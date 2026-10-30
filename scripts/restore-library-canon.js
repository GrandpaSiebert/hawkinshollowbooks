const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SUPPORTED_IMAGE_EXTENSIONS, inspectImageAsset } = require('./image-asset');

const root = path.join(__dirname, '..');
const defaultBaseUrl = 'https://library.hawkinshollowbooks.com';
const defaultBucket = 'hawkins-hollow-library';
const defaultManifestKey = 'manifest/manifest.json';

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.LIBRARY_BASE_URL || defaultBaseUrl,
    destination: path.join(root, 'Library'),
    bucket: process.env.R2_BUCKET || defaultBucket,
    manifestKey: process.env.LIBRARY_MANIFEST_KEY || defaultManifestKey,
    publicOnly: false,
    r2Only: false,
    manifestFile: null,
    requiredSourceMap: null,
    coverSourceIds: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url' && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--destination' && argv[index + 1]) {
      options.destination = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--bucket' && argv[index + 1]) {
      options.bucket = argv[index + 1];
      index += 1;
    } else if (argv[index] === '--public-only') {
      options.publicOnly = true;
    } else if (argv[index] === '--r2-only') {
      options.r2Only = true;
    } else if (argv[index] === '--manifest-file' && argv[index + 1]) {
      options.manifestFile = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--required-source-map' && argv[index + 1]) {
      options.requiredSourceMap = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--cover-source-id' && argv[index + 1]) {
      options.coverSourceIds.push(String(argv[index + 1]).trim().toUpperCase());
      index += 1;
    }
  }

  if (options.publicOnly && (options.r2Only || options.manifestFile)) {
    throw new Error('--public-only cannot be combined with --r2-only or --manifest-file.');
  }
  if (options.coverSourceIds.length && !options.r2Only) {
    throw new Error('--cover-source-id requires --r2-only.');
  }
  if (options.requiredSourceMap && !options.r2Only) {
    throw new Error('--required-source-map requires --r2-only.');
  }
  return options;
}

function isCanonicalDocument(sourcePath) {
  const normalized = String(sourcePath || '').replace(/\\/g, '/');
  if (!/\.docx$/i.test(normalized)) return false;
  return /^Books\//i.test(normalized) && /Story Master\.docx$/i.test(normalized)
    || /^(Characters|Relationships|Environments|Landmarks)\//i.test(normalized)
    || isFreebieManuscript(normalized);
}

// Freebie manuscripts carry the authoritative song and rhyme text, so they need real bytes, not placeholders.
function isFreebieManuscript(key) {
  return /^Freebies\/.+\.docx$/i.test(String(key || '').replace(/\\/g, '/'));
}

function isFreebieTitleArt(sourcePath) {
  const normalized = String(sourcePath || '').replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  return /^Freebies\//i.test(normalized)
    && !/^Freebies\/Title Art\//i.test(normalized)
    && /^HH-[SR]-\d{4}(?![A-Za-z0-9])[^/]*$/i.test(basename)
    && SUPPORTED_IMAGE_EXTENSIONS.includes(path.posix.extname(basename).toLowerCase());
}

function isFreebieTitleArtDerivative(key) {
  const normalized = String(key || '').replace(/\\/g, '/');
  return /^Freebies\/Title Art\/HH-[SR]-\d{4}\.webp$/i.test(normalized);
}

function isWorldCanonDocument(key) {
  return /^(Characters|Relationships|Environments|Landmarks)\/.*\.docx$/i.test(String(key || ''));
}

function isFreebieObject(key) {
  return /^Freebies\/.+[^\/]$/i.test(String(key || ''));
}

function toDestination(rootPath, sourcePath) {
  const segments = String(sourcePath || '').replace(/\\/g, '/').split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe manifest source path: ${sourcePath}`);
  }
  return path.join(rootPath, ...segments);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not retrieve ${url}: HTTP ${response.status}`);
  return response.json();
}

