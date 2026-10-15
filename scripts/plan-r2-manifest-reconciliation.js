const fs = require('fs');
const path = require('path');
const { parseWorkbook } = require('./amazon-kdp-import');
const { createR2Client, getR2Credentials } = require('./publish-library');
const { DEFAULT_LIBRARY_BASE_URL } = require('./freebie-title-art-media');

const root = path.join(__dirname, '..');
const DEFAULT_PLAN_PATH = path.join(root, 'reports', 'stage-7e-r2-upload-plan.json');
const DEFAULT_VERIFICATION_PATH = path.join(root, 'reports', 'stage-7f-r2-post-upload-verification.json');
const DEFAULT_WORKBOOK_PATH = path.join(root, 'Amazon KDP Info.xlsx');
const DEFAULT_BASE_MANIFEST_URL = `${DEFAULT_LIBRARY_BASE_URL}/manifest/manifest.json`;
const DEFAULT_DELTA_PATH = path.join(root, 'generated', 'stage-7i-r2-manifest-delta.json');
const DEFAULT_MANIFEST_PATH = path.join(root, 'generated', 'stage-7i-reconciled-manifest.json');
const DEFAULT_REPORT_PATH = path.join(root, 'generated', 'stage-7i-r2-manifest-dry-run.json');
const EXPECTED_BUCKET = 'hawkins-hollow-library';
const EXPECTED_CANDIDATE_COUNT = 146;
const EXPECTED_LIVE_BOOK_COUNT = 79;
const EXPECTED_BOOK_COUNTS = new Map([
  ['HH-C+-0007', 45],
  ['HH-F-0008', 35],
  ['HH-F-0009', 35],
  ['HH-B-0003', 20]
]);
const EXPECTED_BOOK_SERIES = new Map([
  ['HH-C+-0007', 'Growing Together'],
  ['HH-F-0008', 'Holiday Story Poems'],
  ['HH-F-0009', 'Holiday Story Poems'],
  ['HH-B-0003', 'First Readers']
]);
const EXPECTED_RESOURCE_COUNTS = new Map([
  ['HH-R-0022', 1],
  ['HH-R-0023', 1],
  ['HH-R-0030', 1],
  ['HH-R-0034', 1],
  ['HH-R-0036', 1],
  ['HH-R-0037', 1],
  ['HH-R-0039', 1],
  ['HH-R-0046', 1],
  ['HH-R-0054', 1],
  ['HH-S-0110', 1],
  ['HH-S-0116', 1]
]);
const LEGACY_C7_KEY_PREFIX = 'books/hh-c-growing-together/hh-c-0001-0010/hh-c-0007-callen-crow-s-lost-feather-cover/';
const LEGACY_C7_OBJECT_PREFIX = 'books/hh-c-growing-together/hh-c-0001-0010/HH-C+-0007 Callen Crow’s Lost Feather/';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256Pattern(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function toAssetSlug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extensionContentType(sourcePath) {
  const extension = path.posix.extname(String(sourcePath || '')).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.docx' || extension === '.mp3' || extension === '.wav' || extension === '.mp4') {
    return 'application/octet-stream';
  }
  throw new Error(`Unsupported Stage 7F candidate extension: ${sourcePath}`);
}

function assertVerification(plan, verification) {
  if (!verification
    || verification.bucket !== EXPECTED_BUCKET
    || verification.approvedPlanGeneratedAt !== plan.generatedAt
    || verification.legacyObjectSetUnchanged !== true
    || Number(verification.legacyObjectsPresent) !== 45
    || !Array.isArray(verification.checks)
    || verification.checks.length !== EXPECTED_CANDIDATE_COUNT
    || (verification.remainingMissing || []).length !== 0
    || (verification.mismatches || []).length !== 0
    || (verification.unresolved || []).length !== 0) {
    throw new Error('Stage 7F verification does not confirm the complete approved plan and protected legacy objects.');
  }
  const checks = new Map(verification.checks.map((check) => {
    if (check.status !== 'verified-present-match') {
      throw new Error(`Stage 7F evidence is not a verified match for ${check.key}.`);
    }
    return [check.key, check];
  }));
  if (checks.size !== EXPECTED_CANDIDATE_COUNT) {
    throw new Error('Stage 7F verification has duplicate destination keys.');
  }
  return checks;
}

