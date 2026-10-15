const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const {
  CONTINUATION_COLLECTIONS,
  getPublicSurfaceEligibility,
  isPublicEntityEligible
} = require('../scripts/public-surface-eligibility');
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
function visibleText(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.tagName && ['script', 'style', 'noscript'].includes(node.tagName)) return '';
  if ((node.attrs || []).some((entry) => entry.name === 'hidden')) return '';
  return (node.childNodes || []).map(visibleText).join(' ');
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

test('approved public surfaces are classified precisely without losing primary search destinations', () => {
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated/public-surface-index.json'), 'utf8')).records;
  const entities = JSON.parse(fs.readFileSync(path.join(root, 'generated/entity-index.json'), 'utf8'));
  const search = JSON.parse(fs.readFileSync(path.join(root, 'generated/search-index.json'), 'utf8'));
  const sitemap = html('sitemap.xml');
  const empty = surfaces.filter((entry) => entry.route.startsWith('characters/') && !entry.generated);
  assert.deepEqual(empty.map((entry) => entry.route).sort(), expectedEmptyRoutes);
  const shells = surfaces.filter((entry) => entry.route.startsWith('entities/book/') && entry.state === 'secondary');
  assert.equal(shells.length, entities.byType.books.length);
  const pop = surfaces.find((entry) => entry.route === 'entities/character/pop-pop-pop-farmer-hawkins.html');
  const reading = surfaces.find((entry) => entry.route === 'entities/resource/reading-order-reading-order.html');
  const alias = surfaces.find((entry) => entry.route === 'storybook-series.html');
  assert.match(pop.reason, /Preserved secondary authoring\/canon surface pending editorial decision/);
  const approved = [...shells, ...empty, pop, reading, alias];
  assert.equal(approved.length, shells.length + empty.length + 3);
  for (const entry of approved) {
    assert.equal(entry.sitemap, false, entry.route);
    assert.equal(entry.search, false, entry.route);
    assert.equal(entry.navigation, false, entry.route);
    assert.ok(!sitemap.includes(`/${entry.route}</loc>`), entry.route);
    assert.ok(!search.records.some((record) => record.href === entry.route), entry.route);
    const file = path.join(root, 'build-recovery', entry.route);
    assert.equal(fs.existsSync(file), entry.generated, entry.route);
    if (entry.generated) assert.match(fs.readFileSync(file, 'utf8'), /<meta name="robots" content="noindex, follow"/, entry.route);
  }
  const libraryBookIds = new Set(JSON.parse(fs.readFileSync(path.join(root, 'generated/library-index.json'), 'utf8')).books
    .map((book) => String(book.id || '').toUpperCase()));
  for (const book of entities.byType.books) {
    assert.ok(libraryBookIds.has(String(book.id || '').toUpperCase()), `internal Book identity ${book.id} must remain`);
  }
  assert.ok(entities.byType.characters.some((entity) => entity.id === 'Pop'));
  assert.ok(entities.byType.resources.some((entity) => entity.id === 'reading-order'));
  const liveBookIds = new Set(JSON.parse(fs.readFileSync(path.join(root, 'generated/amazon-index.json'), 'utf8')).records
    .filter((record) => String(record.status || '').trim().toLowerCase() === 'live')
    .map((record) => String(record.id || '').trim().toUpperCase()));
  assert.equal(search.summary.byType.books, liveBookIds.size);
  assert.equal(search.summary.byType.characters, 27);
  for (const entity of entities.byType.characters) {
    const route = `characters/${entity.slug}.html`;
    const surface = surfaces.find((entry) => entry.route === route);
    if (!surface || !surface.search) continue;
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

test('Farmhouse Exterior is publicly discoverable and remains distinct from Farmhouse Porch', () => {
  const route = 'entities/environment/env-0032-farmhouse-exterior.html';
  const porchRoute = 'entities/environment/env-0010-farmhouse-porch.html';
  const entityIndex = JSON.parse(fs.readFileSync(path.join(root, 'generated/entity-index.json'), 'utf8'));
  const graph = JSON.parse(fs.readFileSync(path.join(root, 'generated/entity-graph.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'data/entity-id-registry.json'), 'utf8'));
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated/public-surface-index.json'), 'utf8')).records;
  const search = JSON.parse(fs.readFileSync(path.join(root, 'generated/search-index.json'), 'utf8'));
  const discovery = JSON.parse(fs.readFileSync(path.join(output, 'generated/public-discovery-index.json'), 'utf8'));
  const entity = entityIndex.byType.environments.find((record) => record.sourceDocument === 'Environments/Farmhouse Exterior Visual Canon.docx');
  const porch = entityIndex.byType.environments.find((record) => record.sourceDocument === 'Environments/Farmhouse Porch Visual Canon.docx');
  const farmhouseEntry = registry.entries['environment:Environments/Farmhouse Exterior Visual Canon.docx'];
  const internalWorldCanon = JSON.parse(fs.readFileSync(path.join(root, 'generated/world-canon-index.json'), 'utf8'));
  const internalGraphNode = graph.nodes.find((node) => node.id === 'environment:ENV-0032');
  const publicEntityIndex = JSON.parse(fs.readFileSync(path.join(output, 'generated/entity-index.json'), 'utf8'));
  const publicRecord = discovery.records.find((record) => record.id === 'ENV-0032');
  const farmhouseSurface = surfaces.find((record) => record.route === route);
  const pondRoute = 'entities/environment/env-0023-pond-edge.html';
  const pondSurface = surfaces.find((record) => record.route === pondRoute);
  const pondDiscovery = discovery.records.find((record) => record.id === 'ENV-0023');
  const pondReferences = (JSON.parse(fs.readFileSync(path.join(root, 'data/books.json'), 'utf8')).books || [])
    .filter((book) => (book.environments || []).includes('ENV-0023'))
    .map((book) => book.identity.canonicalId)
    .sort();
  const sitemap = html('sitemap.xml');

  assert.deepEqual(farmhouseEntry, { id: 'ENV-0032' });
  assert.equal(isPublicEntityEligible({ type: 'environment', id: 'ENV-0032' }), true);
  assert.equal(isPublicEntityEligible({ type: 'environment', id: 'ENV-0010' }), true);
  assert.equal(entity.id, 'ENV-0032');
  assert.equal(entity.slug, 'farmhouse-exterior');
  assert.equal(entity.href, route);
  assert.equal(porch.id, 'ENV-0010');
  assert.equal(porch.slug, 'farmhouse-porch');
  assert.equal(porch.href, porchRoute);
  assert.notEqual(entity.id, porch.id);
  assert.notEqual(entity.href, porch.href);
  assert.deepEqual(entity.mentions.landmarks, []);
  assert.equal(internalGraphNode.entityId, 'ENV-0032');
  assert.ok(internalWorldCanon.byType.environments.some((record) => record.id === 'ENV-0032'));
  assert.deepEqual(getPublicSurfaceEligibility({ entity }), {
    generated: true,
    indexable: true,
    sitemap: true,
    search: true,
    navigation: true,
    robots: '',
    state: 'primary',
    reason: 'Existing public visitor destination.',
    redirectTo: ''
  });
  assert.ok(farmhouseSurface && farmhouseSurface.generated && farmhouseSurface.sitemap && farmhouseSurface.navigation);
  assert.ok(search.records.some((record) => record.id === 'ENV-0032' && record.href === route));
  assert.ok(publicRecord && publicRecord.type === 'environment' && publicRecord.href === route);
  assert.equal((sitemap.match(new RegExp(`/${route}</loc>`, 'g')) || []).length, 1);
  assert.ok(html('map.html').includes(route));
  assert.ok(html(route).includes('Farmhouse Exterior'));
  assert.ok(fs.existsSync(path.join(output, route)));
  assert.ok(fs.existsSync(path.join(root, 'build-recovery', route)));
  assert.ok(pondSurface && pondSurface.sitemap && pondSurface.navigation);
  assert.ok(pondDiscovery && pondDiscovery.href === pondRoute);
  assert.equal((sitemap.match(new RegExp(`/${pondRoute}</loc>`, 'g')) || []).length, 1);
  assert.deepEqual(pondReferences, ['HH-A-0013', 'HH-B-0001']);
  assert.ok(html('map.html').includes('entities/environment/env-0030-willow-circle.html'));
  assert.ok(surfaces.some((record) => record.route === 'entities/environment/env-0030-willow-circle.html' && record.navigation));

  const publicFarmhouse = publicEntityIndex.byType.environments.find((record) => record.id === 'ENV-0032');
  const publicPorch = publicEntityIndex.byType.environments.find((record) => record.id === 'ENV-0010');
  assert.ok(publicFarmhouse);
  assert.ok(publicPorch);
  assert.equal(publicFarmhouse.sourceDocument, undefined);
  assert.equal(publicPorch.sourceDocument, undefined);
  assert.deepEqual(Object.keys(publicEntityIndex.byType).sort(), ['environments', 'landmarks']);
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
