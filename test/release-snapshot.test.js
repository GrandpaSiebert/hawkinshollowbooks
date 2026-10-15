const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { test } = require('node:test');
const {
  APPROVED_STORY_MASTER_EXCEPTIONS,
  APPROVAL_PURPOSE,
  APPROVAL_SCHEMA_VERSION,
  assertOutsideProtectedPaths,
  assertNoSymlinkAncestors,
  calculateManifestSha256,
  canonicalApprovalRecord,
  canonicalJson,
  getApprovalPublicKeyId,
  normalizeRelativePath,
  parseJsonRejectDuplicateKeys,
  sha256,
  validateManifest,
  verifyApproval,
  walkNoLinks
} = require('../scripts/release-snapshot');
const {
  createInventory,
  manifestFromInventory,
  prepareSnapshot,
  verifyCandidateDirectory,
  hashFile
} = require('../scripts/prepare-release-snapshot');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7+8AAAAASUVORK5CYII=',
  'base64'
);

function writeFile(root, relativePath, bytes = Buffer.from(relativePath)) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function createFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-release-snapshot-'));
  const repo = path.join(parent, 'repo');
  const library = path.join(repo, 'Library');
  const archive = path.join(parent, 'OneDrive Archive');
  const external = path.join(parent, 'snapshots');
  fs.mkdirSync(library, { recursive: true });
  fs.mkdirSync(archive);
  fs.mkdirSync(external);

  const books = [
    'Books/HH-C+ Growing Together/HH-C+-0001-0010/HH-C+-0001 Sample Book/HH-C+-0001 Sample Story Master.docx',
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-008 Eighth Book/Eighth Book.pdf',
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-008 Eighth Book/HH-F-0008 Eighth Book Story Master.docx',
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-009 Ninth Book/Ninth Book.pdf',
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-009 Ninth Book/HH-F-0009 Ninth Book Story Master.docx'
  ];
  for (const sourcePath of books) writeFile(library, sourcePath);
  writeFile(library, "Freebies/Mode S Kids' Songs/HH-S-0001-0010/HH-S-0001 Sample Song/HH-S-0001 Sample Song.docx");
  writeFile(library, "Freebies/Mode S Kids' Songs/HH-S-0001-0010/HH-S-0001 Sample Song/HH-S-0001 Sample Song Primary.png", PNG_1X1);
  writeFile(library, 'Characters/Ali Character Canon.docx');
  writeFile(library, 'Relationships/Aleea and Callen Relationship Canon.docx');
  writeFile(library, 'Landmarks/Old Oak Landmark Canon.docx');
  writeFile(library, 'Ribbons/HH-C+-0001 Ribbon.png', PNG_1X1);

  const charactersPath = writeFile(repo, 'data/characters.json', Buffer.from(JSON.stringify({
    characters: [{
      code: 'Ali',
      slug: 'alice-mole',
      identity: { canonicalId: 'HH-CHR-0001', legacyAliases: ['Ali'] }
    }]
  })));
  const entityRegistryPath = writeFile(repo, 'data/entity-id-registry.json', Buffer.from(JSON.stringify({
    entries: {
      'relationship:Relationships/Aleea and Callen Relationship Canon.docx': { id: 'REL-0001' },
      'landmark:Landmarks/Old Oak Landmark Canon.docx': { id: 'LND-0001' }
    }
  })));
  const workbookPath = path.join(repo, 'Amazon KDP Info.xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    { ID: 'HH-C+-0001', Title: 'Sample Book', Series: 'Growing Together', Status: 'Live' },
    { ID: 'HH-F-0008', Title: 'Eighth Book', Series: 'Holiday Story Poems', Status: 'Live' },
    { ID: 'HH-F-0009', Title: 'Ninth Book', Series: 'Holiday Story Poems', Status: 'Live' },
    { ID: 'HH-S-0001', Title: 'Sample Song', Series: 'Kids Songs', Status: 'Draft' }
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Mode C+');
  XLSX.writeFile(workbook, workbookPath);

  return {
    parent,
    repo,
    library,
    archive,
    external,
    charactersPath,
    entityRegistryPath,
    workbookPath,
    options: {
      repositoryRoot: repo,
      libraryRoot: library,
      archiveRoot: archive,
      charactersPath,
      entityRegistryPath,
      workbookPath
    }
  };
}