function validatePlan(plan, verification, workbookRecords) {
  if (plan.schemaVersion !== 1
    || plan.authority?.liveBookCount !== EXPECTED_LIVE_BOOK_COUNT
    || plan.summary?.expectedPublicContentCandidateCount !== EXPECTED_CANDIDATE_COUNT
    || plan.summary?.planRowCount !== EXPECTED_CANDIDATE_COUNT
    || !Array.isArray(plan.candidates)
    || plan.candidates.length !== EXPECTED_CANDIDATE_COUNT
    || plan.remoteVerification?.bucket !== EXPECTED_BUCKET
    || plan.excluded?.nonLiveBookIds?.includes('HH-F-0010') !== true) {
    throw new Error('Stage 7E plan scope, bucket, or KDP authority does not match the approved Stage 7F set.');
  }
  const verificationByKey = assertVerification(plan, verification);
  const liveRecords = new Map(workbookRecords
    .filter((record) => record.status === 'live')
    .map((record) => [record.id, record]));
  if (liveRecords.size !== EXPECTED_LIVE_BOOK_COUNT) {
    throw new Error(`Reviewed KDP workbook has ${liveRecords.size} Live Books; expected ${EXPECTED_LIVE_BOOK_COUNT}.`);
  }

  const expectedCounts = new Map([...EXPECTED_BOOK_COUNTS, ...EXPECTED_RESOURCE_COUNTS]);
  const counts = new Map();
  const keys = new Set();
  const sourcePaths = new Set();
  const normalizedCandidates = [];
  for (const candidate of plan.candidates) {
    const ownerId = String(candidate.ownerCanonicalId || '').toUpperCase();
    const expectedCount = expectedCounts.get(ownerId);
    const key = String(candidate.destinationR2Key || '');
    const sourcePath = String(candidate.manifestSourcePath || '').replace(/\\/g, '/');
    const localSourcePath = String(candidate.localSourcePath || '').replace(/\\/g, '/');
    const check = verificationByKey.get(key);
    if (!expectedCount) throw new Error(`Candidate owner is outside the Stage 7F allowlist: ${ownerId}.`);
    if (candidate.verifiedRemoteStatus !== 'verified-absent'
      || candidate.uploadCandidate !== true
      || candidate.uploadAuthorization !== 'not-authorized') {
      throw new Error(`Unexpected candidate authorization state for ${key}.`);
    }
    if (keys.has(key)) throw new Error(`Duplicate candidate R2 key: ${key}.`);
    if (sourcePaths.has(sourcePath)) throw new Error(`Duplicate candidate source path: ${sourcePath}.`);
    if (!sourcePath || sourcePath.startsWith('/') || sourcePath.split('/').some((segment) => segment === '..' || segment === '.')) {
      throw new Error(`Unsafe candidate source path: ${sourcePath}.`);
    }
    if (localSourcePath !== `Library/${sourcePath}`) {
      throw new Error(`Local and manifest source paths disagree for ${key}.`);
    }
    if (!sha256Pattern(candidate.sha256) || !Number.isSafeInteger(Number(candidate.sizeBytes)) || Number(candidate.sizeBytes) <= 0) {
      throw new Error(`Candidate has invalid size or SHA-256 metadata: ${key}.`);
    }
    if (!check
      || check.ownerCanonicalId !== ownerId
      || Number(check.remoteSize) !== Number(candidate.sizeBytes)
      || String(check.remoteSha256 || '').toLowerCase() !== String(candidate.sha256).toLowerCase()) {
      throw new Error(`Stage 7F verification metadata does not match the candidate: ${key}.`);
    }

    const isBook = EXPECTED_BOOK_COUNTS.has(ownerId);
    if (isBook) {
      const workbookRecord = liveRecords.get(ownerId);
      if (!workbookRecord) throw new Error(`Book is not Live in the reviewed KDP workbook: ${ownerId}.`);
      if (candidate.ownerType !== 'book' || toAssetSlug(candidate.ownerTitle) !== toAssetSlug(workbookRecord.title)) {
        throw new Error(`KDP owner identity/title mismatch for ${ownerId}.`);
      }
      const folderNames = sourcePath.split('/').slice(1, -1);
      const canonicalKeyId = ownerId.toLowerCase().replace(/\+/g, '');
      const shortKeyId = canonicalKeyId.replace(/-000([1-9])$/, '-00$1');
      const titleSlug = toAssetSlug(candidate.ownerTitle);
      const hasCanonicalOwnerFolder = folderNames.some((folderName) => {
        const folderSlug = toAssetSlug(folderName);
        return folderSlug.includes(titleSlug)
          && [canonicalKeyId, shortKeyId].some((id) => folderSlug.startsWith(id));
      });
      if (!/^Books\//.test(sourcePath)
        || !hasCanonicalOwnerFolder
        || !key.startsWith('books/')
        || ![canonicalKeyId, shortKeyId].some((id) => key.includes(`/${id}-${titleSlug}/`))) {
        throw new Error(`Book asset source path does not match its canonical owner's title: ${sourcePath}.`);
      }
      if (ownerId === 'HH-C+-0007' && !key.startsWith('books/hh-c-growing-together/hh-c-0001-0010/hh-c-0007-callen-crow-s-lost-feather/')) {
        throw new Error(`C+-0007 key does not use the corrected hh-c- prefix: ${key}.`);
      }
    } else {
      const expectedType = ownerId.startsWith('HH-R-') ? 'rhyme' : 'song';
      const expectedFolder = expectedType === 'rhyme' ? 'Freebies/Mode R Nursery Rhymes/' : "Freebies/Mode S Kids' Songs/";
      if (candidate.ownerType !== expectedType
        || !sourcePath.startsWith(expectedFolder)
        || !sourcePath.includes(ownerId)
        || key !== sourcePath) {
        throw new Error(`Freebie candidate ownership or source/key mismatch for ${ownerId}: ${key}.`);
      }
    }

    keys.add(key);
    sourcePaths.add(sourcePath);
    counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
    normalizedCandidates.push({
      ownerCanonicalId: ownerId,
      ownerTitle: candidate.ownerTitle,
      ownerType: candidate.ownerType,
      sourcePath,
      key,
      sizeBytes: Number(candidate.sizeBytes),
      sha256: String(candidate.sha256).toLowerCase(),
      contentType: extensionContentType(sourcePath),
      role: isBook ? 'book' : 'other'
    });
  }

  for (const [ownerId, expectedCount] of expectedCounts) {
    if ((counts.get(ownerId) || 0) !== expectedCount) {
      throw new Error(`${ownerId}: expected ${expectedCount} approved assets, found ${counts.get(ownerId) || 0}.`);
    }
  }
  for (const key of verificationByKey.keys()) {
    if (!keys.has(key)) throw new Error(`Stage 7F verification includes an unapproved key: ${key}.`);
  }
  return { candidates: normalizedCandidates, counts, liveRecords, liveBookCount: liveRecords.size };
}

