const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const { CONTINUATION_COLLECTIONS, getPublicSurfaceEligibility } = require('../scripts/public-surface-eligibility');
const { readSearchTitlePage } = require('../scripts/search-titles');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const expectedEmptyRoutes = [
  'aleea-caracara-places', 'alice-mole-places', 'asher-chipmunk-places',
  'aydin-caracara-places', 'baxter-badger-places', 'bentley-crow-places',
  'bentley-crow-relationships', 'blain-turtle-stories', 'garrett-hedgehog-stories',
  'grandpa-people', 'grandpa-stories', 'harlie-mouse-stories',
  'haylee-prairie-dog-places', 'kayla-rabbit-stories', 'lillian-squirrel-places',
  'mimi-hawkins-people', 'mimi-hawkins-stories', 'pop-pop-farmer-hawkins-people',
  'pop-pop-farmer-hawkins-places', 'pop-pop-farmer-hawkins-relationships',
  'pop-pop-farmer-hawkins-stories', 'skylin-crow-places', 'skylin-crow-stories',
  'spencer-field-mouse-places', 'trinity-egret-stories', 'zylar-squirrel-places'
].map((slug) => `characters/${slug}.html`).sort();

function elements(node, tag, result = []) {
  if (node.tagName === tag) result.push(node);
  for (const child of node.childNodes || []) elements(child, tag, result);
  return result;
}
function attr(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}
function html(route) {
  return fs.readFileSync(path.join(output, route), 'utf8');
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

test('public eligibility distinguishes internal entities from primary, secondary, withdrawn and consolidated surfaces', () => {
  const experience = Object.fromEntries(Object.values(CONTINUATION_COLLECTIONS).map((key) => [key, []]));
  for (const [continuationType, key] of Object.entries(CONTINUATION_COLLECTIONS)) {
    const empty = getPublicSurfaceEligibility({ experience, continuationType });
    assert.equal(empty.generated, false);
    for (const flag of ['indexable', 'sitemap', 'search', 'navigation']) assert.equal(empty[flag], false);
    const populated = getPublicSurfaceEligibility({ experience: { ...experience, [key]: [{ href: 'existing.html' }] }, continuationType });
    for (const flag of ['generated', 'indexable', 'sitemap', 'search', 'navigation']) assert.equal(populated[flag], true);
  }
  assert.throws(() => getPublicSurfaceEligibility({ experience, continuationType: 'unknown' }), /Unknown/);
  assert.throws(() => getPublicSurfaceEligibility({ experience: {}, continuationType: 'stories' }), /Missing current-build/);
  for (const entity of [
    { type: 'book', id: 'HH-A-0001' },
    { type: 'character', slug: 'pop-pop-farmer-hawkins', id: 'Pop' },
    { type: 'resource', id: 'reading-order' }
  ]) {
    const before = JSON.stringify(entity);
    const secondary = getPublicSurfaceEligibility({ entity });
    assert.equal(secondary.generated, true);
    assert.equal(secondary.robots, 'noindex, follow');
    for (const flag of ['indexable', 'sitemap', 'search', 'navigation']) assert.equal(secondary[flag], false);
    assert.equal(JSON.stringify(entity), before, 'internal entity must not be mutated');
  }
  assert.equal(getPublicSurfaceEligibility({ entity: { type: 'book' }, freebieEntity: true }).generated, false);
  assert.equal(getPublicSurfaceEligibility({ route: 'storybook-series.html' }).redirectTo, 'storybook-shelf.html');
  assert.equal(getPublicSurfaceEligibility({ route: 'storybook-shelf.html' }).indexable, true);
  assert.equal(getPublicSurfaceEligibility({ entity: { type: 'character', slug: 'alice-mole' } }).indexable, true);
});

test('approved 107 public surfaces are classified precisely without losing primary search destinations', () => {
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated/public-surface-index.json'), 'utf8')).records;
  const entities = JSON.parse(fs.readFileSync(path.join(root, 'generated/entity-index.json'), 'utf8'));
  const search = JSON.parse(fs.readFileSync(path.join(root, 'generated/search-index.json'), 'utf8'));
  const sitemap = html('sitemap.xml');
  const empty = surfaces.filter((entry) => entry.route.startsWith('characters/') && !entry.generated);
  assert.deepEqual(empty.map((entry) => entry.route).sort(), expectedEmptyRoutes);
  const shells = surfaces.filter((entry) => entry.route.startsWith('entities/book/') && entry.state === 'secondary');
  assert.equal(shells.length, 78);
  const pop = surfaces.find((entry) => entry.route === 'entities/character/pop-pop-pop-farmer-hawkins.html');
  const reading = surfaces.find((entry) => entry.route === 'entities/resource/reading-order-reading-order.html');
  const alias = surfaces.find((entry) => entry.route === 'storybook-series.html');
  assert.match(pop.reason, /Preserved secondary authoring\/canon surface pending editorial decision/);
  const approved = [...shells, ...empty, pop, reading, alias];
  assert.equal(approved.length, 107);
  for (const entry of approved) {
    assert.equal(entry.sitemap, false, entry.route);
    assert.equal(entry.search, false, entry.route);
    assert.equal(entry.navigation, false, entry.route);
    assert.ok(!sitemap.includes(`/${entry.route}</loc>`), entry.route);
    assert.ok(!search.records.some((record) => record.href === entry.route), entry.route);
    for (const directory of ['build-recovery', 'build']) {
      const file = path.join(root, directory, entry.route);
      assert.equal(fs.existsSync(file), entry.generated, `${directory}: ${entry.route}`);
      if (entry.generated) assert.match(fs.readFileSync(file, 'utf8'), /<meta name="robots" content="noindex, follow"/, entry.route);
    }
  }
  assert.equal(entities.byType.books.length, 1078, 'internal Book identities must remain');
  assert.ok(entities.byType.characters.some((entity) => entity.id === 'Pop'));
  assert.ok(entities.byType.resources.some((entity) => entity.id === 'reading-order'));
  assert.equal(search.summary.byType.books, 78);
  assert.equal(search.summary.byType.characters, 27);
  for (const entity of entities.byType.characters) {
    assert.ok(search.records.some((record) => record.id === entity.id && record.href === `characters/${entity.slug}.html`), entity.id);
  }
  assert.ok(search.records.some((record) => record.href === 'storybook-shelf.html'));
  assert.ok(search.records.some((record) => record.href === 'resources.html'));
  for (const record of search.records) {
    const entry = surfaces.find((surface) => surface.route === record.href);
    assert.ok(entry && entry.search && entry.generated && entry.indexable, record.href);
  }
  assert.equal(search.summary.totalRecords, search.records.length);
  assert.equal(search.summary.byType.songs, 500);
  assert.equal(search.summary.byType.nurseryRhymes, 500);
});

test('consolidation uses the established immediate-refresh mechanism and no generated anchors target withdrawn continuations or series alias', () => {
  const alias = html('storybook-series.html');
  assert.match(alias, /<meta http-equiv="refresh" content="0; url=storybook-shelf.html"/);
  assert.match(alias, /<link rel="canonical" href="https:\/\/hawkinshollowbooks.com\/storybook-shelf.html"/);
  assert.match(alias, /<a href="storybook-shelf.html">/);
  const shelf = readSearchTitlePage(html('storybook-shelf.html'), 'storybook-shelf.html');
  assert.equal(shelf.canonical, 'https://hawkinshollowbooks.com/storybook-shelf.html');
  assert.equal(shelf.h1.length, 1);
  const disallowed = new Set([...expectedEmptyRoutes, 'storybook-series.html']);
  const missing = [];
  for (const file of walk(output).filter((file) => file.endsWith('.html'))) {
    const route = path.relative(output, file).replace(/\\/g, '/');
    for (const anchor of elements(parse5.parse(fs.readFileSync(file, 'utf8')), 'a')) {
      if (!attr(anchor, 'href')) continue;
      const url = new URL(attr(anchor, 'href'), `https://hawkinshollowbooks.com/${route}`);
      if (url.origin !== 'https://hawkinshollowbooks.com') continue;
      let target = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      assert.equal(disallowed.has(target), false, `${route} links to withdrawn/consolidated ${target}`);
      if (!fs.existsSync(path.join(output, target)) && !fs.existsSync(path.join(output, `${target}.html`))) missing.push({ route, target });
    }
  }
  assert.deepEqual(missing, []);
  assert.doesNotMatch(html('robots.txt'), /Disallow:\s*\/(?:entities|characters|storybook-series)/i);
});
