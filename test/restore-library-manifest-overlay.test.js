const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { test } = require('node:test');
const { restoreLibraryCanon, parseArgs } = require('../scripts/restore-library-canon');

test('restore accepts a locally reconciled manifest and reads objects without writing to R2', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-manifest-overlay-'));
  try {
    const manifestPath = path.join(root, 'reconciled.json');
    const destination = path.join(root, 'Library');
    const documentKey = 'books/example/hh-a-0001-story-master.docx';
    fs.writeFileSync(manifestPath, JSON.stringify({
      records: [{
        id: 'HH-A-0001',
        assets: [
          {
            role: 'book',
            key: documentKey,
            sourcePath: 'Books/HH-A-0001 A Story/HH-A-0001 Story Master.docx'
          },
          {
            role: 'book',
            key: 'books/example/hh-a-0001-cover.png',
            sourcePath: 'Books/HH-A-0001 A Story/HH-A-0001 Cover.png'
          }
        ]
      }]
    }));
    const sourceDocument = Buffer.from('read-only object body');
    const calls = [];
    const r2Client = {
      async send(command) {
        calls.push(command.constructor.name);
        if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [] };
        if (command.constructor.name === 'GetObjectCommand') {
          assert.equal(command.input.Key, documentKey);
          return { Body: Readable.from([sourceDocument]) };
        }
        throw new Error(`Unexpected R2 operation ${command.constructor.name}`);
      }
    };

    await restoreLibraryCanon({
      manifestFile: manifestPath,
      destination,
      credentials: { configured: false },
      r2Client,
      bucket: 'test-bucket'
    });

    assert.deepEqual(calls, ['ListObjectsV2Command', 'GetObjectCommand']);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'Books', 'HH-A-0001 A Story', 'HH-A-0001 Story Master.docx')), sourceDocument);
    assert.equal(fs.statSync(path.join(destination, 'Books', 'HH-A-0001 A Story', 'HH-A-0001 Cover.png')).size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore CLI recognizes an explicit local manifest-file option', () => {
  const parsed = parseArgs(['--manifest-file', 'generated/reconciled.json']);
  assert.equal(parsed.manifestFile, path.resolve('generated/reconciled.json'));
});

test('restore reads an explicitly mapped review PDF omitted by the manifest and verifies its original bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-review-source-'));
  try {
    const destination = path.join(root, 'Library');
    const requiredSourceMap = path.join(root, 'required.json');
    const sourcePath = 'Books/HH-F-0009 Original/Original’s Book.pdf';
    const key = 'books/original/published-book.pdf';
    const bytes = Buffer.from('%PDF-1.7 original reviewed source');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(requiredSourceMap, JSON.stringify([{ sourcePath, key, sha256, sizeBytes: bytes.length }]));
    const manifest = { records: [{ assets: [{ sourcePath: 'Books/Story/HH-F-0009 Story Master.docx', key: 'books/story-master.docx' }] }] };
    const calls = [];
    let pdfBytes = bytes;
    const r2Client = { async send(command) {
      calls.push([command.constructor.name, command.input.Key]);
      if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [] };
      assert.equal(command.constructor.name, 'GetObjectCommand', 'restoration is read-only');
      if (command.input.Key === 'manifest/manifest.json') return { Body: Readable.from([Buffer.from(JSON.stringify(manifest))]) };
      if (command.input.Key === 'books/story-master.docx') return { Body: Readable.from([Buffer.from('canonical DOCX')]) };
      assert.equal(command.input.Key, key, 'use the explicit stored key, never reconstruct it from a filename');
      if (!pdfBytes) throw Error('NoSuchKey');
      return { Body: Readable.from([pdfBytes]) };
    } };
    const options = { destination, requiredSourceMap, r2Only: true, r2Client, credentials: { configured: false } };
    await restoreLibraryCanon(options);
    const restored = path.join(destination, ...sourcePath.split('/'));
    assert.deepEqual(fs.readFileSync(restored), bytes);
    assert.equal(calls.filter(([operation, objectKey]) => operation === 'GetObjectCommand' && objectKey === key).length, 1);
    pdfBytes = Buffer.from(bytes);
    pdfBytes[pdfBytes.length - 1] ^= 1;
    await assert.rejects(restoreLibraryCanon(options), /size or SHA-256 does not match/);
    assert.deepEqual(fs.readFileSync(restored), bytes, 'a mismatched source must not replace the verified original');
    pdfBytes = null;
    await assert.rejects(restoreLibraryCanon(options), /NoSuchKey/);
    assert.deepEqual(fs.readFileSync(restored), bytes, 'missing storage objects must fail without fallback data');
    await assert.rejects(restoreLibraryCanon({ ...options, publicOnly: true, r2Only: false }), /explicit R2-only/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release PDF source mapping preserves the existing review fingerprint and requires explicit R2 restoration', () => {
  const mapped = require('../data/discovery-review-source-objects.json');
  const reviews = require('../data/discovery-book-annotations.json');
  for (const source of mapped) {
    const review = reviews.records.find(record => record.sourceDocument === source.sourcePath);
    assert.ok(review);
    assert.equal(source.sha256, review.sourceSha256);
  }
  const parsed = parseArgs(['--r2-only', '--required-source-map', 'data/discovery-review-source-objects.json']);
  assert.equal(parsed.requiredSourceMap, path.resolve('data/discovery-review-source-objects.json'));
  assert.throws(() => parseArgs(['--required-source-map', 'data/discovery-review-source-objects.json']), /requires --r2-only/);
});