function createSignedApproval(inventory, options = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const keyId = getApprovalPublicKeyId(publicKeyPem);
  const issuedAt = options.issuedAt || new Date(Date.now() - 60_000).toISOString();
  const expiresAt = options.expiresAt || new Date(Date.now() + 3_600_000).toISOString();
  const approval = {
    schemaVersion: options.schemaVersion === undefined ? APPROVAL_SCHEMA_VERSION : options.schemaVersion,
    purpose: options.purpose || APPROVAL_PURPOSE,
    sourceSetSha256: options.sourceSetSha256 || inventory.sourceSetSha256,
    workbookSha256: options.workbookSha256 || inventory.workbookSha256,
    keyId,
    issuedAt,
    expiresAt
  };
  const signature = crypto.sign(null, Buffer.from(canonicalApprovalRecord(approval)), privateKey);
  const trustedKeys = options.trustOtherKey
    ? (() => {
      const wrong = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
      return [{
        keyId: getApprovalPublicKeyId(wrong),
        algorithm: 'Ed25519',
        publicKeyPem: wrong,
        purposes: [APPROVAL_PURPOSE],
        status: 'active'
      }];
    })()
    : [{
      keyId,
      algorithm: options.algorithm || 'Ed25519',
      publicKeyPem,
      purposes: options.purposes || [APPROVAL_PURPOSE],
      status: options.status || 'active'
    }];
  return { approval, signature, trustedKeys, trustedKeyFingerprint: options.pinnedFingerprint || keyId };
}

function writeSignedApproval(fixture, inventory, options = {}) {
  const bundle = createSignedApproval(inventory, options);
  const approvalFile = path.join(fixture.external, 'signed-approval.json');
  const signatureFile = path.join(fixture.external, 'signed-approval.sig');
  const trustedKeysFile = path.join(fixture.external, 'trusted-approval-keys.json');
  fs.writeFileSync(approvalFile, `${JSON.stringify(bundle.approval, null, 2)}\n`, { flag: 'w' });
  fs.writeFileSync(signatureFile, `${bundle.signature.toString('base64')}\n`, { flag: 'w' });
  fs.writeFileSync(trustedKeysFile, `${JSON.stringify({ schemaVersion: 1, keys: bundle.trustedKeys }, null, 2)}\n`, { flag: 'w' });
  return { ...bundle, approvalFile, signatureFile, trustedKeysFile };
}

async function prepareFixture(fixture, destination) {
  const inventory = await createInventory(fixture.options);
  const approvalBundle = writeSignedApproval(fixture, inventory);
  const result = await prepareSnapshot({
    ...fixture.options,
    approvalFile: approvalBundle.approvalFile,
    signatureFile: approvalBundle.signatureFile,
    trustedKeysFile: approvalBundle.trustedKeysFile,
    trustedKeyFingerprint: approvalBundle.trustedKeyFingerprint,
    destination
  });
  return { inventory, result, ...approvalBundle };
}

test('canonical serialization and identity are deterministic and preserve C+ IDs', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventoryA = await createInventory(fixture.options);
  const inventoryB = await createInventory(fixture.options);
  const manifestA = manifestFromInventory(inventoryA);
  const manifestB = manifestFromInventory(inventoryB);

  assert.equal(canonicalJson(manifestA), canonicalJson(manifestB));
  assert.equal(manifestA.snapshotId, manifestB.snapshotId);
  assert.equal(calculateManifestSha256(manifestA), calculateManifestSha256(manifestB));
  assert.ok(manifestA.payloads.some((record) => record.canonicalId === 'HH-C+-0001'));
  assert.deepEqual(manifestA.storyMasterExceptions, []);
  for (const id of ['HH-F-0008', 'HH-F-0009']) {
    assert.equal(manifestA.payloads.filter((record) => record.role === 'book-story-master' && record.canonicalId === id).length, 1);
    assert.equal(manifestA.discrepancies.some((record) => record.canonicalId === id), false);
  }
  assert.deepEqual(manifestA.liveBookIds, ['HH-C+-0001', 'HH-F-0008', 'HH-F-0009']);
});

