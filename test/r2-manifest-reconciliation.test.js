const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  EXPECTED_BOOK_COUNTS,
  EXPECTED_CANDIDATE_COUNT,
  EXPECTED_LIVE_BOOK_COUNT,
  EXPECTED_RESOURCE_COUNTS,
  LEGACY_C7_KEY_PREFIX,
  createManifestReconciliation,
  verifyCurrentHeads,
  validatePlan
} = require('../scripts/plan-r2-manifest-reconciliation');

const sha = (index) => String(index + 1).padStart(64, '0');
const slug = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function fixture() {
  const titles = new Map([
    ['HH-C+-0007', 'Callen Crow’s Lost Feather'],
    ['HH-F-0008', "Alice Mole's Grandparents Day Memory Walk"],
    ['HH-F-0009', 'Aralynn Fox’s Patriot Day Quiet Helper Plan Painted Stone'],
    ['HH-B-0003', 'Austin Turtle and the Sight Word Challenge']
  ]);
  const candidates = [];
  let index = 0;
  const counts = new Map([...EXPECTED_BOOK_COUNTS, ...EXPECTED_RESOURCE_COUNTS]);
  for (const [ownerCanonicalId, count] of counts) {
    const isBook = EXPECTED_BOOK_COUNTS.has(ownerCanonicalId);
    const ownerTitle = titles.get(ownerCanonicalId) || `${ownerCanonicalId} resource`;
    const ownerType = isBook ? 'book' : ownerCanonicalId.startsWith('HH-R-') ? 'rhyme' : 'song';
    for (let sequence = 0; sequence < count; sequence += 1) {
      const sourcePath = isBook
        ? `Books/${ownerCanonicalId} ${ownerTitle}/${ownerCanonicalId}-${sequence + 1}.${ownerCanonicalId === 'HH-F-0008' ? 'pdf' : 'png'}`
        : `Freebies/Mode ${ownerType === 'rhyme' ? 'R Nursery Rhymes' : "S Kids' Songs"}/${ownerCanonicalId}/${ownerCanonicalId}-${sequence + 1}.mp3`;
      const key = ownerCanonicalId === 'HH-C+-0007'
        ? `${LEGACY_C7_KEY_PREFIX}${ownerCanonicalId}-${sequence + 1}.png`.replace('-cover/', '/')
        : isBook
          ? `books/test/${slug(ownerCanonicalId)}-${slug(ownerTitle)}/${slug(ownerCanonicalId)}-${slug(ownerTitle)}-${sequence + 1}.${ownerCanonicalId === 'HH-F-0008' ? 'pdf' : 'png'}`
          : sourcePath;
      candidates.push({
        ownerCanonicalId,
        ownerTitle,
        ownerType,
        localSourcePath: `Library/${sourcePath}`,
        manifestSourcePath: sourcePath,
        destinationR2Key: key,
        sizeBytes: 1000 + index,
        sha256: sha(index),
        verifiedRemoteStatus: 'verified-absent',
        uploadCandidate: true,
        uploadAuthorization: 'not-authorized'
      });
      index += 1;
    }
  }

  const liveRecords = Array.from({ length: EXPECTED_LIVE_BOOK_COUNT }, (_, position) => ({
    id: `HH-X-${String(position + 1).padStart(4, '0')}`,
    status: 'live',
    title: `Live ${position + 1}`,
    series: 'Test Series'
  }));
  for (const [id, title] of titles) {
    liveRecords[positionForBook(id)] = {
      id,
      status: 'live',
      title,
      series: id.startsWith('HH-F-') ? 'Holiday Story Poems' : id === 'HH-B-0003' ? 'First Readers' : 'Growing Together'
    };
  }
  const plan = {
    schemaVersion: 1,
    generatedAt: '2026-10-10T04:00:00.000Z',
    authority: { liveBookCount: EXPECTED_LIVE_BOOK_COUNT },
    summary: {
      expectedPublicContentCandidateCount: EXPECTED_CANDIDATE_COUNT,
      planRowCount: EXPECTED_CANDIDATE_COUNT
    },
    remoteVerification: { bucket: 'hawkins-hollow-library' },
    excluded: { nonLiveBookIds: ['HH-F-0010'] },
    candidates
  };
  const verification = {
    verifiedAt: '2026-10-10T04:30:00.000Z',
    bucket: 'hawkins-hollow-library',
    approvedPlanGeneratedAt: plan.generatedAt,
    legacyObjectsPresent: 45,
    legacyObjectSetUnchanged: true,
    remainingMissing: [],
    mismatches: [],
    unresolved: [],
    checks: candidates.map((candidate) => ({
      ownerCanonicalId: candidate.ownerCanonicalId,
      key: candidate.destinationR2Key,
      status: 'verified-present-match',
      remoteSize: candidate.sizeBytes,
      remoteSha256: candidate.sha256
    }))
  };
  const staleC7Assets = Array.from({ length: 45 }, (_, item) => ({
    role: 'book',
    key: `${LEGACY_C7_KEY_PREFIX}stale-${item + 1}.png`,
    sourcePath: `Books/old-stale-c7/${item + 1}.png`,
    url: `https://library.hawkinshollowbooks.com/${LEGACY_C7_KEY_PREFIX}stale-${item + 1}.png`,
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
    contentType: 'image/png'
  }));
  const resourceIds = Array.from(EXPECTED_RESOURCE_COUNTS.keys());
  const baseManifest = {
    generatedAt: '2026-09-29T07:04:43.703Z',
    records: [
      { id: 'HH-C+-0007', title: 'Callen Crow’s Lost Feather Cover', assets: staleC7Assets },
      { id: 'HH-B-0003', title: titles.get('HH-B-0003'), series: 'First Readers', assets: [] },
      ...resourceIds.map((id) => ({ id, title: `${id} resource`, assets: [] }))
    ]
  };
  return { plan, verification, workbookRecords: liveRecords, baseManifest };
}

