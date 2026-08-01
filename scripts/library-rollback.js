const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const historyDir = path.join(root, 'generated', 'manifest', 'history');

function parseArgs(argv) {
  const args = {
    mode: 'preview',
    bucket: process.env.R2_BUCKET || 'hawkins-hollow-library',
    manifestKey: process.env.LIBRARY_MANIFEST_KEY || 'manifest/manifest.json',
    metadataKey: process.env.LIBRARY_MANIFEST_META_KEY || 'manifest/manifest.meta.json',
    stamp: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.mode = 'apply';
    } else if (token === '--preview') {
      args.mode = 'preview';
    } else if (token === '--bucket' && argv[i + 1]) {
      args.bucket = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--stamp' && argv[i + 1]) {
      args.stamp = String(argv[i + 1]).trim();
      i += 1;
    }
  }

  return args;
}

function getR2Credentials(overrides = {}) {
  const localCredsPath = process.env.R2_CREDENTIALS_FILE
    ? path.resolve(process.env.R2_CREDENTIALS_FILE)
    : path.join(root, '.r2-credentials.local.json');

  let fileCredentials = {};
  if (fs.existsSync(localCredsPath)) {
    fileCredentials = JSON.parse(fs.readFileSync(localCredsPath, 'utf8'));
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
    hasCredentials: Boolean(accountId && accessKeyId && secretAccessKey)
  };
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

async function putJson(client, bucket, key, filePath, cacheControl) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const body = fs.readFileSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json',
    CacheControl: cacheControl
  }));
}

function selectHistoryPair(stamp) {
  if (!fs.existsSync(historyDir)) {
    return null;
  }

  const files = fs.readdirSync(historyDir);
  const manifestFiles = files
    .filter((name) => name.startsWith('manifest-') && name.endsWith('.json'))
    .filter((name) => !name.startsWith('manifest-meta-'))
    .sort();

  if (manifestFiles.length === 0) {
    throw new Error('No manifest history artifacts found.');
  }

  let selectedManifest = manifestFiles[manifestFiles.length - 1];
  if (stamp) {
    const explicit = `manifest-${stamp}.json`;
    if (!manifestFiles.includes(explicit)) {
      throw new Error(`Requested history stamp not found: ${stamp}`);
    }
    selectedManifest = explicit;
  }

  const selectedStamp = selectedManifest.replace(/^manifest-/, '').replace(/\.json$/, '');
  const selectedMetadata = `manifest-meta-${selectedStamp}.json`;
  if (!files.includes(selectedMetadata)) {
    throw new Error(`Matching metadata artifact not found for stamp: ${selectedStamp}`);
  }

  return {
    stamp: selectedStamp,
    manifestPath: path.join(historyDir, selectedManifest),
    metadataPath: path.join(historyDir, selectedMetadata)
  };
}

async function run(options = {}) {
  const selection = selectHistoryPair(options.stamp);
  if (!selection) {
    if (options.mode === 'preview') {
      console.log('Library Rollback');
      console.log(`- Mode: ${options.mode}`);
      console.log('- History artifacts not found yet. Run at least one successful publish before rollback is available.');
      return;
    }
    throw new Error(`History directory not found: ${historyDir}`);
  }
  const credentials = getR2Credentials({ bucket: options.bucket });

  console.log('Library Rollback');
  console.log(`- Mode: ${options.mode}`);
  console.log(`- Target bucket: ${credentials.bucket}`);
  console.log(`- Selected stamp: ${selection.stamp}`);
  console.log(`- Manifest source: ${path.relative(root, selection.manifestPath)}`);
  console.log(`- Metadata source: ${path.relative(root, selection.metadataPath)}`);

  if (options.mode !== 'apply') {
    console.log('Rollback preview complete. No upload attempted.');
    return;
  }

  if (!credentials.hasCredentials) {
    throw new Error('R2 credentials are required for rollback apply mode.');
  }

  const client = createR2Client(credentials);
  await putJson(client, credentials.bucket, options.metadataKey, selection.metadataPath, 'public, max-age=300');
  await putJson(client, credentials.bucket, options.manifestKey, selection.manifestPath, 'public, max-age=300');

  console.log(`- Uploaded metadata key: ${options.metadataKey}`);
  console.log(`- Uploaded manifest key: ${options.manifestKey}`);
  console.log('Rollback complete.');
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
