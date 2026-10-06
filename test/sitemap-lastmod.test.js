const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ORIGIN,
  createSnapshot,
  finalizeDeployment,
  makeState,
  snapshotFromBuild
} = require('../scripts/indexnow-deployment');
const {
  BASELINE_MEANING,
  assertBootstrapState,
  createBaselineLedger,
  reconcileLedger,
  validateLedger,
  validateSeedBaseline
} = require('../scripts/sitemap-lastmod-ledger');
const { addLastmodToSitemap } = require('../scripts/sitemap-lastmod');

const root = path.join(__dirname, '..');
const baselinePath = path.join(root, 'data', 'sitemap-lastmod-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const page = (name, content = name) => ({ url: `${ORIGIN}/${name}.html`, fingerprint: hash(content) });
const provenance = {
  deploymentSha: '1'.repeat(40),
  runId: '10',
  snapshotId: '2'.repeat(64),
  trackingDate: '2026-10-05'
};

function fixtureLedger(...pages) {
  const snapshot = createSnapshot(pages);
  return createBaselineLedger(snapshot.pages, { ...provenance, snapshotId: snapshot.id });
}

test('checked-in tracking baseline exactly hashes all 1392 URLs from the deployed Stage 4D seed snapshot', () => {
  validateSeedBaseline(baseline);
  const snapshot = createSnapshot(baseline.entries.map(({ url, fingerprint }) => ({ url, fingerprint })));
  assert.equal(baseline.entries.length, 1392);
  assert.equal(snapshot.id, '988c818c4e5df2bd5dd768180ca8b7fd90d8900a2d51d4b1ad05c43e0f1bb41d');
  assert.equal(snapshot.id, baseline.baseline.snapshotId);
  assert.equal(baseline.baseline.deploymentSha, '50765cea0faacea8d62215e2d629974299262ef9');
  assert.equal(baseline.baseline.runId, '37312228527');
  assert.equal(baseline.baseline.trackingDate, '2026-10-05');
  assert.equal(baseline.baseline.meaning, BASELINE_MEANING);

  const sitemap = fs.readFileSync(path.join(root, 'build-recovery', 'sitemap.xml'), 'utf8');
  const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1].replace(/&amp;/g, '&')).sort();
  assert.deepEqual(baseline.entries.map((entry) => entry.url), urls);
});

test('initial tracking dates remain stable on unchanged rebuilds and bootstrap cannot reset an advanced ledger', () => {
  const pages = [page('alpha'), page('beta')];
  const seed = fixtureLedger(...pages);
  const firstBuild = reconcileLedger(pages, seed);
  const secondBuild = reconcileLedger(pages.slice().reverse(), firstBuild);
  assert.deepEqual(secondBuild.entries, firstBuild.entries);
  assert.ok(secondBuild.entries.every((entry) => entry.lastmod === '2026-10-05'));

  const changedPages = [page('alpha', 'revised'), pages[1]];
  const advanced = reconcileLedger(changedPages, firstBuild, '2026-10-06');
  const currentSnapshot = createSnapshot(changedPages);
  const advancedState = makeState(currentSnapshot, '3'.repeat(40), '11', [], advanced);
  assert.strictEqual(assertBootstrapState(advancedState, seed), advanced);
  assert.notDeepEqual(advanced.entries, seed.entries);
});

test('unchanged pages preserve dates while a changed page and a new page receive the supplied deployment date', () => {
  const before = fixtureLedger(page('same'), page('changed', 'old'), page('removed'));
  const current = [page('same'), page('changed', 'new'), page('added')];
  const next = reconcileLedger(current, before, '2026-10-06');
  const byUrl = new Map(next.entries.map((entry) => [entry.url, entry]));
  assert.equal(byUrl.get(`${ORIGIN}/same.html`).lastmod, '2026-10-05');
  assert.equal(byUrl.get(`${ORIGIN}/changed.html`).lastmod, '2026-10-06');
  assert.equal(byUrl.get(`${ORIGIN}/added.html`).lastmod, '2026-10-06');
  assert.equal(byUrl.has(`${ORIGIN}/removed.html`), false);
});

test('enumeration order cannot affect reconciled ledger dates or bytes', () => {
  const pages = [page('zeta'), page('alpha'), page('middle')];
  const seed = fixtureLedger(...pages);
  const first = reconcileLedger(pages, seed);
  const second = reconcileLedger(pages.slice().reverse(), seed);
  assert.deepEqual(first, second);
  assert.deepEqual(first.entries.map((entry) => entry.url), first.entries.map((entry) => entry.url).slice().sort());
});