function positionForBook(id) {
  return id === 'HH-C+-0007' ? 0
    : id === 'HH-F-0008' ? 1
      : id === 'HH-F-0009' ? 2 : 3;
}

test('creates a 146-asset dry-run delta from the 79-Live workbook and matching Stage 7F evidence', () => {
  const input = fixture();
  const result = createManifestReconciliation(input);
  assert.equal(result.candidates.length, EXPECTED_CANDIDATE_COUNT);
  assert.equal(result.report.liveBookCount, EXPECTED_LIVE_BOOK_COUNT);
  assert.equal(result.report.uniqueDestinationKeyCount, EXPECTED_CANDIDATE_COUNT);
  assert.equal(result.delta.summary.preservedLegacyC7ObjectCount, 45);
  assert.equal(result.delta.summary.remoteObjectsDeleted, 0);
  assert.equal(result.delta.summary.removedManifestReferences, 45);
  const f8Assets = result.delta.records.find((record) => record.id === 'HH-F-0008').added;
  const f9Assets = result.delta.records.find((record) => record.id === 'HH-F-0009').added;
  assert.equal(f8Assets.length, 35);
  assert.equal(f9Assets.length, 35);
  assert.ok(f8Assets.every((asset) => asset.key && asset.sourcePath && asset.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(asset.sha256)));
  assert.equal(result.reconciledManifest.records.find((record) => record.id === 'HH-F-0008').title,
    "Alice Mole's Grandparents Day Memory Walk");
  assert.equal(result.reconciledManifest.records.find((record) => record.id === 'HH-C+-0007').assets
    .some((asset) => asset.key.startsWith(LEGACY_C7_KEY_PREFIX)), false);
  assert.equal(result.report.writesRemoteManifest, false);
});

test('rejects a candidate with mismatched owner, size, SHA-256, or verification evidence', () => {
  for (const mutate of [
    (input) => { input.plan.candidates[0].ownerCanonicalId = 'HH-F-0010'; },
    (input) => { input.plan.candidates[0].sizeBytes += 1; },
    (input) => { input.plan.candidates[0].sha256 = 'f'.repeat(64); },
    (input) => { input.verification.checks[0].status = 'unresolved'; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => createManifestReconciliation(input));
  }
});

test('rejects a Stage 7F Book candidate that is no longer Live in the reviewed workbook', () => {
  const input = fixture();
  input.workbookRecords.find((record) => record.id === 'HH-F-0008').status = 'draft';
  assert.throws(() => validatePlan(input.plan, input.verification, input.workbookRecords), /not Live|has 78 Live Books/);
});

test('rejects duplicate candidate keys and partial obsolete C+-0007 reference sets', () => {
  const duplicate = fixture();
  duplicate.plan.candidates[1].destinationR2Key = duplicate.plan.candidates[0].destinationR2Key;
  duplicate.verification.checks[1].key = duplicate.verification.checks[0].key;
  assert.throws(() => createManifestReconciliation(duplicate), /duplicate|Duplicate/i);

  const partial = fixture();
  partial.baseManifest.records[0].assets.pop();
  assert.throws(() => createManifestReconciliation(partial), /zero or 45 obsolete/);
});

test('fresh remote verification uses HEAD only and rejects metadata mismatch', async () => {
  const input = fixture();
  const candidate = input.plan.candidates[0];
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command.constructor.name);
      return {
        ContentLength: candidate.sizeBytes,
        Metadata: { sha256: candidate.sha256 },
        ContentType: 'image/png'
      };
    }
  };
  const checked = await verifyCurrentHeads(client, [{
    key: candidate.destinationR2Key,
    sizeBytes: candidate.sizeBytes,
    sha256: candidate.sha256,
    contentType: 'image/png'
  }]);
  assert.deepEqual(checked, [candidate.destinationR2Key]);
  assert.deepEqual(calls, ['HeadObjectCommand']);

  const mismatchClient = {
    async send() {
      return { ContentLength: candidate.sizeBytes + 1, Metadata: { sha256: candidate.sha256 }, ContentType: 'image/png' };
    }
  };
  await assert.rejects(verifyCurrentHeads(mismatchClient, [{
    key: candidate.destinationR2Key,
    sizeBytes: candidate.sizeBytes,
    sha256: candidate.sha256,
    contentType: 'image/png'
  }]), /HEAD does not match/);
});
