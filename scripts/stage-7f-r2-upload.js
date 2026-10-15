const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const { createR2Client, getR2Credentials, getRemoteHead } = require('./publish-library');
const { parseWorkbook } = require('./amazon-kdp-import');

const root = path.join(__dirname, '..');
const defaultPlanPath = path.join(root, 'reports', 'stage-7e-r2-upload-plan.json');
const defaultResultPath = path.join(root, 'reports', 'stage-7f-r2-upload-results.jsonl');
const defaultPreflightPath = path.join(root, 'reports', 'stage-7f-r2-preflight.json');
const bucketName = 'hawkins-hollow-library';
const expectedBookCounts = new Map([
  ['HH-C+-0007', 45],
  ['HH-F-0008', 35],
  ['HH-F-0009', 35],
  ['HH-B-0003', 20]
]);
const resourceIds = new Set([
  'HH-R-0022',
  'HH-R-0023',
  'HH-R-0030',
  'HH-R-0034',
  'HH-R-0036',
  'HH-R-0037',
  'HH-R-0039',
  'HH-R-0046',
  'HH-R-0054',
  'HH-S-0110',
  'HH-S-0116'
]);
const expectedCounts = new Map([
  ...expectedBookCounts,
  ...Array.from(resourceIds, (id) => [id, 1])
]);
const expectedTotal = 146;
const legacyPrefix = 'books/hh-c-growing-together/hh-c-0001-0010/HH-C+-0007 Callen Crow’s Lost Feather/';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isLiveBook(id, workbookRecords) {
  return workbookRecords.some((record) => record.id === id && record.status === 'live');
}

function localPathFor(candidate) {
  const sourcePath = path.resolve(root, candidate.localSourcePath);
  const libraryRoot = `${path.resolve(root, 'Library')}${path.sep}`;
  if (!sourcePath.startsWith(libraryRoot)) {
    throw new Error(`Source path escapes Library: ${candidate.localSourcePath}`);
  }
  return sourcePath;
}

function validatePlan({ planPath = defaultPlanPath, manifestPath, workbookPath } = {}) {
  const plan = readJson(planPath);
  const manifest = readJson(manifestPath || path.join(root, 'generated', 'manifest', 'manifest.json'));
  const recordsById = new Map((manifest.records || []).map((record) => [record.id, record]));
  const workbookRecords = parseWorkbook(workbookPath || path.join(root, 'Amazon KDP Info.xlsx'));
  const liveIds = new Set(workbookRecords
    .filter((record) => record.status === 'live')
    .map((record) => record.id));
  const candidates = plan.candidates;
  if (plan.schemaVersion !== 1 || !Array.isArray(candidates) || candidates.length !== expectedTotal) {
    throw new Error(`Expected the unchanged Stage 7E plan with exactly ${expectedTotal} candidates.`);
  }
  if (plan.remoteVerification?.bucket !== bucketName) {
    throw new Error(`Stage 7E plan bucket must be ${bucketName}.`);
  }
  if (liveIds.size !== 79) throw new Error(`KDP workbook has ${liveIds.size} Live Books; expected 79.`);

  const keySet = new Set();
  const counts = new Map();
  let totalBytes = 0;
  for (const candidate of candidates) {
    const id = String(candidate.ownerCanonicalId || '').toUpperCase();
    const expectedCount = expectedCounts.get(id);
    if (!expectedCount) throw new Error(`Owner is outside the Stage 7F allowlist: ${id}`);
    if (candidate.verifiedRemoteStatus !== 'verified-absent' || candidate.uploadCandidate !== true) {
      throw new Error(`Candidate is not marked verified-absent in the Stage 7E plan: ${candidate.destinationR2Key}`);
    }
    if (candidate.uploadAuthorization !== 'not-authorized') {
      throw new Error(`Unexpected authorization state for ${candidate.destinationR2Key}.`);
    }
    if (keySet.has(candidate.destinationR2Key)) {
      throw new Error(`Duplicate destination key: ${candidate.destinationR2Key}`);
    }
    keySet.add(candidate.destinationR2Key);

    const ownerType = expectedBookCounts.has(id) ? 'book' : id.startsWith('HH-R-') ? 'rhyme' : 'song';
    if (candidate.ownerType !== ownerType) throw new Error(`Incorrect owner type for ${id}.`);
    if (ownerType === 'book' && !isLiveBook(id, workbookRecords)) {
      throw new Error(`Book is not Live in Amazon KDP Info.xlsx: ${id}`);
    }
    if (ownerType === 'rhyme' && (!id.startsWith('HH-R-') || !candidate.manifestSourcePath.includes('Mode R Nursery Rhymes'))) {
      throw new Error(`Rhyme ownership/path mismatch for ${id}.`);
    }
    if (ownerType === 'song' && (!id.startsWith('HH-S-') || !candidate.manifestSourcePath.includes('Mode S Kids'))) {
      throw new Error(`Song ownership/path mismatch for ${id}.`);
    }

    const record = recordsById.get(id);
    if (!record) throw new Error(`Manifest record is missing for owner ${id}.`);
    const asset = (record.assets || []).find((entry) => entry.key === candidate.destinationR2Key);
    if (!asset
      || asset.sourcePath !== candidate.manifestSourcePath
      || asset.sha256 !== candidate.sha256
      || Number(asset.sizeBytes) !== Number(candidate.sizeBytes)) {
      throw new Error(`Plan entry does not match the current local manifest: ${candidate.destinationR2Key}`);
    }
    if (id === 'HH-C+-0007' && !candidate.destinationR2Key.includes('/hh-c-0007-callen-crow-s-lost-feather/')) {
      throw new Error(`C+-0007 destination violates the established hh-c- storage prefix.`);
    }

    const source = localPathFor(candidate);
    const buffer = fs.readFileSync(source);
    if (buffer.length !== Number(candidate.sizeBytes) || sha256(buffer) !== candidate.sha256) {
      throw new Error(`Local source integrity check failed: ${candidate.localSourcePath}`);
    }
    candidate._sourcePath = source;
    candidate._contentType = asset.contentType;
    counts.set(id, (counts.get(id) || 0) + 1);
    totalBytes += buffer.length;
  }

  for (const [id, expected] of expectedCounts) {
    if ((counts.get(id) || 0) !== expected) {
      throw new Error(`${id}: expected ${expected} candidates, found ${counts.get(id) || 0}.`);
    }
  }
  if (keySet.size !== expectedTotal) throw new Error(`Expected ${expectedTotal} unique destination keys.`);
  if (plan.excluded?.nonLiveBookIds?.includes('HH-F-0010') !== true) {
    throw new Error('The Stage 7E plan must explicitly exclude non-Live HH-F-0010.');
  }

  return { plan, candidates, counts, totalBytes, liveBookCount: liveIds.size };
}

