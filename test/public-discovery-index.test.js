const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parse5 = require('parse5');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');

function generate() {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-site.js')], {
    cwd: root,
    env: { ...process.env, HH_SITEMAP_DEPLOYMENT_DATE: process.env.HH_SITEMAP_DEPLOYMENT_DATE || '2026-10-09' },
    stdio: 'pipe'
  });
}

function elements(node, tag, result = []) {
  if (node.tagName === tag) result.push(node);
  for (const child of node.childNodes || []) elements(child, tag, result);
  return result;
}

function attribute(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

before(generate);

test('Farmhouse Exterior appears in public discovery at its canonical environment route', () => {
  const route = 'entities/environment/env-0032-farmhouse-exterior.html';
  const image = '/assets/environments/Farmhouse Exterior-HEP-V001.png';
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated/public-discovery-index.json'), 'utf8'));
  const record = index.records.find((entry) => entry.type === 'environment' && entry.id === 'ENV-0032');
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const html = fs.readFileSync(path.join(output, route), 'utf8');
  const imagePath = path.join(output, image.replace(/^\/+/, ''));

  assert.ok(record);
  assert.equal(record.title, 'Farmhouse Exterior');
  assert.equal(record.href, route);
  assert.equal(record.image, image);
  assert.match(html, /src="\.\.\/\.\.\/assets\/environments\/Farmhouse Exterior-HEP-V001\.png"/);
  assert.ok(fs.existsSync(path.join(output, route)));
  assert.ok(fs.existsSync(imagePath));
  assert.deepEqual(fs.readFileSync(imagePath), fs.readFileSync(path.join(root, image.replace(/^\/+/, ''))));
  assert.equal((sitemap.match(new RegExp(`/${route}</loc>`, 'g')) || []).length, 1);

  const porchRoute = 'entities/environment/env-0010-farmhouse-porch.html';
  const porchImage = 'assets/environments/Farmhouse Porch-HEP-V001.png';
  const porch = index.records.find((entry) => entry.type === 'environment' && entry.id === 'ENV-0010');
  const porchHtml = fs.readFileSync(path.join(output, porchRoute), 'utf8');
  assert.ok(porch);
  assert.equal(porch.title, 'Farmhouse Porch');
  assert.equal(porch.href, porchRoute);
  assert.match(porchHtml, /src="\.\.\/\.\.\/assets\/environments\/Farmhouse Porch-HEP-V001\.png"/);
  assert.deepEqual(
    fs.readFileSync(path.join(output, porchImage)),
    fs.readFileSync(path.join(root, porchImage))
  );
});

test('Where Shall We Go Today uses static entry paths and an optional public-safe discovery filter', () => {
  const html = fs.readFileSync(path.join(output, 'start-here.html'), 'utf8');
  const home = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const navigation = JSON.parse(fs.readFileSync(path.join(root, 'data', 'navigation.json'), 'utf8')).items;
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated', 'public-discovery-index.json'), 'utf8'));
  const search = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'search-index.json'), 'utf8'));
  const publications = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'amazon-index.json'), 'utf8')).records;
  const liveBookIds = new Set(publications
    .filter((record) => String(record.status || '').trim().toLowerCase() === 'live')
    .map((record) => String(record.id || '').trim().toUpperCase()));
  const htmlRoutes = new Set(Array.from(sitemap.matchAll(/<loc>[^/]+:\/\/[^/]+\/([^<]+)<\/loc>/g), (match) => decodeURIComponent(match[1])));
  const recordsByType = new Map();

  assert.match(html, /Where Shall We Go Today\?/);
  assert.match(home, /href="start-here\.html"/);
  assert.ok(navigation.some((item) => item.href === 'start-here.html'));
  assert.ok(htmlRoutes.has('start-here.html'));
  for (const pathName of ['characters.html', 'map.html', 'books.html', 'kids-songs.html', 'nursery-rhymes.html', 'themes.html', 'resources.html']) {
    assert.ok(html.includes(`href="${pathName}"`), `${pathName} is available without JavaScript`);
  }
  assert.match(html, /id="discovery-filter"/);
  assert.match(html, /Show matching paths/);
  assert.match(html, /paths below are ready to explore without using a filter/);

  for (const record of index.records) {
    assert.ok(record.href && htmlRoutes.has(record.href), `${record.id}: public canonical route exists`);
    for (const related of record.related) assert.ok(htmlRoutes.has(related.href), `${record.id}: related route ${related.href} exists`);
    const records = recordsByType.get(record.type) || [];
    records.push(record);
    recordsByType.set(record.type, records);
  }
  for (const type of ['book', 'character', 'environment', 'landmark', 'song', 'rhyme']) {
    assert.ok(recordsByType.get(type)?.length, `${type}: discovery records available`);
  }
  assert.deepEqual(
    new Set(recordsByType.get('book').map((record) => String(record.id).toUpperCase())),
    new Set(search.records.filter((record) => record.type === 'book').map((record) => String(record.id).toUpperCase())),
    'hub Books use the same publication-filtered public search routes'
  );
  assert.ok(recordsByType.get('book').every((record) => liveBookIds.has(String(record.id).toUpperCase())));
  assert.ok(index.facets.some((facet) => facet.kind === 'interest'), 'explicit interests/themes are available');
  assert.ok(index.facets.some((facet) => facet.kind === 'age'), 'source age-lane labels remain available');
  assert.ok(index.facets.some((facet) => facet.kind === 'activity' || facet.kind === 'feeling'), 'source activity labels or story hooks remain available');

  const welcomeSong = index.records.find((record) => record.id === 'HH-S-0001');
  assert.ok(welcomeSong.related.some((related) => related.href === 'characters/spencer-field-mouse.html'));
  assert.ok(welcomeSong.related.some((related) => related.href.startsWith('entities/environment/')));
  assert.ok(fs.existsSync(path.join(output, 'generated', 'public-discovery-index.json')));
});

