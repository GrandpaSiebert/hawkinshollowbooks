const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const sharp = require('sharp');
const { inspectImageAsset } = require('../scripts/image-asset');
const {
  isFreebieTitleArt,
  isFreebieTitleArtDerivative,
  restoreLibraryCanon
} = require('../scripts/restore-library-canon');
const { parseArgs, publishFreebieTitleArt } = require('../scripts/publish-freebie-title-art');
const {
  attachPublishedTitleArt,
  generateTitleArtDerivative,
  getTitleArtKey,
  getTitleArtPublicUrl,
  sha256
} = require('../scripts/freebie-title-art-media');

function pngFixture() {
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(3, 4);
  const imageData = Buffer.from([0]);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', imageData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function jpegFixture() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
}

function webpFixture() {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer[24] = 2;
  buffer[27] = 3;
  buffer.write('VP8L', 30, 'ascii');
  buffer.writeUInt32LE(5, 34);
  buffer[38] = 0x2f;
  return buffer;
}

function compactWebpFixture() {
  const buffer = Buffer.alloc(26);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(18, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8L', 12, 'ascii');
  buffer.writeUInt32LE(5, 16);
  buffer[20] = 0x2f;
  return buffer;
}

test('recognizes supported image signatures and dimensions', () => {
  assert.deepEqual(inspectImageAsset(pngFixture(), '.png'), { format: 'png', width: 2, height: 3 });
  assert.deepEqual(inspectImageAsset(jpegFixture(), '.jpg'), { format: 'jpeg', width: 3, height: 2 });
  assert.deepEqual(inspectImageAsset(webpFixture(), '.webp'), { format: 'webp', width: 3, height: 4 });
  assert.deepEqual(inspectImageAsset(compactWebpFixture(), '.webp'), { format: 'webp', width: 1, height: 1 });
});

test('rejects empty, malformed, and extension-mismatched image data', () => {
  assert.equal(inspectImageAsset(Buffer.alloc(0), '.png'), null);
  assert.equal(inspectImageAsset(Buffer.from('not an image'), '.png'), null);
  assert.equal(inspectImageAsset(pngFixture(), '.jpg'), null);
  assert.equal(inspectImageAsset(Buffer.concat([pngFixture(), Buffer.from([0])]), '.png'), null);
  assert.equal(inspectImageAsset(webpFixture().subarray(0, 30), '.webp'), null);
});

test('matches only canonical Song and Rhyme title-art filenames', () => {
  assert.equal(isFreebieTitleArt('Freebies/Mode S/HH-S-0001 — Title.webp'), true);
  assert.equal(isFreebieTitleArt('Freebies/Mode R/HH-R-0060 Title.JPEG'), true);
  assert.equal(isFreebieTitleArt('Freebies/Mode S/HH-S-0001A.png'), false);
  assert.equal(isFreebieTitleArt('Freebies/Mode S/HH-SL-0001.png'), false);
  assert.equal(isFreebieTitleArt('Freebies/Mode S/HH-S-0001.mp4'), false);
  assert.equal(isFreebieTitleArt('Freebies/Title Art/HH-S-0001.webp'), false);
  assert.equal(isFreebieTitleArtDerivative('Freebies/Title Art/HH-S-0001.webp'), true);
});

test('restores real manifest title-art bytes and leaves invalid candidates absent', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-title-art-'));
  const originalFetch = global.fetch;
  const imagePath = 'Freebies/Mode S/HH-S-0001 — Test Song.png';
  const documentPath = 'Freebies/Mode S/HH-S-0001 — Test Song.docx';
  const manifest = {
    records: [{
      assets: [
        { sourcePath: documentPath, key: 'freebies/test.docx', url: 'https://library.test/test.docx' },
        { sourcePath: imagePath, key: 'freebies/test.png', url: 'https://library.test/test.png' }
      ]
    }]
  };

  async function restoreWithImageBytes(imageBytes, destination) {
    global.fetch = async (url) => {
      if (String(url).endsWith('/manifest/manifest.json')) {
        return { ok: true, json: async () => manifest };
      }
      const body = String(url).endsWith('.png') ? imageBytes : Buffer.from('docx');
      return { ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    };
    return restoreLibraryCanon({
      baseUrl: 'https://library.test',
      destination,
      credentials: { configured: false }
    });
  }

  try {
    const realDestination = path.join(tempRoot, 'real');
    const pngBytes = pngFixture();
    await restoreWithImageBytes(pngBytes, realDestination);
    const restoredImage = fs.readFileSync(path.join(realDestination, imagePath));
    assert.deepEqual(restoredImage, pngBytes);

    const invalidDestination = path.join(tempRoot, 'invalid');
    await restoreWithImageBytes(Buffer.alloc(0), invalidDestination);
    assert.equal(fs.existsSync(path.join(invalidDestination, imagePath)), false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('supplements missing manifest artwork from the authenticated R2 object list', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-title-art-r2-'));
  const originalFetch = global.fetch;
  const imagePath = 'Freebies/Mode R/HH-R-0036 — Test Rhyme.png';
  const documentPath = 'Freebies/Mode R/HH-R-0036 — Test Rhyme.docx';
  const imageBytes = pngFixture();
  const manifest = {
    records: [{
      assets: [{
        sourcePath: documentPath,
        key: documentPath,
        url: 'https://library.test/test.docx'
      }]
    }]
  };
  const r2Client = {
    async send(command) {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: documentPath },
            { Key: imagePath },
            { Key: 'Freebies/Title Art/HH-R-0036.webp' }
          ]
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const bytes = command.input.Key === imagePath ? imageBytes : Buffer.from('docx');
        return { Body: Readable.from([bytes]) };
      }
      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    }
  };

  try {
    global.fetch = async () => ({ ok: true, json: async () => manifest });
    const destination = path.join(tempRoot, 'Library');
    await restoreLibraryCanon({
      baseUrl: 'https://library.test',
      destination,
      credentials: { configured: false },
      r2Client
    });
    assert.deepEqual(fs.readFileSync(path.join(destination, imagePath)), imageBytes);
    assert.equal(fs.existsSync(path.join(destination, 'Freebies', 'Title Art', 'HH-R-0036.webp')), false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('restores world canon documents listed in R2 when the public manifest omits them', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-world-canon-r2-'));
  const originalFetch = global.fetch;
  const documentPath = 'Environments/Barn Interior Visual Canon.docx';
  const documentBytes = Buffer.from('world canon docx fixture');
  const r2Client = {
    async send(command) {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return { Contents: [{ Key: documentPath }] };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        assert.equal(command.input.Key, documentPath);
        return { Body: Readable.from([documentBytes]) };
      }
      throw new Error(`Unexpected R2 command: ${command.constructor.name}`);
    }
  };

  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ records: [] }) });
    const destination = path.join(tempRoot, 'Library');
    await restoreLibraryCanon({
      baseUrl: 'https://library.test',
      destination,
      credentials: { configured: false },
      titleArtR2Client: r2Client
    });
    assert.deepEqual(fs.readFileSync(path.join(destination, documentPath)), documentBytes);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generates one uncropped canonical WebP derivative within the 1200px bound', async () => {
  const sourceBytes = await sharp({
    create: { width: 2400, height: 1200, channels: 3, background: { r: 20, g: 90, b: 160 } }
  }).png().toBuffer();
  const derivative = await generateTitleArtDerivative(sourceBytes, 'HH-S-0042.png');
  assert.deepEqual(derivative.sourceImage, { format: 'png', width: 2400, height: 1200 });
  assert.equal(derivative.derivativeImage.format, 'webp');
  assert.equal(derivative.derivativeImage.width, 1200);
  assert.equal(derivative.derivativeImage.height, 600);
  assert.ok(derivative.bytes.length > 0);
  assert.equal(getTitleArtKey('HH-S-0042'), 'Freebies/Title Art/HH-S-0042.webp');
  assert.equal(getTitleArtKey('HH-R-0007'), 'Freebies/Title Art/HH-R-0007.webp');
  assert.equal(
    getTitleArtPublicUrl('HH-S-0042'),
    'https://library.hawkinshollowbooks.com/Freebies/Title%20Art/HH-S-0042.webp'
  );
  assert.throws(() => getTitleArtKey('HH-SL-0042'), /Invalid canonical freebie ID/);
});