test('preparation copies and verifies every payload without altering source files', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const sourceBefore = await createInventory(fixture.options);
  const destination = path.join(fixture.external, 'candidate');
  const { result } = await prepareFixture(fixture, destination);
  const manifest = await verifyCandidateDirectory(destination);

  assert.equal(result.snapshotId, manifest.snapshotId);
  assert.equal(result.manifestSha256, calculateManifestSha256(manifest));
  assert.equal(result.liveBookCount, 3);
  assert.equal(manifest.payloads.length, 9);
  assert.ok(manifest.payloads.some((record) => record.sourcePath.includes('HH-C+-0001')));
  assert.ok(manifest.payloads.some((record) => record.role === 'freebie-illustration'));
  assert.ok(manifest.payloads.some((record) => record.canonicalId === 'HH-CHR-0001'));
  assert.ok(manifest.payloads.some((record) => record.canonicalId === 'REL-0001'));
  assert.ok(manifest.payloads.some((record) => record.canonicalId === 'LND-0001'));
  for (const id of ['HH-F-0008', 'HH-F-0009']) {
    assert.equal(manifest.payloads.filter((record) => record.role === 'book-story-master' && record.canonicalId === id).length, 1);
    assert.equal(manifest.discrepancies.some((record) => record.canonicalId === id), false);
  }
  assert.ok(manifest.scannerMetadata.files.some((record) => record.path === 'Ribbons/HH-C+-0001 Ribbon.png'));
  assert.deepEqual(await createInventory(fixture.options), sourceBefore);
});

test('verification rejects missing, extra, and altered payload files', async (t) => {
  for (const mutate of [
    (candidate, payload) => fs.rmSync(path.join(candidate, ...payload.payloadPath.split('/'))),
    (candidate) => writeFile(candidate, 'payload/unexpected.bin'),
    (candidate) => fs.mkdirSync(path.join(candidate, 'unexpected-empty-directory')),
    (candidate, payload) => fs.writeFileSync(path.join(candidate, ...payload.payloadPath.split('/')), Buffer.from('altered'))
  ]) {
    const fixture = createFixture();
    const destination = path.join(fixture.external, 'candidate');
    const { result } = await prepareFixture(fixture, destination);
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
    const payload = manifest.payloads.find((record) => record.role !== 'kdp-workbook');
    mutate(destination, payload);
    await assert.rejects(verifyCandidateDirectory(destination));
    assert.equal(result.snapshotId, manifest.snapshotId);
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test('verification checks tracked identity inputs and inventory rejects ambiguous source mappings', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const destination = path.join(fixture.external, 'candidate');
  await prepareFixture(fixture, destination);
  fs.appendFileSync(fixture.charactersPath, ' ');
  await assert.rejects(
    verifyCandidateDirectory(destination, undefined, fixture.repo),
    /Tracked release input does not match/
  );

  writeFile(fixture.library, 'Characters/Ali Additional Canon.docx');
  await assert.rejects(createInventory(fixture.options), /Multiple Character canon documents map/);
});

test('a legacy alias shared by distinct canonical IDs is rejected', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const characters = JSON.parse(fs.readFileSync(fixture.charactersPath, 'utf8'));
  characters.characters.push({
    code: 'Other',
    slug: 'other-character',
    identity: { canonicalId: 'HH-CHR-0002', legacyAliases: ['Ali'] }
  });
  fs.writeFileSync(fixture.charactersPath, JSON.stringify(characters));
  await assert.rejects(createInventory(fixture.options), /distinct canonical identities/);
});

test('inventory requires the exact tracked identity registries', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  await assert.rejects(createInventory({
    ...fixture.options,
    charactersPath: path.join(fixture.repo, 'data', 'characters-copy.json')
  }), /exact tracked registries/);
});

