const test = require('node:test');
const assert = require('node:assert/strict');
const { createFreebieDiscoveryRecords } = require('../scripts/freebie-discovery');
const {
  createFreebiePageAssociationIndex,
  renderFreebieAssociationSections
} = require('../scripts/freebie-page-associations');

const characters = [
  { slug: 'spencer-field-mouse', name: 'Spencer Field Mouse', code: 'Spe', published: true, identity: { canonicalId: 'HH-CHR-0002', legacyAliases: ['Spe'] } },
  { slug: 'alice-mole', name: 'Alice Mole', code: 'Ali', published: true, identity: { canonicalId: 'HH-CHR-0001', legacyAliases: ['Ali'] } },
  { slug: 'austin-turtle', name: 'Austin Turtle', code: 'Aus', published: true, identity: { canonicalId: 'HH-CHR-0007', legacyAliases: ['Aus'] } },
  { slug: 'callen-crow', name: 'Callen Crow', code: 'Cal', published: true, identity: { canonicalId: 'HH-CHR-0010', legacyAliases: ['Cal'] } }
];

const environmentPages = [
  { id: 'ENV-0010', type: 'environment', name: 'Willow Circle', entityPageHref: 'entities/environment/env-0010-willow-circle.html' },
  { id: 'ENV-0028', type: 'environment', name: 'Garden Row', entityPageHref: 'entities/environment/env-0028-garden-row.html' },
  { id: 'ENV-0031', type: 'environment', name: 'Pinecone Shop', entityPageHref: 'entities/environment/env-0031-pinecone-shop.html' },
  { id: 'ENV-0032', type: 'environment', name: 'Garden', entityPageHref: 'entities/environment/env-0032-garden.html' },
  { id: 'LND-0004', type: 'landmark', name: 'Mailbox Path', entityPageHref: 'entities/landmark/lnd-0004-mailbox-path.html' }
];

const freebieInputs = [
  {
    canonicalId: 'HH-S-0001',
    contentType: 'song',
    title: 'Welcome on the Path',
    description: 'Austin Turtle and Callen Crow are mentioned in the story notes, but only Spencer and Alice are in the Cast.',
    centralHook: 'Make room for a friend.',
    infoFields: [
      { key: 'cast', label: 'Cast', value: 'Spencer Field Mouse and Alice Mole. Austin Turtle and Callen Crow are discussed in a note.' },
      { key: 'route', label: 'Route', value: 'Willow Circle → Garden Row, with Mailbox Path details → Unmapped Orchard' }
    ],
    illustrationPublished: true,
    illustrationUrl: 'https://library.hawkinshollowbooks.com/Freebies/Title%20Art/HH-S-0001.webp'
  },
  {
    canonicalId: 'HH-R-0002',
    contentType: 'rhyme',
    title: 'A Turn at Willow Circle',
    description: 'Pinecone Shop appears only in the description, not in Route.',
    infoFields: [
      { key: 'cast', label: 'Cast', value: 'Austin Turtle. Spencer Field Mouse is mentioned only in the premise.' },
      { key: 'route', label: 'Route', value: 'Willow Circle → Garden Row' }
    ],
    illustrationPublished: false,
    illustrationUrl: ''
  }
];

function createNormalizedRecords(inputs = freebieInputs) {
  return createFreebieDiscoveryRecords(
    inputs,
    characters,
    { byType: { environments: environmentPages.filter((page) => page.type === 'environment'), landmarks: environmentPages.filter((page) => page.type === 'landmark') } },
    (record) => `${record.contentType === 'song' ? 'songs' : 'nursery-rhymes'}/${record.canonicalId.toLowerCase()}.html`
  );
}

test('character associations use canonical Cast participants and ignore prose mentions', () => {
  const records = createNormalizedRecords();
  const associations = createFreebiePageAssociationIndex(records, characters, environmentPages);

  assert.deepEqual(associations.byCharacterCanonicalId.get('HH-CHR-0002').map((record) => record.canonicalId), ['HH-S-0001']);
  assert.deepEqual(associations.byCharacterCanonicalId.get('HH-CHR-0001').map((record) => record.canonicalId), ['HH-S-0001']);
  assert.deepEqual(associations.byCharacterCanonicalId.get('HH-CHR-0007').map((record) => record.canonicalId), ['HH-R-0002']);
  assert.equal(associations.byCharacterCanonicalId.has('HH-CHR-0010'), false);
  assert.deepEqual(associations.report.unresolvedParticipants, []);
});

