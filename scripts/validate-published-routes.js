const fs = require('fs');
const path = require('path');
const {
  APPROVED_COMPATIBILITY_REDIRECTS,
  createKdpLiveBookIdSet
} = require('./canonical-book-routes');

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

function sitemapContainsRoute(sitemap, route) {
  return Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => {
    try {
      return decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '');
    } catch {
      return '';
    }
  }).includes(route);
}

function validateCompatibilityRedirect(buildDir, domain, redirect, sitemap, errors) {
  const redirectPath = path.join(buildDir, redirect.route);
  const targetPath = path.join(buildDir, redirect.targetRoute);
  const redirectUrl = `${domain}/${redirect.route}`;
  const targetUrl = `${domain}/${redirect.targetRoute}`;
  const targetHref = path.relative(path.dirname(redirect.route), redirect.targetRoute).replace(/\\/g, '/');

  if (!fs.existsSync(redirectPath)) {
    errors.push(`missing approved compatibility redirect: ${redirect.route}`);
    return;
  }
  if (!fs.existsSync(targetPath)) {
    errors.push(`compatibility redirect target is missing: ${redirect.route} -> ${redirect.targetRoute}`);
    return;
  }

  const redirectHtml = fs.readFileSync(redirectPath, 'utf8');
  const targetHtml = fs.readFileSync(targetPath, 'utf8');
  const refreshTags = Array.from(redirectHtml.matchAll(/<meta\s+http-equiv="refresh"\s+content="([^"]+)"\s*\/?>/gi), (match) => match[1]);
  if (refreshTags.length !== 1 || refreshTags[0] !== `0; url=${targetHref}`) {
    errors.push(`compatibility redirect has an invalid target: ${redirect.route}`);
  }

  const canonicalTags = Array.from(redirectHtml.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/gi), (match) => match[1]);
  if (canonicalTags.length !== 1 || canonicalTags[0] !== targetUrl) {
    errors.push(`compatibility redirect has an invalid canonical destination: ${redirect.route}`);
  }

  const robotsTags = Array.from(redirectHtml.matchAll(/<meta\s+name="robots"\s+content="([^"]+)"\s*\/?>/gi), (match) => match[1].toLowerCase());
  if (robotsTags.length !== 1 || robotsTags[0] !== 'noindex, follow') {
    errors.push(`compatibility redirect must be noindex, follow: ${redirect.route}`);
  }

  const targetCanonicalTags = Array.from(targetHtml.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/gi), (match) => match[1]);
  if (targetCanonicalTags.length !== 1 || targetCanonicalTags[0] !== targetUrl) {
    errors.push(`compatibility redirect target has an invalid canonical URL: ${redirect.targetRoute}`);
  }
  if (sitemapContainsRoute(sitemap, redirect.route) || sitemap.includes(`<loc>${redirectUrl}</loc>`)) {
    errors.push(`compatibility redirect must not appear in the sitemap: ${redirect.route}`);
  }
}