test('unknown changes, mismatched fingerprints, and corrupt or missing provenance fail closed', () => {
  const seed = fixtureLedger(page('known'));
  assert.throws(() => reconcileLedger([page('known', 'changed')], seed), /no successful-deployment date/);
  assert.throws(() => reconcileLedger([page('known', 'changed')], seed, '2026-10-04'), /precedes/);
  assert.throws(() => reconcileLedger([page('known')], null), /missing, corrupt, or incompatible ledger/);
  assert.throws(() => validateLedger({ ...seed, baseline: { ...seed.baseline, snapshotId: 'bad' } }), /provenance/);
  assert.throws(() => validateSeedBaseline({
    ...seed,
    entries: [{ ...seed.entries[0], fingerprint: 'f'.repeat(64) }]
  }), /do not match their successful-deployment snapshot provenance/);
  assert.throws(() => validateLedger({
    ...seed,
    entries: [{ ...seed.entries[0], fingerprint: 'f'.repeat(64) }]
  }, seed.entries), /fingerprint provenance/);

  const mismatch = {
    deploymentSha: '9'.repeat(40),
    runId: '99',
    snapshot: { id: '8'.repeat(64), pages: seed.entries.map(({ url, fingerprint }) => ({ url, fingerprint })) }
  };
  assert.throws(() => assertBootstrapState(mismatch, seed), /does not match the one-time tracking baseline/);
});

test('sitemap output has one lastmod per URL without changing Stage 4C page fingerprints', () => {
  const url = `${ORIGIN}/story.html`;
  const onePage = fixtureLedger({ url, fingerprint: hash('representation') });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n  <url>\n    <loc>${url}</loc>\n  </url>\n</urlset>\n`;
  const withLastmod = addLastmodToSitemap(xml, onePage);
  assert.equal(Array.from(withLastmod.matchAll(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)).length, 1);
  assert.match(withLastmod, /<lastmod>2026-10-05<\/lastmod>/);
  assert.throws(() => addLastmodToSitemap(`${xml}${xml}`, onePage), /Duplicate sitemap URL/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-lastmod-fingerprint-'));
  try {
    fs.writeFileSync(path.join(directory, 'sitemap.xml'), xml);
    fs.writeFileSync(path.join(directory, 'story.html'),
      `<!DOCTYPE html><html><head><title>Story</title><link rel="canonical" href="${url}"></head><body><h1>Story</h1></body></html>`);
    const before = snapshotFromBuild(directory);
    fs.writeFileSync(path.join(directory, 'sitemap.xml'), withLastmod);
    const after = snapshotFromBuild(directory);
    assert.equal(after.id, before.id);
    assert.deepEqual(after.pages, before.pages);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Stage 4C state validates and retains only a ledger matching its successful snapshot', () => {
  const pages = [page('state-page')];
  const snapshot = createSnapshot(pages);
  const ledger = createBaselineLedger(pages, { ...provenance, snapshotId: snapshot.id });
  const state = makeState(snapshot, '4'.repeat(40), '12', [], ledger);
  assert.deepEqual(state.lastmod, ledger);
  assert.throws(() => makeState(snapshot, '4'.repeat(40), '12', [], {
    ...ledger,
    entries: [{ ...ledger.entries[0], fingerprint: 'a'.repeat(64) }]
  }), /fingerprint provenance/);
});

test('lastmod state advances only after the Pages deployment is successful', async () => {
  const pages = [page('deployed-page')];
  const snapshot = createSnapshot(pages);
  const previous = makeState(snapshot, '5'.repeat(40), '13', []);
  const candidate = createBaselineLedger(pages, { ...provenance, snapshotId: snapshot.id });

  const failed = await finalizeDeployment({
    current: snapshot,
    previousState: previous,
    deploymentSha: '6'.repeat(40),
    runId: '14',
    buildSucceeded: true,
    deploymentSucceeded: false,
    lastmod: candidate
  });
  assert.equal(failed.status, 'not-deployed');
  assert.strictEqual(failed.state, previous);
  assert.equal(Object.hasOwn(failed.state, 'lastmod'), false);

  const succeeded = await finalizeDeployment({
    current: snapshot,
    previousState: previous,
    deploymentSha: '6'.repeat(40),
    runId: '14',
    buildSucceeded: true,
    deploymentSucceeded: true,
    lastmod: candidate
  });
  assert.deepEqual(succeeded.state.lastmod, candidate);
});
