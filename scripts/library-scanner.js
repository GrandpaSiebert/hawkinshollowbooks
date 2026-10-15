const fs = require('fs');
const path = require('path');

const ID_WITH_TITLE_PATTERN = /\b(HH-[A-Z+]+-\d{4})\s+(.+?)\.(pdf|docx|png|jpe?g|json)$/i;
const ID_PATTERN_GLOBAL = /\b(HH-[A-Z+]+-\d{4})\b/gi;
const SHORT_ID_PATTERN_GLOBAL = /\b(HH-[A-Z+]+-(\d{1,3}))(?=[\s/\\.-]|$)/gi;
// Audio deliverables carry an HH-SL sibling code that is not a canonical content identity.
const MEDIA_DERIVED_ID_PATTERN = /^HH-SL-\d{4}$/i;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeRelativePath(filePath, rootDir) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function getTopLevelCategory(relativePath) {
  const segments = relativePath.split('/');
  return segments[0] || null;
}

function parseSeriesFromBooksPath(relativePath) {
  const segments = relativePath.split('/');
  if (segments.length < 2 || segments[0] !== 'Books') {
    return null;
  }

  const folder = segments[1];
  const match = /^HH-([A-Z+]+)\s+(.+)$/.exec(folder);
  if (!match) {
    return {
      seriesCode: null,
      series: folder
    };
  }

  return {
    seriesCode: match[1],
    series: match[2]
  };
}

function extractBookFolderId(relativePath) {
  const segments = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments[0] !== 'Books') return null;
  for (let index = 1; index < segments.length - 1; index += 1) {
    const match = /^HH-([A-Z+]+)-(\d{1,4})\s+.+$/i.exec(segments[index]);
    if (match) {
      return `HH-${match[1].toUpperCase()}-${match[2].padStart(4, '0')}`;
    }
  }
  return null;
}

function extractPrimaryId(relativePath) {
  const folderId = extractBookFolderId(relativePath);
  if (folderId) return folderId;

  const matches = [
    ...Array.from(relativePath.matchAll(ID_PATTERN_GLOBAL))
      .filter((match) => !MEDIA_DERIVED_ID_PATTERN.test(match[1]))
      .map((match) => ({ index: match.index, id: match[1] })),
    ...Array.from(relativePath.matchAll(SHORT_ID_PATTERN_GLOBAL))
      .filter((match) => !MEDIA_DERIVED_ID_PATTERN.test(match[1]))
      .map((match) => ({
        index: match.index,
        id: match[1].replace(/-(\d{1,3})$/, (_, digits) => `-${digits.padStart(4, '0')}`)
      }))
  ].sort((left, right) => left.index - right.index);
  if (matches.length === 0) {
    return null;
  }

  return matches[matches.length - 1].id;
}

function getContentType(relativePath) {
  const segments = relativePath.split('/');
  if (segments[0] !== 'Freebies') {
    return 'book';
  }
  if (/^Mode S\b/i.test(segments[1] || '')) {
    return 'song';
  }
  if (/^Mode R\b/i.test(segments[1] || '')) {
    return 'rhyme';
  }
  return 'book';
}

function inferTitleFromPath(relativePath, id) {
  const segments = relativePath.split('/');
  // Ignore the leaf file name; infer title from enclosing folder names.
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const match = /^(HH-[A-Z+]+)-(\d{1,4})\s+(.+)$/i.exec(segments[i]);
    if (!match) continue;
    const folderId = `${match[1]}-${match[2].padStart(4, '0')}`;
    if (folderId.toUpperCase() === id.toUpperCase()) return match[3].trim();
  }

  return null;
}

function normalizeTitleCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  const normalized = candidate.trim();
  if (!normalized) {
    return null;
  }

  if (/^\(\d+\)$/.test(normalized)) {
    return null;
  }

  if (/^story master$/i.test(normalized)) {
    return null;
  }

  // Freebie package folders separate the ID from the title with a dash.
  return normalized.replace(/^[\u2014\u2013-]\s*/, '').trim() || null;
}

function extractRecordHints(relativePath, fileName) {
  const id = extractPrimaryId(relativePath);
  if (!id) {
    return null;
  }

  const pathTitle = normalizeTitleCandidate(inferTitleFromPath(relativePath, id));
  if (pathTitle) {
    return {
      id,
      title: pathTitle,
      source: 'path-folder'
    };
  }

  const idWithTitleMatch = ID_WITH_TITLE_PATTERN.exec(fileName);
  if (idWithTitleMatch) {
    const fileTitle = normalizeTitleCandidate(idWithTitleMatch[2]);
    return {
      id,
      title: fileTitle,
      source: 'file-name'
    };
  }

  return {
    id,
    title: null,
    source: 'path'
  };
}

function walkDirectory(startDir, onDirectory, onFile) {
  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      onDirectory(fullPath);
      walkDirectory(fullPath, onDirectory, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath, entry.name);
    }
  }
}