function createManifestReconciliation({ plan, verification, workbookRecords, baseManifest, baseUrl = DEFAULT_LIBRARY_BASE_URL }) {
  const validated = validatePlan(plan, verification, workbookRecords);
  if (!baseManifest || !Array.isArray(baseManifest.records)) {
    throw new Error('The current published manifest must contain a records array.');
  }
  const recordsById = new Map();
  for (const record of baseManifest.records) {
    const id = String(record.id || '').toUpperCase();
    if (!id || recordsById.has(id)) throw new Error(`The current manifest has a missing or duplicate owner ID: ${id || '(empty)'}.`);
    recordsById.set(id, { ...record, assets: Array.isArray(record.assets) ? record.assets.slice() : [] });
  }

  const obsoleteC7References = [];
  for (const [recordId, record] of recordsById) {
    const kept = [];
    for (const asset of record.assets) {
      if (String(asset.key || '').startsWith(LEGACY_C7_KEY_PREFIX)) {
        if (recordId !== 'HH-C+-0007') throw new Error(`Obsolete C+-0007 asset reference is owned by ${recordId}.`);
        obsoleteC7References.push(asset);
      } else {
        kept.push(asset);
      }
    }
    record.assets = kept;
  }
  if (![0, 45].includes(obsoleteC7References.length)) {
    throw new Error(`Expected either zero or 45 obsolete C+-0007 manifest references; found ${obsoleteC7References.length}.`);
  }

  const deltaRecords = new Map();
  const globalAssetOwners = new Map();
  for (const [recordId, record] of recordsById) {
    for (const asset of record.assets) {
      if (!asset.key) continue;
      if (globalAssetOwners.has(asset.key) && globalAssetOwners.get(asset.key) !== recordId) {
        throw new Error(`Existing manifest key is claimed by multiple owners: ${asset.key}.`);
      }
      globalAssetOwners.set(asset.key, recordId);
    }
  }
  const base = String(baseUrl || DEFAULT_LIBRARY_BASE_URL).replace(/\/+$/, '');
  for (const candidate of validated.candidates) {
    const id = candidate.ownerCanonicalId;
    let record = recordsById.get(id);
    if (!record) {
      if (candidate.ownerType !== 'book') {
        throw new Error(`Published freebie owner record is missing from the current manifest: ${id}.`);
      }
      record = {
        id,
        title: candidate.ownerTitle,
        series: EXPECTED_BOOK_SERIES.get(id),
        assets: []
      };
      recordsById.set(id, record);
    } else if (candidate.ownerType === 'book') {
      record.title = candidate.ownerTitle;
      record.series = EXPECTED_BOOK_SERIES.get(id);
    }

    const competingOwner = globalAssetOwners.get(candidate.key);
    if (competingOwner && competingOwner !== id) {
      throw new Error(`Candidate key already belongs to a different manifest owner: ${candidate.key}.`);
    }
    globalAssetOwners.set(candidate.key, id);
    const asset = {
      role: candidate.role,
      key: candidate.key,
      sourcePath: candidate.sourcePath,
      url: `${base}/${encodeURI(candidate.key)}`,
      sizeBytes: candidate.sizeBytes,
      sha256: candidate.sha256,
      contentType: candidate.contentType
    };
    const sameSource = record.assets.filter((existing) => existing.sourcePath === candidate.sourcePath);
    if (sameSource.length > 1) {
      throw new Error(`Multiple current manifest assets claim source ${candidate.sourcePath}.`);
    }
    const existingIndex = record.assets.findIndex((existing) => existing.sourcePath === candidate.sourcePath);
    const existing = existingIndex >= 0 ? record.assets[existingIndex] : null;
    if (existing && existing.key === candidate.key) {
      if (Number(existing.sizeBytes) !== candidate.sizeBytes
        || String(existing.sha256 || '').toLowerCase() !== candidate.sha256
        || String(existing.contentType || '').toLowerCase() !== candidate.contentType) {
        throw new Error(`Current manifest metadata conflicts with verified candidate ${candidate.key}.`);
      }
      record.assets[existingIndex] = { ...existing, ...asset };
      deltaRecords.set(id, deltaRecords.get(id) || { id, added: [], replaced: [], removed: [] });
    } else if (existing) {
      record.assets[existingIndex] = asset;
      const entry = deltaRecords.get(id) || { id, added: [], replaced: [], removed: [] };
      entry.replaced.push({ from: existing, to: asset });
      deltaRecords.set(id, entry);
    } else {
      record.assets.push(asset);
      const entry = deltaRecords.get(id) || { id, added: [], replaced: [], removed: [] };
      entry.added.push(asset);
      deltaRecords.set(id, entry);
    }
  }

  if (obsoleteC7References.length) {
    const entry = deltaRecords.get('HH-C+-0007') || { id: 'HH-C+-0007', added: [], replaced: [], removed: [] };
    entry.removed.push(...obsoleteC7References);
    deltaRecords.set('HH-C+-0007', entry);
  }
  const delta = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourcePlanGeneratedAt: plan.generatedAt,
    sourceVerificationAt: verification.verifiedAt,
    bucket: EXPECTED_BUCKET,
    remoteManifestVersion: baseManifest.generatedAt || null,
    summary: {
      approvedAssetCount: validated.candidates.length,
      added: Array.from(deltaRecords.values()).reduce((sum, record) => sum + record.added.length, 0),
      replaced: Array.from(deltaRecords.values()).reduce((sum, record) => sum + record.replaced.length, 0),
      removedManifestReferences: obsoleteC7References.length,
      remoteObjectsDeleted: 0,
      preservedLegacyC7ObjectCount: 45
    },
    records: Array.from(deltaRecords.values()).sort((left, right) => left.id.localeCompare(right.id))
  };
  const reconciledManifest = {
    ...baseManifest,
    generatedAt: new Date().toISOString(),
    records: Array.from(recordsById.values()).sort((left, right) => String(left.id).localeCompare(String(right.id)))
  };
  const report = {
    status: 'dry-run-only',
    generatedAt: delta.generatedAt,
    bucket: EXPECTED_BUCKET,
    liveBookCount: validated.liveBookCount,
    candidateCount: validated.candidates.length,
    uniqueDestinationKeyCount: new Set(validated.candidates.map((candidate) => candidate.key)).size,
    candidatesByOwner: Object.fromEntries(Array.from(validated.counts).sort(([a], [b]) => a.localeCompare(b))),
    delta: delta.summary,
    remoteVerification: {
      stage7fMatches: verification.checks.length,
      currentHeadMatches: null,
      status: 'Stage 7F evidence validated; fresh HEAD validation is required by the CLI before writing outputs.'
    },
    legacyC7: {
      verifiedObjectsPresent: verification.legacyObjectsPresent,
      objectSetUnchanged: verification.legacyObjectSetUnchanged,
      manifestReferencesRemoved: obsoleteC7References.length,
      remoteDeletionRequested: false
    },
    excludedNonLiveBooks: ['HH-F-0010'],
    writesRemoteManifest: false
  };
  return { delta, reconciledManifest, report, candidates: validated.candidates };
}

