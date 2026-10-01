const fs = require('fs');
const path = require('path');
const { normalizeSearchText } = require('./freebie-discovery');

const root = path.join(__dirname, '..');
const outputs = ['build', 'build-recovery'];
const ALLOWED_RECORD_KEYS = new Set([
  'type', 'id', 'title', 'series', 'href', 'asin', 'amazonUrl', 'purchaseLinks',
  'summary', 'imageUrl', 'youtubeUrl', 'participants', 'literalLocations',
  'canonicalLocations', 'theme', 'ageLane', 'keywords', 'searchText'
]);
const CANONICAL_FREEBIE_ID = /^HH-([SR])-(\d{4})$/;

function fail(message) {
  throw new Error(`Freebie discovery validation failed: ${message}`);
}

function safeId(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function detailSlug(record) {
  const titleSlug = String(record.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return titleSlug ? `${safeId(record.id)}-${titleSlug}.html` : `${safeId(record.id)}.html`;
}

function validate() {
  const searchIndexPath = path.join(root, 'generated', 'search-index.json');
  const freebieIndexPath = path.join(root, 'generated', 'freebie-index.json');
  const entityIndexPath = path.join(root, 'generated', 'entity-index.json');
  for (const file of [searchIndexPath, freebieIndexPath, entityIndexPath]) {
    if (!fs.existsSync(file)) fail(`${path.relative(root, file)} is missing`);
  }

  const searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, 'utf8'));
  const freebieIndex = JSON.parse(fs.readFileSync(freebieIndexPath, 'utf8'));
  const entityIndex = JSON.parse(fs.readFileSync(entityIndexPath, 'utf8'));
  const charactersData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8'));
  const freebieRecords = (searchIndex.records || []).filter((record) => record.type === 'song' || record.type === 'rhyme');
  const sourceRecords = freebieIndex.records || [];
  const sourceById = new Map(sourceRecords.map((record) => [record.canonicalId, record]));
  const freebieIds = new Set();
  const characterIds = new Set((charactersData.characters || [])
    .map((record) => String(record.identity && record.identity.canonicalId || '').toUpperCase())
    .filter(Boolean));
  const placeIds = new Set([
    ...((entityIndex.byType && entityIndex.byType.environments) || []),
    ...((entityIndex.byType && entityIndex.byType.landmarks) || [])
  ].map((record) => record.id));
  const indexIds = new Set();

  if (freebieRecords.length !== sourceRecords.length) {
    fail(`search index has ${freebieRecords.length} Songs/Rhymes for ${sourceRecords.length} canonical records`);
  }

  for (const record of freebieRecords) {
    const id = String(record.id || '');
    const match = CANONICAL_FREEBIE_ID.exec(id);
    if (!match) fail(`invalid canonical ID ${id || '(empty)'}`);
    if (freebieIds.has(id)) fail(`duplicate canonical ID ${id}`);
    freebieIds.add(id);
    if ((match[1] === 'S' && record.type !== 'song') || (match[1] === 'R' && record.type !== 'rhyme')) {
      fail(`${id} has a type that disagrees with its canonical ID`);
    }
    if (!record.title || !record.href || !Array.isArray(record.keywords) || !record.searchText) {
      fail(`${id} is missing safe visitor-facing search fields`);
    }
    if (!sourceById.has(id)) fail(`${id} does not correspond to a canonical freebie-index record`);
    for (const key of Object.keys(record)) {
      if (!ALLOWED_RECORD_KEYS.has(key)) fail(`${id} includes unapproved search field ${key}`);
    }
    if (record.searchText !== normalizeSearchText(record.keywords.join(' '))) {
      fail(`${id} has a nondeterministic searchText value`);
    }
    if (/negative prompt|illustration prompt|generation instructions|mureka|suno|qc note|production status|source document/i.test(record.searchText)) {
      fail(`${id} search data contains production-only text`);
    }
    const source = sourceById.get(id);
    const sourceFields = new Map((source.infoFields || []).map((field) => [field.key, field.value]));
    if (record.theme !== String(sourceFields.get('theme') || '')) fail(`${id} theme does not match manuscript metadata`);
    if (record.ageLane !== String(sourceFields.get('age lane') || '')) fail(`${id} age lane does not match manuscript metadata`);

    if (!Array.isArray(record.participants) || !Array.isArray(record.literalLocations) || !Array.isArray(record.canonicalLocations)) {
      fail(`${id} is missing normalized participant/location metadata`);
    }
    for (const participant of record.participants) {
      if (!characterIds.has(participant.canonicalId)) fail(`${id} references nonexistent character ${participant.canonicalId}`);
    }
    for (const location of record.canonicalLocations) {
      if (!placeIds.has(location.id)) fail(`${id} references nonexistent place ${location.id}`);
    }
    if (record.href !== `${record.type === 'song' ? 'songs' : 'nursery-rhymes'}/${detailSlug(record)}`) {
      fail(`${id} has an invalid internal detail href ${record.href}`);
    }
    indexIds.add(id);
  }

  const bookCount = (searchIndex.records || []).filter((record) => record.type === 'book').length;
  const characterCount = (searchIndex.records || []).filter((record) => record.type === 'character').length;
  const mistypedFreebies = (searchIndex.records || []).filter((record) => record.type === 'book' && /^HH-[SR]-\d{4}$/i.test(String(record.id || '')));
  if (mistypedFreebies.length > 0) fail(`canonical freebie IDs appear as Books (${mistypedFreebies.slice(0, 5).map((record) => record.id).join(', ')})`);
  const worldTypes = ['environment', 'landmark', 'relationship'];
  if (bookCount === 0 || characterCount === 0
    || worldTypes.some((type) => !(searchIndex.records || []).some((record) => record.type === type))) {
    fail('existing book/world discovery records disappeared');
  }
  if (searchIndex.summary.byType.songs !== freebieRecords.filter((record) => record.type === 'song').length
    || searchIndex.summary.byType.nurseryRhymes !== freebieRecords.filter((record) => record.type === 'rhyme').length) {
    fail('search summary counts disagree with generated Songs/Rhymes records');
  }

  for (const output of outputs) {
    const outputRoot = path.join(root, output);
    const localAssets = path.join(outputRoot, 'assets', 'freebies');
    if (fs.existsSync(localAssets) && fs.readdirSync(localAssets).length > 0) {
      fail(`${output}/ contains freebie delivery image copies`);
    }
    for (const type of ['song', 'rhyme']) {
      const collectionPage = type === 'song' ? 'kids-songs.html' : 'nursery-rhymes.html';
      const html = fs.readFileSync(path.join(outputRoot, collectionPage), 'utf8');
      const inputId = `freebie-search-${type}`;
      if (!html.includes(`id="${inputId}"`) || !html.includes('freebie-search-clear')
        || !html.includes('freebie-search-empty') || !html.includes("fetch('generated/search-index.json')")) {
        fail(`${output}/${collectionPage} is missing its functional search controls`);
      }
      const cards = Array.from(html.matchAll(/data-freebie-search-card data-canonical-id="([^"]+)"/g), (match) => match[1]);
      const expected = freebieRecords.filter((record) => record.type === type).map((record) => record.id);
      if (cards.length !== expected.length || new Set(cards).size !== cards.length
        || cards.some((id) => !expected.includes(id) || !indexIds.has(id))) {
        fail(`${output}/${collectionPage} cards do not match the generated search index`);
      }
      for (const record of freebieRecords.filter((entry) => entry.type === type)) {
        const detailPath = path.join(outputRoot, ...record.href.split('/'));
        if (!fs.existsSync(detailPath)) fail(`${output}/${record.href} does not exist`);
      }
    }
  }

  const songCount = freebieRecords.filter((record) => record.type === 'song').length;
  const rhymeCount = freebieRecords.filter((record) => record.type === 'rhyme').length;
  console.log(`Freebie discovery validation passed: ${songCount} Songs, ${rhymeCount} Rhymes; ${bookCount} book and ${characterCount} character search records preserved; no Pages delivery WebPs.`);
}

validate();