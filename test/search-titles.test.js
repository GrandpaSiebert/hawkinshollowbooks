const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  LONG_TITLE_EXCEPTIONS,
  getFreebieSearchTitle,
  readSearchTitlePage,
  resolveSearchTitles,
  titleLength
} = require('../scripts/search-titles');
const overrides = require('../scripts/search-title-overrides');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const siteName = 'Hawkins Hollow';

function sitemapRecords() {
  const xml = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => {
    const canonical = match[1];
    const route = decodeURIComponent(new URL(canonical).pathname).replace(/^\/+/, '') || 'index.html';
    const html = fs.readFileSync(path.join(output, route), 'utf8');
    return { ...readSearchTitlePage(html, route), html, expectedCanonical: canonical };
  });
}

test('freebie document titles preserve identity without word cutting or ellipses', () => {
  const fixtures = [
    ['HH-R-0001', 'Bouncy Puddle Parade', 'Bouncy Puddle Parade | Hawkins Hollow'],
    ['HH-S-0001', 'Singable Hollow Welcome', 'Singable Hollow Welcome | Hawkins Hollow'],
    ['HH-R-0106', 'When the Folding Rhyme Window Changed the Barn Loft Pulley', 'When the Folding Rhyme Window Changed the Barn Loft Pulley'],
    ['HH-R-0225', 'The Cobb Orchard Press Missing-Rhyme Participation Verse And The Magnetic Echo Cup 225', 'The Cobb Orchard Press Missing-Rhyme Verse And The Magnetic Echo Cup'],
    ['HH-R-0136', 'Blueberry Trellis Shadow Question Fingerplay with the Braided Gesture Deck', 'Blueberry Trellis Shadow Questions with the Braided Gesture Deck'],
    ['HH-R-0205', 'Magnetic Pause Ribbon - Riverside Sandbar A Reverse-Counting Fingerplay 205', 'Magnetic Pause Ribbon - Riverside Sandbar A Reverse Counting'],
    ...Object.entries(overrides).map(([id, value]) => [id, value.canonicalTitle, value.title])
  ];
  for (const [canonicalId, title, expected] of fixtures) {
    const record = Object.freeze({ canonicalId, title });
    assert.equal(getFreebieSearchTitle(record, siteName), expected, canonicalId);
    assert.equal(record.title, title);
    assert.ok(titleLength(expected) <= 70, canonicalId);
    assert.doesNotMatch(expected, /(?:\.{3}|\u2026)/);
  }
  assert.equal(getFreebieSearchTitle({ canonicalId: 'HH-R-0123', title: 'A Story About 12' }, siteName), 'A Story About 12 | Hawkins Hollow');
  assert.equal(getFreebieSearchTitle({
    canonicalId: 'HH-R-0301',
    title: 'A Meaningful and Already Distinctive Story About the Number 12'
  }, siteName), 'A Meaningful and Already Distinctive Story About the Number 12');
  assert.throws(() => getFreebieSearchTitle({ canonicalId: 'HH-R-225', title: 'A rhyme' }, siteName), /identity/);
  assert.throws(() => getFreebieSearchTitle({ canonicalId: 'HH-R-0128', title: 'Changed source title' }, siteName), /stale/);
  assert.throws(() => getFreebieSearchTitle({ canonicalId: 'HH-R-0001' }, siteName), /identity/);
});

test('global collision resolution adds only necessary family semantics', () => {
  const records = [
    { route: 'books/HH-C+-0001-first.html', title: 'First | Hawkins Hollow' },
    { route: 'entities/book/hh-c-0001-first.html', title: 'First | Hawkins Hollow' },
    { route: 'books/HH-C+-0001-first-characters.html', title: 'First Characters' },
    { route: 'characters/alice.html', title: 'Alice | Hawkins Hollow' },
    { route: 'entities/character/hh-chr-0001-alice.html', title: 'Alice | Hawkins Hollow' },
    { route: 'entities/environment/env-0004-barn-path.html', title: 'Barn Path | Hawkins Hollow' },
    { route: 'entities/landmark/lnd-0001-barn-path.html', title: 'Barn Path | Hawkins Hollow' },
    { route: 'songs/HH-S-0498-barn-loft-pulley.html', title: 'Barn Loft Pulley | Hawkins Hollow' },
    { route: 'nursery-rhymes/HH-R-0483-barn-loft-pulley.html', title: 'Barn Loft Pulley | Hawkins Hollow' },
    { route: 'storybook-shelf.html', title: 'Storybooks | Hawkins Hollow' },
    { route: 'storybook-series.html', title: 'Storybooks | Hawkins Hollow' },
    { route: 'index.html', title: 'Home | Hawkins Hollow' }
  ];
  const before = JSON.stringify(records);
  const resolved = resolveSearchTitles(records, siteName);
  assert.equal(new Set(resolved.map((record) => record.title)).size, records.length);
  assert.equal(resolved[0].route, 'books/HH-C+-0001-first.html');
  assert.equal(resolved[0].title, 'First | Book | Hawkins Hollow');
  assert.equal(resolved[1].title, 'First | Connections | Hawkins Hollow');
  assert.equal(resolved[2].title, 'First Characters');
  assert.equal(resolved.at(-1).title, 'Home | Hawkins Hollow');
  assert.equal(JSON.stringify(records), before);
  assert.throws(() => resolveSearchTitles([{ route: 'a.html', title: 'x'.repeat(71) }], siteName), /semantic review/);
  assert.throws(() => resolveSearchTitles([{ route: 'a.html', title: 'Broken...' }], siteName), /Invalid document title/);
  assert.doesNotThrow(() => resolveSearchTitles([{ route: 'a.html', title: 'A story | HH-C+-0001' }], siteName));
  assert.throws(() => resolveSearchTitles([{ route: 'a.html', title: 'A story | HH-C+-001' }], siteName), /Malformed/);
  assert.throws(() => resolveSearchTitles([
    { route: 'songs/HH-S-0001-a.html', title: 'Same' },
    { route: 'songs/HH-S-0002-b.html', title: 'Same' }
  ], siteName), /collision/);
});

