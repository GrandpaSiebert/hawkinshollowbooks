const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const assetHashCache = new Map();

function normalizeCanonicalId(value) {
  const match = /^HH-([A-Z+]+)-(\d{1,4})$/i.exec(String(value || '').trim());
  return match ? `HH-${match[1].toUpperCase()}-${match[2].padStart(4, '0')}` : '';
}

function folderIdentity(folderName) {
  const match = /^HH-([A-Z+]+)-(\d{1,4})\s+(.+)$/i.exec(String(folderName || '').trim());
  if (!match) return null;
  return {
    canonicalId: normalizeCanonicalId(`HH-${match[1]}-${match[2]}`),
    title: match[3].trim()
  };
}

function normalizeSeries(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeBookTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function classifyPngRole(filePath) {
  const filename = path.posix.basename(String(filePath || ''));
  if (!/\.png$/i.test(filename)) return 'other';
  if (/back[\s_-]*cover/i.test(filename)) return 'back-cover';
  if (/\bgrandpa\b|\bpop[\s-]*pop\b/i.test(filename)) return 'introduction';
  if (/cover\.png$/i.test(filename)) return 'front-cover';
  if (/\(\d+\)\.png$/i.test(filename) || /\bpicture[\s_-]*\d+\.png$/i.test(filename)) {
    return 'interior-illustration';
  }
  return 'other';
}

function classifyBookFolderAssets(book, expected = {}) {
  const canonicalId = normalizeCanonicalId(expected.canonicalId || (book && book.id));
  const expectedSeries = normalizeSeries(expected.series || (book && book.series));
  const expectedTitle = normalizeBookTitle(expected.title || (book && book.title));
  const files = Array.isArray(book && book.files) ? book.files : [];
  if (!canonicalId || files.length === 0) {
    return {
      status: 'ownership-conflict',
      canonicalId,
      folder: '',
      frontCoverPaths: [],
      conflicts: ['Missing canonical ID or indexed book files.']
    };
  }

  const ownerFolders = new Set();
  const conflicts = [];
  for (const file of files) {
    const segments = String(file || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const matches = [];
    for (let index = 1; index < segments.length - 1; index += 1) {
      const identity = folderIdentity(segments[index]);
      if (!identity) continue;
      matches.push({ index, identity });
      if (identity.canonicalId !== canonicalId) {
        conflicts.push(`${file}: folder identity ${identity.canonicalId} conflicts with ${canonicalId}.`);
      }
      if (expectedTitle && normalizeBookTitle(identity.title) !== expectedTitle) {
        conflicts.push(`${file}: folder title "${identity.title}" conflicts with "${expected.title || book.title}".`);
      }
    }
    const owner = matches.find((entry) => entry.identity.canonicalId === canonicalId);
    if (!owner) {
      conflicts.push(`${file}: no parent folder establishes ${canonicalId} ownership.`);
      continue;
    }
    ownerFolders.add(segments.slice(0, owner.index + 1).join('/'));

    const seriesFolder = segments[1] || '';
    const seriesMatch = /^HH-[A-Z+]+\s+(.+)$/i.exec(seriesFolder);
    if (!seriesMatch || normalizeSeries(seriesMatch[1]) !== expectedSeries) {
      conflicts.push(`${file}: series folder "${seriesFolder}" does not match "${expected.series || book.series}".`);
    }
  }

  if (ownerFolders.size !== 1) {
    conflicts.push(`Indexed files resolve to ${ownerFolders.size} distinct ${canonicalId} folders.`);
  }
  if (conflicts.length) {
    return {
      status: 'ownership-conflict',
      canonicalId,
      folder: ownerFolders.size === 1 ? Array.from(ownerFolders)[0] : '',
      frontCoverPaths: [],
      conflicts
    };
  }

  const folder = Array.from(ownerFolders)[0];
  const pngRoles = files
    .filter((file) => String(file).replace(/\\/g, '/').startsWith(`${folder}/`))
    .filter((file) => /\.png$/i.test(path.posix.basename(String(file).replace(/\\/g, '/'))))
    .map((file) => ({ path: String(file).replace(/\\/g, '/'), role: classifyPngRole(file) }));
  const frontCoverPaths = pngRoles.filter((asset) => asset.role === 'front-cover').map((asset) => asset.path);
  const status = frontCoverPaths.length === 1
    ? 'matched'
    : frontCoverPaths.length === 0
      ? 'missing-cover'
      : 'ambiguous-cover';
  const warnings = frontCoverPaths
    .filter((file) => expectedTitle)
    .map((file) => {
      const filename = path.posix.basename(file).replace(/\s+Cover\.png$/i, '');
      const artworkTitle = filename.replace(/^\S+\s+/, '');
      return normalizeBookTitle(artworkTitle) === expectedTitle
        ? ''
        : `${file}: front-cover filename title "${artworkTitle}" differs from the canonical title "${expected.title || book.title}".`;
    })
    .filter(Boolean);

  return {
    status,
    canonicalId,
    folder,
    frontCoverPaths,
    warnings,
    assets: pngRoles
  };
}

function hashFile(filePath) {
  const stats = fs.statSync(filePath);
  const cacheKey = `${filePath}\0${stats.size}\0${stats.mtimeMs}`;
  if (!assetHashCache.has(cacheKey)) {
    assetHashCache.set(cacheKey, crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'));
  }
  return assetHashCache.get(cacheKey);
}

function findByteIdenticalPublicCovers(sourcePath, publicCoverDirectory) {
  if (!fs.existsSync(sourcePath) || !fs.existsSync(publicCoverDirectory)) return [];
  const sourceHash = hashFile(sourcePath);
  return fs.readdirSync(publicCoverDirectory)
    .filter((filename) => /\.png$/i.test(filename) && !/back[\s_-]*cover/i.test(filename))
    .map((filename) => path.join(publicCoverDirectory, filename))
    .filter((candidate) => hashFile(candidate) === sourceHash);
}

function findExactTitlePublicCovers(title, publicCoverDirectory) {
  if (!title || !fs.existsSync(publicCoverDirectory)) return [];
  const titleKey = normalizeBookTitle(title);
  return fs.readdirSync(publicCoverDirectory)
    .filter((filename) => /\.png$/i.test(filename) && !/back[\s_-]*cover/i.test(filename))
    .filter((filename) => {
      const coverTitle = filename
        .replace(/^\S+\s+/, '')
        .replace(/\s+Cover\.png$/i, '');
      return normalizeBookTitle(coverTitle) === titleKey;
    })
    .map((filename) => path.join(publicCoverDirectory, filename));
}

function findVerifiedForeignBookCoverOwner(sourcePath, expectedCanonicalId, seriesSlug, bookModels, rootDir) {
  const filename = path.basename(sourcePath);
  const match = /^HH-[A-Z+]+-\d{4}\s+(.+?)\s+Cover\.png$/i.exec(filename);
  if (!match || !fs.existsSync(sourcePath)) return '';

  const artworkTitle = normalizeBookTitle(match[1]);
  const expectedId = normalizeCanonicalId(expectedCanonicalId);
  const expectedSeries = normalizeSeries(seriesSlug);
  const candidates = (Array.isArray(bookModels) ? bookModels : [])
    .filter((book) => {
      const canonicalId = normalizeCanonicalId(book && book.identity && book.identity.canonicalId || book && book.id);
      return canonicalId
        && canonicalId !== expectedId
        && normalizeSeries(book && book.seriesSlug) === expectedSeries
        && normalizeBookTitle(book && book.title) === artworkTitle
        && book && book.coverImage;
    })
    .filter((book) => {
      const coverPath = path.resolve(rootDir, String(book.coverImage).replace(/^[/\\]/, ''));
      if (!fs.existsSync(coverPath)) return false;

      const mappedTitle = path.basename(coverPath)
        .replace(/^\S+\s+/, '')
        .replace(/\s+Cover\.png$/i, '');
      const exactTitleCovers = findExactTitlePublicCovers(book.title, path.dirname(coverPath));
      return normalizeBookTitle(mappedTitle) === artworkTitle
        && exactTitleCovers.length === 1
        && path.resolve(exactTitleCovers[0]) === coverPath
        && hashFile(sourcePath) === hashFile(coverPath);
    });

  return candidates.length === 1
    ? normalizeCanonicalId(candidates[0].identity && candidates[0].identity.canonicalId || candidates[0].id)
    : '';
}

module.exports = {
  classifyBookFolderAssets,
  classifyPngRole,
  findByteIdenticalPublicCovers,
  findExactTitlePublicCovers,
  findVerifiedForeignBookCoverOwner,
  normalizeBookTitle,
  normalizeCanonicalId
};