function getR2Credentials() {
  const credentialsPath = process.env.R2_CREDENTIALS_FILE
    ? path.resolve(process.env.R2_CREDENTIALS_FILE)
    : path.join(root, '.r2-credentials.local.json');
  const fileCredentials = fs.existsSync(credentialsPath)
    ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
    : {};
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || fileCredentials.accountId || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || fileCredentials.accessKeyId || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || fileCredentials.secretAccessKey || '';
  return { accountId, accessKeyId, secretAccessKey, configured: Boolean(accountId && accessKeyId && secretAccessKey) };
}

function createR2Client(credentials) {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey }
  });
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function fetchR2Object(client, bucket, key) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return bodyToBuffer(response.Body);
}

async function listR2ObjectKeys(client, bucket) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const keys = [];
  let continuationToken;
  do {
    const response = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    keys.push(...(response.Contents || []).map((entry) => entry.Key));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function mapWithConcurrency(items, limit, handler) {
  const records = Array.from(items || []);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, records.length) }, async () => {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      await handler(records[index], index);
    }
  });
  await Promise.all(workers);
}

async function restoreLibraryCanon(options = {}) {
  const baseUrl = String(options.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
  const destination = path.resolve(options.destination || path.join(root, 'Library'));
  const manifestFile = options.manifestFile ? path.resolve(options.manifestFile) : null;
  if (!options.publicOnly && !manifestFile && !options.r2Only) {
    throw new Error('Select an explicit restore source: --manifest-file, --r2-only, or --public-only.');
  }
  if (options.publicOnly && manifestFile) {
    throw new Error('Public-only restore cannot also use a local manifest file.');
  }
  if (options.requiredSourceMap && !options.r2Only) {
    throw new Error('Required source restoration requires explicit R2-only access.');
  }
  const credentials = options.publicOnly
    ? { accountId: '', accessKeyId: '', secretAccessKey: '', configured: false }
    : (options.credentials || getR2Credentials());
  if (options.r2Only && !options.r2Client && !credentials.configured) {
    throw new Error('R2-only restore requires configured read-only R2 credentials.');
  }
  const r2Client = options.publicOnly
    ? null
    : (options.r2Client || (options.r2Only ? createR2Client(credentials) : null));
  const manifest = manifestFile
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    : (options.publicOnly
      ? await fetchJson(`${baseUrl}/manifest/manifest.json`)
      : JSON.parse((await fetchR2Object(
        r2Client,
        options.bucket || defaultBucket,
        options.manifestKey || defaultManifestKey
      )).toString('utf8')));
  const assets = (manifest.records || []).flatMap((record) => record.assets || []);
  const freebieTitleArtByPath = new Map(assets
    .filter((asset) => isFreebieTitleArt(asset.sourcePath))
    .map((asset) => [asset.sourcePath, asset]));
  const documentsByPath = new Map(assets
    .filter((asset) => isCanonicalDocument(asset.sourcePath))
    .map((asset) => [asset.sourcePath, asset]));
  if (options.requiredSourceMap) {
    const requiredSources = JSON.parse(fs.readFileSync(options.requiredSourceMap, 'utf8'));
    if (!Array.isArray(requiredSources)) throw new Error('Required source map must be an array.');
    for (const asset of requiredSources) {
      toDestination(destination, asset.sourcePath);
      if (!/^Books\/.+\.(?:pdf|docx)$/i.test(asset.sourcePath)
        || typeof asset.key !== 'string' || !asset.key
        || !/^[a-f0-9]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
        throw new Error('Required source needs an explicit Book path, R2 key, SHA-256 and byte size.');
      }
      const existing = documentsByPath.get(asset.sourcePath);
      if (existing && existing.key !== asset.key) throw new Error('Required source conflicts with manifest identity.');
      documentsByPath.set(asset.sourcePath, { ...asset, requiredSource: true });
    }
  }
  const documentKeys = new Set(Array.from(documentsByPath.values(), (document) => document.key || document.sourcePath));
  // Manifest sourcePath is authoritative for original Library identity (preserves '+', casing, punctuation);
  // the CDN object key is lossy (slugified) and must never be reverse-engineered into a Library path.
  const manifestPlaceholderPaths = new Set(assets
    .map((asset) => asset.sourcePath)
    .filter((sourcePath) => sourcePath && !documentsByPath.has(sourcePath) && !isFreebieTitleArt(sourcePath)));
  const catalogObjects = new Set();
  const titleArtR2Client = options.publicOnly
    ? null
    : (options.titleArtR2Client || r2Client || (credentials.configured ? createR2Client(credentials) : null));

  if (titleArtR2Client) {
    const bucket = options.bucket || defaultBucket;
    for (const key of await listR2ObjectKeys(titleArtR2Client, bucket)) {
      if (isFreebieTitleArtDerivative(key)) continue;
      if (isWorldCanonDocument(key) && !documentKeys.has(key)) {
        const correction = (options.sourcePathCorrections || require('../data/canonical-source-path-corrections.json')).find(record => record.key === key);
        const sourcePath = correction ? correction.sourcePath : key;
        toDestination(destination, sourcePath);
        if (correction && (!isWorldCanonDocument(sourcePath) || !/^[a-f0-9]{64}$/.test(correction.sha256)
          || !Number.isSafeInteger(correction.sizeBytes) || correction.sizeBytes <= 0)) {
          throw new Error('Canonical filename correction requires a reviewed path, SHA-256 and byte size.');
        }
        if (documentsByPath.has(sourcePath)) throw new Error(`Conflicting canonical source paths: ${sourcePath}.`);
        documentsByPath.set(sourcePath, { key, sourcePath, r2Only: true, ...(correction || {}), requiredSource: Boolean(correction) });
        documentKeys.add(key);
      }
      if (r2Client && isFreebieManuscript(key)) {
        documentsByPath.set(key, { key, sourcePath: key });
      } else if (isFreebieTitleArt(key)) {
        if (!freebieTitleArtByPath.has(key)) {
          freebieTitleArtByPath.set(key, { key, sourcePath: key, r2Only: true });
        }
      } else if (r2Client && isFreebieObject(key)) {
        catalogObjects.add(key);
      }
    }
  }
  const documents = Array.from(documentsByPath.values());
  const coverSourceIds = new Set((options.coverSourceIds || [])
    .map((id) => String(id || '').trim().toUpperCase())
    .filter(Boolean));
  const requestedCovers = [];
  for (const record of manifest.records || []) {
    const recordId = String(record.id || record.canonicalId || '').trim().toUpperCase();
    if (!coverSourceIds.has(recordId)) continue;
    const covers = (record.assets || []).filter((asset) => {
      const sourcePath = String(asset.sourcePath || '');
      const basename = path.posix.basename(sourcePath.replace(/\\/g, '/'));
      return (String(asset.role || '').toLowerCase() === 'cover' || /cover/i.test(basename))
        && SUPPORTED_IMAGE_EXTENSIONS.includes(path.posix.extname(basename).toLowerCase());
    });
    if (covers.length !== 1) {
      throw new Error(`Expected exactly one manifest front-cover asset for requested canonical Book ID ${recordId}; found ${covers.length}.`);
    }
    requestedCovers.push(covers[0]);
  }
  for (const id of coverSourceIds) {
    if (!(manifest.records || []).some((record) => String(record.id || record.canonicalId || '').trim().toUpperCase() === id)) {
      throw new Error(`Requested cover source ID ${id} is not present in the manifest.`);
    }
  }

  if (documents.length === 0) {
    throw new Error('The selected manifest contained no canonical DOCX source documents.');
  }
  if (!r2Client && !options.publicOnly) {
    throw new Error('A local manifest restore requires an explicit R2 client for its object reads.');
  }
  if (requestedCovers.length > 0 && !titleArtR2Client) {
    throw new Error('Requested canonical Book covers require read-only R2 object access.');
  }
  if (requestedCovers.some((asset) => !asset.key)) {
    throw new Error('A requested canonical Book cover is missing its manifest object key.');
  }

  await mapWithConcurrency(documents, 8, async (document) => {
    const outputPath = toDestination(destination, document.sourcePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (r2Client || document.r2Only) {
      const bytes = await fetchR2Object(titleArtR2Client, options.bucket || defaultBucket, document.key);
      if (document.requiredSource && (bytes.length !== document.sizeBytes
        || crypto.createHash('sha256').update(bytes).digest('hex') !== document.sha256)) {
        throw new Error(`Required source size or SHA-256 does not match the reviewed original: ${document.sourcePath}.`);
      }
      fs.writeFileSync(outputPath, bytes);
    } else if (options.publicOnly) {
      const sourceUrl = document.url || `${baseUrl}/${encodeURI(document.key)}`;
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Could not retrieve ${document.sourcePath}: HTTP ${response.status}`);
      fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    } else {
      throw new Error(`No explicit object source is available for ${document.sourcePath}.`);
    }
  });

  await mapWithConcurrency(requestedCovers, 4, async (asset) => {
    const outputPath = toDestination(destination, asset.sourcePath);
    const bytes = await fetchR2Object(titleArtR2Client, options.bucket || defaultBucket, asset.key);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (Number.isFinite(asset.sizeBytes) && bytes.length !== asset.sizeBytes) {
      throw new Error(`Requested cover size does not match manifest metadata: ${asset.sourcePath}.`);
    }
    if (asset.sha256 && sha256.toLowerCase() !== String(asset.sha256).toLowerCase()) {
      throw new Error(`Requested cover SHA-256 does not match manifest metadata: ${asset.sourcePath}.`);
    }
    if (!inspectImageAsset(bytes, asset.sourcePath)) {
      throw new Error(`Requested cover is not a valid supported image: ${asset.sourcePath}.`);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bytes);
  });

  await mapWithConcurrency(freebieTitleArtByPath.values(), 4, async (asset) => {
    const outputPath = toDestination(destination, asset.sourcePath);
    const useR2 = Boolean(asset.r2Only || r2Client);
    const response = useR2 || !options.publicOnly
      ? null
      : await fetch(asset.url || `${baseUrl}/${encodeURI(asset.key || asset.sourcePath)}`);
    if (response && !response.ok) {
      throw new Error(`Could not retrieve freebie title illustration ${asset.sourcePath}: HTTP ${response.status}`);
    }
    if (!useR2 && !options.publicOnly) {
      throw new Error(`No explicit object source is available for ${asset.sourcePath}.`);
    }
    const bytes = useR2
      ? await fetchR2Object(titleArtR2Client, options.bucket || defaultBucket, asset.key)
      : Buffer.from(await response.arrayBuffer());
    if (!inspectImageAsset(bytes, asset.sourcePath)) {
      console.warn(`Skipped invalid freebie title illustration: ${asset.sourcePath}`);
      if (fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bytes);
  });

  for (const objectKey of catalogObjects) {
    const outputPath = toDestination(destination, objectKey);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.closeSync(fs.openSync(outputPath, 'w'));
    }
  }

  for (const sourcePath of manifestPlaceholderPaths) {
    const outputPath = toDestination(destination, sourcePath);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.closeSync(fs.openSync(outputPath, 'w'));
    }
  }

  const placeholderCount = catalogObjects.size + manifestPlaceholderPaths.size;
  const sourceDescription = options.publicOnly
    ? baseUrl
    : (r2Client ? `R2 bucket ${options.bucket || defaultBucket}` : `local manifest ${manifestFile}`);
  console.log(`Restored ${documents.length} canonical Library source files and ${placeholderCount} catalog paths from ${sourceDescription}.`);
  return { documentCount: documents.length, catalogObjectCount: placeholderCount, destination };
}

if (require.main === module) {
  restoreLibraryCanon(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`Library canon restore failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { restoreLibraryCanon, isCanonicalDocument, isWorldCanonDocument, isFreebieObject, isFreebieManuscript, isFreebieTitleArt, isFreebieTitleArtDerivative, parseArgs };