test('all generated canonicals have meaningful unique search titles without collateral changes', (t) => {
  const before = sitemapRecords();
  const sourceFiles = ['data/books.json', 'data/characters.json', 'scripts/publish-library.js'];
  const sourceContents = sourceFiles.map((file) => fs.readFileSync(path.join(root, file)));
  const beforeSearch = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'search-index.json'), 'utf8')).records;
  const beforeFreebies = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'freebie-index.json'), 'utf8')).records;

  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-site.js')], { cwd: root, stdio: 'pipe' });

  sourceFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(root, file)), sourceContents[index], file));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'generated', 'search-index.json'), 'utf8')).records, beforeSearch);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'generated', 'freebie-index.json'), 'utf8')).records, beforeFreebies);

  const after = sitemapRecords();
  assert.ok(after.length > 0);
  assert.deepEqual(after.map((record) => record.route), before.map((record) => record.route));
  const seen = new Map();
  const buckets = { preferred: 0, review: 0, highReview: 0, exceptions: 0 };
  const beforeByRoute = new Map(before.map((record) => [record.route, record]));
  for (const record of after) {
    const old = beforeByRoute.get(record.route);
    assert.equal(record.canonical, record.expectedCanonical, record.route);
    assert.equal(record.canonical, old.canonical, record.route);
    assert.deepEqual(record.h1, old.h1, record.route);
    assert.equal(record.h1.length, 1, record.route);
    assert.equal(
      record.html.replace(/<title>[\s\S]*?<\/title>/i, '<title></title>'),
      old.html.replace(/<title>[\s\S]*?<\/title>/i, '<title></title>'),
      `${record.route}: only the document title may change, including social metadata`
    );
    assert.ok(record.title.trim() && /[a-z]/i.test(record.title), record.route);
    assert.doesNotMatch(record.title, /(?:\.{3}|\u2026|\uFFFD|<[^>]+>|&(?:amp|lt|gt|quot|#\d+);)/, record.route);
    for (const match of record.title.matchAll(/\bHH-[^\s|]+/g)) {
      assert.match(match[0], /^HH-[A-Z]+\+?-\d{4}$/, record.route);
    }
    assert.equal(seen.has(record.title), false, `${record.route}: duplicate with ${seen.get(record.title)}`);
    seen.set(record.title, record.route);
    const length = titleLength(record.title);
    if (length <= 60) buckets.preferred += 1;
    else if (length <= 65) buckets.review += 1;
    else if (length <= 70) buckets.highReview += 1;
    else {
      assert.ok(LONG_TITLE_EXCEPTIONS[record.route]?.reason, `${record.route}: >70 title needs documented exception`);
      assert.equal(record.title, LONG_TITLE_EXCEPTIONS[record.route].title);
      buckets.exceptions += 1;
    }
  }
  t.diagnostic(`Search-title quality buckets: ${JSON.stringify(buckets)}`);

  const byId = new Map(after.filter((record) => /^(songs|nursery-rhymes)\//.test(record.route))
    .map((record) => [/HH-[SR]-\d{4}/.exec(record.route)[0], record]));
  for (const canonicalId of ['HH-R-0106', 'HH-R-0225', 'HH-R-0136', 'HH-R-0205', 'HH-R-0249', 'HH-R-0001', 'HH-S-0001']) {
    const work = beforeFreebies.find((record) => record.canonicalId === canonicalId);
    const page = byId.get(canonicalId);
    assert.deepEqual(page.h1, [work.title]);
    assert.equal(page.title, getFreebieSearchTitle(work, siteName));
  }
  for (const id of ['HH-F-0005', 'HH-HR-0002', 'HH-F-0004', 'HH-F-0007', 'HH-E-0005', 'HH-F-0001']) {
    const page = after.find((record) => record.route.startsWith(`books/${id}-`) && record.route.endsWith('-characters.html'));
    assert.ok(page && page.title.endsWith(' Characters'));
    assert.ok(titleLength(page.title) <= 60);
  }
  const austin = after.find((record) => record.route.startsWith('books/HH-F-0001-') && record.route.endsWith('-characters.html'));
  assert.equal(austin.title, 'Austin Turtle\u2019s Independence Day Quilt Square Characters');
  assert.deepEqual(austin.h1, ['Aydin and Albert Einstein\u2019s Map Characters']);
});
