const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildManifest } = require('./build-manifest');
const { verifyManifest } = require('./verify-library');

const root = path.join(__dirname, '..');
const statePath = path.join(root, 'generated', 'manifest', 'publish-state.json');
const metadataOutputPath = path.join(root, 'generated', 'manifest', 'manifest.meta.json');
const historyDir = path.join(root, 'generated', 'manifest', 'history');

function parseArgs(argv) {
  const args = {
    mode: 'preview',
    baseUrl: process.env.LIBRARY_BASE_URL || 'https://library.hawkinshollowbooks.com',
    output: path.join(root, 'generated', 'manifest', 'manifest.json'),
    bucket: process.env.R2_BUCKET || 'hawkins-hollow-library',
    manifestKey: process.env.LIBRARY_MANIFEST_KEY || 'manifest/manifest.json',
    metadataKey: process.env.LIBRARY_MANIFEST_META_KEY || 'manifest/manifest.meta.json',
    verifyPublic: false,
    multipartThresholdMb: Number(process.env.LIBRARY_MULTIPART_THRESHOLD_MB || 64)
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.mode = 'apply';
    } else if (token === '--preview' || token === '--dry-run') {
      args.mode = 'preview';
    } else if (token === '--verify-public') {
      args.verifyPublic = true;
    } else if (token === '--base-url' && argv[i + 1]) {
      args.baseUrl = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--output' && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--manifest-key' && argv[i + 1]) {
      args.manifestKey = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--metadata-key' && argv[i + 1]) {
      args.metadataKey = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--bucket' && argv[i + 1]) {
      args.bucket = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--multipart-threshold-mb' && argv[i + 1]) {
      args.multipartThresholdMb = Number(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

function readPreviousState() {
  if (!fs.existsSync(statePath)) {
    return {
      manifestVersion: 0,
      records: {},
      assets: {},
      summary: {}
    };
  }

  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function buildRecordHashes(manifest) {
  const hashes = {};
  for (const record of manifest.records || []) {
    const key = String(record.id || record.slug || 'unknown');
    hashes[key] = sha256Json({
      id: record.id,
      slug: record.slug,
      title: record.title,
      series: record.series,
      seriesCode: record.seriesCode,
      assets: (record.assets || []).map((asset) => ({
        role: asset.role,
        key: asset.key,
        sourcePath: asset.sourcePath,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes
      }))
    });
  }
  return hashes;
}

function buildAssetIndex(manifest) {
  const assets = {};
  for (const record of manifest.records || []) {
    for (const asset of record.assets || []) {
      if (!asset || !asset.key) {
        continue;
      }

      assets[asset.key] = {
        key: asset.key,
        sourcePath: asset.sourcePath,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        role: asset.role,
        contentType: asset.contentType
      };
    }
  }
  return assets;
}

function diffRecordHashes(previous, current) {
  const previousKeys = new Set(Object.keys(previous || {}));
  const currentKeys = new Set(Object.keys(current || {}));
  let newRecords = 0;
  let updatedRecords = 0;
  let deletedRecords = 0;

  for (const key of currentKeys) {
    if (!previousKeys.has(key)) {
      newRecords += 1;
      continue;
    }
    if (previous[key] !== current[key]) {
      updatedRecords += 1;
    }
  }

  for (const key of previousKeys) {
    if (!currentKeys.has(key)) {
      deletedRecords += 1;
    }
  }

  return { newRecords, updatedRecords, deletedRecords };
}

function diffAssets(previousAssets, currentAssets) {
  const previousKeys = new Set(Object.keys(previousAssets || {}));
  const currentKeys = new Set(Object.keys(currentAssets || {}));
  const deleted = [];

  for (const key of previousKeys) {
    if (!currentKeys.has(key)) {
      deleted.push(previousAssets[key]);
    }
  }

  return { deleted };
}

function buildSummaryByRole(assetIndex) {
  const roleCounts = {};
  for (const key of Object.keys(assetIndex || {})) {
    const role = assetIndex[key].role || 'other';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  return roleCounts;
}

function cacheControlForAsset(asset) {
  const role = String(asset.role || '').toLowerCase();
  const ext = path.extname(asset.key || '').toLowerCase();

  if (role === 'cover' || role === 'illustration' || role === 'character') {
    return 'public, max-age=2592000, immutable';
  }

  if (role === 'book' || role === 'companion-pack' || role === 'resource') {
    return 'public, max-age=604800, immutable';
  }

  if (ext === '.json') {
    return 'public, max-age=300';
  }

  return 'public, max-age=604800, immutable';
}

function getR2Credentials(overrides = {}) {
  const localCredsPath = process.env.R2_CREDENTIALS_FILE
    ? path.resolve(process.env.R2_CREDENTIALS_FILE)
    : path.join(root, '.r2-credentials.local.json');

  let fileCredentials = {};
  if (fs.existsSync(localCredsPath)) {
    try {
      fileCredentials = JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to parse local credentials file at ${localCredsPath}: ${error.message}`);
    }
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || fileCredentials.accountId || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || fileCredentials.accessKeyId || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || fileCredentials.secretAccessKey || '';
  const bucket = overrides.bucket || process.env.R2_BUCKET || fileCredentials.bucket || 'hawkins-hollow-library';

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    hasCredentials: Boolean(accountId && accessKeyId && secretAccessKey),
    source: fileCredentials && Object.keys(fileCredentials).length > 0 ? 'env+local-file' : 'env-only'
  };
}

function writePublishSummary(summary) {
  fs.mkdirSync(path.dirname(metadataOutputPath), { recursive: true });
  const summaryPath = path.join(path.dirname(metadataOutputPath), 'publish-summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summaryPath;
}

function createR2Client(credentials) {
  const { S3Client } = require('@aws-sdk/client-s3');

  return new S3Client({
    region: 'auto',
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  });
}

async function getRemoteHead(client, bucket, key) {
  const { HeadObjectCommand } = require('@aws-sdk/client-s3');
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const code = error && (error.name || error.Code || '');
    const status = error && error.$metadata ? error.$metadata.httpStatusCode : null;
    if (code === 'NotFound' || status === 404) {
      return null;
    }
    throw error;
  }
}

async function mapWithConcurrency(items, limit, handler) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

async function buildUploadPlan(manifest, credentials) {
  const assetIndex = buildAssetIndex(manifest);
  const assets = Object.values(assetIndex);

  if (!credentials.hasCredentials) {
    return {
      filesToUpload: assets,
      checkedRemote: false,
      reason: 'R2 credentials not configured; remote hash comparison was skipped.'
    };
  }

  const client = createR2Client(credentials);
  const filesToUpload = [];

  await mapWithConcurrency(assets, 16, async (asset) => {
    const head = await getRemoteHead(client, credentials.bucket, asset.key);
    if (!head) {
      filesToUpload.push(asset);
      return;
    }

    const remoteSha = (head.Metadata && head.Metadata.sha256) ? String(head.Metadata.sha256) : '';
    const remoteBytes = Number(head.ContentLength || 0);
    if (remoteSha !== asset.sha256 || remoteBytes !== Number(asset.sizeBytes || 0)) {
      filesToUpload.push(asset);
    }
  });

  return {
    filesToUpload,
    checkedRemote: true,
    reason: null
  };
}

function toAbsoluteSourcePath(sourcePath) {
  return path.join(root, 'Library', ...String(sourcePath || '').split('/'));
}

async function uploadAssetAndVerify(client, bucket, asset, options = {}) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { Upload } = require('@aws-sdk/lib-storage');

  const sourcePath = toAbsoluteSourcePath(asset.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found for upload: ${asset.sourcePath}`);
  }

  const multipartThresholdBytes = Number(options.multipartThresholdBytes || 64 * 1024 * 1024);
  const isMultipart = Number(asset.sizeBytes || 0) >= multipartThresholdBytes;

  if (isMultipart) {
    const uploader = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: asset.key,
        Body: fs.createReadStream(sourcePath),
        ContentType: asset.contentType,
        CacheControl: cacheControlForAsset(asset),
        Metadata: {
          sha256: asset.sha256
        }
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false
    });
    await uploader.done();
  } else {
    const body = fs.readFileSync(sourcePath);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: asset.key,
      Body: body,
      ContentType: asset.contentType,
      CacheControl: cacheControlForAsset(asset),
      Metadata: {
        sha256: asset.sha256
      }
    }));
  }

  const verifyHead = await getRemoteHead(client, bucket, asset.key);
  if (!verifyHead) {
    throw new Error(`Upload verification failed (missing head): ${asset.key}`);
  }
  const remoteSha = verifyHead.Metadata && verifyHead.Metadata.sha256 ? String(verifyHead.Metadata.sha256) : '';
  const remoteBytes = Number(verifyHead.ContentLength || 0);
  if (remoteSha !== asset.sha256 || remoteBytes !== Number(asset.sizeBytes || 0)) {
    throw new Error(`Upload verification failed (hash/size mismatch): ${asset.key}`);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value} B`;
}

function archiveHistoryArtifacts(manifestPath, metadataPath, manifestHash) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(historyDir, { recursive: true });

  const manifestArchivePath = path.join(historyDir, `manifest-${stamp}.json`);
  const metadataArchivePath = path.join(historyDir, `manifest-meta-${stamp}.json`);

  fs.copyFileSync(manifestPath, manifestArchivePath);
  fs.copyFileSync(metadataPath, metadataArchivePath);

  const receiptPath = path.join(historyDir, `publish-${stamp}.json`);
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    archivedAt: new Date().toISOString(),
    manifestHash,
    manifestPath: path.relative(root, manifestArchivePath),
    metadataPath: path.relative(root, metadataArchivePath)
  }, null, 2)}\n`, 'utf8');

  return {
    manifestArchivePath,
    metadataArchivePath,
    receiptPath
  };
}

