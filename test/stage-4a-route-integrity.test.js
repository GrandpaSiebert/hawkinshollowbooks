const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  createCanonicalBookRouteRegistry,
  getBookCharactersRoute,
  getCanonicalBookRoute,
  getPublishedRoutableBooks
} = require('../scripts/canonical-book-routes');

const repoRoot = path.join(__dirname, '..');
const buildRoot = path.join(repoRoot, 'build-recovery');

function readBuildHtml(relativePath) {
  return fs.readFileSync(path.join(buildRoot, relativePath), 'utf8');
}

function getHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? getHtmlFiles(filePath)
      : (entry.name.endsWith('.html') ? [filePath] : []);
  });
}

test('canonical route registry excludes unpublished, unroutable, and ambiguous records', () => {
  const indexedBooks = [
    { identity: { canonicalId: 'HH-ROUTED' }, pageHref: 'books/indexed-route.html' },
    { identity: { canonicalId: 'HH-CONFLICT' }, pageHref: 'books/indexed-conflict-route.html' },
    { identity: { canonicalId: 'HH-AMBIGUOUS' }, pageHref: 'books/first-route.html' },
    { identity: { canonicalId: 'HH-AMBIGUOUS' }, pageHref: 'books/second-route.html' },
    { identity: { canonicalId: 'HH-INVALID' }, pageHref: '../outside.html' }
  ];
  const routes = createCanonicalBookRouteRegistry(indexedBooks, (book) => book.pageHref);
  const seriesBooks = getPublishedRoutableBooks([
    { identity: { canonicalId: 'HH-ROUTED' }, published: true },
    { identity: { canonicalId: 'HH-ROUTED' }, published: false },
    { identity: { canonicalId: 'HH-CONFLICT' }, title: 'A different presentation title', published: true },
    { identity: { canonicalId: 'HH-INVALID' }, published: true },
    { identity: { canonicalId: 'HH-AMBIGUOUS' }, published: true }
  ], routes);

  assert.equal(getCanonicalBookRoute(seriesBooks[0], routes), 'books/indexed-route.html');
  assert.deepEqual(seriesBooks.map((book) => book.identity.canonicalId), ['HH-ROUTED', 'HH-CONFLICT']);
  assert.equal(getCanonicalBookRoute(seriesBooks[1], routes), 'books/indexed-conflict-route.html');
  assert.equal(getBookCharactersRoute('books/indexed-route.html'), 'books/indexed-route-characters.html');
});

