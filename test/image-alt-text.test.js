const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parse5 = require('parse5');
const { getImageAlt, imageAlt, reviewed } = require('../scripts/image-alt-text');
const { auditDocument, auditSite, elements, attr, text } = require('../scripts/audit-image-alt');
const output = path.join(__dirname, '../build-recovery');
const page = name => parse5.parse(fs.readFileSync(path.join(output, name), 'utf8'));
const json = name => JSON.parse(fs.readFileSync(path.join(output, 'generated', name), 'utf8'));
const scripts = name => elements(page(name), 'script').map(text);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('reviewed alternatives retain identities, escape titles, and preserve explicit decoration', () => {
  assert.equal(imageAlt('cover', 'A "book" & <friends>'), 'Cover image for A &quot;book&quot; &amp; &lt;friends&gt;');
  assert.equal(getImageAlt('decorative'), '');
  assert.throws(() => getImageAlt('cover', '   '), /requires/);
  assert.throws(() => getImageAlt('unknown', 'Title'), /Unknown/);
  for (const entry of new Set(reviewed.values())) {
    assert.ok(entry.alt.trim().length > 15, entry.image);
    assert.ok(entry.review, 'descriptions have a review record');
    assert.equal(getImageAlt('portrait', 'unused', '../' + encodeURI(entry.image)), entry.alt);
    if (entry.visualCanon) assert.ok(fs.existsSync(path.join(__dirname, '..', entry.visualCanon)), entry.visualCanon);
  }
  const alternatives = [...new Set(reviewed.values())].map(entry => entry.alt);
  assert.ok(alternatives.some(alt => /Bentley Baby Crow cradled/.test(alt)));
  assert.ok(alternatives.some(alt => /Asher.*wheelchair/.test(alt)));
  const confirmed = reviewed.get('assets/relationship-portraits/rel-0004.webp');
  assert.equal(confirmed.alt, 'Baxter Badger beside Brandon Rabbit near a wooden gate.');
  assert.match(confirmed.ownerConfirmation, /Brandon Rabbit/);
  assert.equal(confirmed.ownerReview, undefined);
});

test('audit rejects missing, blank, generic, misleading and unnamed linked alternatives', () => {
  for (const html of ['<img src="x.png">', '<img src="x.png" alt=" ">', '<img src="x.png" alt="image">',
    '<img src="x.png" alt="x.png">', '<img src="x.png" alt="">', '<a href="books.html"><img src="x.png" alt=""></a>']) {
    assert.ok(auditDocument(html).issues.length, html);
  }
  const first = reviewed.values().next().value;
  assert.ok(auditDocument(`<img src="${first.image}" alt="Wrong subject">`).issues.length);
  assert.deepEqual(auditDocument('<a class="map-place-card" href="place.html"><img src="x.png" alt=""><h3>Barn Lane</h3></a>').issues, []);
  assert.ok(auditDocument('<a class="map-place-card" href="place.html"><img src="x.png" alt="Barn Lane"><h3>Barn Lane</h3></a>').issues.length);
});

test('every generated image has an appropriate alternative and linked images have named destinations', () => {
  const report = auditSite(output);
  assert.ok(report.pages > 2000, 'audit the complete production-shaped local build');
  assert.ok(report.images > 2000);
  assert.equal(report.missing, 0);
  assert.equal(report.issues.length, 0, `Image alternative violations (first five): ${JSON.stringify(report.issues.slice(0, 5))}`);
  assert.ok(report.decorative > 0);
});

// A small DOM adapter executes the emitted browser code, including asynchronous fetches and event handlers.
// No renderer implementation is copied into these tests.
class Element {
  constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.events = {}; this.value = ''; this.textContent = ''; this.parentElement = {}; }
  appendChild(child) { this.children.push(child); return child; }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  querySelector() { return this.summary ||= new Element('summary'); }
  emit(name) { for (const callback of this.events[name] || []) callback({ preventDefault() {} }); }
}
function descendants(node, tag) { return [...(node.tagName === tag ? [node] : []), ...node.children.flatMap(child => descendants(child, tag))]; }

