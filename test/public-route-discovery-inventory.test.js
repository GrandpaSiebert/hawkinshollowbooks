const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');

function generate() {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-site.js')], {
    cwd: root,
    env: {
      ...process.env,
      HH_SITEMAP_DEPLOYMENT_DATE: process.env.HH_SITEMAP_DEPLOYMENT_DATE || '2026-10-14'
    },
    stdio: 'pipe'
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sitemapRoutes() {
  const xml = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html');
}

before(generate);

test('every sitemap route is registered with matching public-surface eligibility', () => {
  const routes = sitemapRoutes();
  const surfaces = readJson(path.join(root, 'generated', 'public-surface-index.json')).records;
  const registeredRoutes = new Set(surfaces.filter((surface) => surface.sitemap).map((surface) => surface.route));
  const generatedRoutes = new Set(routes);

  assert.equal(routes.length, generatedRoutes.size, 'sitemap routes should be unique');
  assert.deepEqual(
    Array.from(generatedRoutes).sort(),
    Array.from(registeredRoutes).sort(),
    'sitemap and public-surface sitemap eligibility should agree exactly'
  );
  for (const route of routes) {
    assert.ok(fs.existsSync(path.join(output, route)), `sitemap route exists: ${route}`);
  }
});

test('eligible character continuations have unique, content-backed search destinations', () => {
  const surfaces = readJson(path.join(root, 'generated', 'public-surface-index.json')).records;
  const search = readJson(path.join(root, 'generated', 'search-index.json'));
  const eligibleRoutes = surfaces
    .filter((surface) => surface.search && /^characters\/.+-(stories|places|people|relationships)\.html$/.test(surface.route))
    .map((surface) => surface.route)
    .sort();
  const records = search.records.filter((record) => record.type === 'character-continuation');
  const destinations = records.map((record) => record.href);

  assert.deepEqual(destinations.slice().sort(), eligibleRoutes);
  assert.equal(new Set(destinations).size, records.length, 'each continuation route has one search record');
  assert.equal(new Set(records.map((record) => record.id)).size, records.length, 'continuation IDs are unique');
  assert.equal(new Set(records.map((record) => record.title)).size, records.length, 'continuation titles distinguish results');
  assert.equal(search.summary.byType.characterContinuations, records.length);
  for (const record of records) {
    assert.ok(record.title && record.summary, `${record.href} has visitor-facing search text`);
    assert.ok(record.keywords.some((keyword) => keyword && keyword.trim()), `${record.href} has searchable content terms`);
    assert.ok(fs.existsSync(path.join(output, record.href)), `${record.href} exists`);
  }
});

test('search-enabled routes have direct, shared, or navigational discovery', () => {
  const surfaces = readJson(path.join(root, 'generated', 'public-surface-index.json')).records;
  const entities = readJson(path.join(root, 'generated', 'entity-index.json')).entities;
  const searchRecords = readJson(path.join(root, 'generated', 'search-index.json')).records;
  const directDestinations = new Set(searchRecords.map((record) => record.href));
  const unmatched = surfaces.filter((surface) => surface.search && !directDestinations.has(surface.route));
  const continuationGaps = unmatched.filter((surface) => (
    /^characters\/.+-(stories|places|people|relationships)\.html$/.test(surface.route)
  ));
  const profileGaps = unmatched.filter((surface) => /^characters\/[^/]+\.html$/.test(surface.route));
  const directCharacterDestinations = new Set(searchRecords
    .filter((record) => record.type === 'character')
    .map((record) => record.href));
  const characterProfileSurfaces = surfaces.filter((surface) => (
    /^characters\/[^/]+\.html$/.test(surface.route)
      && !/-(stories|places|people|relationships)\.html$/.test(surface.route)
  ));
  for (const profile of characterProfileSurfaces) {
    const slug = path.basename(profile.route, '.html');
    const entity = entities.find((record) => record.type === 'character' && record.slug === slug);
    const entitySurface = entity && surfaces.find((surface) => surface.route === entity.entityPageHref);
    assert.ok(entitySurface, `${profile.route} has a canonical character entity surface`);
    assert.equal(profile.search, entitySurface.search, `${profile.route} follows shared character search eligibility`);
    assert.ok(profile.generated && profile.indexable && profile.sitemap, `${profile.route} remains a public canonical profile`);
  }
  assert.deepEqual(
    characterProfileSurfaces.filter((surface) => surface.search).map((surface) => surface.route).sort(),
    Array.from(directCharacterDestinations).sort(),
    'every search-eligible character profile has exactly one direct character search destination'
  );
  const bookCharacterGaps = unmatched.filter((surface) => (
    /^books\/.+-characters\.html$/.test(surface.route)
  ));
  const sharedEntityGaps = unmatched.filter((surface) => surface.route.startsWith('entities/'));
  assert.equal(sharedEntityGaps.length, 26, 'character entity pages share discovery with their primary profiles');
  assert.ok(sharedEntityGaps.every((surface) => {
    const entity = entities.find((record) => record.entityPageHref === surface.route);
    return entity
      && entity.type === 'character'
      && directDestinations.has(entity.legacyHref);
  }));
  const freebieHubGaps = unmatched.filter((surface) => (
    ['kids-songs.html', 'nursery-rhymes.html'].includes(surface.route)
  ));
  const navigationLandingGaps = unmatched.filter((surface) => (
    !surface.route.includes('/')
      && surface.route.endsWith('.html')
      && !freebieHubGaps.includes(surface)
  ));
  const childSearchTypes = new Set(searchRecords.map((record) => record.type));

  assert.equal(continuationGaps.length, 0, 'eligible continuation content must have its own search entry');
  assert.equal(profileGaps.length, 0, 'character profiles are directly searchable');
  assert.equal(bookCharacterGaps.length, 69, 'book character lists share the searchable canonical Book result');
  assert.ok(bookCharacterGaps.every((surface) => searchRecords.some((record) => (
    record.type === 'book'
      && record.href === surface.route.replace(/-characters\.html$/, '.html')
  ))));
  assert.equal(freebieHubGaps.length, 2, 'song and rhyme hubs share discovery with their indexed contents');
  assert.ok(childSearchTypes.has('song') && childSearchTypes.has('rhyme'));
  assert.deepEqual(
    navigationLandingGaps.filter((surface) => surface.route !== 'theme-songs.html').map((surface) => surface.route).sort(),
    [
      'index.html', 'start-here.html', 'books.html', 'characters.html', 'themes.html',
      'community.html', 'map.html', 'first-readers.html', 'second-readers.html',
      'bedtime-library.html', 'growing-together.html', 'tender-times.html',
      'basic-training.html', 'holiday-story-poems.html', 'hero-play-poems.html'
    ].sort(),
    'all original 15 landing and series pages retain their discovery classification'
  );
  assert.equal(navigationLandingGaps.filter((surface) => surface.route === 'theme-songs.html').length, 1,
    'Theme Songs is the single additional navigation-discovered landing page');
  assert.ok(readJson(path.join(root, 'data', 'navigation.json')).items.some((item) => item.href === 'theme-songs.html'),
    'Theme Songs has an explicit navigation destination');
  assert.equal(navigationLandingGaps.length, 16, 'landing and series pages, including Theme Songs, remain discoverable through navigation and their indexed contents');
  assert.equal(
    unmatched.length,
    bookCharacterGaps.length
      + sharedEntityGaps.length
      + freebieHubGaps.length
      + navigationLandingGaps.length,
    'every unmatched search-enabled route has an explicit discovery classification'
  );
});