test('What Sounds Good Right Now choices come from explicit interests and link to eligible public records', () => {
  const html = fs.readFileSync(path.join(output, 'start-here.html'), 'utf8');
  const document = parse5.parse(html);
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated', 'public-discovery-index.json'), 'utf8'));
  const publications = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'amazon-index.json'), 'utf8')).records;
  const liveBookIds = new Set(publications
    .filter((record) => String(record.status || '').trim().toLowerCase() === 'live')
    .map((record) => String(record.id || '').trim().toUpperCase()));
  const choices = elements(document, 'details')
    .filter((entry) => attribute(entry, 'class').split(/\s+/).includes('discovery-interest-choice'));
  const usedHrefs = new Set();

  assert.match(html, /What Sounds Good Right Now\?/);
  assert.ok(choices.length > 0 && choices.length <= 4, 'only a small set of available interest choices is shown');
  for (const choice of choices) {
    const summary = elements(choice, 'summary')[0];
    assert.ok(summary, 'choice has a keyboard-accessible native summary');
    const label = textContent(summary).replace(/^Explore\s+/i, '').trim();
    assert.ok(label, 'choice label is present');
    const links = elements(choice, 'a');
    assert.ok(links.length > 0, `${label}: static destinations work without JavaScript`);
    for (const link of links) {
      const href = attribute(link, 'href');
      assert.ok(href && !usedHrefs.has(href), `${href}: recommendations are not repeated`);
      usedHrefs.add(href);
      const record = index.records.find((entry) => entry.href === href);
      assert.ok(record, `${href}: result comes from the public discovery index`);
      assert.ok(['book', 'song', 'rhyme'].includes(record.type), `${href}: content type supports interests`);
      assert.ok(record.tags.some((tag) => tag.kind === 'interest' && tag.label.toLowerCase() === label.toLowerCase()),
        `${href}: result carries the displayed canonical interest`);
      assert.ok(sitemapRoutes.has(href), `${href}: result resolves to a sitemap route`);
      assert.ok(fs.existsSync(path.join(output, href)), `${href}: generated destination exists`);
      if (record.type === 'book') assert.ok(liveBookIds.has(String(record.id).toUpperCase()), `${href}: Book is workbook-eligible`);
    }
  }
  assert.doesNotMatch(html, /Something peaceful|Something funny|mood recommendation/i,
    'the experience does not invent mood classifications');
});

