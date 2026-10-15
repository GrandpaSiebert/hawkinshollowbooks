const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidBookId } = require('../scripts/validate-canonical-ids');

test('accepts established publication ID modes and preserves series distinctions', () => {
  for (const mode of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    assert.equal(isValidBookId(`HH-${mode}-0001`), true, `${mode} remains a valid single-letter mode`);
  }

  assert.equal(isValidBookId('HH-C+-0001'), true);
  assert.equal(isValidBookId('HH-HR-0001'), true);
  assert.notEqual('HH-C-0001', 'HH-C+-0001');
  assert.notEqual('HH-F-0001', 'HH-HR-0001');
});

test('rejects malformed publication IDs without accepting arbitrary mode prefixes', () => {
  const invalidIds = [
    'HHC-0001',
    'HH-C0001',
    'HH-C--0001',
    'HH-C-001',
    'HH-C-00001',
    'HH-C-00A1',
    'HH-C-0001-extra',
    'HH-UNKNOWN-0001',
    'XX-C-0001',
    'hh-C-0001',
    null,
    undefined
  ];

  for (const id of invalidIds) {
    assert.equal(isValidBookId(id), false, `${String(id)} must be rejected`);
  }
});