function isIgnoredLibraryFile(fileName) {
  const name = String(fileName || '');
  return name.startsWith('~$')
    || /^Hawkins Hollow Website to YouTube Routing Master(?: \(version \d+\))?(?:\.xlsb)?\.xlsx$/i.test(name);
}

function buildCategorySummary(files) {
  const summaryMap = new Map();
  for (const file of files) {
    const key = file.category || 'uncategorized';
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        category: key,
        fileCount: 0,
        extensions: {}
      });
    }

    const current = summaryMap.get(key);
    current.fileCount += 1;
    const ext = file.extension || 'none';
    current.extensions[ext] = (current.extensions[ext] || 0) + 1;
  }

  return Array.from(summaryMap.values()).sort((a, b) => a.category.localeCompare(b.category));
}

function buildBookIndex(files) {
  const booksMap = new Map();

  for (const file of files) {
    const hint = extractRecordHints(file.path, file.name);
    if (!hint || !hint.id) {
      continue;
    }

    if (!booksMap.has(hint.id)) {
      const seriesInfo = parseSeriesFromBooksPath(file.path);
      booksMap.set(hint.id, {
        id: hint.id,
        title: hint.title,
        contentType: getContentType(file.path),
        series: seriesInfo ? seriesInfo.series : null,
        seriesCode: seriesInfo ? seriesInfo.seriesCode : null,
        folder: path.posix.dirname(file.path),
        files: [],
        fileTypes: {}
      });
    }

    const record = booksMap.get(hint.id);
    if (!record.title && hint.title) {
      record.title = hint.title;
    }

    record.files.push(file.path);
    record.fileTypes[file.extension || 'none'] = (record.fileTypes[file.extension || 'none'] || 0) + 1;
  }

  return Array.from(booksMap.values())
    .map((record) => ({
      ...record,
      files: record.files.sort(),
      fileTypes: Object.keys(record.fileTypes)
        .sort()
        .map((ext) => ({ extension: ext, count: record.fileTypes[ext] }))
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function scanLibrary(siteRoot) {
  const libraryRoot = path.join(siteRoot, 'Library');
  const startedAt = new Date().toISOString();
  if (!fs.existsSync(libraryRoot)) {
    const completedAt = new Date().toISOString();
    const emptyCategories = buildCategorySummary([]);
    return {
      scan: {
        generatedAt: completedAt,
        startedAt,
        libraryRoot: 'Library',
        missingLibrary: true,
        summary: {
          folderCount: 0,
          fileCount: 0,
          categories: emptyCategories
        },
        folders: [],
        files: []
      },
      index: {
        generatedAt: completedAt,
        libraryRoot: 'Library',
        missingLibrary: true,
        summary: {
          indexedBooks: 0,
          categories: emptyCategories
        },
        books: []
      }
    };
  }

  const folders = [];
  const files = [];

  walkDirectory(
    libraryRoot,
    (dirPath) => {
      folders.push(normalizeRelativePath(dirPath, libraryRoot));
    },
    (filePath, fileName) => {
      if (isIgnoredLibraryFile(fileName)) {
        return;
      }

      const stats = fs.statSync(filePath);
      const relativePath = normalizeRelativePath(filePath, libraryRoot);
      const extension = path.extname(fileName).toLowerCase().replace(/^\./, '');
      files.push({
        path: relativePath,
        name: fileName,
        category: getTopLevelCategory(relativePath),
        extension,
        sizeBytes: stats.size,
        lastModifiedUtc: stats.mtime.toISOString()
      });
    }
  );

  const completedAt = new Date().toISOString();
  const categorySummary = buildCategorySummary(files);
  const books = buildBookIndex(files);

  const scan = {
    generatedAt: completedAt,
    startedAt,
    libraryRoot: 'Library',
    summary: {
      folderCount: folders.length,
      fileCount: files.length,
      categories: categorySummary
    },
    folders: folders.sort(),
    files: files.sort((a, b) => a.path.localeCompare(b.path))
  };

  const index = {
    generatedAt: completedAt,
    libraryRoot: 'Library',
    summary: {
      indexedBooks: books.length,
      categories: categorySummary
    },
    books
  };

  return { scan, index };
}

function writeLibraryArtifacts(siteRoot, outputDir = path.join(siteRoot, 'generated')) {
  const { scan, index } = scanLibrary(siteRoot);
  ensureDir(outputDir);

  const scanPath = path.join(outputDir, 'library-scan.json');
  const indexPath = path.join(outputDir, 'library-index.json');

  fs.writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf8');
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  return {
    scanPath,
    indexPath,
    missingLibrary: scan.missingLibrary === true,
    summary: {
      fileCount: scan.summary.fileCount,
      folderCount: scan.summary.folderCount,
      indexedBooks: index.summary.indexedBooks
    }
  };
}

module.exports = {
  scanLibrary,
  writeLibraryArtifacts,
  isIgnoredLibraryFile
};
