const fs = require('fs');
const path = require('path');
const { writeLibraryArtifacts } = require('./library-scanner');
const { writeFreebieManuscriptArtifact } = require('./freebie-manuscript-import');
const {
  DEFAULT_LIBRARY_BASE_URL,
  TITLE_ART_DERIVATIVE_VERSION,
  TITLE_ART_FORMAT_VERSION,
  generateTitleArtDerivative,
  getTitleArtKey,
  getTitleArtPublicUrl,
  sha256
} = require('./freebie-title-art-media');
const { inspectImageAsset } = require('./image-asset');

const root = path.join(__dirname, '..');
const DEFAULT_PUBLICATION_PATH = path.join(root, 'generated', 'freebie-title-art-publication.json');

function writeLocalPublication(outputPath, publication) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(publication, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, outputPath);
}

function validatePublicBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.origin !== DEFAULT_LIBRARY_BASE_URL
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error('Read-only title-art verification is restricted to the public Hawkins Hollow Library host.');
  }
  return url.origin;
}

async function verifyFreebieTitleArt(records, options = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('A public fetch implementation is required for read-only title-art verification.');
  const baseUrl = options.baseUrl || DEFAULT_LIBRARY_BASE_URL;
  const allowedOrigin = validatePublicBaseUrl(baseUrl);
  const libraryRoot = path.resolve(options.libraryRoot || path.join(root, 'Library'));
  const outputPath = path.resolve(options.output || DEFAULT_PUBLICATION_PATH);
  const seenIds = new Set();
  const verifiedRecords = [];
  const verificationErrors = [];

  for (const record of records || []) {
    if (!record.illustrationSourcePath) continue;
    const canonicalId = String(record.canonicalId || '').toUpperCase();
    if (!canonicalId || seenIds.has(canonicalId)) {
      verificationErrors.push(`Missing or duplicate canonical freebie title-art ID: ${canonicalId || '(empty)'}.`);
      continue;
    }
    seenIds.add(canonicalId);

    const sourcePath = path.resolve(libraryRoot, ...String(record.illustrationSourcePath).split('/'));
    if (!sourcePath.startsWith(`${libraryRoot}${path.sep}`) || !fs.existsSync(sourcePath)) {
      verificationErrors.push(`${canonicalId}: freebie title-art source is missing or unsafe.`);
      continue;
    }
    const sourceBytes = fs.readFileSync(sourcePath);
    let derivative;
    try {
      derivative = await generateTitleArtDerivative(sourceBytes, sourcePath);
    } catch (error) {
      verificationErrors.push(`${canonicalId}: source derivative generation failed (${error.message}).`);
      continue;
    }
    if (derivative.sourceSha256 !== record.illustrationSourceSha256) {
      verificationErrors.push(`${canonicalId}: source changed after discovery.`);
      continue;
    }

    const key = getTitleArtKey(canonicalId);
    const publicUrl = getTitleArtPublicUrl(canonicalId, baseUrl);
    if (new URL(publicUrl).origin !== allowedOrigin) {
      verificationErrors.push(`${canonicalId}: title-art URL escaped the approved public Library host.`);
      continue;
    }
    let response;
    try {
      response = await fetcher(publicUrl, { redirect: 'error' });
    } catch (error) {
      verificationErrors.push(`${canonicalId}: public title-art request failed (${error.name || 'RemoteReadError'}).`);
      continue;
    }
    if (!response || !response.ok) {
      verificationErrors.push(`${canonicalId}: required public title-art is unavailable (${key}; HTTP ${response ? response.status : 'no response'}).`);
      continue;
    }
    if (response.url && new URL(response.url).origin !== allowedOrigin) {
      verificationErrors.push(`${canonicalId}: public title-art request redirected outside the approved Library host.`);
      continue;
    }
    const responseContentType = response.headers && typeof response.headers.get === 'function'
      ? String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      : '';
    if (responseContentType !== 'image/webp') {
      verificationErrors.push(`${canonicalId}: required public title-art has unexpected content type (${responseContentType || 'missing'}).`);
      continue;
    }
    let remoteBytes;
    try {
      remoteBytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      verificationErrors.push(`${canonicalId}: public title-art download failed (${error.name || 'RemoteReadError'}).`);
      continue;
    }
    const remoteImage = inspectImageAsset(remoteBytes, '.webp');
    if (remoteBytes.length !== derivative.bytes.length
      || sha256(remoteBytes) !== derivative.derivativeSha256
      || !remoteImage) {
      verificationErrors.push(`${canonicalId}: public title-art bytes do not match the approved derivative (${key}).`);
      continue;
    }
    if (remoteImage.width !== derivative.derivativeImage.width || remoteImage.height !== derivative.derivativeImage.height) {
      verificationErrors.push(`${canonicalId}: existing R2 title-art dimensions do not match (${key}).`);
      continue;
    }

    verifiedRecords.push({
      canonicalId,
      sourcePath: record.illustrationSourcePath,
      sourceSha256: derivative.sourceSha256,
      key,
      url: publicUrl,
      derivativeSha256: derivative.derivativeSha256,
      sizeBytes: derivative.bytes.length,
      width: derivative.derivativeImage.width,
      height: derivative.derivativeImage.height,
      status: 'verified'
    });
  }

  if (verificationErrors.length > 0) {
    throw new Error(`Read-only freebie title-art verification failed for ${verificationErrors.length} of ${seenIds.size} item(s); ${verifiedRecords.length} matched:\n${verificationErrors.map((message) => `- ${message}`).join('\n')}`);
  }
  if (verifiedRecords.length === 0) {
    throw new Error('No freebie title-art derivatives were available for read-only verification.');
  }
  const publication = {
    formatVersion: TITLE_ART_FORMAT_VERSION,
    derivativeVersion: TITLE_ART_DERIVATIVE_VERSION,
    generatedAt: new Date().toISOString(),
    bucket: 'hawkins-hollow-library',
    summary: {
      resolvedCount: seenIds.size,
      verifiedCount: verifiedRecords.length,
      uploadedCount: 0,
      unchangedCount: verifiedRecords.length
    },
    records: verifiedRecords.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
  };
  writeLocalPublication(outputPath, publication);
  return publication;
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.LIBRARY_BASE_URL || DEFAULT_LIBRARY_BASE_URL,
    output: DEFAULT_PUBLICATION_PATH
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[++index];
    } else if (argv[index] === '--output' && argv[index + 1]) {
      options.output = path.resolve(argv[++index]);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const libraryArtifacts = writeLibraryArtifacts(root);
  const libraryIndex = JSON.parse(fs.readFileSync(libraryArtifacts.indexPath, 'utf8'));
  const freebieArtifacts = writeFreebieManuscriptArtifact(root, libraryIndex);
  const publication = await verifyFreebieTitleArt(freebieArtifacts.records, {
    baseUrl: options.baseUrl,
    libraryRoot: path.join(root, 'Library'),
    output: options.output
  });
  console.log(`Read-only title-art verification passed: ${publication.summary.verifiedCount} derivatives; 0 uploads.`);
  console.log(`Local publication receipt: ${path.relative(root, options.output)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Read-only freebie title-art verification failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_PUBLICATION_PATH,
  parseArgs,
  verifyFreebieTitleArt
};