test('Song and rhyme pages show eligible participant/place continuations and resolve to public routes', () => {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const publicSurfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'public-surface-index.json'), 'utf8')).records;
  const primaryRoutes = new Set(publicSurfaces
    .filter((record) => record.generated && record.navigation && record.state === 'primary')
    .map((record) => record.route));
  const discoveryIndex = JSON.parse(fs.readFileSync(path.join(output, 'generated', 'public-discovery-index.json'), 'utf8'));
  const discoveryByHref = new Map(discoveryIndex.records.map((record) => [record.href, record]));
  const freebies = discoveryIndex.records.filter((record) => record.type === 'song' || record.type === 'rhyme');
  let pagesWithPaths = 0;

  for (const freebie of freebies) {
    const document = parse5.parse(fs.readFileSync(path.join(output, freebie.href), 'utf8'));
    const section = elements(document, 'section')
      .find((entry) => attribute(entry, 'aria-labelledby') === 'freebie-related-paths');
    const links = section ? elements(section, 'a') : [];
    if (!links.length) {
      assert.equal(section, undefined, `${freebie.id}: do not show an empty continuation section`);
      continue;
    }
    pagesWithPaths += 1;
    const seen = new Set();
    for (const link of links) {
      const href = attribute(link, 'href');
      assert.ok(href && !seen.has(href), `${freebie.id}: continuation links are unique`);
      seen.add(href);
      const destination = decodeURIComponent(new URL(href, `https://hawkinshollowbooks.com/${freebie.href}`).pathname)
        .replace(/^\/+/, '');
      const related = discoveryByHref.get(destination);
      assert.ok(related && ['character', 'environment', 'landmark'].includes(related.type),
        `${freebie.id}: ${destination} is an established participant or place`);
      assert.ok(sitemapRoutes.has(destination), `${freebie.id}: ${destination} is in the sitemap`);
      assert.ok(primaryRoutes.has(destination), `${freebie.id}: ${destination} is a primary public route`);
      assert.ok(fs.existsSync(path.join(output, destination)), `${freebie.id}: ${destination} exists`);
      assert.doesNotMatch(destination, /env-0032|farmhouse-exterior/i, 'no unverified farmhouse association is introduced');
    }
    const hubLinks = elements(document, 'a')
      .filter((anchor) => attribute(anchor, 'href') === '../start-here.html'
        && textContent(anchor).trim() === 'Choose another path');
    assert.equal(hubLinks.length, 1, `${freebie.id}: a clear return to the exploration hub`);
  }
  assert.ok(pagesWithPaths > 0, 'verified Song/Rhyme participant and place paths are visible');
});

