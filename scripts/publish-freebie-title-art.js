const fs = require('fs');
const path = require('path');
const { writeLibraryArtifacts } = require('./library-scanner');
const { writeFreebieManuscriptArtifact } = require('./freebie-manuscript-import');
const {
  cacheControlForAsset,
  createR2Client,
  getR2Credentials,
  getRemoteHead,
  uploadBufferAndVerify
} = require('./publish-library');
const {
  DEFAULT_LIBRARY_BASE_URL,
  TITLE_ART_DERIVATIVE_VERSION,
  TITLE_ART_FORMAT_VERSION,
  generateTitleArtDerivative,
  getTitleArtKey,
  getTitleArtPublicUrl
} = require('./freebie-title-art-media');

const root = path.join(__dirname, '..');
const DEFAULT_PUBLICATION_PATH = path.join(root, 'generated', 'freebie-title-art-publication.json');

function parseArgs(argv) {
  const options = {
    bucket: process.env.R2_BUCKET || 'hawkins-hollow-library',
    baseUrl: process.env.LIBRARY_BASE_URL || DEFAULT_LIBRARY_BASE_URL,
    output: DEFAULT_PUBLICATION_PATH,
    apply: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--apply') {
      options.apply = true;
    } else if (argv[index] === '--bucket' && argv[index + 1]) {
      options.bucket = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--output' && argv[index + 1]) {
      options.output = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

function remoteMatches(remote, asset) {
  return Boolean(remote)
    && Number(remote.ContentLength || 0) === Number(asset.sizeBytes)
    && String(remote.Metadata && remote.Metadata.sha256 || '') === asset.sha256
    && String(remote.ContentType || '').split(';')[0].trim().toLowerCase() === asset.contentType
    && String(remote.CacheControl || '') === cacheControlForAsset(asset);
}

function writePublication(outputPath, publication) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(publication, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outputPath);
}

async function publishFreebieTitleArt(records, options = {}) {
  const client = options.client;
  if (!client) throw new Error('An R2 client is required to publish freebie title art.');
  const bucket = options.bucket || 'hawkins-hollow-library';
  const baseUrl = options.baseUrl || DEFAULT_LIBRARY_BASE_URL;
  const libraryRoot = path.resolve(options.libraryRoot || path.join(root, 'Library'));
  const outputPath = path.resolve(options.output || DEFAULT_PUBLICATION_PATH);
  const recordsById = new Map();
  const publishedRecords = [];
  let uploadedCount = 0;
  let unchangedCount = 0;

  for (const record of records || []) {
    if (!record.illustrationSourcePath) continue;
    const canonicalId = String(record.canonicalId || '').toUpperCase();
    if (recordsById.has(canonicalId)) throw new Error(`Duplicate freebie title-art ID: ${canonicalId}`);
    recordsById.set(canonicalId, true);

    const sourcePath = path.resolve(libraryRoot, ...String(record.illustrationSourcePath).split('/'));
    if (!sourcePath.startsWith(`${libraryRoot}${path.sep}`) || !fs.existsSync(sourcePath)) {
      throw new Error(`Freebie title-art source is missing or unsafe: ${record.illustrationSourcePath}`);
    }
    const sourceBytes = fs.readFileSync(sourcePath);
    const derivative = await generateTitleArtDerivative(sourceBytes, sourcePath);
    if (derivative.sourceSha256 !== record.illustrationSourceSha256) {
      throw new Error(`Freebie title-art source changed after discovery: ${canonicalId}`);
    }

    const key = getTitleArtKey(canonicalId);
    const asset = {
      key,
      role: 'illustration',
      contentType: 'image/webp',
      sha256: derivative.derivativeSha256,
      sizeBytes: derivative.bytes.length
    };
    const remote = await getRemoteHead(client, bucket, key);
    if (remoteMatches(remote, asset)) {
      unchangedCount += 1;
    } else {
      await uploadBufferAndVerify(client, bucket, asset, derivative.bytes);
      uploadedCount += 1;
    }

    publishedRecords.push({
      canonicalId,
      sourcePath: record.illustrationSourcePath,
      sourceSha256: derivative.sourceSha256,
      key,
      url: getTitleArtPublicUrl(canonicalId, baseUrl),
      derivativeSha256: derivative.derivativeSha256,
      sizeBytes: derivative.bytes.length,
      width: derivative.derivativeImage.width,
      height: derivative.derivativeImage.height,
      status: 'verified'
    });
  }

  const publication = {
    formatVersion: TITLE_ART_FORMAT_VERSION,
    derivativeVersion: TITLE_ART_DERIVATIVE_VERSION,
    generatedAt: new Date().toISOString(),
    bucket,
    summary: {
      resolvedCount: recordsById.size,
      verifiedCount: publishedRecords.length,
      uploadedCount,
      unchangedCount
    },
    records: publishedRecords.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
  };
  writePublication(outputPath, publication);
  return publication;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.apply) {
    throw new Error('No upload attempted. Re-run with --apply to publish verified freebie title-art derivatives.');
  }
  const credentials = getR2Credentials({ bucket: options.bucket });
  if (!credentials.hasCredentials) {
    throw new Error('R2 credentials are required. Configure CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
  }

  const libraryArtifacts = writeLibraryArtifacts(root);
  const libraryIndex = JSON.parse(fs.readFileSync(libraryArtifacts.indexPath, 'utf8'));
  const freebieArtifacts = writeFreebieManuscriptArtifact(root, libraryIndex);
  const client = createR2Client(credentials);
  const publication = await publishFreebieTitleArt(freebieArtifacts.records, {
    client,
    bucket: credentials.bucket,
    baseUrl: options.baseUrl,
    libraryRoot: path.join(root, 'Library'),
    output: options.output
  });
  console.log(`Freebie title-art derivatives verified: ${publication.summary.verifiedCount}`);
  console.log(`Uploaded: ${publication.summary.uploadedCount}; unchanged: ${publication.summary.unchangedCount}`);
  console.log(`Publication receipt: ${path.relative(root, options.output)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Freebie title-art publication failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_PUBLICATION_PATH,
  parseArgs,
  publishFreebieTitleArt,
  remoteMatches,
  writePublication
};