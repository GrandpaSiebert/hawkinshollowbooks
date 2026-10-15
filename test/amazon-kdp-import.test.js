const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { writeAmazonKdpArtifact } = require('../scripts/amazon-kdp-import');

function createWorkbookFixture(directory) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['ID', 'Title', ' Status ', 'Paperback ASIN'],
    [' hh-a-0001 ', 'First Book', '  LiVe ', 'b012345678'],
    ['HH-A-0002', 'Draft Book', ' dRaFt ', '']
  ]), 'Mode A');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Book ID', 'Book Title', 'Publication status'],
    ['HH-B-0001', 'Second Book', ' LIVE '],
    ['HH-B-0002', 'Unpublished Book', '']
  ]), 'Mode B');
  XLSX.writeFile(workbook, path.join(directory, 'Amazon KDP Info.xlsx'));
}

test('KDP importer reads every worksheet and normalizes canonical IDs and publication status', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-kdp-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  createWorkbookFixture(directory);

  const result = writeAmazonKdpArtifact(directory);
  const imported = JSON.parse(fs.readFileSync(result.outputPath, 'utf8'));

  assert.equal(result.summary.recordCount, 4);
  assert.equal(result.summary.liveCount, 2);
  assert.deepEqual(imported.records.map(({ id }) => id), [
    'HH-A-0001', 'HH-A-0002', 'HH-B-0001', 'HH-B-0002'
  ]);
  assert.deepEqual(imported.liveRecords.map(({ id }) => id), ['HH-A-0001', 'HH-B-0001']);
  assert.equal(imported.records.find(({ id }) => id === 'HH-A-0001').status, 'live');
  assert.equal(imported.records.find(({ id }) => id === 'HH-A-0002').status, 'draft');
  assert.equal(imported.records.find(({ id }) => id === 'HH-B-0002').status, '');
});

test('KDP importer reports an absent workbook without manufacturing publication records', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-kdp-import-missing-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const result = writeAmazonKdpArtifact(directory);
  assert.equal(result.summary.missingWorkbook, true);
  assert.equal(result.summary.liveCount, 0);
  assert.equal(result.outputPath, null);
});