test('generator omits unpublished and unroutable series records without rewriting their titles', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const unavailableSeriesRecords = [
    ['bedtime-library.html', 'HH-H-0001'],
    ['bedtime-library.html', 'HH-H-0006'],
    ['growing-together.html', 'HH-D-0007'],
    ['hero-play-poems.html', 'HH-F-0003'],
    ['holiday-story-poems.html', 'HH-I-0001'],
    ['holiday-story-poems.html', 'HH-I-0007']
  ];
  for (const [page, canonicalId] of unavailableSeriesRecords) {
    assert.doesNotMatch(readBuildHtml(page), new RegExp(`href="books/${canonicalId}-[^\"]+\\.html"`));
  }

  const storybookShelf = readBuildHtml('storybook-shelf.html');
  assert.doesNotMatch(storybookShelf, /href="books\/HH-A-0011-brandons-listening-ears\.html"/);
  assert.doesNotMatch(storybookShelf, /href="books\/HH-A-0011-brandon-s-listening-ears\.html"/);

  assert.equal(fs.readdirSync(path.join(buildRoot, 'songs')).filter((file) => file.endsWith('.html')).length, 500);
  assert.equal(fs.readdirSync(path.join(buildRoot, 'nursery-rhymes')).filter((file) => file.endsWith('.html')).length, 500);
  assert.ok(fs.existsSync(path.join(buildRoot, 'songs', 'HH-S-0001-singable-hollow-welcome.html')));
  assert.ok(fs.existsSync(path.join(buildRoot, 'nursery-rhymes', 'HH-R-0001-bouncy-puddle-parade.html')));
  assert.equal(fs.existsSync(path.join(buildRoot, 'entities', 'book', 'hh-s-0001-singable-hollow-welcome.html')), false);
  assert.equal(fs.existsSync(path.join(buildRoot, 'entities', 'book', 'hh-r-0001-bouncy-puddle-parade.html')), false);

  const searchIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'generated', 'search-index.json'), 'utf8'));
  assert.ok(searchIndex.records.some((record) => record.id === 'HH-S-0001'));
  assert.ok(searchIndex.records.some((record) => record.id === 'HH-R-0001'));
  const sitemap = readBuildHtml('sitemap.xml');
  assert.equal((sitemap.match(/<loc>/g) || []).length, 1392);
  assert.doesNotMatch(sitemap, /entities\/book\/hh-[sr]-/i);

  const porchLight = readBuildHtml('the-porch-light.html');
  assert.match(porchLight, /<meta name="robots" content="noindex, follow"\s*\/>/);
  assert.match(porchLight, /<link rel="canonical" href="https:\/\/hawkinshollowbooks\.com\/the-porch-light\.html"/);
  assert.match(porchLight, /In this opening story, a child follows the porch light home and discovers the welcoming feeling of Hawkins Hollow\./);
  assert.match(porchLight, /href="storybook-shelf\.html"/);
  assert.doesNotMatch(porchLight, /Unresolved book reference/);
  assert.doesNotMatch(sitemap, /the-porch-light\.html/);

  const generatedHtml = getHtmlFiles(buildRoot);
  assert.equal(generatedHtml.filter((filePath) => fs.readFileSync(filePath, 'utf8').includes('pub-d3308832301d4b6387c9e30504f86c7d.r2.dev')).length, 0);
});

test('Book-character pages canonicalize to their generated path and return to indexed detail routes', () => {
  const cases = [
    {
      characterPage: 'books/HH-A-0011-brandons-listening-ears-characters.html',
      detailPath: 'books/HH-A-0011-brandons-listening-ears.html'
    },
    {
      characterPage: 'books/HH-D-0001-spencer-s-grumpy-wake-up-characters.html',
      detailPath: 'books/HH-D-0001-spencer-s-grumpy-wake-up.html'
    },
    {
      characterPage: 'books/HH-F-0001-austin-turtle-s-independence-day-quilt-square-characters.html',
      detailPath: 'books/HH-F-0001-austin-turtle-s-independence-day-quilt-square.html'
    }
  ];

  for (const { characterPage, detailPath } of cases) {
    const html = readBuildHtml(characterPage);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://hawkinshollowbooks\\.com/${characterPage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.ok(html.includes(`href="${path.posix.basename(detailPath)}"`));
    assert.ok(fs.existsSync(path.join(buildRoot, detailPath)));
  }
});

test('detail pages do not link to Book-character pages that were not generated', () => {
  const cases = [
    ['HH-B-0002', 'the-vowel-mystery'],
    ['HH-B-0003', 'austin-turtle-and-the-sight-word-challenge'],
    ['HH-B-0004', 'the-hollow-rhyme-day'],
    ['HH-B-0005', 'aralynn-fox-s-word-family-discovery'],
    ['HH-C-0006', 'bentley-s-first-week-in-the-nest'],
    ['HH-F-0003', 'baby-bentley-s-friendship-day-painted-pebble'],
    ['HH-G-0001', 'spencer-washes-up-before-snack'],
    ['HH-G-0002', 'lex-and-the-waiting-coat-hook'],
    ['HH-G-0003', 'brandon-s-muddy-boots']
  ];

  for (const [canonicalId, slug] of cases) {
    const detailPath = `books/${canonicalId}-${slug}.html`;
    const characterPath = `books/${canonicalId}-${slug}-characters.html`;
    const html = readBuildHtml(detailPath);
    assert.doesNotMatch(html, new RegExp(`href="[^\"]*${canonicalId}-[^\"]*-characters\\.html"`));
    assert.equal(fs.existsSync(path.join(buildRoot, characterPath)), false);
  }
});