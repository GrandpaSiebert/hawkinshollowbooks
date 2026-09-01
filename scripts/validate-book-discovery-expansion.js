const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const site = JSON.parse(fs.readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const booksData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'books.json'), 'utf8')).books || [];
const storyMasters = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-index.json'), 'utf8')).records || [];
const resources = JSON.parse(fs.readFileSync(path.join(root, 'data', 'companion-resource-registry.json'), 'utf8')).resources || [];
const characterIndex = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-character-book-index.json'), 'utf8')).records || [];
const themeIndex = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-theme-book-index.json'), 'utf8')).records || [];
const sitemap = fs.readFileSync(path.join(buildDir, 'sitemap.xml'), 'utf8');
const modelById = new Map(booksData.map((book) => [String(book.identity && book.identity.canonicalId || '').toUpperCase(), book]));
const failures = [];
const totals = { storyMasters: storyMasters.length, readingAge: 0, themes: 0, themeWithheld: 0, rawCharacters: 0, resolvedCharacters: 0, unresolvedCharacters: 0, booksWithResolvedCharacters: 0, booksWithUnresolvedCharacters: 0, resources: 0, booksWithResources: 0, resourcePreviews: 0 };

function getPageName(id) {
  return fs.readdirSync(path.join(buildDir, 'books')).find((name) => (name === `${id}.html` || name.startsWith(`${id}-`)) && !name.endsWith('-characters.html'));
}

for (const record of storyMasters) {
  const id = record.discoveryId;
  const model = modelById.get(id);
  const pageName = getPageName(id);
  const page = pageName ? fs.readFileSync(path.join(buildDir, 'books', pageName), 'utf8') : '';
  const canonicalUrl = `${String(site.domain || '').replace(/\/$/, '')}/books/${pageName}`;
  const fields = record.fields || {};
  if (!pageName) {
    failures.push(`${id}: generated detail page is missing`);
    continue;
  }
  if (!page.includes(`<link rel="canonical" href="${canonicalUrl}" />`) || !page.includes(`"url": "${canonicalUrl}"`) || !sitemap.includes(`<loc>${canonicalUrl}</loc>`)) failures.push(`${id}: route, canonical, JSON-LD, or sitemap changed`);
  if (fields.readingAge && fields.readingAge.value) {
    totals.readingAge += 1;
    if (!page.includes(`<strong>Reading Age:</strong> ${fields.readingAge.value}`)) failures.push(`${id}: Reading Age is missing or changed`);
  }
  const curatedThemes = Array.isArray(model && model.themes) ? model.themes.filter(Boolean) : [];
  if (fields.themes && fields.themes.value && fields.themes.value.length > 0) {
    if (curatedThemes.length > 0) totals.themeWithheld += 1;
    else {
      totals.themes += 1;
      for (const theme of fields.themes.value) if (!page.includes(theme)) failures.push(`${id}: Story Master theme is missing: ${theme}`);
    }
  }
  const deduped = new Set();
  let unresolved = 0;
  for (const fieldName of ['mainCharacters', 'featuredCharacters', 'characterDependencies']) {
    const field = fields[fieldName];
    for (const resolution of (field && field.resolutions) || []) {
      totals.rawCharacters += 1;
      if (resolution.resolutionStatus === 'exact' || resolution.resolutionStatus === 'resolved-alias') deduped.add(resolution.canonicalId);
      else unresolved += 1;
    }
  }
  totals.resolvedCharacters += deduped.size;
  totals.unresolvedCharacters += unresolved;
  if (deduped.size > 0) totals.booksWithResolvedCharacters += 1;
  if (unresolved > 0) totals.booksWithUnresolvedCharacters += 1;
  const matchingResources = resources.filter((resource) => String(resource && resource.structural && resource.structural.storyId || '').toUpperCase() === id);
  totals.resources += matchingResources.length;
  if (matchingResources.length > 0) {
    totals.booksWithResources += 1;
    const preview = matchingResources.slice(0, 3);
    totals.resourcePreviews += preview.length;
    for (const resource of preview) if (!page.includes(resource.publicName || resource.resourceId)) failures.push(`${id}: resource preview is missing ${resource.resourceId}`);
  }
}

const characterAssociations = characterIndex.reduce((count, record) => count + (record.books || []).length, 0);
const themeAssociations = themeIndex.reduce((count, record) => count + (record.books || []).length, 0);
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Book discovery expansion validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ...totals, reverseCharacters: characterIndex.length, characterAssociations, reverseThemes: themeIndex.length, themeAssociations }, null, 2));
}