async function verifyAllAbsent(client, bucket, candidates) {
  const statuses = [];
  for (const candidate of candidates) {
    try {
      const head = await getRemoteHead(client, bucket, candidate.destinationR2Key);
      statuses.push({
        key: candidate.destinationR2Key,
        status: head ? 'present-conflict' : 'verified-absent'
      });
    } catch (error) {
      statuses.push({
        key: candidate.destinationR2Key,
        status: 'unverified',
        error: error?.name || 'RemoteReadError'
      });
    }
  }
  return statuses;
}

async function verifyLegacyObjects(client, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: legacyPrefix,
      ContinuationToken: continuationToken
    }));
    keys.push(...(page.Contents || []).map((object) => object.Key));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function summarize({ candidates, counts, totalBytes, liveBookCount }, remoteStatuses, legacyKeys) {
  return {
    bucket: bucketName,
    candidateCount: candidates.length,
    totalBytes,
    uniqueDestinationKeys: new Set(candidates.map((candidate) => candidate.destinationR2Key)).size,
    liveBookCount,
    distribution: Object.fromEntries(counts),
    remote: {
      verifiedAbsent: remoteStatuses.filter((entry) => entry.status === 'verified-absent').length,
      presentConflicts: remoteStatuses.filter((entry) => entry.status === 'present-conflict').length,
      unverified: remoteStatuses.filter((entry) => entry.status === 'unverified').length
    },
    legacyCPlusObjectsPreserved: legacyKeys.length,
    deletions: 0,
    overwrites: 0
  };
}

async function uploadOne(client, bucket, candidate) {
  const key = candidate.destinationR2Key;
  const before = await getRemoteHead(client, bucket, key);
  if (before) return { key, status: 'skipped-present-conflict' };

  const body = fs.readFileSync(candidate._sourcePath);
  if (body.length !== Number(candidate.sizeBytes) || sha256(body) !== candidate.sha256) {
    return { key, status: 'failed-local-integrity' };
  }
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: candidate._contentType || 'application/octet-stream',
      CacheControl: 'public, max-age=604800, immutable',
      Metadata: { sha256: candidate.sha256 },
      IfNoneMatch: '*'
    }));
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code || 'PutObjectError';
    let afterFailure;
    try {
      afterFailure = await getRemoteHead(client, bucket, key);
    } catch (headError) {
      return { key, status: 'upload-outcome-unverified', error: headError?.name || 'RemoteReadError' };
    }
    if ((status !== 412 && code !== 'PreconditionFailed')
      && afterFailure
      && Number(afterFailure.ContentLength) === Number(candidate.sizeBytes)
      && String(afterFailure.Metadata?.sha256 || '') === candidate.sha256) {
      return { key, status: 'present-matching-after-put-error', error: code };
    }
    return {
      key,
      status: afterFailure || status === 412 || code === 'PreconditionFailed'
        ? 'skipped-present-conflict'
        : 'failed-upload',
      error: code
    };
  }

  const verified = await getRemoteHead(client, bucket, key);
  if (!verified
    || Number(verified.ContentLength) !== Number(candidate.sizeBytes)
    || String(verified.Metadata?.sha256 || '') !== candidate.sha256) {
    return { key, status: 'failed-post-upload-verification' };
  }
  return { key, status: 'uploaded-and-verified' };
}