test('public-only restore ignores configured R2 credentials and uses only public GET requests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-public-restore-'));
  const destination = path.join(root, 'Library');
  const originalFetch = global.fetch;
  const calls = [];
  const documentBytes = Buffer.from('public canonical source');
  const manifestUrl = 'https://library.hawkinshollowbooks.com/manifest/manifest.json';
  const documentUrl = 'https://library.hawkinshollowbooks.com/books/story-master.docx';
  global.fetch = async (url) => {
    calls.push(url);
    if (url === manifestUrl) {
      return {
        ok: true,
        json: async () => ({
          records: [{
            assets: [{
              key: 'books/story-master.docx',
              sourcePath: 'Characters/Story Master.docx',
              url: documentUrl
            }]
          }]
        })
      };
    }
    if (url === documentUrl) {
      return {
        ok: true,
        arrayBuffer: async () => documentBytes.buffer.slice(
          documentBytes.byteOffset,
          documentBytes.byteOffset + documentBytes.byteLength
        )
      };
    }
    throw new Error(`Unexpected public URL: ${url}`);
  };

  try {
    await restoreLibraryCanon({
      baseUrl: 'https://library.hawkinshollowbooks.com',
      destination,
      publicOnly: true,
      credentials: { configured: true, accountId: 'unused', accessKeyId: 'unused', secretAccessKey: 'unused' },
      r2Client: { send: async () => { throw new Error('Public-only restore must not use the R2 API.'); } }
    });
    assert.deepEqual(calls, [manifestUrl, documentUrl]);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'Characters', 'Story Master.docx')), documentBytes);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pages-only restore fetches requested canonical front covers read-only and validates bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-cover-source-'));
  try {
    const manifestPath = path.join(root, 'reconciled.json');
    const destination = path.join(root, 'Library');
    const documentKey = 'books/example/hh-a-0001-story-master.docx';
    const coverKey = 'books/example/hh-a-0001-story-cover.png';
    const coverPath = 'Books/HH-A-0001 A Story/HH-A-0001 The Story Cover.png';
    const coverBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7+8AAAAASUVORK5CYII=',
      'base64'
    );
    const coverSha256 = crypto.createHash('sha256').update(coverBytes).digest('hex');
    fs.writeFileSync(manifestPath, JSON.stringify({
      records: [{
        id: 'HH-A-0001',
        assets: [
          {
            role: 'book',
            key: documentKey,
            sourcePath: 'Books/HH-A-0001 A Story/HH-A-0001 Story Master.docx'
          },
          {
            role: 'book',
            key: coverKey,
            sourcePath: coverPath,
            sha256: coverSha256,
            sizeBytes: coverBytes.length
          }
        ]
      }]
    }));
    const sourceDocument = Buffer.from('read-only object body');
    const calls = [];
    const r2Client = {
      async send(command) {
        calls.push(command.constructor.name);
        if (command.constructor.name === 'ListObjectsV2Command') return { Contents: [] };
        if (command.constructor.name === 'GetObjectCommand') {
          if (command.input.Key === documentKey) return { Body: Readable.from([sourceDocument]) };
          if (command.input.Key === coverKey) return { Body: Readable.from([coverBytes]) };
        }
        throw new Error(`Unexpected R2 operation ${command.constructor.name}`);
      }
    };
    const coverOutputPath = path.join(destination, ...coverPath.split('/'));
    fs.mkdirSync(path.dirname(coverOutputPath), { recursive: true });
    fs.writeFileSync(coverOutputPath, Buffer.alloc(0));

    await restoreLibraryCanon({
      manifestFile: manifestPath,
      destination,
      credentials: { configured: false },
      r2Client,
      coverSourceIds: ['HH-A-0001'],
      bucket: 'test-bucket'
    });

    assert.deepEqual(calls, ['ListObjectsV2Command', 'GetObjectCommand', 'GetObjectCommand']);
    assert.deepEqual(fs.readFileSync(coverOutputPath), coverBytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restore CLI accepts explicit canonical cover-source IDs', () => {
  const parsed = parseArgs([
    '--r2-only',
    '--cover-source-id',
    'HH-B-0002',
    '--cover-source-id',
    'HH-D-0001'
  ]);
  assert.deepEqual(parsed.coverSourceIds, ['HH-B-0002', 'HH-D-0001']);
});
