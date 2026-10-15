const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { createR2Client, getR2Credentials, getRemoteHead } = require('./publish-library');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'generated', 'manifest', 'manifest.json');
const publicationPath = path.join(root, 'generated', 'amazon-index.json');
const publishStatePath = path.join(root, 'generated', 'manifest', 'publish-state.json');
const defaultOutputPath = path.join(root, 'reports', 'stage-7e-r2-upload-plan.json');
const expectedBookCounts = new Map([
  ['HH-C+-0007', 45],
  ['HH-F-0008', 35],
  ['HH-F-0009', 35],
  ['HH-B-0003', 20]
]);
const resourceIds = [
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
];
const oldCPlusPrefix = 'books/hh-c-growing-together/hh-c-0001-0010/HH-C+-0007 Callen Crow’s Lost Feather/';
const expectedCandidateCount = 146;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

async function listKeys(client, bucket, prefix) {
  const keys = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));
    keys.push(...(page.Contents || []).map((object) => object.Key));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function requireRecord(recordsById, id) {
  const record = recordsById.get(id);
  if (!record) throw new Error(`Required manifest owner is missing: ${id}`);
  return record;
}

async function verifyAsset(client, bucket, record, asset, ownerType) {
  const sourcePath = path.join(root, 'Library', asset.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Local source is missing for ${record.id}: ${asset.sourcePath}`);
  }

  const actualSize = fs.statSync(sourcePath).size;
  const actualSha256 = sha256File(sourcePath);
  if (actualSize !== Number(asset.sizeBytes) || actualSha256 !== asset.sha256) {
    throw new Error(`Local source differs from manifest for ${record.id}: ${asset.sourcePath}`);
  }

  let head;
  try {
    head = await getRemoteHead(client, bucket, asset.key);
  } catch (error) {
    const code = error && (error.name || error.Code || 'RemoteReadError');
    throw new Error(`Remote status is unverified for ${asset.key} (${code}).`);
  }

  return {
    ownerCanonicalId: record.id,
    ownerTitle: record.title,
    ownerType,
    localSourcePath: path.relative(root, sourcePath).replace(/\\/g, '/'),
    manifestSourcePath: asset.sourcePath,
    destinationR2Key: asset.key,
    sizeBytes: actualSize,
    sha256: actualSha256,
    verifiedRemoteStatus: head ? 'verified-present' : 'verified-absent',
    uploadCandidate: !head,
    uploadAuthorization: 'not-authorized'
  };
}

async function preparePlan({ outputPath = defaultOutputPath } = {}) {
  const manifest = readJson(manifestPath);
  const publication = readJson(publicationPath);
  const publishState = fs.existsSync(publishStatePath) ? readJson(publishStatePath) : {};
  const recordsById = new Map((manifest.records || []).map((record) => [record.id, record]));
  const liveIds = new Set((publication.liveRecords || [])
    .filter((record) => String(record.status || '').trim().toLowerCase() === 'live')
    .map((record) => String(record.id || '').trim().toUpperCase()));
  const requiredBookIds = [...expectedBookCounts.keys()];
  if (liveIds.size !== 79 || requiredBookIds.some((id) => !liveIds.has(id))) {
    throw new Error('KDP-derived Live inventory does not contain the expected 79 books and required owners.');
  }

  const credentials = getR2Credentials({ bucket: 'hawkins-hollow-library' });
  if (!credentials.hasCredentials) {
    throw new Error('Read-only R2 reconciliation requires configured credentials.');
  }
  const client = createR2Client(credentials);

  try {
    const assetGroups = [];
    for (const [id, expectedCount] of expectedBookCounts) {
      const record = requireRecord(recordsById, id);
      let assets = record.assets || [];
      if (id === 'HH-B-0003') {
        assets = assets.filter((asset) => /\/Companion Resources\//i.test(asset.sourcePath)
          && /\.png$/i.test(asset.sourcePath));
      }
      if (assets.length !== expectedCount) {
        throw new Error(`${id}: expected ${expectedCount} scoped assets, found ${assets.length}.`);
      }
      if (id === 'HH-C+-0007'
        && assets.some((asset) => !asset.key.includes('/hh-c-0007-callen-crow-s-lost-feather/'))) {
        throw new Error('HH-C+-0007 contains an asset outside the corrected hh-c- storage folder.');
      }
      assetGroups.push({
        ownerId: id,
        ownerType: 'book',
        assets
      });
    }

    const resources = resourceIds.map((id) => {
      const record = requireRecord(recordsById, id);
      return { ownerId: id, ownerType: id.startsWith('HH-S-') ? 'song' : 'rhyme', assets: record.assets || [] };
    });
    const allScopedAssets = [
      ...assetGroups.flatMap((group) => group.assets.map((asset) => ({
        group, asset, record: recordsById.get(group.ownerId)
      }))),
      ...resources.flatMap((group) => group.assets.map((asset) => ({
        group, asset, record: recordsById.get(group.ownerId)
      })))
    ];
    const verified = await mapLimit(allScopedAssets, 12, ({ group, asset, record }) => (
      verifyAsset(client, credentials.bucket, record, asset, group.ownerType)
    ));
    const groupRows = new Map();
    for (let index = 0; index < allScopedAssets.length; index += 1) {
      const id = allScopedAssets[index].group.ownerId;
      const rows = groupRows.get(id) || [];
      rows.push(verified[index]);
      groupRows.set(id, rows);
    }

    const planRows = [];
    const bookSummaries = [];
    for (const [id, expectedCount] of expectedBookCounts) {
      const rows = groupRows.get(id) || [];
      if (rows.length !== expectedCount) {
        throw new Error(`${id}: verified scoped asset count changed during reconciliation.`);
      }
      planRows.push(...rows);
      bookSummaries.push({
        ownerCanonicalId: id,
        scopedAssetCount: rows.length,
        verifiedAbsent: rows.filter((row) => row.verifiedRemoteStatus === 'verified-absent').length,
        verifiedPresent: rows.filter((row) => row.verifiedRemoteStatus === 'verified-present').length
      });
    }
    const resourceSummaries = [];
    for (const { ownerId } of resources) {
      const missingRows = (groupRows.get(ownerId) || []).filter((row) => row.verifiedRemoteStatus === 'verified-absent');
      planRows.push(...missingRows);
      resourceSummaries.push({
        ownerCanonicalId: ownerId,
        scopedManifestAssetCount: (groupRows.get(ownerId) || []).length,
        verifiedAbsent: missingRows.length
      });
    }

    const legacyKeys = await listKeys(client, credentials.bucket, oldCPlusPrefix);
    const uploadCandidates = planRows.filter((row) => row.uploadCandidate);
    const localManifestText = JSON.stringify(manifest);
    const localStateText = JSON.stringify(publishState);
    const plan = {
      schemaVersion: 1,
      purpose: 'Stage 7E review-only R2 upload plan; no operation is authorized by this file.',
      generatedAt: new Date().toISOString(),
      remoteVerification: {
        method: 'S3 HeadObject for every planned candidate and ListObjectsV2 for preserved legacy keys',
        bucket: credentials.bucket,
        statusMeaning: 'verified-absent means HeadObject returned 404 at generatedAt; status can change afterward.'
      },
      authority: {
        bookPublicationEligibility: 'Amazon KDP Info.xlsx via generated/amazon-index.json',
        liveBookCount: liveIds.size,
        nonLiveBooksIncluded: false
      },
      summary: {
        expectedPublicContentCandidateCount: expectedCandidateCount,
        verifiedAbsentCandidateCount: uploadCandidates.length,
        planRowCount: planRows.length,
        countMatchesExpected: uploadCandidates.length === expectedCandidateCount,
        allCandidatesVerifiedAbsent: uploadCandidates.every((row) => row.verifiedRemoteStatus === 'verified-absent'),
        books: bookSummaries,
        resources: resourceSummaries
      },
      protectedLegacyObjects: {
        prefix: oldCPlusPrefix,
        verifiedPresentCount: legacyKeys.length,
        localManifestReferenceCount: localManifestText.split(oldCPlusPrefix).length - 1,
        localPublishStateReferenceCount: localStateText.split(oldCPlusPrefix).length - 1,
        action: 'preserve; deletion is not authorized',
        keys: legacyKeys
      },
      excluded: {
        nonLiveBookIds: ['HH-F-0010'],
        reason: 'Non-Live Book assets are not included in the public-content upload candidate set.'
      },
      candidates: planRows
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      outputPath: path.relative(root, outputPath),
      planRows: planRows.length,
      verifiedAbsentCandidates: uploadCandidates.length,
      countMatchesExpected: plan.summary.countMatchesExpected,
      protectedLegacyObjects: legacyKeys.length,
      books: bookSummaries,
      resources: resourceSummaries
    }, null, 2));
    return plan;
  } finally {
    client.destroy();
  }
}

if (require.main === module) {
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
    ? path.resolve(process.argv[outputIndex + 1])
    : defaultOutputPath;
  preparePlan({ outputPath }).catch((error) => {
    console.error(`Stage 7E R2 plan failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { preparePlan };
