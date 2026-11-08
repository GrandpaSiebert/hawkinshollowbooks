const { test } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../data/page-themes.json');
const publication = require('../data/page-theme-publication.json');
const { libraryTracks } = require('../scripts/theme-song-library');

test('all 385 delivered themes stay active, all 318 prior receipts remain unchanged, and ten withheld recordings stay inactive', () => {
  const active = libraryTracks();
  assert.equal(publication.records.length, 385);
  assert.equal(active.length, 385);
  assert.deepEqual(active.map(t => t.id).sort(), publication.records.map(r => r.id).sort());
  const previous = require('./fixtures/previously-verified-theme-receipts.json');
  assert.equal(previous.records.length, 265);
  const previousIds = new Set(previous.records.map(r => r.id));
  for (const receipt of previous.records) assert.deepEqual(publication.records.find(r => r.id === receipt.id), receipt);
  assert.equal(active.filter(t => !previousIds.has(t.id)).length, 120);
  assert.deepEqual(active.map(t => t.id).sort(), manifest.recordings.filter(t => t.classification !== 'unresolved').map(t => t.id).sort());
  const lastRelease = require('./fixtures/theme-receipts-october-30-2026.json');
  assert.equal(lastRelease.records.length, 318);
  const lastReleaseIds = new Set(lastRelease.records.map(r => r.id));
  for (const receipt of lastRelease.records) assert.deepEqual(publication.records.find(r => r.id === receipt.id), receipt);
  assert.equal(active.filter(t => !lastReleaseIds.has(t.id)).length, 67);
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

test('Community adds exactly one verified Primary without changing the previous 394 records or 384 receipts', () => {
  const crypto = require('crypto'), baseline = require('./fixtures/community-theme-baseline.json');
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const oldManifest = { ...manifest, recordings:manifest.recordings.filter(t => t.id !== baseline.newRecordingId) };
  const oldPublication = { ...publication, records:publication.records.filter(t => t.id !== baseline.newRecordingId) };
  assert.equal(oldManifest.recordings.length, baseline.recordings);
  assert.equal(oldPublication.records.length, baseline.receipts);
  assert.equal(hash(oldManifest), baseline.normalizedManifestSha256);
  assert.equal(hash(oldPublication), baseline.normalizedPublicationSha256);
  const track = manifest.recordings.at(-1), receipt = publication.records.at(-1);
  assert.equal(track.id, baseline.newRecordingId); assert.equal(receipt.id, track.id);
  assert.equal(track.title, 'Come See the Hollow'); assert.equal(track.page, 'community.html');
  assert.equal(track.category, 'page'); assert.equal(track.canonicalId, 'community');
  assert.equal(track.primary, true); assert.equal(track.classification, 'confirmed-primary');
  assert.equal(track.lyricMatchStatus, 'not-required-page-theme');
  assert.equal(manifest.recordings.filter(t => t.page === 'community.html').length, 1);
  assert.equal(libraryTracks().filter(t => t.page === 'community.html').length, 1);
  assert.ok(!manifest.recordings.some(t => /Community.*Provisional/i.test(t.originalFilename)));
});