test('publishes idempotently and only attaches a matching verified public URL', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-title-art-publish-'));
  const libraryRoot = path.join(tempRoot, 'Library');
  const outputPath = path.join(tempRoot, 'generated', 'publication.json');
  const sourcePath = 'Freebies/Mode S/HH-S-0042 — Mock Song.png';
  const absoluteSourcePath = path.join(libraryRoot, sourcePath);
  const sourceBytes = await sharp({
    create: { width: 64, height: 32, channels: 3, background: { r: 80, g: 140, b: 35 } }
  }).png().toBuffer();
  fs.mkdirSync(path.dirname(absoluteSourcePath), { recursive: true });
  fs.writeFileSync(absoluteSourcePath, sourceBytes);

  const objects = new Map();
  let uploadCount = 0;
  const client = {
    async send(command) {
      if (command.constructor.name === 'HeadObjectCommand') {
        const object = objects.get(command.input.Key);
        if (!object) throw Object.assign(new Error('Not found'), { name: 'NotFound' });
        return object.head;
      }
      if (command.constructor.name === 'PutObjectCommand') {
        uploadCount += 1;
        const input = command.input;
        objects.set(input.Key, {
          body: Buffer.from(input.Body),
          head: {
            ContentLength: input.Body.length,
            ContentType: input.ContentType,
            CacheControl: input.CacheControl,
            Metadata: input.Metadata
          }
        });
        return {};
      }
      throw new Error(`Unexpected mock R2 command: ${command.constructor.name}`);
    }
  };

  try {
    const record = {
      canonicalId: 'HH-S-0042',
      illustrationSourcePath: sourcePath,
      illustrationSourceSha256: sha256(sourceBytes)
    };
    const first = await publishFreebieTitleArt([record], { client, bucket: 'test', libraryRoot, output: outputPath });
    const second = await publishFreebieTitleArt([record], { client, bucket: 'test', libraryRoot, output: outputPath });
    assert.equal(first.summary.uploadedCount, 1);
    assert.equal(second.summary.uploadedCount, 0);
    assert.equal(second.summary.unchangedCount, 1);
    assert.equal(uploadCount, 1);
    assert.equal(second.records[0].status, 'verified');
    assert.equal(second.records[0].key, 'Freebies/Title Art/HH-S-0042.webp');
    assert.equal(second.records[0].url, getTitleArtPublicUrl('HH-S-0042'));
    assert.ok(second.records[0].sizeBytes > 0);

    const attached = attachPublishedTitleArt([record], second);
    assert.equal(attached[0].illustrationPublished, true);
    assert.equal(attached[0].illustrationUrl, second.records[0].url);
    const staleRecord = { ...record, illustrationSourceSha256: '0'.repeat(64) };
    const stale = attachPublishedTitleArt([staleRecord], second);
    assert.equal(stale[0].illustrationPublished, false);
    assert.equal(stale[0].illustrationUrl, '');
    const absent = attachPublishedTitleArt([{ canonicalId: 'HH-R-0007' }], second);
    assert.equal(absent[0].illustrationUrl, '');
    assert.equal(fs.existsSync(path.join(tempRoot, 'generated', 'HH-S-0042.webp')), false);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.verifiedCount, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('requires an explicit apply flag for production publication commands', () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(['--apply']).apply, true);
});