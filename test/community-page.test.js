const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parse5 = require('parse5');
const { elements, attr, text, auditDocument } = require('../scripts/audit-image-alt');
const { renderCommunityContent, renderCommunityTheme, communityStopBrowser } = require('../scripts/community-page');
const { validateManifest, validateDestinations } = require('../scripts/page-themes');
const root = path.join(__dirname, '..');
const body = () => parse5.parseFragment(renderCommunityContent());
const clone = x => JSON.parse(JSON.stringify(x));
// Synthetic test association only: no fixture is saved to catalogs or used in candidate output.
function fixture() {
  const manifest = clone(require('../data/page-themes.json'));
  const publication = clone(require('../data/page-theme-publication.json'));
  const primary = manifest.recordings.find(t => t.primary && publication.records.some(r => r.id === t.id));
  primary.page = 'community.html'; primary.title = 'Come See the Hollow';
  return { manifest: { ...manifest, recordings: [primary] }, publication: { records: publication.records.filter(r => r.id === primary.id) } };
}

test('Community presents one visible primary heading and all eight connected-world sections', () => {
  const d = body();
  assert.equal(elements(d, 'h1').length, 1);
  assert.deepEqual(elements(d, 'section').map(s => attr(s, 'aria-labelledby')), ['community-doorway','community-neighbors','community-stories','community-places','community-free','community-paths','community-caring','community-next']);
  const content = text(d);
  for (const term of ['grandparents','caregivers','educators','communication styles','Difficult feelings','Keep the Porch Light On']) assert.ok(content.includes(term));
  assert.doesNotMatch(content, /Read this story|Read a story|Subscribe|Sign up/i);
});

test('landing-page themes accept only the published Community catalog association', () => {
  const input = fixture().manifest;
  Object.assign(input.recordings[0], { category:'page', canonicalId:'community' });
  const entities = require('../generated/entity-index.json');
  const discovery = require('../generated/public-discovery-index.json');
  assert.equal(require('../data/pages.json').pages.find(p => p.slug === 'community').published, true);
  assert.equal(validateManifest(input), true);
  assert.equal(validateDestinations(input, entities, discovery), true);
  for (const wrong of [
    {page:'index.html'}, {page:'about.html'}, {page:'theme-songs.html'},
    {page:'community.html?audio=1'}, {page:'../community.html'},
    {canonicalId:'index'}, {category:'book'},
    {page:'books/community.html'}
  ]) {
    const invalid = clone(input);
    Object.assign(invalid.recordings[0], wrong);
    assert.throws(() => validateManifest(invalid), /Invalid canonical theme destination/);
    assert.throws(() => validateDestinations(invalid, entities, discovery), /canonical routing/);
  }
  const existing = require('../data/page-themes.json');
  assert.equal(validateManifest(existing), true);
  assert.equal(validateDestinations(existing, entities, discovery), true);
});

test('all nine story series use their published descriptions and actual landing routes', () => {
  const d = body(), series = require('../data/series.json').series;
  const links = elements(d, 'a').map(a => attr(a, 'href'));
  for (const s of series) {
    assert.ok(links.includes(s.slug === 'storybooks' ? 'storybook-shelf.html' : s.slug + '.html'));
    assert.ok(text(d).includes(s.presentationAuthority.shortDescription));
  }
  assert.match(text(d), /do not provide the complete books to read online/);
});

test('neighbor introductions preserve canonical descriptions and existing approved artwork', () => {
  const d = body(), characters = require('../data/characters.json').characters;
  for (const slug of ['spencer-field-mouse','aleea-caracara','austin-turtle']) {
    const c = characters.find(c => c.slug === slug);
    assert.ok(text(d).includes(c.description));
    assert.ok(elements(d, 'a').some(a => attr(a, 'href') === 'characters/' + slug + '.html'));
  }
  assert.equal(elements(d,'img').length,10);
  assert.deepEqual(auditDocument(renderCommunityContent()).issues, []);
});

test('free access is explicit without promising full books or unavailable recordings/resources', () => {
  const content = text(body());
  assert.match(content, /will remain free, without a subscription, registration, or payment/);
  assert.match(content, /text is available even when there is no recording/);
  assert.match(content, /some resource details are still being prepared/);
  assert.match(content, /free songs and nursery rhymes are separate from published books/i);
});

