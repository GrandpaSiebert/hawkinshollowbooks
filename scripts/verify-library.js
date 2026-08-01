const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const DEFAULT_MANIFEST = path.join(root, 'generated', 'manifest', 'manifest.json');
const DEFAULT_SCHEMA = path.join(root, 'manifest.schema.json');

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    schema: DEFAULT_SCHEMA
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--manifest' && argv[i + 1]) {
      args.manifest = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--schema' && argv[i + 1]) {
      args.schema = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(errors) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

function verifyManifest(manifestPath, schemaPath) {
  const errors = [];

  if (!fs.existsSync(manifestPath)) {
    errors.push(`Manifest file not found: ${manifestPath}`);
    fail(errors);
  }

  if (!fs.existsSync(schemaPath)) {
    errors.push(`Schema file not found: ${schemaPath}`);
    fail(errors);
  }

  const manifest = readJson(manifestPath);
  const schema = readJson(schemaPath);

  if (schema.properties && schema.properties.schemaVersion && schema.properties.schemaVersion.const) {
    const expected = schema.properties.schemaVersion.const;
    if (manifest.schemaVersion !== expected) {
      errors.push(`schemaVersion must be ${expected}. Received ${manifest.schemaVersion}`);
    }
  }

  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push('generatedAt must be a valid ISO date-time string.');
  }

  if (!isObject(manifest.library)) {
    errors.push('library must be an object.');
  } else {
    if (!manifest.library.baseUrl || typeof manifest.library.baseUrl !== 'string') {
      errors.push('library.baseUrl must be a non-empty string.');
    }
    if (!isObject(manifest.library.prefixes)) {
      errors.push('library.prefixes must be an object.');
    }
  }

  if (!isObject(manifest.summary)) {
    errors.push('summary must be an object.');
  } else {
    if (!Number.isInteger(manifest.summary.recordCount) || manifest.summary.recordCount < 0) {
      errors.push('summary.recordCount must be a non-negative integer.');
    }
    if (!Number.isInteger(manifest.summary.assetCount) || manifest.summary.assetCount < 0) {
      errors.push('summary.assetCount must be a non-negative integer.');
    }
  }

  if (!Array.isArray(manifest.records)) {
    errors.push('records must be an array.');
  } else {
    const idSet = new Set();
    const slugSet = new Set();
    let computedAssetCount = 0;

    for (const [index, record] of manifest.records.entries()) {
      const label = `records[${index}]`;
      if (!isObject(record)) {
        errors.push(`${label} must be an object.`);
        continue;
      }

      for (const field of ['id', 'slug', 'title', 'series', 'seriesCode']) {
        if (typeof record[field] !== 'string') {
          errors.push(`${label}.${field} must be a string.`);
        }
      }

      if (idSet.has(record.id)) {
        errors.push(`${label}.id duplicates another record id (${record.id}).`);
      }
      if (slugSet.has(record.slug)) {
        errors.push(`${label}.slug duplicates another record slug (${record.slug}).`);
      }
      idSet.add(record.id);
      slugSet.add(record.slug);

      if (!Array.isArray(record.assets)) {
        errors.push(`${label}.assets must be an array.`);
        continue;
      }

      computedAssetCount += record.assets.length;
      for (const [assetIndex, asset] of record.assets.entries()) {
        const assetLabel = `${label}.assets[${assetIndex}]`;
        if (!isObject(asset)) {
          errors.push(`${assetLabel} must be an object.`);
          continue;
        }

        for (const field of ['role', 'key', 'sourcePath', 'url', 'contentType', 'sha256']) {
          if (typeof asset[field] !== 'string' || asset[field].length === 0) {
            errors.push(`${assetLabel}.${field} must be a non-empty string.`);
          }
        }

        if (!Number.isInteger(asset.sizeBytes) || asset.sizeBytes < 0) {
          errors.push(`${assetLabel}.sizeBytes must be a non-negative integer.`);
        }

        if (asset.sha256 && !/^[a-f0-9]{64}$/.test(asset.sha256)) {
          errors.push(`${assetLabel}.sha256 must be a lowercase 64-char hex digest.`);
        }

        if (manifest.library && manifest.library.baseUrl && typeof asset.url === 'string') {
          if (!asset.url.startsWith(manifest.library.baseUrl.replace(/\/+$/, ''))) {
            errors.push(`${assetLabel}.url must begin with library.baseUrl.`);
          }
        }
      }
    }

    if (manifest.summary && Number.isInteger(manifest.summary.assetCount)) {
      if (computedAssetCount !== manifest.summary.assetCount) {
        errors.push(`summary.assetCount (${manifest.summary.assetCount}) does not match computed assets (${computedAssetCount}).`);
      }
    }

    if (manifest.summary && Number.isInteger(manifest.summary.recordCount)) {
      if (manifest.records.length !== manifest.summary.recordCount) {
        errors.push(`summary.recordCount (${manifest.summary.recordCount}) does not match records length (${manifest.records.length}).`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('Manifest validation failed:');
    fail(errors);
  }

  console.log(`Manifest validation succeeded for ${path.relative(root, manifestPath)}.`);
  console.log(`- Records: ${manifest.summary.recordCount}`);
  console.log(`- Assets: ${manifest.summary.assetCount}`);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  verifyManifest(args.manifest, args.schema);
}

module.exports = {
  verifyManifest,
  parseArgs
};
