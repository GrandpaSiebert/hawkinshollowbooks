const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeLibraryArtifacts } = require('./library-scanner');

const root = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(root, 'generated', 'manifest', 'manifest.json');
const DEFAULT_BASE_URL = 'https://library.hawkinshollowbooks.com';
const DEFAULT_MAPPING_PATH = path.join(root, 'data', 'library-publish-mapping.json');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.LIBRARY_BASE_URL || DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
    mappingPath: process.env.LIBRARY_MAPPING_PATH || DEFAULT_MAPPING_PATH,
    quiet: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--base-url' && argv[i + 1]) {
      args.baseUrl = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--output' && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--mapping' && argv[i + 1]) {
      args.mappingPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--quiet') {
      args.quiet = true;
    }
  }

  return args;
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toBookPageSlug(book) {
  const safeId = (book.id || 'unknown')
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeTitle = (book.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return safeTitle ? `${safeId}-${safeTitle}` : safeId;
}

function ensurePosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sanitizePathSegment(value, preserveDot = false) {
  const pattern = preserveDot ? /[^a-z0-9.-]+/g : /[^a-z0-9-]+/g;
  return String(value || '')
    .toLowerCase()
    .replace(pattern, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mimeTypeFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.zip':
      return 'application/zip';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function normalizePrefix(value) {
  return ensurePosix(String(value || ''))
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '') + '/';
}

function defaultMappingConfig() {
  return {
    prefixes: {
      books: 'books/',
      covers: 'covers/',
      companionPacks: 'companion-packs/',
      illustrations: 'illustrations/',
      characters: 'characters/',
      resources: 'resources/',
      manifest: 'manifest/'
    },
    rules: [
      { localPrefixes: ['books/'], r2Prefix: 'books/', role: 'book' },
      { localPrefixes: ['covers/'], r2Prefix: 'covers/', role: 'cover' },
      { localPrefixes: ['companion packs/', 'companion-packs/', 'companion_packs/'], r2Prefix: 'companion-packs/', role: 'companion-pack' },
      { localPrefixes: ['illustrations/'], r2Prefix: 'illustrations/', role: 'illustration' },
      { localPrefixes: ['characters/'], r2Prefix: 'characters/', role: 'character' },
      { localPrefixes: ['resources/', 'ribbons/'], r2Prefix: 'resources/', role: 'resource' }
    ],
    fallback: {
      r2Prefix: 'resources/',
      role: 'other'
    }
  };
}

function loadMappingConfig(mappingPath) {
  if (!fs.existsSync(mappingPath)) {
    return defaultMappingConfig();
  }

  const raw = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const base = defaultMappingConfig();

  const prefixes = Object.assign({}, base.prefixes, raw.prefixes || {});
  const rules = Array.isArray(raw.rules) ? raw.rules : base.rules;
  const fallback = Object.assign({}, base.fallback, raw.fallback || {});

  return { prefixes, rules, fallback };
}

function resolveMapping(relativePath, category, mappingConfig) {
  const normalizedPath = normalizePrefix(relativePath);
  const normalizedCategory = normalizePrefix(category || '');
  const rules = Array.isArray(mappingConfig.rules) ? mappingConfig.rules : [];

  for (const rule of rules) {
    const localPrefixes = Array.isArray(rule.localPrefixes) ? rule.localPrefixes : [];
    for (const prefix of localPrefixes) {
      const normalizedPrefix = normalizePrefix(prefix);
      if (normalizedPath.startsWith(normalizedPrefix) || normalizedCategory === normalizedPrefix) {
        return {
          role: rule.role || 'other',
          r2Prefix: normalizePrefix(rule.r2Prefix || mappingConfig.fallback.r2Prefix),
          matchedPrefix: normalizedPrefix
        };
      }
    }
  }

  return {
    role: mappingConfig.fallback.role || 'other',
    r2Prefix: normalizePrefix(mappingConfig.fallback.r2Prefix || 'resources/'),
    matchedPrefix: ''
  };
}

function toObjectKey(relativePath, category, mappingConfig) {
  const normalized = ensurePosix(relativePath);
  const mapping = resolveMapping(normalized, category, mappingConfig);
  const parts = normalized.split('/').filter(Boolean);
  const matchedSegments = mapping.matchedPrefix
    .split('/')
    .filter(Boolean)
    .length;
  const trimmed = parts.length > matchedSegments ? parts.slice(matchedSegments) : parts;
  const sanitized = trimmed.map((segment, index) => {
    const isLast = index === trimmed.length - 1;
    if (!isLast) {
      return sanitizePathSegment(segment);
    }

    const ext = path.extname(segment).toLowerCase();
    const base = segment.slice(0, segment.length - ext.length);
    const safeBase = sanitizePathSegment(base);
    const safeExt = sanitizePathSegment(ext.replace(/^\./, ''), true);
    return safeExt ? `${safeBase}.${safeExt}` : safeBase;
  });

  const keyTail = sanitized.join('/');
  return `${mapping.r2Prefix}${keyTail}`;
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const content = fs.readFileSync(filePath);
  hash.update(content);
  return hash.digest('hex');
}

function findPreferredAsset(files, pattern) {
  return files.find((file) => pattern.test(file.path));
}

function buildManifest(options = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const outputPath = path.resolve(options.output || DEFAULT_OUTPUT);
  const mappingPath = path.resolve(options.mappingPath || DEFAULT_MAPPING_PATH);
  const mappingConfig = loadMappingConfig(mappingPath);
  const result = writeLibraryArtifacts(root);
  const libraryIndex = JSON.parse(fs.readFileSync(result.indexPath, 'utf8'));
  const libraryScan = JSON.parse(fs.readFileSync(result.scanPath, 'utf8'));

  const filesByPath = new Map((libraryScan.files || []).map((entry) => [ensurePosix(entry.path), entry]));
  let assetCount = 0;

  const records = (libraryIndex.books || []).map((book) => {
    const files = (book.files || [])
      .map((filePath) => ensurePosix(filePath))
      .map((filePath) => {
        const scanInfo = filesByPath.get(filePath);
        if (!scanInfo) {
          return null;
        }

        const absolutePath = path.join(root, 'Library', ...filePath.split('/'));
        if (!fs.existsSync(absolutePath)) {
          return null;
        }

        const mapping = resolveMapping(filePath, scanInfo.category, mappingConfig);
        const key = toObjectKey(filePath, scanInfo.category, mappingConfig);
        return {
          role: mapping.role,
          key,
          sourcePath: filePath,
          url: `${baseUrl}/${encodeURI(key)}`,
          contentType: mimeTypeFromExtension(filePath),
          sizeBytes: Number(scanInfo.sizeBytes || 0),
          sha256: hashFile(absolutePath)
        };
      })
      .filter(Boolean);

    const prioritized = [];
    const cover = findPreferredAsset(files, /\.(png|jpe?g|webp)$/i);
    const pdf = findPreferredAsset(files, /\.pdf$/i);
    if (cover) prioritized.push(cover);
    if (pdf && pdf !== cover) prioritized.push(pdf);
    const remaining = files.filter((file) => file !== cover && file !== pdf);

    const assets = prioritized.concat(remaining);
    assetCount += assets.length;

    return {
      id: book.id,
      slug: toBookPageSlug(book),
      title: book.title || book.id,
      series: book.series || '',
      seriesCode: book.seriesCode || '',
      assets
    };
  });

  const manifest = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    library: {
      baseUrl,
      prefixes: mappingConfig.prefixes
    },
    summary: {
      recordCount: records.length,
      assetCount
    },
    records
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (!options.quiet) {
    console.log(`Manifest generated at ${path.relative(root, outputPath)}.`);
    console.log(`- Mapping: ${path.relative(root, mappingPath)}`);
    console.log(`- Records: ${manifest.summary.recordCount}`);
    console.log(`- Assets: ${manifest.summary.assetCount}`);
    console.log(`- Base URL: ${baseUrl}`);
  }

  return {
    manifest,
    outputPath,
    scanPath: result.scanPath,
    indexPath: result.indexPath
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  buildManifest(args);
}

module.exports = {
  buildManifest,
  parseArgs
};