async function runPreflight(options = {}) {
  const validated = validatePlan(options);
  const credentials = getR2Credentials({ bucket: bucketName });
  if (!credentials.hasCredentials) throw new Error('R2 read-only preflight requires configured credentials.');
  const client = createR2Client(credentials);
  try {
    const remoteStatuses = await verifyAllAbsent(client, bucketName, validated.candidates);
    const legacyKeys = await verifyLegacyObjects(client, bucketName);
    const plannedLegacyKeys = [...(validated.plan.protectedLegacyObjects?.keys || [])].sort();
    const legacyKeysMatchPlan = JSON.stringify([...legacyKeys].sort()) === JSON.stringify(plannedLegacyKeys);
    const result = summarize(validated, remoteStatuses, legacyKeys);
    result.readyForSeparatelyAuthorizedUpload = result.remote.verifiedAbsent === expectedTotal
      && result.remote.presentConflicts === 0
      && result.remote.unverified === 0
      && legacyKeys.length === 45
      && legacyKeysMatchPlan;
    result.authorization = 'not-authorized';
    result.generatedAt = new Date().toISOString();
    result.legacyKeysMatchStage7EPlan = legacyKeysMatchPlan;
    result.candidates = remoteStatuses.map((remote) => {
      const candidate = validated.candidates.find((entry) => entry.destinationR2Key === remote.key);
      return {
        ownerCanonicalId: candidate.ownerCanonicalId,
        localSourcePath: candidate.localSourcePath,
        destinationR2Key: candidate.destinationR2Key,
        sizeBytes: candidate.sizeBytes,
        sha256: candidate.sha256,
        verifiedRemoteStatus: remote.status,
        error: remote.error || null
      };
    });
    const preflightPath = options.preflightPath || defaultPreflightPath;
    result.preflightPath = path.relative(root, preflightPath);
    fs.mkdirSync(path.dirname(preflightPath), { recursive: true });
    fs.writeFileSync(preflightPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    return result;
  } finally {
    client.destroy();
  }
}

async function runUpload(options = {}) {
  if (options.ownerAuthorized !== true) {
    throw new Error('Upload refused: explicit owner authorization flag is required.');
  }
  const validated = validatePlan(options);
  const credentials = getR2Credentials({ bucket: bucketName });
  if (!credentials.hasCredentials) throw new Error('R2 credentials are required for the authorized upload.');
  const client = createR2Client(credentials);
  const resultPath = options.resultPath || defaultResultPath;
  if (fs.existsSync(resultPath)) throw new Error(`Refusing to reuse an existing one-time result log: ${resultPath}`);

  try {
    const initialStatuses = await verifyAllAbsent(client, bucketName, validated.candidates);
    if (initialStatuses.some((entry) => entry.status !== 'verified-absent')) {
      throw new Error('Upload refused: at least one destination is present or its remote status is unverified.');
    }
    const legacyKeys = await verifyLegacyObjects(client, bucketName);
    const plannedLegacyKeys = [...(validated.plan.protectedLegacyObjects?.keys || [])].sort();
    if (legacyKeys.length !== 45
      || JSON.stringify([...legacyKeys].sort()) !== JSON.stringify(plannedLegacyKeys)) {
      throw new Error('Upload refused: legacy C+-0007 objects differ from the Stage 7E preservation set.');
    }

    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    const fd = fs.openSync(resultPath, 'wx');
    fs.closeSync(fd);
    const results = [];
    for (const candidate of validated.candidates) {
      let outcome;
      try {
        outcome = await uploadOne(client, bucketName, candidate);
      } catch (error) {
        outcome = {
          key: candidate.destinationR2Key,
          status: 'failed-remote-verification',
          error: error?.name || 'RemoteReadError'
        };
      }
      const row = {
        timestamp: new Date().toISOString(),
        ownerCanonicalId: candidate.ownerCanonicalId,
        destinationR2Key: candidate.destinationR2Key,
        status: outcome.status,
        error: outcome.error || null
      };
      fs.appendFileSync(resultPath, `${JSON.stringify(row)}\n`, 'utf8');
      results.push(row);
    }

    return {
      resultPath: path.relative(root, resultPath),
      candidateCount: validated.candidates.length,
      uploadedAndVerified: results.filter((entry) => entry.status === 'uploaded-and-verified').length,
      failuresOrConflicts: results.filter((entry) => entry.status !== 'uploaded-and-verified').length,
      deletions: 0,
      publicationStateUpdated: false,
      remoteManifestUpdated: false,
      results
    };
  } finally {
    client.destroy();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const ownerAuthorized = process.argv.includes('--owner-authorized');
  const resultPathIndex = process.argv.indexOf('--results');
  const options = {
    ownerAuthorized,
    resultPath: resultPathIndex >= 0 && process.argv[resultPathIndex + 1]
      ? path.resolve(process.argv[resultPathIndex + 1])
      : defaultResultPath
  };
  const operation = apply ? runUpload(options) : runPreflight(options);
  operation.then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.failuresOrConflicts > 0) process.exitCode = 1;
  }).catch((error) => {
    console.error(`Stage 7F ${apply ? 'upload' : 'preflight'} failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runPreflight,
  runUpload,
  summarize,
  uploadOne,
  validatePlan,
  verifyAllAbsent
};
