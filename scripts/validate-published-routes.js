const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const booksDataPath = path.join(root, 'data', 'books.json');
const libraryIndexPath = path.join(root, 'generated', 'library-index.json');
const sitePath = path.join(root, 'data', 'site.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getCanonicalBookId(book) {
  return String((book && ((book.identity && book.identity.canonicalId) || book.canonicalId || book.code || book.id)) || '').trim();
}

function toBookPageSlug(book) {
  const safeId = (getCanonicalBookId(book) || 'unknown')
    .replace(/[^A-Za-z0-9+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeTitle = String(book && book.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safeTitle ? `${safeId}-${safeTitle}` : safeId;
}

function fail(message) {
  console.error(`Published route validation failed: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(buildDir) || !fs.existsSync(libraryIndexPath)) {
  fail('build-recovery/ or generated/library-index.json is missing. Run the site generator first.');
} else {
  const site = readJson(sitePath);
  const libraryBooks = readJson(libraryIndexPath).books || [];
  const expectedRoutes = libraryBooks.map((libraryBook) => `books/${toBookPageSlug(libraryBook)}.html`);
  const errors = [];
  const sitemapPath = path.join(buildDir, 'sitemap.xml');
  const sitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';

  for (const route of expectedRoutes) {
    const filePath = path.join(buildDir, route);
    const canonicalUrl = `${String(site.domain || '').replace(/\/$/, '')}/${route}`;
    if (!fs.existsSync(filePath)) {
      errors.push(`missing detail page: ${route}`);
      continue;
    }
    const html = fs.readFileSync(filePath, 'utf8');
    if (!html.includes(`<link rel="canonical" href="${canonicalUrl}" />`)) {
      errors.push(`canonical mismatch: ${route}`);
    }
    if (!html.includes(`"url": "${canonicalUrl}"`)) {
      errors.push(`structured-data URL mismatch: ${route}`);
    }
    if (!sitemap.includes(`<loc>${canonicalUrl}</loc>`)) {
      errors.push(`sitemap missing: ${route}`);
    }
  }

  const generatedBookFiles = fs.readdirSync(path.join(buildDir, 'books'))
    .filter((name) => name.endsWith('.html') && !name.endsWith('-characters.html'));
  const expectedSet = new Set(expectedRoutes.map((route) => path.basename(route)));
  for (const fileName of generatedBookFiles) {
    if (!expectedSet.has(fileName)) {
      errors.push(`unexpected book route: books/${fileName}`);
    }
  }

  const lowercaseDuplicates = generatedBookFiles.filter((fileName) => {
    const matchingExpected = Array.from(expectedSet).find((expected) => expected.toLowerCase() === fileName.toLowerCase());
    return matchingExpected && matchingExpected !== fileName;
  });
  for (const fileName of lowercaseDuplicates) {
    errors.push(`case-variant duplicate book route: books/${fileName}`);
  }

  if (errors.length > 0) {
    errors.forEach(fail);
  } else {
    console.log(`Published route validation passed: ${expectedRoutes.length} book detail routes retain authoritative canonical-ID casing.`);
  }
}