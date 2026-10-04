const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const parse5 = require('parse5');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const discoveryFile = path.join(root, 'generated', 'story-master-character-book-index.json');
const expectedStorySlugs = [
  'aleea-caracara', 'alice-mole', 'aralynn-fox', 'asher-chipmunk', 'aydin-caracara',
  'austin-turtle', 'baxter-badger', 'bentley-crow', 'brandon-rabbit', 'callen-crow',
  'emmitt-armadillo', 'grandma-siebert', 'haylee-prairie-dog', 'kaydence-chipmunk',
  'lex-hedgehog', 'lillian-squirrel', 'spencer-field-mouse', 'zylar-squirrel'
];

function elements(node, tag, result = []) {
  if (node.tagName === tag) result.push(node);
  for (const child of node.childNodes || []) elements(child, tag, result);
  return result;
}

function attribute(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}

function digest(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function snapshot() {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const routes = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  ));
  const routeSet = new Set(routes);
  const pages = new Map();
  for (const route of routes) {
    const html = fs.readFileSync(path.join(output, route), 'utf8');
    const document = parse5.parse(html);
    const links = elements(document, 'a')
      .filter((anchor) => attribute(anchor, 'href') && !/\bnofollow\b/i.test(attribute(anchor, 'rel')))
      .flatMap((anchor) => {
        const url = new URL(attribute(anchor, 'href'), `https://hawkinshollowbooks.com/${route === 'index.html' ? '' : route}`);
        if (url.origin !== 'https://hawkinshollowbooks.com') return [];
        let target = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if (!routeSet.has(target) && routeSet.has(`${target}.html`)) target += '.html';
        return routeSet.has(target) ? [target] : [];
      });
    const listing = elements(document, 'section').find((section) => (
      attribute(section, 'aria-labelledby') === 'continuation-list'
    ));
    pages.set(route, {
      hash: digest(html),
      links,
      cards: listing ? elements(listing, 'article').length : 0
    });
  }
  const depths = new Map([['index.html', 0]]);
  const queue = ['index.html'];
  for (let i = 0; i < queue.length; i += 1) {
    for (const target of pages.get(queue[i]).links) {
      if (!depths.has(target)) {
        depths.set(target, depths.get(queue[i]) + 1);
        queue.push(target);
      }
    }
  }
  const inbound = new Set();
  for (const [route, page] of pages) {
    for (const target of page.links) if (route !== target) inbound.add(target);
  }
  return {
    sitemap,
    pages: Object.fromEntries(pages),
    depths: Object.fromEntries(depths),
    unreachable: routes.filter((route) => !depths.has(route)).sort(),
    zeroInbound: routes.filter((route) => !inbound.has(route)).sort(),
    discovery: JSON.parse(fs.readFileSync(discoveryFile, 'utf8')),
    registry: JSON.parse(fs.readFileSync(path.join(root, 'generated', 'entity-id-registry.json'), 'utf8'))
  };
}

function generate() {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-site.js')], {
    cwd: root,
    stdio: 'pipe'
  });
}

test('clean first build and warmed second build share current structured Character-story discovery', (t) => {
  const before = snapshot();
  const originalDiscovery = fs.readFileSync(discoveryFile);
  const protectedFiles = ['data/books.json', 'data/characters.json', 'scripts/publish-library.js'];
  const originalSources = protectedFiles.map((file) => fs.readFileSync(path.join(root, file)));
  let cleanCompleted = false;
  fs.rmSync(discoveryFile);
  try {
    assert.equal(fs.existsSync(discoveryFile), false, 'clean first build must have no previous reverse index');
    generate();
    cleanCompleted = true;
  } finally {
    if (!cleanCompleted) fs.writeFileSync(discoveryFile, originalDiscovery);
  }
  const clean = snapshot();
  assert.deepEqual(clean.discovery, JSON.parse(originalDiscovery), 'current projection preserves established structured eligibility');
  assert.deepEqual(clean.registry, before.registry, 'canonical IDs must not change');
  assert.equal(clean.sitemap, before.sitemap, 'routes/canonicals and sitemap membership must not change');
  assert.deepEqual(clean.unreachable, before.unreachable, 'original disconnected population is out of scope');
  assert.equal(clean.unreachable.length, 107);
  assert.equal(clean.zeroInbound.length, 98);

  const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters;
  const usefulStories = Object.entries(clean.pages).filter(([route, page]) => (
    /^characters\/.*-stories\.html$/.test(route) && page.cards > 0
  ));
  assert.equal(usefulStories.length, 18);
  assert.deepEqual(usefulStories.map(([route]) => route), expectedStorySlugs.map((slug) => `characters/${slug}-stories.html`).sort());
  let storyCards = 0;
  for (const slug of expectedStorySlugs) {
    const profileRoute = `characters/${slug}.html`;
    const storyRoute = `characters/${slug}-stories.html`;
    const character = characters.find((entry) => entry.slug === slug);
    const record = clean.discovery.records.find((entry) => entry.canonicalCharacterId === character.identity.canonicalId);
    const expectedBooks = record.books.map((book) => book.bookHref).sort();
    const actualBooks = clean.pages[storyRoute].links.filter((route) => route.startsWith('books/')).sort();
    assert.deepEqual(actualBooks, expectedBooks, `${slug}: only established structured Book associations`);
    assert.equal(clean.pages[storyRoute].cards, expectedBooks.length, slug);
    assert.ok(clean.pages[profileRoute].links.includes(storyRoute), `${slug}: profile must expose stories`);
    assert.ok(clean.depths[storyRoute] > 0, `${slug}: stories must be homepage-reachable`);
    storyCards += expectedBooks.length;
    for (const route of expectedBooks) assert.ok(clean.depths[route] > 0, `${slug}: Book destination must be reachable`);
  }
  assert.equal(storyCards, 295);
  const reachableBooks = Object.keys(clean.depths).filter((route) => /^books\//.test(route) && !route.endsWith('-characters.html'));
  const reachableCast = Object.keys(clean.depths).filter((route) => /^books\/.*-characters\.html$/.test(route));
  assert.equal(reachableBooks.length, 78);
  assert.equal(reachableCast.length, 69);

  generate();
  const warmed = snapshot();
  assert.deepEqual(warmed, clean, 'HTML cards/links, graph, IDs, sitemap and discovery output must be first-build deterministic');
  for (const [route, page] of Object.entries(before.pages)) {
    assert.equal(clean.pages[route].hash, page.hash, `${route}: preserve correct warmed-local output`);
  }
  protectedFiles.forEach((file, index) => (
    assert.deepEqual(fs.readFileSync(path.join(root, file)), originalSources[index], file)
  ));
  t.diagnostic('Clean/warmed identical: 18 populated story trails, 295 cards, 78 reachable Books, 69 reachable cast pages; original 107/98 retained.');
});