test('Story Masters for formerly excepted Holiday books are ordinary verified payloads', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventory = await createInventory(fixture.options);
  const manifest = manifestFromInventory(inventory);
  assert.deepEqual(manifest.discrepancies, []);
  for (const id of ['HH-F-0008', 'HH-F-0009']) {
    const payloads = manifest.payloads.filter((record) => record.role === 'book-story-master' && record.canonicalId === id);
    assert.equal(payloads.length, 1);
    assert.match(path.basename(payloads[0].sourcePath), new RegExp(`^${id} `));
  }
});

test('validation rejects unsafe paths and duplicate canonical source mappings', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventory = await createInventory(fixture.options);
  const manifest = manifestFromInventory(inventory);

  for (const unsafe of ['../outside.docx', '/root/file', 'C:/outside', 'Books\\bad.docx', 'Books//bad.docx']) {
    assert.throws(() => normalizeRelativePath(unsafe), /Unsafe relative path/);
  }
  for (const unsafe of ['Books/CON.docx', 'Books/trailing. ', 'Books/alternate:name.docx']) {
    assert.throws(() => normalizeRelativePath(unsafe), /Unsafe relative path/);
  }
  const duplicate = structuredClone(manifest);
  const bookRecord = duplicate.payloads.find((record) => record.role === 'book-story-master');
  duplicate.payloads.push({
    ...bookRecord,
    sourcePath: 'Books/Duplicate/Story Master.docx',
    payloadPath: 'payload/Library/Books/Duplicate/Story Master.docx'
  });
  assert.throws(() => validateManifest(duplicate), /Duplicate canonical identity/);

  for (const mutate of [
    (value) => { value.payloads[0].role = 'arbitrary'; },
    (value) => { value.payloads[0].sourcePath = 'Characters/HH-C+-0001 Fake Canon.docx'; },
    (value) => { value.payloads[0].canonicalId = 'not-a-canonical-id'; },
    (value) => { value.trackedInputs.pop(); }
  ]) {
    const invalid = structuredClone(manifest);
    mutate(invalid);
    assert.throws(() => validateManifest(invalid));
  }
});

test('preparation requires matching explicit approval and never overwrites a candidate', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const destination = path.join(fixture.external, 'candidate');
  const inventory = await createInventory(fixture.options);
  await assert.rejects(
    prepareSnapshot({ ...fixture.options, destination, approvalFile: path.join(fixture.external, 'absent.json') }),
    /--trusted-key-fingerprint are required/
  );
  assert.equal(fs.existsSync(destination), false);

  const stale = writeSignedApproval(fixture, inventory, { workbookSha256: '0'.repeat(64) });
  await assert.rejects(prepareSnapshot({ ...fixture.options, ...stale, destination }), /hashes do not match/);
  assert.equal(fs.existsSync(destination), false);

  await prepareFixture(fixture, destination);
  const manifestBytes = fs.readFileSync(path.join(destination, 'manifest.json'));
  const approval = writeSignedApproval(fixture, inventory);
  await assert.rejects(prepareSnapshot({ ...fixture.options, ...approval, destination }), /already exists/);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'manifest.json')), manifestBytes);
});

test('preparation rejects duplicate approval JSON before creating a candidate', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventory = await createInventory(fixture.options);
  const approval = writeSignedApproval(fixture, inventory);
  fs.writeFileSync(
    approval.approvalFile,
    `{"schemaVersion":1,"purpose":"prepare-release-snapshot","purpose":"publish","sourceSetSha256":"${inventory.sourceSetSha256}","workbookSha256":"${inventory.workbookSha256}","keyId":"${approval.approval.keyId}","issuedAt":"${approval.approval.issuedAt}","expiresAt":"${approval.approval.expiresAt}"}`
  );
  const destination = path.join(fixture.external, 'duplicate-approval-candidate');
  await assert.rejects(
    prepareSnapshot({ ...fixture.options, ...approval, destination }),
    /Duplicate JSON member name/
  );
  assert.equal(fs.existsSync(destination), false);
});

