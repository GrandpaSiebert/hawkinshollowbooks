const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFreebieDiscoveryRecords,
  createFreebieDiscoveryVocabulary,
  createFreebieSearchIndexRecord,
  extractCanonicalParticipants,
  extractLiteralRouteLocations,
  filterFreebieRecords
} = require('../scripts/freebie-discovery');

const characters = [
  { name: 'Alice Mole', code: 'Ali', identity: { canonicalId: 'HH-CHR-0001', legacyAliases: ['Ali'] } },
  { name: 'Spencer Field Mouse', code: 'Spe', identity: { canonicalId: 'HH-CHR-0002', legacyAliases: ['Spe'] } },
  { name: 'Bentley Crow', code: 'Ben', identity: { canonicalId: 'HH-CHR-0008', legacyAliases: ['Ben'] } },
  { name: 'Lillian Squirrel', code: 'Lil', identity: { canonicalId: 'HH-CHR-0011', legacyAliases: ['Lil'] } },
  { name: 'Zylar Squirrel', code: 'Zyl', identity: { canonicalId: 'HH-CHR-0027', legacyAliases: ['Zyl'] } }
];

const places = {
  byType: {
    environments: [
      { id: 'ENV-001', name: 'Willow Circle', type: 'environment', entityPageHref: 'places/willow-circle.html' },
      { id: 'ENV-002', name: 'Garden Row', type: 'environment', entityPageHref: 'places/garden-row.html' },
      { id: 'ENV-003', name: 'Pinecone Shop', type: 'environment', entityPageHref: 'places/pinecone-shop.html' }
    ],
    landmarks: [
      { id: 'LND-001', name: 'Mailbox Path', type: 'landmark', entityPageHref: 'places/mailbox-path.html' }
    ]
  }
};

const song = {
  canonicalId: 'HH-S-0025',
  contentType: 'song',
  title: 'Weather-Ribbon Welcome',
  description: 'A gentle weather song about making room for a friend; Lillian and Zylar also wait at Pinecone Shop.',
  centralHook: 'Make a little room.',
  infoFields: [
    { key: 'cast', label: 'Cast', value: 'Barefoot Alice Mole and newborn Baby Bentley. Lillian and Zylar were considered, but not added.' },
    { key: 'route', label: 'Route', value: 'Willow Circle → Garden Row, with Mailbox Path details' },
    { key: 'theme', label: 'Theme', value: 'Weather & Seasons' },
    { key: 'age lane', label: 'Age lane', value: 'S3 — Early Elementary, approximately ages 5–8' },
    { key: 'emotional hook', label: 'Emotional hook', value: 'A friend belongs from the first hello' },
    { key: 'negative prompt', label: 'Negative Prompt', value: 'Zylar excluded; internal render instruction' }
  ],
  illustrationPublished: false,
  illustrationUrl: ''
};

const rhyme = {
  canonicalId: 'HH-R-0025',
  contentType: 'rhyme',
  title: 'Bouncy Puddle Parade',
  description: 'A playful puddle rhyme about taking turns.',
  infoFields: [
    { key: 'cast', label: 'Cast', value: 'Spencer and Alice Mole. Zylar is available but off-scene.' },
    { key: 'route', label: 'Route', value: 'Willow Circle → Mailbox Path' },
    { key: 'theme', label: 'Theme', value: 'Weather & Seasons' },
    { key: 'age lane', label: 'Age lane', value: 'R2 — Toddler Rhyme, approximately ages 2–3' }
  ],
  illustrationPublished: false,
  illustrationUrl: ''
};

function createRecords() {
  return createFreebieDiscoveryRecords(
    [song, rhyme],
    characters,
    places,
    (record) => `${record.contentType === 'song' ? 'songs' : 'nursery-rhymes'}/${record.canonicalId.toLowerCase()}.html`
  );
}

function createVocabulary(records) {
  return createFreebieDiscoveryVocabulary(records, characters, places);
}

