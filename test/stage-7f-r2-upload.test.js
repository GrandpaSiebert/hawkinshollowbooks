const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { uploadOne, runUpload } = require('../scripts/stage-7f-r2-upload');

function makeCandidate(directory) {
  const body = Buffer.from('verified bytes for a scoped upload');
  const sourcePath = path.join(directory, 'source.bin');
  fs.writeFileSync(sourcePath, body);
  return {
    ownerCanonicalId: 'HH-S-0110',
    destinationR2Key: 'books/example/allowed-key.bin',
    sizeBytes: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    _sourcePath: sourcePath,
    _contentType: 'application/octet-stream'
  };
}

test('Stage 7F upload refuses a key that appeared after preflight', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-stage-7f-'));
  try {
    const candidate = makeCandidate(directory);
    const calls = [];
    const client = {
      async send(command) {
        calls.push(command.constructor.name);
        return { ContentLength: candidate.sizeBytes, Metadata: { sha256: candidate.sha256 } };
      }
    };

    const result = await uploadOne(client, 'bucket', candidate);
    assert.deepEqual(result, { key: candidate.destinationR2Key, status: 'skipped-present-conflict' });
    assert.deepEqual(calls, ['HeadObjectCommand']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Stage 7F upload uses conditional create and verifies successful writes with a fresh HEAD', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-stage-7f-'));
  try {
    const candidate = makeCandidate(directory);
    const calls = [];
    let putCommand;
    const client = {
      async send(command) {
        calls.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') {
          putCommand = command;
          return {};
        }
        if (calls.filter((name) => name === 'HeadObjectCommand').length === 1) {
          return null;
        }
        return {
          ContentLength: candidate.sizeBytes,
          Metadata: { sha256: candidate.sha256 }
        };
      }
    };

    const result = await uploadOne(client, 'bucket', candidate);
    assert.deepEqual(result, { key: candidate.destinationR2Key, status: 'uploaded-and-verified' });
    assert.deepEqual(calls, ['HeadObjectCommand', 'PutObjectCommand', 'HeadObjectCommand']);
    assert.equal(putCommand.input.IfNoneMatch, '*');
    assert.equal(putCommand.input.Key, candidate.destinationR2Key);
    assert.equal(putCommand.input.Metadata.sha256, candidate.sha256);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Stage 7F upload refuses to start without the explicit owner authorization flag', async () => {
  await assert.rejects(
    runUpload({ ownerAuthorized: false }),
    /explicit owner authorization flag is required/
  );
});