test('Ed25519 approval verification fails closed for invalid authorization', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventory = await createInventory(fixture.options);
  const sourceHash = inventory.sourceSetSha256;
  const workbookHash = inventory.workbookSha256;
  const valid = createSignedApproval(inventory);
  assert.equal(verifyApproval(valid.approval, valid.signature, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), true);
  assert.equal(verifyApproval(valid.approval, valid.signature, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), true);
  const changedSignature = Buffer.from(valid.signature);
  changedSignature[0] ^= 0x01;
  assert.throws(() => verifyApproval(valid.approval, changedSignature, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), /signature is invalid/);

  const tampered = { ...valid.approval, sourceSetSha256: '0'.repeat(64) };
  assert.throws(() => verifyApproval(tampered, valid.signature, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), /hashes do not match/);
  const alternatePublicKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const alternateKeyId = getApprovalPublicKeyId(alternatePublicKey);
  const alternateTrust = [...valid.trustedKeys, {
    keyId: alternateKeyId,
    algorithm: 'Ed25519',
    publicKeyPem: alternatePublicKey,
    purposes: [APPROVAL_PURPOSE],
    status: 'active'
  }];
  assert.throws(() => verifyApproval(
    { ...valid.approval, keyId: alternateKeyId }, valid.signature, alternateTrust, sourceHash, workbookHash, valid.trustedKeyFingerprint
  ), /fingerprint does not match/);
  assert.throws(() => verifyApproval(valid.approval, valid.signature, [], sourceHash, workbookHash, valid.trustedKeyFingerprint), /trusted approval-key set/);
  assert.throws(() => verifyApproval(valid.approval, undefined, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), /signature is missing/);
  assert.throws(() => verifyApproval(valid.approval, Buffer.alloc(63), valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint), /signature is missing/);
  assert.throws(() => verifyApproval(
    { ...valid.approval, unexpected: true }, valid.signature, valid.trustedKeys, sourceHash, workbookHash, valid.trustedKeyFingerprint
  ), /missing or unexpected fields/);

  const wrongKey = createSignedApproval(inventory, { trustOtherKey: true });
  assert.throws(() => verifyApproval(wrongKey.approval, wrongKey.signature, wrongKey.trustedKeys, sourceHash, workbookHash, wrongKey.trustedKeyFingerprint), /not uniquely trusted/);

  const wrongPurpose = createSignedApproval(inventory, { purpose: 'publish-to-r2' });
  assert.throws(() => verifyApproval(wrongPurpose.approval, wrongPurpose.signature, wrongPurpose.trustedKeys, sourceHash, workbookHash, wrongPurpose.trustedKeyFingerprint), /Invalid approval purpose/);
  const unsupportedSchema = createSignedApproval(inventory, { schemaVersion: 2 });
  assert.throws(() => verifyApproval(unsupportedSchema.approval, unsupportedSchema.signature, unsupportedSchema.trustedKeys, sourceHash, workbookHash, unsupportedSchema.trustedKeyFingerprint), /Unsupported approval schema/);
  const wrongSource = createSignedApproval(inventory, { sourceSetSha256: '1'.repeat(64) });
  assert.throws(() => verifyApproval(wrongSource.approval, wrongSource.signature, wrongSource.trustedKeys, sourceHash, workbookHash, wrongSource.trustedKeyFingerprint), /hashes do not match/);
  const wrongWorkbook = createSignedApproval(inventory, { workbookSha256: '2'.repeat(64) });
  assert.throws(() => verifyApproval(wrongWorkbook.approval, wrongWorkbook.signature, wrongWorkbook.trustedKeys, sourceHash, workbookHash, wrongWorkbook.trustedKeyFingerprint), /hashes do not match/);
  const revoked = createSignedApproval(inventory, { status: 'revoked' });
  assert.throws(() => verifyApproval(revoked.approval, revoked.signature, revoked.trustedKeys, sourceHash, workbookHash, revoked.trustedKeyFingerprint), /not authorized/);

  const wrongPin = createSignedApproval(inventory, { pinnedFingerprint: '0'.repeat(64) });
  assert.throws(() => verifyApproval(
    wrongPin.approval, wrongPin.signature, wrongPin.trustedKeys, sourceHash, workbookHash, wrongPin.trustedKeyFingerprint
  ), /fingerprint does not match/);
  const substitutedTrust = createSignedApproval(inventory);
  assert.throws(() => verifyApproval(
    substitutedTrust.approval,
    substitutedTrust.signature,
    substitutedTrust.trustedKeys,
    sourceHash,
    workbookHash,
    valid.trustedKeyFingerprint
  ), /fingerprint does not match/);

  const expired = createSignedApproval(inventory, {
    issuedAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  });
  assert.throws(() => verifyApproval(expired.approval, expired.signature, expired.trustedKeys, sourceHash, workbookHash, expired.trustedKeyFingerprint), /expired/);
  const futureIssued = createSignedApproval(inventory, { issuedAt: new Date(Date.now() + 60_000).toISOString() });
  assert.throws(() => verifyApproval(futureIssued.approval, futureIssued.signature, futureIssued.trustedKeys, sourceHash, workbookHash, futureIssued.trustedKeyFingerprint), /future/);
  const invalidTimestamp = createSignedApproval(inventory, { issuedAt: '2026-02-30T10:00:00.000Z' });
  assert.throws(() => verifyApproval(invalidTimestamp.approval, invalidTimestamp.signature, invalidTimestamp.trustedKeys, sourceHash, workbookHash, invalidTimestamp.trustedKeyFingerprint), /invalid/);
  const invalidInterval = createSignedApproval(inventory, {
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 120_000).toISOString()
  });
  assert.throws(() => verifyApproval(invalidInterval.approval, invalidInterval.signature, invalidInterval.trustedKeys, sourceHash, workbookHash, invalidInterval.trustedKeyFingerprint), /validity interval/);
  assert.throws(() => verifyApproval(valid.approval, valid.signature, valid.trustedKeys, sourceHash, workbookHash), /independently pinned/);
});

