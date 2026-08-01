const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeLibraryArtifacts } = require('./library-scanner');

const root = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(root, 'generated', 'manifest', 'manifest.json');
const DEFAULT_BASE_URL = 'https://library.hawkinshollowbooks.com';

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.LIBRARY_BASE_URL || DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT,
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

function mapPrefixFromCategory(category, relativePath) {
  const normalizedCategory = String(category || '').toLowerCase();
  const firstSegment = ensurePosix(relativePath).split('/')[0].toLowerCase();

  if (normalizedCategory === 'books' || firstSegment === 'books') {
    return { role: 'book', prefix: 'books/' };
  }
  if (firstSegment === 'covers') {
    return { role: 'cover', prefix: 'covers/' };
  }
  if (firstSegment === 'characters' || normalizedCategory === 'characters') {
    return { role: 'character', prefix: 'characters/' };
  }
  if (firstSegment === 'illustrations') {
    return { role: 'illustration', prefix: 'illustrations/' };
  }
  if (firstSegment === 'companion-packs' || firstSegment === 'companion_packs' || firstSegment === 'companion packs') {
    return { role: 'companion-pack', prefix: 'companion-packs/' };
  }
  if (normalizedCategory === 'ribbons') {
    return { role: 'resource', prefix: 'resources/' };
  }
  if (firstSegment === 'resources') {
    return { role: 'resource', prefix: 'resources/' };
  }

  return { role: 'other', prefix: 'resources/' };
}

function toObjectKey(relativePath, category) {
  const normalized = ensurePosix(relativePath);
  const parts = normalized.split('/').filter(Boolean);
  const { prefix } = mapPrefixFromCategory(category, normalized);
  const trimmed = parts.length > 1 ? parts.slice(1) : parts;
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

  return `${prefix}${sanitized.join('/')}`;
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

        const mapping = mapPrefixFromCategory(scanInfo.category, filePath);
        const key = toObjectKey(filePath, scanInfo.category);
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
      prefixes: {
        books: 'books/',
        covers: 'covers/',
        companionPacks: 'companion-packs/',
        illustrations: 'illustrations/',
        characters: 'characters/',
        resources: 'resources/',
        manifest: 'manifest/'
      }
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