function buildManifestMetadata(previousState, manifest, manifestHash) {
  const nextVersion = Number(previousState.manifestVersion || 0) + 1;
  return {
    manifestVersion: nextVersion,
    generatedAt: new Date().toISOString(),
    recordCount: Number(manifest.summary && manifest.summary.recordCount ? manifest.summary.recordCount : 0),
    assetCount: Number(manifest.summary && manifest.summary.assetCount ? manifest.summary.assetCount : 0),
    sha256: manifestHash
  };
}

async function uploadJsonObject(client, bucket, key, payload, cacheControl) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const jsonText = `${JSON.stringify(payload, null, 2)}\n`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(jsonText, 'utf8'),
    ContentType: 'application/json',
    CacheControl: cacheControl,
    Metadata: {
      sha256: sha256Text(jsonText)
    }
  }));

  return jsonText;
}

async function verifyPublicUrl(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`Public check failed for ${url} (${response.status})`);
  }

  return {
    status: response.status,
    contentType: response.headers.get('content-type') || ''
  };
}

async function verifyPublicEndpoints(baseUrl, manifestKey, manifest) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const manifestUrl = `${normalizedBase}/${manifestKey}`;
  const manifestResult = await verifyPublicUrl(manifestUrl);

  const coverAsset = (manifest.records || [])
    .flatMap((record) => record.assets || [])
    .find((asset) => asset.role === 'cover');
  const pdfAsset = (manifest.records || [])
    .flatMap((record) => record.assets || [])
    .find((asset) => String(asset.contentType || '').toLowerCase() === 'application/pdf');

  const sampleChecks = [];
  if (coverAsset && coverAsset.url) {
    const coverResult = await verifyPublicUrl(coverAsset.url);
    sampleChecks.push({ label: 'cover', url: coverAsset.url, ...coverResult });
  }
  if (pdfAsset && pdfAsset.url) {
    const pdfResult = await verifyPublicUrl(pdfAsset.url);
    sampleChecks.push({ label: 'pdf', url: pdfAsset.url, ...pdfResult });
  }

  return {
    manifest: { url: manifestUrl, ...manifestResult },
    samples: sampleChecks
  };
}