test('strict JSON parser rejects duplicate member names at every nesting level', () => {
  assert.deepEqual(parseJsonRejectDuplicateKeys('{"ok":1,"nested":{"value":true}}'), { ok: 1, nested: { value: true } });
  assert.throws(() => parseJsonRejectDuplicateKeys('{"purpose":"prepare-release-snapshot","purpose":"publish"}'), /Duplicate JSON member name/);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"nested":{"id":1,"id":2}}'), /Duplicate JSON member name/);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"key":1,"\\u006bey":2}'), /Duplicate JSON member name/);
  assert.throws(() => parseJsonRejectDuplicateKeys('{"broken":'), /Invalid JSON value/);
});

test('source changes since owner review invalidate approval and a fresh preparation can recover', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventory = await createInventory(fixture.options);
  let approval = writeSignedApproval(fixture, inventory);
  writeFile(fixture.library, 'Books/HH-C+ Growing Together/HH-C+-0001-0010/HH-C+-0001 Sample Book/HH-C+-0001 Sample Story Master.docx', Buffer.from('changed'));
  const failedDestination = path.join(fixture.external, 'failed');
  await assert.rejects(prepareSnapshot({ ...fixture.options, ...approval, destination: failedDestination }), /hashes do not match/);
  assert.equal(fs.existsSync(failedDestination), false);

  const freshInventory = await createInventory(fixture.options);
  approval = writeSignedApproval(fixture, freshInventory);
  const interrupted = path.join(fixture.external, '.recovered.partial-abandoned');
  fs.mkdirSync(interrupted);
  fs.writeFileSync(path.join(interrupted, 'state.txt'), 'left by interrupted preparation');
  const goodDestination = path.join(fixture.external, 'recovered');
  await prepareSnapshot({ ...fixture.options, ...approval, destination: goodDestination });
  assert.equal((await verifyCandidateDirectory(goodDestination)).sourceSetSha256, freshInventory.sourceSetSha256);
  assert.equal(fs.readFileSync(path.join(interrupted, 'state.txt'), 'utf8'), 'left by interrupted preparation');
});