test('actual discovery renderer preserves decorative images and named links for every illustrated asset', async t => {
  const index = json('public-discovery-index.json');
  const ids = new Map();
  const document = { getElementById: id => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id); }, createElement: tag => new Element(tag) };
  const script = scripts('start-here.html').find(source => source.includes('function discoveryBrowser('));
  assert.ok(script, 'execute the generated discovery script');
  vm.runInNewContext(script, { document, setTimeout, fetch: async () => ({ ok: true, json: async () => index }) });
  await settle(); await settle();
  assert.ok(ids.get('discovery-more').events.click, ids.get('discovery-status').textContent);
  while (!ids.get('discovery-more').hidden) ids.get('discovery-more').emit('click');
  const cards = ids.get('discovery-results').children;
  assert.equal(cards.length, index.records.length);
  const illustrated = index.records.filter(record => record.image);
  let checked = 0;
  for (const record of illustrated) {
    const card = cards.find(candidate => descendants(candidate, 'a').some(link => link.href === record.href));
    assert.ok(card, record.href);
    const image = descendants(card, 'img')[0];
    assert.ok(Object.hasOwn(image, 'alt'), 'dynamic image has an explicit alt property');
    assert.equal(image.alt, '');
    assert.equal(image.src, record.image.replace(/^\//, ''));
    assert.ok(descendants(card, 'h3').some(heading => descendants(heading, 'a').some(link => link.textContent === record.title && link.href === record.href)));
    checked++;
  }
  assert.equal(checked, illustrated.length);
  // Also execute the separate More to explore path for an asset missing a selected facet.
  const record = illustrated.find(item => !(item.tags || []).some(tag => tag.kind === 'feeling'));
  assert.ok(record);
  ids.get('discovery-filter').value = record.title;
  ids.get('discovery-feeling').value = 'Test feeling';
  ids.get('discovery-controls').emit('input');
  const unknown = ids.get('discovery-unclassified-results').children;
  assert.ok(unknown.some(card => descendants(card, 'a').some(link => link.href === record.href)));
  for (const image of unknown.flatMap(card => descendants(card, 'img'))) assert.equal(image.alt, '');
  t.diagnostic(`${checked} illustrated discovery records exercised, plus the unclassified-results path`);
});

async function exerciseSearch(filename, index, records) {
  const input = new Element('input'), results = new Element();
  const document = { getElementById: id => ({ 'library-search-input': input, 'library-search-results': results })[id] };
  const script = scripts(filename).find(source => source.includes("getElementById('library-search-input')"));
  assert.ok(script, filename);
  vm.runInNewContext(script, { document, fetch: async url => ({ json: async () => url.includes('search-index') ? index : { nodes: [], edges: [] } }) });
  await settle(); await settle();
  assert.ok(input.events.input, results.innerHTML);
  for (const record of records) {
    input.value = record.id; input.emit('input');
    const fragment = parse5.parseFragment(results.innerHTML);
    const image = elements(fragment, 'img').find(node => attr(node, 'src') === record.imageUrl);
    assert.ok(image, `${filename}: ${record.id}`);
    assert.equal(attr(image, 'alt'), 'Title illustration for ' + record.title);
    assert.ok(elements(fragment, 'a').some(link => attr(link, 'href') === record.href && text(link) === record.title));
  }
}
test('both emitted search renderers supply title alternatives for every illustrated result and escape quotes', async t => {
  const index = json('search-index.json');
  const records = index.records.filter(record => record.imageUrl);
  assert.ok(records.length > 0);
  for (const filename of ['index.html', 'books.html']) {
    await exerciseSearch(filename, index, records);
    const quoted = { ...records[0], title: 'A "quoted" title & friends <together>' };
    await exerciseSearch(filename, { ...index, records: [quoted] }, [quoted]);
  }
  t.diagnostic(`${records.length * 2} illustrated search results exercised across homepage and books, plus escaping fixtures`);
});