test('place and relationship paths never expose internal Book identity shells', () => {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'public-surface-index.json'), 'utf8')).records;
  const primaryRoutes = new Set(surfaces
    .filter((record) => record.generated && record.navigation && record.state === 'primary')
    .map((record) => record.route));
  for (const route of sitemapRoutes) {
    if (!route.endsWith('.html')) continue;
    const document = parse5.parse(fs.readFileSync(path.join(output, route), 'utf8'));
    for (const anchor of elements(document, 'a')) {
      const href = attribute(anchor, 'href');
      if (!href) continue;
      const destination = decodeURIComponent(new URL(href, `https://hawkinshollowbooks.com/${route}`).pathname)
        .replace(/^\/+/, '');
      assert.doesNotMatch(destination, /^entities\/book\//, `${route}: avoid internal Book identity shells`);
      if (!/^entities\/(environment|landmark|relationship)\//.test(route) || !destination.startsWith('books/')) continue;
      assert.ok(sitemapRoutes.has(destination), `${route}: ${destination} is in the sitemap`);
      assert.ok(primaryRoutes.has(destination), `${route}: ${destination} is a primary Book destination`);
      assert.ok(fs.existsSync(path.join(output, destination)), `${route}: ${destination} exists`);
    }
    if (!/^entities\/(environment|landmark|relationship)\//.test(route)) continue;
    assert.ok(elements(document, 'a').some((anchor) => attribute(anchor, 'href') === '../../start-here.html'),
      `${route}: includes an onward path to the exploration hub`);
  }
});

test('shared green CTA text meets WCAG AA normal-text contrast', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const green = css.match(/--accent-2:\s*(#[0-9a-f]{6})/i)?.[1];
  const buttonRule = css.match(/\.button\s*\{([^}]+)\}/)?.[1] || '';
  const backgroundUsesGreen = /background:\s*var\(--accent-2\)/.test(buttonRule);
  const buttonColor = buttonRule.match(/color:\s*(#[0-9a-f]{6}|white|black)\s*;/i)?.[1];
  const toRgb = (value) => {
    const hex = value.toLowerCase() === 'white' ? '#ffffff'
      : value.toLowerCase() === 'black' ? '#000000'
        : value;
    return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  };
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

  assert.ok(green && buttonColor && backgroundUsesGreen, 'the shared button uses the configured green and an explicit text color');
  const [backgroundLuminance, textLuminance] = [luminance(toRgb(green)), luminance(toRgb(buttonColor))];
  const contrast = (Math.max(backgroundLuminance, textLuminance) + 0.05)
    / (Math.min(backgroundLuminance, textLuminance) + 0.05);
  assert.ok(contrast >= 4.5, `button text contrast is ${contrast.toFixed(2)}:1`);
});

test('relationship continuations use primary Character profiles and do not repeat connected destinations', () => {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const surfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'public-surface-index.json'), 'utf8')).records;
  const primaryRoutes = new Set(surfaces
    .filter((record) => record.generated && record.navigation && record.state === 'primary')
    .map((record) => record.route));
  const relationshipRoutes = Array.from(sitemapRoutes)
    .filter((route) => route.startsWith('entities/relationship/') && route.endsWith('.html'));

  for (const route of relationshipRoutes) {
    const document = parse5.parse(fs.readFileSync(path.join(output, route), 'utf8'));
    const main = elements(document, 'main')[0];
    const relationshipSections = ['relationship-neighbors', 'relationship-places', 'relationship-next-step']
      .map((id) => elements(main, 'section').find((section) => attribute(section, 'aria-labelledby') === id))
      .filter(Boolean);
    const destinations = [];

    for (const section of relationshipSections) {
      for (const link of elements(section, 'a')) {
        const href = attribute(link, 'href');
        const destination = decodeURIComponent(new URL(href, `https://hawkinshollowbooks.com/${route}`).pathname)
          .replace(/^\/+/, '');
        if (/^(?:characters\/|entities\/(?:character|environment|landmark)\/)/.test(destination)) {
          destinations.push(destination);
        }
        if (destination.startsWith('characters/')) {
          assert.ok(sitemapRoutes.has(destination), `${route}: ${destination} is sitemap-listed`);
          assert.ok(primaryRoutes.has(destination), `${route}: ${destination} is a primary public Character route`);
          assert.ok(fs.existsSync(path.join(output, destination)), `${route}: ${destination} exists`);
        }
        assert.doesNotMatch(destination, /^entities\/character\//,
          `${route}: prefer the primary Character profile`);
      }
    }

    assert.equal(new Set(destinations).size, destinations.length,
      `${route}: relationship continuation destinations are not repeated`);
  }
  assert.ok(relationshipRoutes.length, 'public relationship pages are covered');
});


test('illustrated hub, full bookshelf, and character journeys expose the completed visitor paths', () => {
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated/public-discovery-index.json'), 'utf8'));
  const hub = parse5.parse(fs.readFileSync(path.join(output, 'start-here.html'), 'utf8'));
  const shelf = parse5.parse(fs.readFileSync(path.join(output, 'books.html'), 'utf8'));
  const doors = elements(hub, 'article').filter(node => attribute(node,'class').split(' ').includes('discovery-card'));
  assert.equal(doors.length,6);
  assert.ok(doors.every(node => elements(node,'img').length === 1), 'each static doorway has an illustration');
  assert.equal(elements(shelf,'div').filter(node => node.attrs?.some(attr => attr.name === 'data-shelf-series')).length,79);
  const books=index.records.filter(record => record.type === 'book');
  assert.ok(books.every(record => record.image && record.summary && record.readingGuidance), 'every book has a cover, description or attributed collection introduction, and source reading guidance');
  assert.equal(new Set(books.map(record => record.series)).size,9);
  assert.ok(index.records.filter(record => record.type === 'character').every(record => record.related.length));
  assert.ok(index.facets.filter(facet => facet.kind === 'interest').every(facet => !/website freebie|clearly inferred|present in manuscript/i.test(facet.label)));
  for (const character of index.records.filter(record => record.type === 'character')) {
    const html=fs.readFileSync(path.join(output, character.href),'utf8');
    assert.ok(!html.includes('id="character-together"'), 'the repeated book section is absent');
    assert.ok(html.includes('start-here.html'), 'character journey returns to discovery');
  }
});


