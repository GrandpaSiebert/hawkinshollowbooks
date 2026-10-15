const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { afterEach, test } = require('node:test');
const {
  generateTitleArtDerivative,
  getTitleArtKey,
  getTitleArtPublicUrl,
  sha256
} = require('../scripts/freebie-title-art-media');
const { verifyFreebieTitleArt } = require('../scripts/verify-freebie-title-art-readonly');

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-title-art-'));
  temporaryRoots.push(root);
  const libraryRoot = path.join(root, 'Library');
  fs.mkdirSync(path.join(libraryRoot, 'covers'), { recursive: true });
  const sourcePath = 'covers/HH-S-0001.png';
  const sourceFile = path.join(libraryRoot, sourcePath);
  const sourceBytes = await sharp({
    create: { width: 12, height: 8, channels: 3, background: { r: 30, g: 90, b: 140 } }
  }).png().toBuffer();
  fs.writeFileSync(sourceFile, sourceBytes);
  const record = {
    canonicalId: 'HH-S-0001',
    title: 'A Song',
    illustrationSourcePath: sourcePath,
    illustrationSourceSha256: sha256(sourceBytes)
  };
  const derivative = await generateTitleArtDerivative(sourceBytes, sourceFile);
  return { root, libraryRoot, sourceFile, sourceBytes, record, derivative, key: getTitleArtKey(record.canonicalId) };
}

function makeFetcher(fixtureData, override = {}) {
  const fetcher = async (url, options) => {
    fetcher.calls.push({ url, options });
    if (override.error) throw override.error;
    const bytes = override.bytes || fixtureData.derivative.bytes;
    return {
      ok: override.status === undefined || override.status === 200,
      status: override.status === undefined ? 200 : override.status,
      headers: { get: () => override.contentType || 'image/webp' },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  };
  fetcher.calls = [];
  return fetcher;
}

test('verifies existing public title-art bytes and writes only a local receipt', async () => {
  const data = await fixture();
  const fetch = makeFetcher(data);
  const output = path.join(data.root, 'receipt.json');
  const publication = await verifyFreebieTitleArt([data.record], {
    fetch,
    libraryRoot: data.libraryRoot,
    output
  });

  assert.deepEqual(fetch.calls, [{
    url: getTitleArtPublicUrl(data.record.canonicalId),
    options: { redirect: 'error' }
  }]);
  assert.equal(publication.summary.uploadedCount, 0);
  assert.equal(publication.summary.verifiedCount, 1);
  assert.equal(publication.records[0].key, data.key);
  assert.equal(publication.records[0].url, getTitleArtPublicUrl(data.record.canonicalId));
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).records[0].status, 'verified');
});

test('fails closed on missing, wrongly typed, or mismatched public dependencies', async () => {
  const data = await fixture();
  const absentFetch = makeFetcher(data, { status: 404 });
  await assert.rejects(verifyFreebieTitleArt([data.record], {
    fetch: absentFetch,
    libraryRoot: data.libraryRoot,
    output: path.join(data.root, 'absent.json')
  }), /HTTP 404/);
  assert.equal(fs.existsSync(path.join(data.root, 'absent.json')), false);

  const typeMismatchFetch = makeFetcher(data, { contentType: 'application/octet-stream' });
  await assert.rejects(verifyFreebieTitleArt([data.record], {
    fetch: typeMismatchFetch,
    libraryRoot: data.libraryRoot,
    output: path.join(data.root, 'type-mismatch.json')
  }), /unexpected content type/);
  assert.equal(fs.existsSync(path.join(data.root, 'type-mismatch.json')), false);

  const byteMismatchFetch = makeFetcher(data, { bytes: Buffer.from('not the title-art derivative') });
  await assert.rejects(verifyFreebieTitleArt([data.record], {
    fetch: byteMismatchFetch,
    libraryRoot: data.libraryRoot,
    output: path.join(data.root, 'bytes.json')
  }), /bytes do not match/);
  assert.equal(fs.existsSync(path.join(data.root, 'bytes.json')), false);
});

test('rejects changed local source and restricts checks to the public Library host', async () => {
  const data = await fixture();
  const changedSource = await sharp({
    create: { width: 12, height: 8, channels: 3, background: { r: 120, g: 30, b: 45 } }
  }).png().toBuffer();
  fs.writeFileSync(data.sourceFile, changedSource);
  const fetch = makeFetcher(data);
  await assert.rejects(verifyFreebieTitleArt([data.record], {
    fetch,
    libraryRoot: data.libraryRoot,
    output: path.join(data.root, 'changed.json')
  }), /source changed/);
  assert.equal(fetch.calls.length, 0);

  await assert.rejects(verifyFreebieTitleArt([data.record], {
    fetch,
    baseUrl: 'https://attacker.example',
    libraryRoot: data.libraryRoot,
    output: path.join(data.root, 'unsafe-host.json')
  }), /restricted to the public Hawkins Hollow Library host/);
  assert.equal(fetch.calls.length, 0);
});