function validatePublishedRoutes(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const buildDir = path.resolve(options.buildDir || path.join(rootDir, 'build-recovery'));
  const libraryIndexPath = path.join(rootDir, 'generated', 'library-index.json');
  const amazonIndexPath = path.join(rootDir, 'generated', 'amazon-index.json');
  const freebieIndexPath = path.join(rootDir, 'generated', 'freebie-index.json');
  const sitePath = path.join(rootDir, 'data', 'site.json');
  const requiredPaths = [buildDir, libraryIndexPath, amazonIndexPath, sitePath];

  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      return {
        errors: [`${path.relative(rootDir, requiredPath) || '.'} is missing. Run the site generator first.`],
        summary: null
      };
    }
  }

  const site = readJson(sitePath);
  const libraryRecords = readJson(libraryIndexPath).books || [];
  const libraryBooks = libraryRecords.filter((record) => String(record.contentType || 'book') === 'book');
  const publicationRecords = readJson(amazonIndexPath).records || [];
  const liveBookIds = createKdpLiveBookIdSet(publicationRecords);
  const libraryBookIds = new Set(libraryBooks.map((record) => getCanonicalBookId(record).toUpperCase()));
  const missingLiveBooks = Array.from(liveBookIds).filter((id) => !libraryBookIds.has(id));
  const freebieRecords = (fs.existsSync(freebieIndexPath) ? readJson(freebieIndexPath).records || [] : [])
    .map((record) => ({ id: record.canonicalId, title: record.title, contentType: record.contentType }));
  const expectedRoutes = libraryBooks
    .filter((libraryBook) => liveBookIds.has(getCanonicalBookId(libraryBook).toUpperCase()))
    .map((libraryBook) => `books/${toBookPageSlug(libraryBook)}.html`);
  const freebieRouteDir = (record) => (String(record.contentType) === 'rhyme' ? 'nursery-rhymes' : 'songs');
  const expectedFreebieRoutes = freebieRecords.map((record) => `${freebieRouteDir(record)}/${toBookPageSlug(record)}.html`);
  const expectedStubRoutes = freebieRecords.map((record) => `books/${toBookPageSlug(record)}.html`);
  const errors = missingLiveBooks.map((id) => `live workbook Book is missing from the local Library index: ${id}`);
  const sitemapPath = path.join(buildDir, 'sitemap.xml');
  const sitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, 'utf8') : '';
  const domain = String(site.domain || '').replace(/\/$/, '');

  for (const route of expectedRoutes) {
    const filePath = path.join(buildDir, route);
    const canonicalUrl = `${domain}/${route}`;
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

  for (let index = 0; index < freebieRecords.length; index += 1) {
    const route = expectedFreebieRoutes[index];
    const stubRoute = expectedStubRoutes[index];
    const canonicalUrl = `${domain}/${route}`;
    const stubCanonicalUrl = `${domain}/${stubRoute}`;
    const filePath = path.join(buildDir, route);

    if (!fs.existsSync(filePath)) {
      errors.push(`missing detail page: ${route}`);
    } else {
      const html = fs.readFileSync(filePath, 'utf8');
      if (!html.includes(`<link rel="canonical" href="${canonicalUrl}" />`)) {
        errors.push(`canonical mismatch: ${route}`);
      }
      if (!sitemap.includes(`<loc>${canonicalUrl}</loc>`)) {
        errors.push(`sitemap missing: ${route}`);
      }
    }

    const stubPath = path.join(buildDir, stubRoute);
    if (!fs.existsSync(stubPath)) {
      errors.push(`missing legacy migration stub: ${stubRoute}`);
      continue;
    }
    const stubHtml = fs.readFileSync(stubPath, 'utf8');
    if (!stubHtml.includes(`<link rel="canonical" href="${canonicalUrl}" />`)) {
      errors.push(`legacy stub must point at the new canonical URL: ${stubRoute}`);
    }
    if (sitemap.includes(`<loc>${stubCanonicalUrl}</loc>`)) {
      errors.push(`legacy stub must not be listed as canonical content: ${stubRoute}`);
    }
  }

  const generatedBookFiles = fs.readdirSync(path.join(buildDir, 'books'))
    .filter((name) => name.endsWith('.html') && !name.endsWith('-characters.html'));
  const expectedSet = new Set(expectedRoutes.map((route) => path.basename(route)));
  const stubSet = new Set(expectedStubRoutes.map((route) => path.basename(route)));
  const approvedCompatibilitySet = new Set(APPROVED_COMPATIBILITY_REDIRECTS
    .filter((redirect) => redirect.route.startsWith('books/'))
    .map((redirect) => path.basename(redirect.route)));
  for (const fileName of generatedBookFiles) {
    if (!expectedSet.has(fileName) && !stubSet.has(fileName) && !approvedCompatibilitySet.has(fileName)) {
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

  for (const redirect of APPROVED_COMPATIBILITY_REDIRECTS) {
    validateCompatibilityRedirect(buildDir, domain, redirect, sitemap, errors);
  }

  return {
    errors,
    summary: {
      bookCount: expectedRoutes.length,
      freebieCount: expectedFreebieRoutes.length,
      legacyStubCount: expectedStubRoutes.length
    }
  };
}

if (require.main === module) {
  const result = validatePublishedRoutes();
  if (result.errors.length > 0) {
    result.errors.forEach((message) => {
      console.error(`Published route validation failed: ${message}`);
    });
    process.exitCode = 1;
  } else {
    console.log(`Published route validation passed: ${result.summary.bookCount} book detail routes retain authoritative canonical-ID casing; ${result.summary.freebieCount} song/nursery-rhyme routes are canonical with ${result.summary.legacyStubCount} legacy migration stubs and ${APPROVED_COMPATIBILITY_REDIRECTS.length} approved compatibility redirects.`);
  }
}

module.exports = {
  APPROVED_COMPATIBILITY_REDIRECTS,
  validatePublishedRoutes
};