test('relationship visits show their own portrait, individual neighbor thumbnails, and honest book links', () => {
  const entities=JSON.parse(fs.readFileSync(path.join(root,'generated/entity-index.json'),'utf8'));
  for (const relationship of entities.byType.relationships) {
    const html=fs.readFileSync(path.join(output,relationship.entityPageHref),'utf8');
    const document=parse5.parse(html);
    const hero=elements(document,'img').find(node=>attribute(node,'data-banner-id')==='relationship-portrait');
    assert.ok(hero, relationship.id+': relationship portrait is displayed');
    assert.ok(attribute(hero,'src').endsWith(relationship.id.toLowerCase()+'.webp'));
    const imagePath=path.resolve(output,path.dirname(relationship.entityPageHref),attribute(hero,'src'));
    assert.ok(fs.existsSync(imagePath));
    assert.doesNotMatch(html,/>Read (?:a story|another story|the Story)</i);
    const neighbors=elements(document,'section').find(node=>attribute(node,'aria-labelledby')==='relationship-neighbors');
    const cards=elements(neighbors,'article');
    assert.ok(cards.length>0);
    for (const card of cards) {
      const image=elements(card,'img')[0]; assert.ok(image,relationship.id+': neighbor thumbnail is present');
      assert.ok(attribute(image,'src').includes('assets/character-thumbnails/'));
      assert.ok(fs.existsSync(path.resolve(output,path.dirname(relationship.entityPageHref),attribute(image,'src'))));
    }
  }
});


test('every discovery category retains unlabeled eligible assets and offers every recorded choice', () => {
 const {classifyDiscovery,discoveryFacetValues}=require('../scripts/visitor-discovery');
 const index=JSON.parse(fs.readFileSync(path.join(output,'generated/public-discovery-index.json'),'utf8'));
 const html=fs.readFileSync(path.join(output,'start-here.html'),'utf8');
 assert.ok(html.includes('discovery-unclassified-results'));
 for (const kind of ['interest','feeling','activity','age']) {
   const values=discoveryFacetValues(index.facets,kind); assert.ok(values.length>0);
   if(kind!=='age') assert.equal(values.length,new Set(index.facets.filter(tag=>tag.kind===kind).map(tag=>tag.label)).size);
   const unlabeled=index.records.filter(record=>!record.tags.some(tag=>tag.kind===kind));
   for(const value of values) for(const record of unlabeled) assert.equal(classifyDiscovery(record,{facets:{[kind]:value}}),'unclassified',record.id+': missing '+kind+' stays reachable');
 }
 const sixYearOlds=index.records.filter(record=>record.type==='book'&&classifyDiscovery(record,{facets:{age:'Age 6'}})==='match');
 assert.equal(new Set(sixYearOlds.map(record=>record.series)).size,9,'age six reaches matching books from all nine collections');
});

test('manuscript review fills missing book categories without exposing internal evidence', () => {
 const index=JSON.parse(fs.readFileSync(path.join(output,'generated/public-discovery-index.json'),'utf8'));
 const books=index.records.filter(record=>record.type==='book');
 const has=(record,kind,label)=>record.tags.some(tag=>tag.kind===kind&&(!label||tag.label===label));
 assert.equal(books.filter(record=>has(record,'feeling')).length,55);
 assert.equal(books.filter(record=>has(record,'activity')).length,64);
 assert.equal(books.filter(record=>has(record,'interest')).length,79);
 assert.equal(books.filter(record=>has(record,'age')).length,79);
 assert.ok(has(books.find(record=>record.id==='HH-D-0001'),'feeling','Grumpy'));
 assert.ok(has(books.find(record=>record.id==='HH-B-0002'),'activity','Practicing vowel sounds'));
 assert.ok(!has(books.find(record=>record.id==='HH-E-0004'),'feeling','Happy'));
 assert.doesNotMatch(JSON.stringify(index),/"(?:sourceDocument|sourceSha256|pdfPage|evidence|paragraph)"\s*:/);
 const report=JSON.parse(fs.readFileSync(path.join(root,'generated/validation/discovery-book-review.json'),'utf8'));
 assert.equal(report.reviewedBooks,79);
 assert.deepEqual(report.withheld,[]);
});