async function getPublishedManifest(url = DEFAULT_BASE_MANIFEST_URL, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not fetch current published manifest: HTTP ${response.status}.`);
  const manifest = await response.json();
  if (!manifest || !Array.isArray(manifest.records)) {
    throw new Error('Current published manifest response is invalid.');
  }
  return manifest;
}

async function verifyCurrentHeads(client, candidates, bucket = EXPECTED_BUCKET) {
  const { getRemoteHead } = require('./publish-library');
  const verified = [];
  for (const candidate of candidates) {
    const head = await getRemoteHead(client, bucket, candidate.key);
    if (!head
      || Number(head.ContentLength) !== candidate.sizeBytes
      || String(head.Metadata && head.Metadata.sha256 || '').toLowerCase() !== candidate.sha256
      || String(head.ContentType || '').split(';')[0].trim().toLowerCase() !== candidate.contentType) {
      throw new Error(`Current R2 HEAD does not match verified asset metadata: ${candidate.key}.`);
    }
    verified.push(candidate.key);
  }
  return verified;
}

function parseArgs(argv) {
  const options = {
    plan: DEFAULT_PLAN_PATH,
    verification: DEFAULT_VERIFICATION_PATH,
    workbook: DEFAULT_WORKBOOK_PATH,
    baseManifestUrl: DEFAULT_BASE_MANIFEST_URL,
    delta: DEFAULT_DELTA_PATH,
    manifest: DEFAULT_MANIFEST_PATH,
    report: DEFAULT_REPORT_PATH
  };
  const names = new Map([
    ['--plan', 'plan'],
    ['--verification', 'verification'],
    ['--workbook', 'workbook'],
    ['--base-manifest-url', 'baseManifestUrl'],
    ['--delta', 'delta'],
    ['--manifest', 'manifest'],
    ['--report', 'report']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (name && argv[index + 1]) {
      options[name] = name === 'baseManifestUrl' ? argv[++index] : path.resolve(argv[++index]);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = readJson(options.plan);
  const verification = readJson(options.verification);
  const workbookRecords = parseWorkbook(options.workbook);
  const baseManifest = await getPublishedManifest(options.baseManifestUrl);
  const result = createManifestReconciliation({ plan, verification, workbookRecords, baseManifest });
  const credentials = getR2Credentials({ bucket: EXPECTED_BUCKET });
  if (!credentials.hasCredentials) {
    throw new Error('Read-only R2 credentials are required to revalidate current object HEAD metadata.');
  }
  const client = createR2Client(credentials);
  try {
    const currentHeads = await verifyCurrentHeads(client, result.candidates, EXPECTED_BUCKET);
    result.report.remoteVerification.currentHeadMatches = currentHeads.length;
    result.report.remoteVerification.status = 'Stage 7F evidence and fresh read-only HEAD metadata match all candidates.';
  } finally {
    client.destroy();
  }
  writeJson(options.delta, result.delta);
  writeJson(options.manifest, result.reconciledManifest);
  writeJson(options.report, result.report);
  console.log(`Manifest reconciliation dry run: ${result.candidates.length} verified assets; ${result.delta.summary.added} additions, ${result.delta.summary.replaced} replacements, ${result.delta.summary.removedManifestReferences} stale references removed from proposed manifest only.`);
  console.log(`Proposed files: ${path.relative(root, options.delta)}, ${path.relative(root, options.manifest)}, ${path.relative(root, options.report)}. No remote manifest or R2 object was changed.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`R2 manifest reconciliation failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_BASE_MANIFEST_URL,
  EXPECTED_BOOK_COUNTS,
  EXPECTED_CANDIDATE_COUNT,
  EXPECTED_LIVE_BOOK_COUNT,
  EXPECTED_RESOURCE_COUNTS,
  LEGACY_C7_KEY_PREFIX,
  createManifestReconciliation,
  extensionContentType,
  getPublishedManifest,
  parseArgs,
  validatePlan,
  verifyCurrentHeads
};
