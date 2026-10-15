const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const expectedGeneratedFiles = [
  'entity-graph.json',
  'entity-index.json',
  'public-discovery-index.json',
  'search-index.json'
].sort();

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

function collectObjectKeys(value, result = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjectKeys(entry, result));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      result.push(key);
      collectObjectKeys(nested, result);
    }
  }
  return result;
}

function anchors(document, result = []) {
  if (document.tagName === 'a') result.push(document);
  for (const child of document.childNodes || []) anchors(child, result);
  return result;
}

test('public generated output contains only visitor-facing allowlisted indexes', () => {
  const generatedDir = path.join(output, 'generated');
  const actual = fs.readdirSync(generatedDir).sort();
  assert.deepEqual(actual, expectedGeneratedFiles);

  const search = JSON.parse(fs.readFileSync(path.join(generatedDir, 'search-index.json'), 'utf8'));
  const entities = JSON.parse(fs.readFileSync(path.join(generatedDir, 'entity-index.json'), 'utf8'));
  const graph = JSON.parse(fs.readFileSync(path.join(generatedDir, 'entity-graph.json'), 'utf8'));
  const discovery = JSON.parse(fs.readFileSync(path.join(generatedDir, 'public-discovery-index.json'), 'utf8'));
  assert.equal(search.summary.byType.books, 79);
  assert.equal(search.summary.byType.songs, 500);
  assert.equal(search.summary.byType.nurseryRhymes, 500);
  assert.equal(search.records.filter((record) => record.type === 'book').length, 79);
  assert.equal(search.records.filter((record) => record.type === 'song').length, 500);
  assert.equal(search.records.filter((record) => record.type === 'rhyme').length, 500);
  assert.ok(entities.byType.environments.length > 0);
  assert.ok(entities.byType.landmarks.length > 0);
  assert.ok(graph.nodes.length > 0);
  assert.ok(graph.edges.length > 0);
  assert.ok(discovery.records.length > 0);
  assert.ok(discovery.facets.length > 0);

  for (const payload of [search, entities, graph, discovery]) {
    assert.ok(
      collectObjectKeys(payload).every((key) => !/^(?:source[A-Z]|manifest(?:[A-Z]|$)|publish(?:[A-Z]|$)|qa(?:[A-Z]|$)|reconciliation(?:[A-Z]|$)|production(?:[A-Z]|$)|filePath|sourcePath|r2(?:[A-Z]|$))/i.test(key)),
      'public JSON fields must not expose source or production metadata'
    );
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /(?:Books|Characters|Relationships|Environments|Landmarks|Freebies)[\\/][^"'<>\s]*\.(?:docx|pdf|xlsx)/i);
    assert.doesNotMatch(serialized, /(?:C:\\Users\\|OneDrive|Amazon KDP Info\.xlsx|publish-state|manifest\/manifest)/i);
  }

  assert.ok(graph.nodes.every((node) => !Object.hasOwn(node, 'provenance')));
  assert.ok(graph.edges.every((edge) => !Object.hasOwn(edge, 'provenance') && !Object.hasOwn(edge, 'mention')));
  assert.ok(!Object.hasOwn(entities, 'entities'));
  assert.ok(!Object.hasOwn(entities, 'sourceDocumentsByType'));
});

test('public pages do not embed developer provenance or source document paths', () => {
  const htmlFiles = walkFiles(output).filter((filePath) => filePath.toLowerCase().endsWith('.html'));
  for (const filePath of htmlFiles) {
    const html = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(html, /Developer Provenance Panel|Developer Mode:|sourceDocuments?:|sourceArtifact:/i, path.relative(output, filePath));
    assert.doesNotMatch(html, /(?:Books|Characters|Relationships|Environments|Landmarks|Freebies)[\\/][^"'<>\s]*\.(?:docx|pdf|xlsx)/i, path.relative(output, filePath));
  }
});

test('visitor pages fetch only generated artifacts included in the public allowlist', () => {
  const fetchedArtifacts = new Set();
  for (const filePath of walkFiles(output).filter((candidate) => candidate.toLowerCase().endsWith('.html'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/fetch\(['"]generated\/([^'"]+)['"]/g)) fetchedArtifacts.add(match[1]);
  }
  assert.deepEqual(Array.from(fetchedArtifacts).sort(), [
    'entity-graph.json',
    'entity-index.json',
    'search-index.json'
  ]);
});
