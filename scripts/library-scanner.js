const fs = require('fs');
const path = require('path');

const ID_WITH_TITLE_PATTERN = /\b(HH-[A-Z+]+-\d{4})\s+(.+?)\.(pdf|docx|png|jpe?g|json)$/i;
const ID_PATTERN_GLOBAL = /\b(HH-[A-Z+]+-\d{4})\b/gi;

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

function extractPrimaryId(relativePath) {
  const matches = Array.from(relativePath.matchAll(ID_PATTERN_GLOBAL));
  if (matches.length === 0) {
    return null;
  }

  // Pick the last 4-digit ID in the path so range folders do not override the concrete book folder.
  return matches[matches.length - 1][1];
}

function inferTitleFromPath(relativePath, id) {
  const segments = relativePath.split('/');
  const prefix = `${id} `;
  // Ignore the leaf file name; infer title from enclosing folder names.
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (segments[i].startsWith(prefix)) {
      return segments[i].slice(prefix.length).trim();
    }
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

  return normalized;
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
    summary: {
      fileCount: scan.summary.fileCount,
      folderCount: scan.summary.folderCount,
      indexedBooks: index.summary.indexedBooks
    }
  };
}

module.exports = {
  scanLibrary,
  writeLibraryArtifacts
};
