const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getEntityMetaDescription,
  getFreebieMetaDescription,
  getVerifiedSocialImageUrl,
  isEditorialDescriptionSentence,
  normalizeMetaDescription
} = require('../scripts/search-presentation-metadata');

const repoRoot = path.join(__dirname, '..');
const domain = 'https://hawkinshollowbooks.com';

test('metadata preserves good prose and excludes unmistakable editorial sentences', () => {
  const good = 'Spencer discovers that saying hello can be the first brave step toward a lasting friendship.';
  assert.equal(normalizeMetaDescription(good), good);
  const quoted = 'Say "Hello, friend." and share a quiet moment together.';
  assert.equal(normalizeMetaDescription(quoted), quoted);
  assert.equal(normalizeMetaDescription('A puddle walk becomes a parade. The dominant anchor is the return cue.'), 'A puddle walk becomes a parade.');
  assert.equal(normalizeMetaDescription('Final QC: generator-ready production prompt.', 'Read this song aloud.'), 'Read this song aloud.');
  assert.equal(normalizeMetaDescription('Children are working together to find a friend.'), 'Children are working together to find a friend.');
  const long = 'One welcoming sentence about a story. '.repeat(10);
  assert.ok(normalizeMetaDescription(long).length <= 160);
});

test('freebie metadata uses public manuscript text and keeps Songs and Nursery Rhymes distinct', () => {
  const record = {
    title: 'Puddle Parade',
    description: 'Dominant anchor: the repeating cue. Final QC: do not publish this prompt.',
    text: [{ lines: ['My turn, your turn, round we go.', 'Step beside a puddle, slow.'] }]
  };
  const song = getFreebieMetaDescription(record, { contentType: 'song' });
  const rhyme = getFreebieMetaDescription(record, { contentType: 'rhyme' });
  assert.match(song, /^Song: Puddle Parade\./);
  assert.match(rhyme, /^Nursery rhyme: Puddle Parade\./);
  assert.doesNotMatch(song, /dominant anchor|QC|prompt|actual engine/i);
  assert.doesNotMatch(rhyme, /dominant anchor|QC|prompt|actual engine/i);
  assert.ok(song.length <= 160);
  assert.ok(rhyme.length <= 160);
});

test('entity descriptions use curated character copy and indexed Book labels only', () => {
  const publicCopy = 'A thoughtful friend who often discovers answers by listening.';
  assert.equal(getEntityMetaDescription({ type: 'character', name: 'Alice Mole', description: publicCopy }), `Meet Alice Mole in Hawkins Hollow. ${publicCopy}`);
  assert.match(getEntityMetaDescription({ type: 'book', name: 'The Sharing Acorn', series: 'Storybooks' }), /The Sharing Acorn is a book in Storybooks/);
  assert.doesNotMatch(getEntityMetaDescription({ type: 'book', name: 'The Sharing Acorn', series: 'Storybooks' }), /Entity profile|canonical|production/i);
});

test('social images require existing curated local artwork or the exact verified title-art URL', () => {
  const verified = {
    image: 'https://library.hawkinshollowbooks.com/Freebies/Title%20Art/HH-S-0001.webp',
    imageIsExternal: true,
    imageVerified: true,
    bannerId: 'freebie-title-art'
  };
  assert.equal(getVerifiedSocialImageUrl(verified, domain, repoRoot), verified.image);
  assert.equal(getVerifiedSocialImageUrl({ ...verified, imageVerified: false }, domain, repoRoot), '');
  assert.equal(getVerifiedSocialImageUrl({ ...verified, image: 'https://pub-example.r2.dev/working.pdf' }, domain, repoRoot), '');
  assert.equal(getVerifiedSocialImageUrl({ ...verified, image: 'https://library.hawkinshollowbooks.com/Review/HH-S-0001.webp' }, domain, repoRoot), '');
  assert.equal(getVerifiedSocialImageUrl({ image: 'assets/missing-image.png' }, domain, repoRoot), '');
  assert.equal(getVerifiedSocialImageUrl({ image: 'images/placeholder-banner.jpg' }, domain, repoRoot), '');
  assert.equal(getVerifiedSocialImageUrl({ image: '../outside.png' }, domain, repoRoot), '');
  const local = getVerifiedSocialImageUrl({ image: 'assets/characters/individuals/Spe-HP-V001.png' }, domain, repoRoot);
  assert.equal(local, `${domain}/assets/characters/individuals/Spe-HP-V001.png`);
});

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function metadataAttributes(html) {
  const result = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map(Array.from(match[0].matchAll(/([\w:-]+)="([^"]*)"/g), (attribute) => [attribute[1], decode(attribute[2])]));
    const name = attributes.get('property') || attributes.get('name');
    if (name) result.set(name, attributes.get('content') || '');
  }
  return result;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function indexedCanonicals(output) {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  return Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => decode(match[1]));
}

