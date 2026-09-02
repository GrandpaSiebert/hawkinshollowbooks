const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const defaultBaseUrl = 'https://library.hawkinshollowbooks.com';
const defaultBucket = 'hawkins-hollow-library';
const defaultManifestKey = 'manifest/manifest.json';

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.LIBRARY_BASE_URL || defaultBaseUrl,
    destination: path.join(root, 'Library'),
    bucket: process.env.R2_BUCKET || defaultBucket,
    manifestKey: process.env.LIBRARY_MANIFEST_KEY || defaultManifestKey
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
    }
  }

  return options;
}

function isCanonicalDocument(sourcePath) {
  const normalized = String(sourcePath || '').replace(/\\/g, '/');
  if (!/\.docx$/i.test(normalized)) return false;
  return /^Books\//i.test(normalized) && /Story Master\.docx$/i.test(normalized)
    || /^(Characters|Relationships|Environments|Landmarks)\//i.test(normalized);
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

async function restoreLibraryCanon(options = {}) {
  const baseUrl = String(options.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
  const destination = path.resolve(options.destination || path.join(root, 'Library'));
  const credentials = getR2Credentials();
  let manifest;
  let r2Client = null;
  try {
    manifest = await fetchJson(`${baseUrl}/manifest/manifest.json`);
  } catch (publicError) {
    if (!credentials.configured) {
      throw new Error(`Public manifest fetch failed (${publicError.message}) and R2 credentials are not configured.`);
    }
    r2Client = createR2Client(credentials);
    manifest = JSON.parse((await fetchR2Object(r2Client, options.bucket || defaultBucket, options.manifestKey || defaultManifestKey)).toString('utf8'));
  }
  const assets = (manifest.records || []).flatMap((record) => record.assets || []);
  const documentsByPath = new Map(assets
    .filter((asset) => isCanonicalDocument(asset.sourcePath))
    .map((asset) => [asset.sourcePath, asset]));
  const catalogObjects = new Set();

  if (r2Client) {
    const bucket = options.bucket || defaultBucket;
    for (const key of await listR2ObjectKeys(r2Client, bucket)) {
      if (isWorldCanonDocument(key)) {
        documentsByPath.set(key, { key, sourcePath: key });
      }
      if (isFreebieObject(key)) {
        catalogObjects.add(key);
      }
    }
  }
  const documents = Array.from(documentsByPath.values());

  if (documents.length === 0) {
    throw new Error('The public library manifest contained no canonical DOCX source documents.');
  }

  for (const document of documents) {
    const outputPath = toDestination(destination, document.sourcePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (r2Client) {
      fs.writeFileSync(outputPath, await fetchR2Object(r2Client, options.bucket || defaultBucket, document.key));
    } else {
      const sourceUrl = document.url || `${baseUrl}/${encodeURI(document.key)}`;
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Could not retrieve ${document.sourcePath}: HTTP ${response.status}`);
      fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    }
  }

  for (const objectKey of catalogObjects) {
    const outputPath = toDestination(destination, objectKey);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.closeSync(fs.openSync(outputPath, 'w'));
    }
  }

  console.log(`Restored ${documents.length} canonical Library DOCX files and ${catalogObjects.size} Freebies catalog paths from ${r2Client ? `R2 bucket ${options.bucket || defaultBucket}` : baseUrl}.`);
  return { documentCount: documents.length, catalogObjectCount: catalogObjects.size, destination };
}

if (require.main === module) {
  restoreLibraryCanon(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`Library canon restore failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { restoreLibraryCanon, isCanonicalDocument, isWorldCanonDocument, isFreebieObject, parseArgs };