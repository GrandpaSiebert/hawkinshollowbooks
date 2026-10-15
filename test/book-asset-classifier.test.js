const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyBookFolderAssets,
  classifyPngRole,
  findByteIdenticalPublicCovers,
  findVerifiedForeignBookCoverOwner
} = require('../scripts/book-asset-classifier');

const bedtimeRoot = 'Books/HH-D Bedtime Library/HH-D-0001-0010/HH-D-0001 Spencer’s Grumpy Wake-Up';

test('classifies front, back, introduction and numbered illustrations without alias-based ownership', () => {
  const book = {
    id: 'HH-D-0001',
    title: 'Spencer’s Grumpy Wake-Up',
    series: 'Bedtime Library',
    files: [
      `${bedtimeRoot}/HH-D-0001 Spencer’s Grumpy Wake-Up Cover.png`,
      `${bedtimeRoot}/Grandpa Back Cover.png`,
      `${bedtimeRoot}/Pop-pop.png`,
      `${bedtimeRoot}/HH-D-0001 (1).png`,
      `${bedtimeRoot}/Story Master.docx`
    ]
  };

  const result = classifyBookFolderAssets(book, {
    canonicalId: 'HH-D-0001',
    title: 'Spencer’s Grumpy Wake-Up',
    series: 'Bedtime Library'
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.folder, bedtimeRoot);
  assert.deepEqual(result.frontCoverPaths, [
    `${bedtimeRoot}/HH-D-0001 Spencer’s Grumpy Wake-Up Cover.png`
  ]);
  assert.deepEqual(result.assets.map((asset) => asset.role), [
    'front-cover',
    'back-cover',
    'introduction',
    'interior-illustration'
  ]);
  assert.equal(classifyPngRole('GT001 Some Other Story Cover.png'), 'front-cover');
  assert.equal(classifyPngRole('Grandpa Back Cover.png'), 'back-cover');
});

test('normalizes abbreviated folder IDs while retaining exact canonical folder ownership', () => {
  const folder = 'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-008 Alice Mole’s Grandparents Day Memory Walk';
  const result = classifyBookFolderAssets({
    id: 'HH-F-0008',
    title: 'Alice Mole’s Grandparents Day Memory Walk',
    series: 'Holiday Story Poems',
    files: [`${folder}/HH-F-0008 Alice Mole’s Grandparents Day Memory Walk Cover.png`]
  }, {
    canonicalId: 'HH-F-0008',
    title: 'Alice Mole’s Grandparents Day Memory Walk',
    series: 'Holiday Story Poems'
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.canonicalId, 'HH-F-0008');
  assert.equal(result.folder, folder);
});

test('rejects a conflicting folder identity instead of following a cross-series alias', () => {
  const result = classifyBookFolderAssets({
    id: 'HH-D-0001',
    title: 'Spencer’s Grumpy Wake-Up',
    series: 'Bedtime Library',
    files: [
      'Books/HH-C+ Growing Together/HH-C+-0001-0010/HH-C+-0001 The Healthy Heart Walk/GT001 The Healthy Heart Walk Cover.png'
    ]
  }, {
    canonicalId: 'HH-D-0001',
    title: 'Spencer’s Grumpy Wake-Up',
    series: 'Bedtime Library'
  });

  assert.equal(result.status, 'ownership-conflict');
  assert.match(result.conflicts.join(' '), /HH-C\+-0001 conflicts with HH-D-0001/);
  assert.deepEqual(result.frontCoverPaths, []);
});

test('reports missing and multiple plausible front covers', () => {
  const base = {
    id: 'HH-D-0001',
    title: 'Spencer’s Grumpy Wake-Up',
    series: 'Bedtime Library'
  };
  const missing = classifyBookFolderAssets({
    ...base,
    files: [`${bedtimeRoot}/Grandpa Back Cover.png`, `${bedtimeRoot}/HH-D-0001 (1).png`]
  });
  const ambiguous = classifyBookFolderAssets({
    ...base,
    files: [
      `${bedtimeRoot}/HH-D-0001 Spencer’s Grumpy Wake-Up Cover.png`,
      `${bedtimeRoot}/Alternate Cover.png`
    ]
  });

  assert.equal(missing.status, 'missing-cover');
  assert.equal(ambiguous.status, 'ambiguous-cover');
  assert.equal(ambiguous.frontCoverPaths.length, 2);
});

test('reports a front-cover filename that conflicts with the canonical Book title', () => {
  const folder = 'Books/HH-B First Readers/HH-B-0001-0010/HH-B-0002 The Vowel Mystery';
  const result = classifyBookFolderAssets({
    id: 'HH-B-0002',
    title: 'The Vowel Mystery',
    series: 'First Readers',
    files: [`${folder}/HH-B-0002 Austin Turtle and the Sight Word Challenge Cover.png`]
  }, {
    canonicalId: 'HH-B-0002',
    title: 'The Vowel Mystery',
    series: 'First Readers'
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /differs from the canonical title/);
});

test('maps a public cover only when its bytes match the verified folder front cover', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-cover-integrity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const publicDirectory = path.join(directory, 'public');
  fs.mkdirSync(publicDirectory);
  const source = path.join(directory, 'source.png');
  const matching = path.join(publicDirectory, 'GT007 Lost Feather Cover.png');
  const unrelated = path.join(publicDirectory, 'GT006 Another Story Cover.png');
  fs.writeFileSync(source, Buffer.from('canonical front cover'));
  fs.writeFileSync(matching, Buffer.from('canonical front cover'));
  fs.writeFileSync(unrelated, Buffer.from('unrelated book cover'));

  assert.deepEqual(findByteIdenticalPublicCovers(source, publicDirectory), [matching]);
  fs.writeFileSync(path.join(publicDirectory, 'duplicate.png'), Buffer.from('canonical front cover'));
  assert.equal(findByteIdenticalPublicCovers(source, publicDirectory).length, 2);
});

test('recognizes a misassigned cover only when a unique same-series book mapping proves its ownership', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-foreign-cover-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const sourceDirectory = path.join(directory, 'Library', 'Books', 'HH-B First Readers', 'HH-B-0001-0010', 'HH-B-0002 The Vowel Mystery');
  const publicDirectory = path.join(directory, 'assets', 'covers', 'First Readers');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(publicDirectory, { recursive: true });
  const source = path.join(sourceDirectory, 'HH-B-0002 Austin Turtle and the Sight Word Challenge Cover.png');
  const mappedCover = path.join(publicDirectory, 'FR003 Austin Turtle and the Sight Word Challenge Cover.png');
  fs.writeFileSync(source, Buffer.from('verified HH-B-0003 artwork'));
  fs.writeFileSync(mappedCover, Buffer.from('verified HH-B-0003 artwork'));

  const models = [
    {
      identity: { canonicalId: 'HH-B-0002' },
      title: 'The Vowel Mystery',
      seriesSlug: 'first-readers',
      coverImage: '/assets/covers/First Readers/FR002 The Vowel Mystery Cover.png'
    },
    {
      identity: { canonicalId: 'HH-B-0003' },
      title: 'Austin Turtle and the Sight Word Challenge',
      seriesSlug: 'first-readers',
      coverImage: '/assets/covers/First Readers/FR003 Austin Turtle and the Sight Word Challenge Cover.png'
    }
  ];

  assert.equal(
    findVerifiedForeignBookCoverOwner(source, 'HH-B-0002', 'first-readers', models, directory),
    'HH-B-0003'
  );

  fs.writeFileSync(source, Buffer.from('different artwork'));
  assert.equal(findVerifiedForeignBookCoverOwner(source, 'HH-B-0002', 'first-readers', models, directory), '');
});