test('literal canonical Route locations associate to multiple established place pages only', () => {
  const records = createNormalizedRecords();
  const associations = createFreebiePageAssociationIndex(records, characters, environmentPages);

  assert.deepEqual(associations.byPlaceKey.get('environment:ENV-0010').map((record) => record.canonicalId), ['HH-R-0002', 'HH-S-0001']);
  assert.deepEqual(associations.byPlaceKey.get('environment:ENV-0028').map((record) => record.canonicalId), ['HH-R-0002', 'HH-S-0001']);
  assert.equal(associations.byPlaceKey.has('environment:ENV-0032'), false);
  assert.equal(associations.byPlaceKey.has('environment:ENV-0031'), false);
  assert.deepEqual(associations.byPlaceKey.get('landmark:LND-0004').map((record) => record.canonicalId), ['HH-S-0001']);
  assert.equal(associations.report.unattachedRouteLocationCount, 1);
  assert.deepEqual(associations.report.unattachedRouteLocations.map((entry) => entry.literalLocation), ['Unmapped Orchard']);
  assert.deepEqual(associations.report.unattachedRouteLocationValues, ['Unmapped Orchard']);
});

test('punctuation variants do not resolve without a canonical alias', () => {
  const [record] = createNormalizedRecords();
  const variant = {
    ...record,
    literalLocations: ['Garden-Row'],
    canonicalLocations: [{ id: 'ENV-0028', name: 'Garden Row', type: 'environment' }]
  };
  const associations = createFreebiePageAssociationIndex([variant], characters, environmentPages);

  assert.equal(associations.byPlaceKey.has('environment:ENV-0028'), false);
  assert.deepEqual(associations.report.unattachedRouteLocations.map((entry) => entry.literalLocation), ['Garden-Row']);
});

test('duplicate canonical participants and Route locations do not duplicate a page association', () => {
  const [record] = createNormalizedRecords();
  const duplicatedRecord = {
    ...record,
    participants: [...record.participants, ...record.participants],
    canonicalLocations: [...record.canonicalLocations, ...record.canonicalLocations],
    literalLocations: [...record.literalLocations, ...record.literalLocations]
  };
  const associations = createFreebiePageAssociationIndex([duplicatedRecord], characters, environmentPages);

  assert.equal(associations.byCharacterCanonicalId.get('HH-CHR-0002').length, 1);
  assert.equal(associations.byPlaceKey.get('environment:ENV-0010').length, 1);
  assert.equal(associations.byPlaceKey.get('environment:ENV-0028').length, 1);
  assert.equal(associations.byPlaceKey.get('landmark:LND-0004').length, 1);
});

test('association cards use external artwork, detail links, type headings, and a no-image fallback', () => {
  const [songRecord, rhymeRecord] = createNormalizedRecords();
  const sections = renderFreebieAssociationSections([songRecord, rhymeRecord], {
    hrefPrefix: '../',
    idPrefix: 'spencer-field-mouse-freebies'
  });

  assert.match(sections, /Kids Songs/);
  assert.match(sections, /Nursery Rhymes/);
  assert.match(sections, /src="https:\/\/library\.hawkinshollowbooks\.com\/Freebies\/Title%20Art\/HH-S-0001\.webp"/);
  assert.match(sections, /href="\.\.\/songs\/hh-s-0001\.html"/);
  assert.match(sections, /href="\.\.\/nursery-rhymes\/hh-r-0002\.html"/);
  assert.match(sections, /class="character-story-thumb-placeholder"/);
  assert.equal(renderFreebieAssociationSections([], { hrefPrefix: '../' }), '');

  const missingArtSection = renderFreebieAssociationSections([rhymeRecord], { hrefPrefix: '../../' });
  assert.doesNotMatch(missingArtSection, /<img\b/);
  assert.match(missingArtSection, /href="\.\.\/\.\.\/nursery-rhymes\/hh-r-0002\.html"/);
});

test('association audit reports unresolved canonical participant identities without guessing', () => {
  const [record] = createNormalizedRecords();
  const associations = createFreebiePageAssociationIndex([{
    ...record,
    participants: [{ canonicalId: 'HH-CHR-9999', name: 'Unmapped Character' }]
  }], characters, environmentPages);

  assert.deepEqual(associations.report.unresolvedParticipants, [{
    freebieCanonicalId: 'HH-S-0001',
    participantCanonicalId: 'HH-CHR-9999',
    participantName: 'Unmapped Character'
  }]);
  assert.equal(associations.byCharacterCanonicalId.size, 0);
});