test('free-resource illustrations retain their approved alternatives without duplicated prefixes', () => {
  const illustrations = require('../data/homepage-illustrations.json').illustrations;
  const images = elements(body(), 'img');
  for (const key of ['resource-songs', 'resource-rhymes']) {
    const approved = illustrations.find(i => i.key === key);
    const image = images.find(i => attr(i, 'src') === approved.image);
    assert.equal(attr(image, 'alt'), approved.alt);
    assert.doesNotMatch(attr(image, 'alt'), /Title illustration for Title illustration for/);
  }
});

test('every Community link and fragment resolves to an actual generated destination', () => {
  const d = body(), route = path.join(root,'build-recovery','community.html');
  for (const a of elements(d,'a')) {
    const url = new URL(attr(a,'href'),'https://candidate.local/community.html');
    const file = url.pathname === '/community.html' ? route : path.join(root,'build-recovery',decodeURIComponent(url.pathname).slice(1));
    assert.ok(fs.existsSync(file), url.href);
    if (url.hash) {
      const target = url.pathname === '/community.html' ? d : parse5.parse(fs.readFileSync(file,'utf8'));
      const stack = [target]; let found = false;
      while(stack.length) { const n = stack.pop(); if(attr(n,'id') === url.hash.slice(1)) found = true; stack.push(...(n.childNodes || [])); }
      assert.ok(found, url.href);
    }
  }
});

test('Community emits no player without a verified approved page-specific Primary', () => {
  const delivered = parse5.parseFragment(renderCommunityTheme());
  assert.equal(elements(delivered, 'audio').length, 1);
  assert.equal(attr(elements(delivered, 'audio')[0], 'autoplay'), undefined);
  assert.equal(elements(delivered, 'source').length, 1);
  assert.equal(attr(elements(delivered, 'source')[0], 'src'), require('../data/page-themes.json').recordings.find(t => t.page === 'community.html').publicUrl);
  const f = fixture();
  assert.equal(renderCommunityTheme({...f,publication:{records:[]}}),'');
  assert.equal(renderCommunityTheme({...f,publication:{records:[]},previewBase:'http://127.0.0.1:8094/audio'}),'');
  f.publication.records[0].sha256 = '0'.repeat(64);
  assert.equal(renderCommunityTheme(f),'');
});

test('a provisional alternate and another relationship theme cannot become the Community Primary', () => {
  const f = fixture();
  f.manifest.recordings[0].classification = 'unresolved'; f.manifest.recordings[0].primary = false;
  assert.equal(renderCommunityTheme(f),'');
  const other = fixture(); other.manifest.recordings[0].title = 'We Keep the Light On';
  assert.equal(renderCommunityTheme(other),'');
});

test('future verified Community Primary uses existing native controls plus an explicit Stop', () => {
  const f = fixture(), alternate = clone(f.manifest.recordings[0]);
  alternate.id += '-provisional'; alternate.primary = false; alternate.classification = 'confirmed-alternate';
  f.manifest.recordings.push(alternate);
  const d = parse5.parseFragment(renderCommunityTheme(f)), audio = elements(d,'audio');
  assert.equal(audio.length,1); assert.equal(attr(audio[0],'controls'),'');
  assert.equal(attr(audio[0],'preload'),'none'); assert.equal(attr(audio[0],'autoplay'),undefined);
  assert.ok(elements(d,'button').some(b => text(b) === 'Stop Come See the Hollow'));
  assert.ok(elements(d,'button').some(b => attr(b,'aria-label') === 'Play or pause Come See the Hollow (Primary theme)'));
  assert.equal(elements(d,'source')[0].attrs.find(a=>a.name==='src').value,f.manifest.recordings[0].publicUrl);
});

test('Community Stop pauses and resets only its own loaded audio', () => {
  let handler;
  const audio = { readyState:4,currentTime:12,pause(){this.paused=true;} };
  const section = { querySelector(selector){return selector === 'audio' ? audio : {addEventListener(event,fn){assert.equal(event,'click');handler=fn;}};} };
  vm.runInNewContext('(' + communityStopBrowser.toString() + ')()', {document:{currentScript:{parentElement:section}}});
  handler(); assert.equal(audio.paused,true); assert.equal(audio.currentTime,0);
  audio.readyState = 0; audio.currentTime = 3; handler(); assert.equal(audio.currentTime,3);
});
