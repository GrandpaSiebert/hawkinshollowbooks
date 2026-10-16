const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { loadBookDiscoveryAnnotations } = require('../scripts/discovery-book-annotations');
const { createPublicDiscoveryIndex } = require('../scripts/public-discovery-index');
const { classifyDiscovery } = require('../scripts/visitor-discovery');

function fixture(t) {
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-book-review-'));
  t.after(() => fs.rmSync(libraryRoot, { recursive: true, force: true }));
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:p><w:r><w:t>I feel </w:t></w:r><w:r><w:t>grumpy.</w:t></w:r></w:p></w:body></w:document>'));
  const bytes = zip.toBuffer();
  fs.writeFileSync(path.join(libraryRoot, 'book.docx'), bytes);
  const data = { version: 1, records: [{ id: 'HH-D-0001', sourceDocument: 'book.docx', sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), review: { method: 'Full narrative reading', categories: { feeling: { status: 'reviewed', labels: [{ label: 'Grumpy', confidence: 'explicit', significance: 'central', rationale: 'The sustained opening feeling.', evidence: [{ paragraph: 0, page: 1, quote: 'I feel grumpy.' }] }] } } } }] };
  return { libraryRoot, data, eligibleBookIds: new Set(['HH-D-0001']) };
}

test('review evidence survives Word formatting runs; quotations and significance are required', t => {
  const input = fixture(t);
  assert.deepEqual(loadBookDiscoveryAnnotations(input).tagsById.get('HH-D-0001'), [{ kind: 'feeling', label: 'Grumpy' }]);
  const label = input.data.records[0].review.categories.feeling.labels[0];
  label.evidence[0].quote = 'I feel happy.';
  assert.throws(() => loadBookDiscoveryAnnotations(input), /does not match manuscript/);
  label.evidence[0].quote = 'I feel grumpy.';
  label.significance = 'incidental';
  assert.throws(() => loadBookDiscoveryAnnotations(input), /Invalid review evidence/);
});

test('changed or missing sources withhold stale classifications; non-public books never project', t => {
  const input = fixture(t);
  fs.appendFileSync(path.join(input.libraryRoot, 'book.docx'), 'changed');
  let result = loadBookDiscoveryAnnotations(input);
  assert.equal(result.tagsById.size, 0);
  assert.equal(result.report.withheld[0].reason, 'source-changed');
  fs.unlinkSync(path.join(input.libraryRoot, 'book.docx'));
  result = loadBookDiscoveryAnnotations(input);
  assert.equal(result.report.withheld[0].reason, 'source-missing');
  input.eligibleBookIds.clear();
  assert.equal(loadBookDiscoveryAnnotations(input).report.reviewedBooks, 0);
});

test('review sources cannot escape Library and inferred ages cannot become filters', t => {
  const input = fixture(t);
  input.data.records[0].sourceDocument = '../outside.docx';
  assert.throws(() => loadBookDiscoveryAnnotations(input), /source path/);
  input.data.records[0].sourceDocument = 'book.docx';
  const category = input.data.records[0].review.categories.feeling;
  input.data.records[0].review.categories = { age: category };
  category.labels[0].label = 'Ages 4–8';
  category.labels[0].confidence = 'strongly-implied';
  assert.throws(() => loadBookDiscoveryAnnotations(input), /Invalid review evidence/);
});

test('annotations fill missing book categories, preserve existing authority and never classify songs', () => {
  const records = [{ type: 'book', id: 'HH-D-0001', title: 'Book', href: 'books/book.html' }, { type: 'song', id: 'HH-D-0001', title: 'Song', href: 'song.html' }];
  const metadata = new Map([['HH-D-0001', { feelings: ['Sad'] }]]);
  const annotations = new Map([['HH-D-0001', [{ kind: 'feeling', label: 'Grumpy' }, { kind: 'activity', label: 'Taking turns' }]]]);
  const index = createPublicDiscoveryIndex(records, { entities: [] }, { edges: [] }, [], [], new Map(), metadata, annotations);
  assert.deepEqual(index.records[0].tags, [{ kind: 'feeling', label: 'Sad' }, { kind: 'activity', label: 'Taking turns' }]);
  assert.ok(!index.records[1].tags.some(tag => tag.kind === 'activity'));
  const noLabel = createPublicDiscoveryIndex(records.slice(0, 1), { entities: [] }, {}, [], [], new Map(), new Map(), new Map());
  assert.equal(classifyDiscovery(noLabel.records[0], { facets: { feeling: 'Grumpy' } }), 'unclassified');
});

test('the completed book review is supported by current canonical files, including the visually read PDF', () => {
  const data = require('../data/discovery-book-annotations.json');
  const result = loadBookDiscoveryAnnotations({ libraryRoot: path.join(__dirname, '..', 'Library'), data, eligibleBookIds: new Set(data.records.map(record => record.id)) });
  assert.equal(result.report.reviewedBooks, 79);
  assert.deepEqual(result.report.withheld, []);
  assert.equal(result.report.categories.feeling.labeledBooks, 47);
  assert.equal(result.report.categories.feeling.withoutLabel, 24);
  assert.equal(result.report.categories.activity.labeledBooks, 64);
  assert.ok(result.tagsById.get('HH-D-0001').some(tag => tag.label === 'Grumpy'));
  assert.ok(result.tagsById.get('HH-F-0009').some(tag => tag.label === 'Patriot Day'));
  assert.ok(!result.tagsById.get('HH-E-0004').some(tag => tag.label === 'Happy'));
});