test('generated metadata is canonical-aligned, visitor-safe, and leaves Stage 4A artifacts intact', () => {
  const output = path.join(repoRoot, 'build-recovery');
  const beforeUrls = indexedCanonicals(output);
  const beforeSearch = JSON.parse(fs.readFileSync(path.join(repoRoot, 'generated/search-index.json'), 'utf8'));
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/generate-site.js')], { cwd: repoRoot, stdio: 'pipe' });
  const urls = indexedCanonicals(output);
  assert.deepEqual(urls, beforeUrls, 'metadata must not change sitemap canonical routes');
  assert.equal(urls.length, 1499);
  assert.equal(new Set(urls).size, urls.length);

  const seenCanonicals = new Set();
  const seenDescriptions = new Set();
  const schemaCounts = {};
  for (const url of urls) {
    const parsed = new URL(url);
    const relative = parsed.pathname === '/' ? 'index.html' : decodeURIComponent(parsed.pathname).replace(/^\//, '');
    const html = fs.readFileSync(path.join(output, relative), 'utf8');
    const title = decode((/<title>([\s\S]*?)<\/title>/i.exec(html) || [,''])[1]).trim();
    const canonicals = Array.from(html.matchAll(/<link rel="canonical" href="([^"]+)"/g), (match) => decode(match[1]));
    const attributes = metadataAttributes(html);
    const description = attributes.get('description');
    assert.ok(title, `${relative}: empty title`);
    assert.deepEqual(canonicals, [url], `${relative}: canonical changed or duplicated`);
    assert.equal(seenCanonicals.has(url), false);
    seenCanonicals.add(url);
    assert.ok(description && description.length <= 160, `${relative}: invalid description length`);
    assert.equal(isEditorialDescriptionSentence(description), false, `${relative}: editorial metadata`);
    assert.equal(seenDescriptions.has(description), false, `${relative}: duplicate description`);
    seenDescriptions.add(description);
    assert.equal(attributes.get('og:title'), title);
    assert.equal(attributes.get('og:description'), description);
    assert.equal(attributes.get('og:url'), url);
    assert.equal(attributes.get('og:type'), 'website');
    assert.equal(attributes.get('og:site_name'), 'Hawkins Hollow');
    assert.equal(attributes.get('twitter:title'), title);
    assert.equal(attributes.get('twitter:description'), description);
    assert.equal(attributes.get('twitter:url'), url);
    assert.equal(attributes.has('twitter:site'), false);
    const image = attributes.get('og:image');
    assert.equal(attributes.get('twitter:card'), image ? 'summary_large_image' : 'summary');
    if (image) {
      assert.equal(attributes.get('twitter:image'), image);
      assert.doesNotMatch(image, /r2\.dev|working|review|placeholder/i);
      const imageUrl = new URL(image);
      if (imageUrl.origin === domain) {
        const asset = decodeURIComponent(imageUrl.pathname).replace(/^\//, '');
        assert.equal(getVerifiedSocialImageUrl({ image: asset }, domain, repoRoot), image);
      } else {
        assert.match(image, /^https:\/\/library\.hawkinshollowbooks\.com\/Freebies\/Title%20Art\/HH-[SR]-\d{4}\.webp$/);
        const freebieIndex = JSON.parse(fs.readFileSync(path.join(repoRoot, 'generated/freebie-index.json'), 'utf8'));
        const publication = JSON.parse(fs.readFileSync(path.join(repoRoot, 'generated/freebie-title-art-publication.json'), 'utf8'));
        const { attachPublishedTitleArt } = require('../scripts/freebie-title-art-media');
        assert.ok(attachPublishedTitleArt(freebieIndex.records, publication).some((record) => record.illustrationPublished && record.illustrationUrl === image));
      }
    } else {
      assert.equal(attributes.has('twitter:image'), false);
    }
    for (const block of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
      const data = JSON.parse(block[1]);
      schemaCounts[data['@type']] = (schemaCounts[data['@type']] || 0) + 1;
      assert.ok(data.name);
      assert.equal(data.url, url);
      if (relative.startsWith('songs/') || relative.startsWith('nursery-rhymes/')) {
        assert.equal(data['@type'], 'CreativeWork');
        assert.equal(data.genre, relative.startsWith('songs/') ? 'song' : 'nursery rhyme');
        assert.equal(data.description, description);
        assert.equal(data.identifier, /HH-[SR]-\d{4}/.exec(relative)[0]);
        for (const unavailable of ['author', 'publisher', 'aggregateRating', 'offers', 'isbn', 'datePublished']) {
          assert.equal(Object.prototype.hasOwnProperty.call(data, unavailable), false);
        }
      }
    }
  }
  assert.deepEqual(schemaCounts, { Book: 78, CreativeWork: 1000 });
  const search = JSON.parse(fs.readFileSync(path.join(repoRoot, 'generated/search-index.json'), 'utf8'));
  assert.deepEqual(search.records, beforeSearch.records, 'metadata must not change Stage 2 search data');
  assert.ok(search.records.some((record) => record.id === 'HH-S-0001' && record.href.startsWith('songs/')));
  assert.ok(search.records.some((record) => record.id === 'HH-R-0001' && record.href.startsWith('nursery-rhymes/')));
  assert.equal(fs.readdirSync(path.join(output, 'songs')).filter((file) => file.endsWith('.html')).length, 500);
  assert.equal(fs.readdirSync(path.join(output, 'nursery-rhymes')).filter((file) => file.endsWith('.html')).length, 500);

  const broken = [];
  let associationCards = 0;
  for (const tree of ['build', 'build-recovery']) {
    for (const file of walk(path.join(repoRoot, tree))) {
      const relative = path.relative(path.join(repoRoot, tree), file).replace(/\\/g, '/');
      assert.doesNotMatch(relative, /^entities\/book\/hh-[sr]-/i);
      assert.doesNotMatch(relative, /(?:Freebies\/Title Art\/|(?:HH-[SR]-\d{4})).*\.webp$/i);
      if (!file.endsWith('.html')) continue;
      const html = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(html, /(?:href|src|content)="https?:\/\/[^" ]*r2\.dev/i);
      const scan = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
      if (tree === 'build-recovery' && /^(characters\/|entities\/(environment|landmark)\/)/.test(relative)) {
        associationCards += (scan.match(/data-freebie-association\b/g) || []).length;
      }
      const base = new URL(relative === 'index.html' ? '/' : `/${relative}`, domain);
      for (const tag of scan.matchAll(/<(?:a|link|script|img|source)\b[^>]*>/gi)) {
        for (const attribute of tag[0].matchAll(/\b(?:href|src)="([^\"]*)"/gi)) {
          const target = new URL(decode(attribute[1]), base);
          if (target.origin !== domain) continue;
          let targetRelative = decodeURIComponent(target.pathname).replace(/^\/+/, '') || 'index.html';
          if (targetRelative.endsWith('/')) targetRelative += 'index.html';
          if (!fs.existsSync(path.join(repoRoot, tree, targetRelative))) broken.push(`${relative} -> ${targetRelative}`);
        }
      }
    }
  }
  assert.deepEqual(broken, []);
  assert.equal(associationCards, 1095, 'Stage 3 association cards must remain intact');
});