const { test } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../data/page-themes.json');
const publication = require('../data/page-theme-publication.json');
const { libraryTracks } = require('../scripts/theme-song-library');

test('all 318 delivered themes stay active, all 265 prior receipts remain unchanged, and ten withheld recordings stay inactive', () => {
  const active = libraryTracks();
  assert.equal(publication.records.length, 318);
  assert.equal(active.length, 318);
  assert.deepEqual(active.map(t => t.id).sort(), publication.records.map(r => r.id).sort());
  const previous = require('./fixtures/previously-verified-theme-receipts.json');
  assert.equal(previous.records.length, 265);
  const previousIds = new Set(previous.records.map(r => r.id));
  for (const receipt of previous.records) assert.deepEqual(publication.records.find(r => r.id === receipt.id), receipt);
  assert.equal(active.filter(t => !previousIds.has(t.id)).length, 53);
  assert.deepEqual(active.map(t => t.id).sort(), manifest.recordings.filter(t => t.classification !== 'unresolved').map(t => t.id).sort());
  const activeIds = new Set(active.map(t => t.id));
  const duplicatePair = manifest.recordings.filter(t => t.canonicalId === 'HH-A-0016');
  assert.equal(duplicatePair.length, 2);
  assert.equal(duplicatePair[0].sha256, duplicatePair[1].sha256);
  assert.ok(activeIds.has(duplicatePair.find(t => t.primary).id));
  assert.ok(!activeIds.has(duplicatePair.find(t => !t.primary).id));
  const pending = manifest.recordings.filter(t => t.classification !== 'unresolved' && !activeIds.has(t.id));
  const withheld = manifest.recordings.filter(t => t.classification === 'unresolved');
  assert.equal(pending.length, 0);
  assert.equal(withheld.length, 10);
  assert.ok([...pending, ...withheld].every(t => !activeIds.has(t.id)));
  for (const track of active) {
    const receipt = publication.records.find(r => r.id === track.id);
    assert.equal(receipt.status, 'verified');
    assert.equal(receipt.ownerApproved, true);
    assert.equal(receipt.rangeVerified, true);
    for (const key of ['sha256', 'objectKey', 'publicUrl', 'sizeBytes']) assert.equal(receipt[key], track[key]);
    assert.equal(track.audioUrl, receipt.publicUrl);
  }
});