test('destinations overlapping repository, Library, or archive are rejected', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  for (const destination of [
    path.join(fixture.repo, 'candidate'),
    path.join(fixture.library, 'candidate'),
    path.join(fixture.archive, 'candidate'),
    fixture.repo
  ]) {
    assert.throws(() => assertOutsideProtectedPaths(destination, [
      fixture.repo,
      fixture.library,
      fixture.archive
    ]), /overlaps protected path/);
  }
});

test('symbolic links are rejected when Windows cannot create filesystem links', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const linkPath = path.join(fixture.library, 'Characters', 'Ali Character Canon.docx');
  const originalLstat = fs.lstatSync;
  fs.lstatSync = function simulatedLstat(filePath, ...args) {
    const stats = originalLstat.call(fs, filePath, ...args);
    if (path.resolve(String(filePath)) !== path.resolve(linkPath)) return stats;
    return new Proxy(stats, {
      get(target, property) {
        if (property === 'isSymbolicLink') return () => true;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };
  try {
    assert.throws(() => walkNoLinks(fixture.library), /Symbolic link/);
    assert.throws(() => assertNoSymlinkAncestors(linkPath), /symbolic link/i);
  } finally {
    fs.lstatSync = originalLstat;
  }
});

test('hashing detects a file changed after its descriptor is opened', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const target = path.join(fixture.library, 'Characters', 'Ali Character Canon.docx');
  const originalCreateReadStream = fs.createReadStream;
  fs.createReadStream = function mutateBeforeRead(...args) {
    if (args[0] === null) fs.appendFileSync(target, 'changed during read');
    return originalCreateReadStream.apply(fs, args);
  };
  try {
    await assert.rejects(hashFile(target), /changed while being hashed/);
  } finally {
    fs.createReadStream = originalCreateReadStream;
  }
});

test('local tools have no remote or Git operations', () => {
  const scripts = [
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-release-snapshot.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release-snapshot.js'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(scripts, /@aws-sdk|PutObject|DeleteObject|git\s+(?:add|commit|push)|deploy-pages|wrangler/i);
  assert.throws(() => verifyApproval({}, undefined, undefined, 'a'.repeat(64), 'b'.repeat(64)));
});

test('documented inventory, preparation, and verification CLIs work on synthetic sources', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.parent, { recursive: true, force: true }));
  const inventoryPath = path.join(fixture.external, 'inventory.json');
  const candidatePath = path.join(fixture.external, 'cli-candidate');
  const prepareScript = path.join(__dirname, '..', 'scripts', 'prepare-release-snapshot.js');
  const verifyScript = path.join(__dirname, '..', 'scripts', 'verify-release-snapshot.js');
  const sharedArgs = [
    '--repository-root', fixture.repo,
    '--library-root', fixture.library,
    '--workbook', fixture.workbookPath,
    '--archive-root', fixture.archive
  ];

  execFileSync(process.execPath, [
    prepareScript,
    ...sharedArgs,
    '--inventory-only',
    '--inventory-output', inventoryPath,
    '--destination', candidatePath
  ], {
    stdio: 'pipe'
  });
  assert.equal(fs.existsSync(candidatePath), false);
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  const approval = writeSignedApproval(fixture, inventory);
  execFileSync(process.execPath, [
    prepareScript,
    ...sharedArgs,
    '--approval-file', approval.approvalFile,
    '--signature-file', approval.signatureFile,
    '--trusted-keys', approval.trustedKeysFile,
    '--trusted-key-fingerprint', approval.trustedKeyFingerprint,
    '--destination', candidatePath
  ], { stdio: 'pipe' });
  const verification = execFileSync(process.execPath, [
    verifyScript,
    '--repository-root', fixture.repo,
    '--library-root', fixture.library,
    '--archive-root', fixture.archive,
    '--candidate', candidatePath
  ], { encoding: 'utf8' });
  assert.match(verification, /Snapshot verified:/);
  assert.equal((await verifyCandidateDirectory(candidatePath, undefined, fixture.repo)).snapshotId,
    JSON.parse(fs.readFileSync(path.join(candidatePath, 'manifest.json'), 'utf8')).snapshotId);
});