test('participant normalization uses only the opening cast list and canonical identities', () => {
  const discovery = createRecords();
  const songRecord = discovery.find((record) => record.canonicalId === song.canonicalId);
  assert.deepEqual(songRecord.participants.map((participant) => participant.canonicalId), [
    'HH-CHR-0001',
    'HH-CHR-0008'
  ]);
  assert.deepEqual(songRecord.participants.map((participant) => participant.name), ['Alice Mole', 'Bentley Crow']);
  assert.equal(songRecord.participants.some((participant) => participant.name === 'Lillian Squirrel'), false);
  assert.equal(songRecord.participants.some((participant) => participant.name === 'Zylar Squirrel'), false);
});

test('literal Route metadata yields literal and canonical location records only', () => {
  const route = 'Willow Circle → Garden Row, with Mailbox Path details';
  assert.deepEqual(extractLiteralRouteLocations(route), ['Willow Circle', 'Garden Row', 'Mailbox Path']);
  const discovery = createRecords();
  const songRecord = discovery.find((record) => record.canonicalId === song.canonicalId);
  assert.deepEqual(songRecord.canonicalLocations.map((location) => location.id), ['ENV-001', 'ENV-002', 'LND-001']);
});

test('collection filtering supports titles, canonical IDs, shortened IDs, names, routes, topics, case, punctuation, and clear', () => {
  const records = createRecords();
  const songs = records.filter((record) => record.contentType === 'song');
  const rhymes = records.filter((record) => record.contentType === 'rhyme');
  const vocabulary = createVocabulary(records);

  assert.deepEqual(filterFreebieRecords(songs, 'weather-ribbon welcome', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(rhymes, 'bouncy puddle parade', 'rhyme', vocabulary).map((record) => record.canonicalId), ['HH-R-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'HH-S-0025', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'HH-S-25', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, '25', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'alice mole', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'Lillian', 'song', vocabulary), []);
  assert.deepEqual(filterFreebieRecords(songs, 'Zylar', 'song', vocabulary), []);
  assert.deepEqual(filterFreebieRecords(songs, 'mailbox-path', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'Pinecone Shop', 'song', vocabulary), []);
  assert.deepEqual(filterFreebieRecords(songs, 'WEATHER & SEASONS', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'ages 5 8', 'song', vocabulary).map((record) => record.canonicalId), ['HH-S-0025']);
  assert.deepEqual(filterFreebieRecords(songs, 'HH-R-25', 'song', vocabulary), []);
  assert.deepEqual(filterFreebieRecords(records, 'no matching neighbor', '', vocabulary), []);
  assert.equal(filterFreebieRecords(records, '', '', vocabulary).length, 2);
});

test('global-search projection is visitor-safe and independent of media availability', () => {
  const records = createRecords();
  const songRecord = records.find((record) => record.contentType === 'song');
  const searchRecord = createFreebieSearchIndexRecord(songRecord);
  assert.equal(searchRecord.type, 'song');
  assert.equal(searchRecord.href, 'songs/hh-s-0025.html');
  assert.equal(searchRecord.imageUrl, '');
  assert.equal(searchRecord.youtubeUrl, '');
  assert.equal(searchRecord.searchText.includes('negative prompt'), false);
  assert.equal(searchRecord.searchText.includes('internal render instruction'), false);
  assert.equal(searchRecord.participants.some((participant) => participant.name === 'Lillian Squirrel'), false);
  assert.equal(searchRecord.participants.some((participant) => participant.name === 'Zylar Squirrel'), false);
  assert.deepEqual(searchRecord.participants.map((participant) => participant.canonicalId), ['HH-CHR-0001', 'HH-CHR-0008']);
  assert.deepEqual(searchRecord.canonicalLocations.map((location) => location.id), ['ENV-001', 'ENV-002', 'LND-001']);
  assert.equal(Object.hasOwn(searchRecord, 'text'), false);
  assert.equal(Object.hasOwn(searchRecord, 'cues'), false);
  assert.equal(Object.hasOwn(searchRecord, 'sourceDocument'), false);
});