async function run(options = {}) {
  const credentials = getR2Credentials({ bucket: options.bucket });
  const previousState = readPreviousState();
  const { manifest, outputPath } = buildManifest({
    baseUrl: options.baseUrl,
    output: options.output,
    quiet: true
  });
  verifyManifest(outputPath, path.join(root, 'manifest.schema.json'));

  const recordHashes = buildRecordHashes(manifest);
  const assetIndex = buildAssetIndex(manifest);
  const recordDelta = diffRecordHashes(previousState.records || {}, recordHashes);
  const assetDelta = diffAssets(previousState.assets || {}, assetIndex);
  const uploadPlan = await buildUploadPlan(manifest, credentials);
  const estimatedUploadBytes = (uploadPlan.filesToUpload || [])
    .reduce((sum, asset) => sum + Number(asset.sizeBytes || 0), 0);
  const manifestText = fs.readFileSync(outputPath, 'utf8');
  const manifestHash = sha256Text(manifestText);
  const metadata = buildManifestMetadata(previousState, manifest, manifestHash);

  fs.mkdirSync(path.dirname(metadataOutputPath), { recursive: true });
  fs.writeFileSync(metadataOutputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  console.log('Publish Library Preview');
  console.log(`- Mode: ${options.mode}`);
  console.log(`- New records: ${recordDelta.newRecords}`);
  console.log(`- Updated records: ${recordDelta.updatedRecords}`);
  console.log(`- Deleted records: ${recordDelta.deletedRecords}`);
  console.log(`- Files to upload: ${uploadPlan.filesToUpload.length}`);
  console.log(`- Estimated upload: ${formatBytes(estimatedUploadBytes)} (${uploadPlan.filesToUpload.length} files)`);
  console.log(`- Deleted files: ${assetDelta.deleted.length}`);
  console.log(`- Manifest hash: ${manifestHash}`);
  console.log(`- Manifest output: ${path.relative(root, outputPath)}`);
  console.log(`- Metadata output: ${path.relative(root, metadataOutputPath)}`);

  const roleSummary = buildSummaryByRole(assetIndex);
  for (const role of Object.keys(roleSummary).sort()) {
    console.log(`  - ${role}: ${roleSummary[role]} assets`);
  }

  if (!uploadPlan.checkedRemote) {
    console.log(`- Remote comparison: skipped (${uploadPlan.reason})`);
  } else {
    console.log('- Remote comparison: complete (sha256 metadata + size)');
  }
  console.log(`- Credentials source: ${credentials.source}`);
  console.log(`- Multipart threshold: ${options.multipartThresholdMb} MB`);
  console.log(`- Target bucket: ${credentials.bucket}`);

  const skippedCount = Math.max(0, Object.keys(assetIndex).length - uploadPlan.filesToUpload.length);

  if (options.mode !== 'apply') {
    const previewSummary = {
      mode: options.mode,
      bucket: credentials.bucket,
      generatedAt: new Date().toISOString(),
      records: manifest.summary.recordCount,
      assets: manifest.summary.assetCount,
      uploaded: 0,
      skipped: skippedCount,
      failed: 0,
      manifestSha256: manifestHash,
      verification: 'PREVIEW'
    };
    const summaryPath = writePublishSummary(previewSummary);
    console.log(`- Summary report: ${path.relative(root, summaryPath)}`);
    console.log('Preview complete. No upload was attempted.');
    return;
  }

  if (!credentials.hasCredentials) {
    throw new Error('R2 credentials are required for --apply. Set CLOUDFLARE_ACCOUNT_ID/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
  }

  const client = createR2Client(credentials);
  console.log(`Applying publish to bucket: ${credentials.bucket}`);

  let uploadedCount = 0;
  const failedUploads = [];
  for (const asset of uploadPlan.filesToUpload) {
    try {
      await uploadAssetAndVerify(client, credentials.bucket, asset, {
        multipartThresholdBytes: Number(options.multipartThresholdMb) * 1024 * 1024
      });
      uploadedCount += 1;
    } catch (error) {
      failedUploads.push({ key: asset.key, reason: error.message });
      break;
    }
  }

  console.log(`- Verified uploaded files: ${uploadedCount}`);

  if (failedUploads.length > 0) {
    const failedSummary = {
      mode: options.mode,
      bucket: credentials.bucket,
      generatedAt: new Date().toISOString(),
      records: manifest.summary.recordCount,
      assets: manifest.summary.assetCount,
      uploaded: uploadedCount,
      skipped: skippedCount,
      failed: failedUploads.length,
      failedUploads,
      manifestSha256: manifestHash,
      verification: 'FAIL'
    };
    const summaryPath = writePublishSummary(failedSummary);
    console.log(`- Summary report: ${path.relative(root, summaryPath)}`);
    throw new Error(`Upload failed before manifest publish. Failed files: ${failedUploads.length}`);
  }

  await uploadJsonObject(
    client,
    credentials.bucket,
    options.metadataKey,
    metadata,
    'public, max-age=300'
  );

  await uploadJsonObject(
    client,
    credentials.bucket,
    options.manifestKey,
    manifest,
    'public, max-age=300'
  );

  console.log(`- Uploaded metadata: ${options.metadataKey}`);
  console.log(`- Uploaded manifest (last): ${options.manifestKey}`);

  const archived = archiveHistoryArtifacts(outputPath, metadataOutputPath, manifestHash);
  console.log(`- Archived manifest history: ${path.relative(root, archived.manifestArchivePath)}`);
  console.log(`- Archived metadata history: ${path.relative(root, archived.metadataArchivePath)}`);

  const nextState = {
    generatedAt: new Date().toISOString(),
    manifestVersion: metadata.manifestVersion,
    manifestHash,
    records: recordHashes,
    assets: assetIndex,
    summary: {
      recordCount: manifest.summary.recordCount,
      assetCount: manifest.summary.assetCount
    }
  };

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  console.log(`- State written: ${path.relative(root, statePath)}`);

  if (options.verifyPublic) {
    const publicChecks = await verifyPublicEndpoints(options.baseUrl, options.manifestKey, manifest);
    console.log(`- Public manifest reachable: ${publicChecks.manifest.url} (${publicChecks.manifest.status})`);
    for (const sample of publicChecks.samples) {
      console.log(`- Public ${sample.label} reachable: ${sample.url} (${sample.status})`);
    }
  } else {
    console.log('- Public endpoint checks: skipped (use --verify-public to enable)');
  }

  const integritySummary = {
    mode: options.mode,
    bucket: credentials.bucket,
    generatedAt: new Date().toISOString(),
    records: manifest.summary.recordCount,
    assets: manifest.summary.assetCount,
    uploaded: uploadedCount,
    skipped: skippedCount,
    failed: 0,
    manifestSha256: manifestHash,
    verification: 'PASS'
  };
  const summaryPath = writePublishSummary(integritySummary);
  console.log(`- Summary report: ${path.relative(root, summaryPath)}`);

  console.log('Publish complete.');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(args).catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  run,
  parseArgs
};
