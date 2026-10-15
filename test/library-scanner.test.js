const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanLibrary, writeLibraryArtifacts } = require('../scripts/library-scanner');

test('missing Library is reported explicitly instead of producing an empty authoritative index', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-missing-library-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = writeLibraryArtifacts(root);
  const scan = JSON.parse(fs.readFileSync(result.scanPath, 'utf8'));
  const index = JSON.parse(fs.readFileSync(result.indexPath, 'utf8'));

  assert.equal(result.missingLibrary, true);
  assert.equal(scan.missingLibrary, true);
  assert.equal(index.missingLibrary, true);
  assert.deepEqual(index.books, []);
});

test('library scanner assigns abbreviated folder IDs to their zero-padded canonical Book ID', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-library-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const range = path.join(root, 'Library', 'Books', 'HH-F Holiday Story Poems', 'HH-F-0001-0010');
  const firstBook = path.join(range, 'HH-F-0001 First Book');
  const abbreviatedBook = path.join(range, 'HH-F-008 Eighth Book');
  fs.mkdirSync(firstBook, { recursive: true });
  fs.mkdirSync(abbreviatedBook, { recursive: true });
  fs.writeFileSync(path.join(firstBook, 'HH-F-0001 First Book.pdf'), '');
  fs.writeFileSync(path.join(abbreviatedBook, 'Eighth Book.pdf'), '');
  fs.writeFileSync(path.join(abbreviatedBook, 'Cover.png'), '');

  const { index } = scanLibrary(root);
  const first = index.books.find((book) => book.id === 'HH-F-0001');
  const eighth = index.books.find((book) => book.id === 'HH-F-0008');

  assert.ok(first);
  assert.ok(eighth);
  assert.equal(first.title, 'First Book');
  assert.equal(eighth.title, 'Eighth Book');
  assert.deepEqual(first.files, [
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-0001 First Book/HH-F-0001 First Book.pdf'
  ]);
  assert.deepEqual(eighth.files, [
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-008 Eighth Book/Cover.png',
    'Books/HH-F Holiday Story Poems/HH-F-0001-0010/HH-F-008 Eighth Book/Eighth Book.pdf'
  ]);
});

test('book-folder identity takes precedence over a conflicting ID in an asset filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-library-folder-authority-'));
  try {
    const ownerFolder = path.join(
      root,
      'Library',
      'Books',
      'HH-C Second Readers',
      'HH-C-0001-0010',
      'HH-C-0006 Bentley’s First Week in the Nest'
    );
    fs.mkdirSync(ownerFolder, { recursive: true });
    fs.writeFileSync(
      path.join(ownerFolder, 'Companion Resource Package — HH-C-0005 Aralynn Fox’s Rights Trail.docx'),
      ''
    );

    const { index } = scanLibrary(root);
    const owner = index.books.find((book) => book.id === 'HH-C-0006');
    const filenameId = index.books.find((book) => book.id === 'HH-C-0005');

    assert.ok(owner.files.some((file) => file.includes('Companion Resource Package — HH-C-0005')));
    assert.equal(filenameId, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
