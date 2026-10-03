const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { spawnSync } = require('child_process');
const {
  ORIGIN, PUBLIC_KEY, KEY_LOCATION, ENDPOINT, canonicalPageUrl, fingerprintPage, createSnapshot,
  snapshotFromBuild, makeState, planDelta, classifyResponse, finalizeDeployment, restoreProductionState
} = require('../scripts/indexnow-deployment');

const oldSha = '1'.repeat(40);
const newSha = '2'.repeat(40);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const page = (name, content = name) => ({ url: `${ORIGIN}/${name}.html`, fingerprint: hash(content) });
const snapshot = (...pages) => createSnapshot(pages);
const state = (current, pending = []) => makeState(current, oldSha, '1', pending);

function html(url, text = 'Welcome', extra = '') {
  return `<!DOCTYPE html><html><head><title>Hawkins Hollow</title><link rel="canonical" href="${url}">${extra}</head><body><main>${text}</main></body></html>`;
}

function network(status = 200, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return { status: url === KEY_LOCATION ? 200 : status, statusText: 'mock response',
      text: async () => url === KEY_LOCATION ? PUBLIC_KEY : 'Private response material must not enter receipts.' };
  };
}

test('first deployment establishes 1499 canonical pages without sending any requests', async () => {
  const current = createSnapshot(Array.from({ length: 1499 }, (_, index) => page(`page-${index}`)));
  const calls = [];
  const checkpoints = [];
  const result = await finalizeDeployment({ current, deploymentSha: newSha, runId: '2', buildSucceeded: true,
    deploymentSucceeded: true, fetchImpl: network(200, calls), checkpoint: async (next) => checkpoints.push(next) });
  assert.equal(result.status, 'baseline-established');
  assert.equal(result.receipt.submittedUrlCount, 0);
  assert.equal(result.receipt.batchCount, 0);
  assert.equal(result.receipt.counts.unchanged, 1499);
  assert.equal(result.state.snapshot.pages.length, 1499);
  assert.deepEqual(calls, []);
  assert.equal(checkpoints.length, 1);
});

test('one added canonical page is exactly one added candidate', () => {
  const plan = planDelta(snapshot(page('old'), page('new')), state(snapshot(page('old'))));
  assert.deepEqual(plan.counts, { added: 1, updated: 0, deleted: 0, unchanged: 1 });
  assert.deepEqual(plan.candidates.map((entry) => entry.url), [`${ORIGIN}/new.html`]);
});

test('one material page update is exactly one updated candidate', () => {
  const plan = planDelta(snapshot(page('story', 'new text')), state(snapshot(page('story', 'old text'))));
  assert.deepEqual(plan.counts, { added: 0, updated: 1, deleted: 0, unchanged: 0 });
  assert.equal(plan.candidates.length, 1);
});

test('unchanged public content produces no candidate', () => {
  const current = snapshot(page('story'));
  const plan = planDelta(current, state(current));
  assert.equal(plan.counts.unchanged, 1);
  assert.deepEqual(plan.candidates, []);
});

test('deleted canonical page is retained from the previous successful snapshot', () => {
  const plan = planDelta(snapshot(page('kept')), state(snapshot(page('kept'), page('removed'))));
  assert.deepEqual(plan.counts, { added: 0, updated: 0, deleted: 1, unchanged: 1 });
  assert.equal(plan.candidates[0].url, `${ORIGIN}/removed.html`);
  assert.equal(plan.candidates[0].operation, 'deleted');
});

test('mixed content delta counts added updated deleted and unchanged independently', () => {
  const before = snapshot(page('kept'), page('changed', 'old'), page('removed'));
  const after = snapshot(page('kept'), page('changed', 'new'), page('added'));
  const plan = planDelta(after, state(before));
  assert.deepEqual(plan.counts, { added: 1, updated: 1, deleted: 1, unchanged: 1 });
  assert.equal(plan.candidates.length, 3);
});

test('pending retry and new update of the same URL deduplicate to one candidate', () => {
  const before = snapshot(page('changed', 'old'));
  const pending = { ...page('changed', 'old'), operation: 'updated' };
  const plan = planDelta(snapshot(page('changed', 'new')), state(before, [pending, pending]));
  assert.equal(plan.candidates.length, 1);
});

for (const rejected of ['https://grandpasiebert.github.io/story.html', 'https://library.hawkinshollowbooks.com/story.html',
  'https://example.r2.dev/story.html', 'http://localhost/story.html', 'http://hawkinshollowbooks.com/story.html',
  `${ORIGIN}/story.html?preview=true`, `${ORIGIN}/story.html#characters`]) {
  test(`reject non-production or noncanonical URL ${rejected}`, () => assert.throws(() => canonicalPageUrl(rejected)));
}

test('assets infrastructure verification files and compatibility routes are rejected', () => {
  for (const route of ['/image.webp', '/image.jpg', '/image.png', '/styles.css', '/script.js', '/sitemap.xml',
    '/assets/example.html', '/generated/search-index.json', '/the-porch-light.html', '/google0022909b14d1ddac.html',
    '/books/HH-S-0001-old-route.html', '/books/HH-R-0001-old-route.html', '/entities/book/hh-s-0001-old.html']) {
    assert.throws(() => canonicalPageUrl(`${ORIGIN}${route}`), route);
  }
});

test('noindex pages and non-self-canonical pages cannot enter a fingerprint snapshot', () => {
  const url = `${ORIGIN}/story.html`;
  assert.throws(() => fingerprintPage(html(url, 'Welcome', '<meta name="robots" content="noindex, follow">'), url));
  assert.throws(() => fingerprintPage(html(`${ORIGIN}/other.html`), url));
  assert.throws(() => fingerprintPage(html(url, 'Welcome', `<link rel="canonical" href="${url}">`), url));
});

test('fingerprints ignore timestamps CSS JS comments formatting and hidden developer provenance', () => {
  const url = `${ORIGIN}/story.html`;
  const first = html(url, 'Welcome   home', '<!-- deploy old --><meta name="generated-at" content="yesterday"><link rel="stylesheet" href="old.css"><script>new Date()</script>')
    .replace('</body>', '<aside id="entity-debug-panel">Old timestamp</aside></body>');
  const second = html(url, 'Welcome home', '<!-- deploy new --><meta name="generated-at" content="today"><link rel="stylesheet" href="new.css"><script>Date.now()</script>')
    .replace('</body>', '<aside id="entity-debug-panel">New timestamp</aside></body>');
  assert.equal(fingerprintPage(first, url), fingerprintPage(second, url));
  assert.notEqual(fingerprintPage(first, url), fingerprintPage(html(url, 'A different public story'), url));
  assert.notEqual(fingerprintPage(first, url), fingerprintPage(html(url, 'Welcome home', '<meta name="description" content="Changed public description">'), url));
});

for (const stage of ['build', 'deployment']) {
  test(`failed ${stage} neither submits nor advances the successful baseline`, async () => {
    const previousState = state(snapshot(page('old')));
    let touched = false;
    const result = await finalizeDeployment({ current: snapshot(page('new')), previousState,
      buildSucceeded: stage !== 'build', deploymentSucceeded: stage !== 'deployment',
      deploymentSha: newSha, runId: '2', fetchImpl: async () => { touched = true; },
      checkpoint: async () => { touched = true; } });
    assert.equal(touched, false);
    assert.equal(result.state, previousState);
    assert.equal(result.receipt, null);
  });
}

test('successful deployment and IndexNow outage checkpoint deployed state and retain retryable delta', async () => {
  const before = snapshot(page('old'));
  const current = snapshot(page('old'), page('new'));
  const calls = [];
  const checkpoints = [];
  const result = await finalizeDeployment({ current, previousState: state(before), deploymentSha: newSha, runId: '2',
    buildSucceeded: true, deploymentSucceeded: true, fetchImpl: network(503, calls),
    checkpoint: async (next) => checkpoints.push(JSON.parse(JSON.stringify(next))) });
  assert.equal(result.status, 'submission-failed-pending');
  assert.equal(result.state.snapshot.id, current.id);
  assert.equal(result.state.pending.length, 1);
  assert.equal(checkpoints[0].pending.length, 1);
  assert.equal(planDelta(current, result.state).candidates.length, 1);
  assert.equal(result.receipt.batches[0].result, 'transient-remote-failure');
  assert.equal(result.receipt.batchCount, 1);
});

test('pending deletion survives later deployments where it is absent from both snapshots', async () => {
  const before = snapshot(page('kept'), page('removed'));
  const current = snapshot(page('kept'));
  const failed = await finalizeDeployment({ current, previousState: state(before), deploymentSha: newSha, runId: '2',
    buildSucceeded: true, deploymentSucceeded: true, fetchImpl: network(429) });
  const retry = planDelta(current, failed.state);
  assert.equal(retry.candidates[0].url, `${ORIGIN}/removed.html`);
  assert.equal(retry.candidates[0].operation, 'deleted');
  assert.equal(retry.counts.deleted, 0);
});

test('successful bulk submission produces a safe receipt and clears acknowledged pending URLs', async () => {
  const calls = [];
  const result = await finalizeDeployment({ current: snapshot(page('old'), page('new')), previousState: state(snapshot(page('old'))),
    deploymentSha: newSha, runId: '2', buildSucceeded: true, deploymentSucceeded: true, fetchImpl: network(200, calls) });
  assert.equal(result.status, 'submitted');
  assert.equal(result.receipt.submittedUrlCount, 1);
  assert.equal(result.receipt.acceptedUrlCount, 1);
  assert.equal(result.receipt.batchCount, 1);
  assert.equal(result.state.pending.length, 0);
  assert.equal(calls[1].url, ENDPOINT);
  assert.equal(calls[1].body.host, 'hawkinshollowbooks.com');
  assert.equal(calls[1].body.keyLocation, KEY_LOCATION);
  assert.deepEqual(calls[1].body.urlList, [`${ORIGIN}/new.html`]);
  assert.doesNotMatch(JSON.stringify(result.receipt), /Private response|Authorization|GITHUB_TOKEN|R2_SECRET/);
  assert.equal(Object.prototype.hasOwnProperty.call(result.receipt, 'key'), false);
});

test('partial batch failure preserves failed and unattempted URLs without an infinite retry', async () => {
  let posts = 0;
  const mock = async (url) => ({ status: url === KEY_LOCATION ? 200 : ++posts === 1 ? 200 : 429,
    statusText: '', text: async () => url === KEY_LOCATION ? PUBLIC_KEY : '' });
  const result = await finalizeDeployment({ current: snapshot(page('a'), page('b'), page('c')), previousState: state(snapshot()),
    deploymentSha: newSha, runId: '2', buildSucceeded: true, deploymentSucceeded: true, fetchImpl: mock, batchSize: 1 });
  assert.equal(result.receipt.batchCount, 2);
  assert.equal(result.receipt.acceptedUrlCount, 1);
  assert.deepEqual(result.state.pending.map((entry) => entry.url), [`${ORIGIN}/b.html`, `${ORIGIN}/c.html`]);
});

test('protocol responses distinguish acknowledgement key validation errors and throttling', () => {
  assert.deepEqual([200, 202, 400, 403, 422, 429, 500].map(classifyResponse),
    ['success', 'accepted-key-validation-pending', 'malformed-request', 'key-authorization-failure',
      'url-host-key-mismatch', 'throttled', 'transient-remote-failure']);
});

test('invalid live key file preserves pending notifications without submitting', async () => {
  const result = await finalizeDeployment({ current: snapshot(page('new')), previousState: state(snapshot()),
    deploymentSha: newSha, runId: '2', buildSucceeded: true, deploymentSucceeded: true,
    fetchImpl: async () => ({ status: 403, text: async () => 'not the key' }) });
  assert.equal(result.receipt.status, 'key-verification-failed');
  assert.equal(result.receipt.submittedUrlCount, 0);
  assert.equal(result.state.pending.length, 1);
});

test('202 acknowledgement is recorded explicitly rather than claimed as indexing success', async () => {
  const result = await finalizeDeployment({ current: snapshot(page('new')), previousState: state(snapshot()),
    deploymentSha: newSha, runId: '2', buildSucceeded: true, deploymentSucceeded: true, fetchImpl: network(202) });
  assert.equal(result.receipt.batches[0].result, 'accepted-key-validation-pending');
  assert.equal(result.receipt.acceptedUrlCount, 1);
});

test('network failures preserve pending state without leaking error or response credentials', async () => {
  const result = await finalizeDeployment({ current: snapshot(page('new')), previousState: state(snapshot()),
    deploymentSha: newSha, runId: '2', buildSucceeded: true, deploymentSucceeded: true,
    fetchImpl: async (url) => {
      if (url === KEY_LOCATION) return { status: 200, text: async () => PUBLIC_KEY };
      throw new Error('PRIVATE_TOKEN should not be logged');
    } });
  assert.equal(result.state.pending.length, 1);
  assert.equal(result.receipt.batches[0].result, 'transient-network-failure');
  assert.doesNotMatch(JSON.stringify(result.receipt), /PRIVATE_TOKEN/);
});

function artifactNetwork({ missing = false, gap = false, wrongSha = false, rerun = false, calls = [] } = {}) {
  const previous = state(snapshot(page('old')));
  const zip = new AdmZip();
  zip.addFile('state.json', Buffer.from(JSON.stringify(previous)));
  const bytes = zip.toBuffer();
  const sourceRun = { id: 1, head_sha: wrongSha ? newSha : oldSha, head_branch: 'main',
    path: '.github/workflows/deploy-pages.yml', status: rerun ? 'in_progress' : 'completed', updated_at: new Date().toISOString() };
  return async (url, options = {}) => {
    calls.push({ url, headers: options.headers });
    const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
    if (url.includes('/actions/artifacts?')) return response({ artifacts: missing ? [] : [
      { id: 9, name: 'indexnow-production-state-1-1', expired: false, workflow_run: { id: 1 },
        created_at: '2026-10-02T00:01:00Z' }
    ] });
    if (url.includes('/actions/workflows/')) return response({ workflow_runs: gap ? [{ ...sourceRun, id: 2 }] : [sourceRun] });
    if (url.includes('/jobs?')) return response({ jobs: [{ steps: [
      { name: 'Deploy to GitHub Pages', conclusion: 'success',
        completed_at: url.includes('/runs/2/') ? '2026-10-02T00:02:00Z' : '2026-10-02T00:00:00Z' },
      ...(!missing || gap ? [{ name: 'Finalize deployment-aware IndexNow', conclusion: 'failure' }] : [])
    ] }] });
    if (url.endsWith('/actions/runs/1')) return response(sourceRun);
    if (url.endsWith('/actions/artifacts/9/zip')) return { status: 302, headers: new Map([['location', 'https://artifact.test/state.zip']]) };
    if (url === 'https://artifact.test/state.zip') return { ok: true, status: 200, arrayBuffer: async () => bytes };
    throw new Error('Unexpected fixture API route.');
  };
}

test('state artifact is trusted only when its SHA and run match a successful Pages deployment', async () => {
  const calls = [];
  const restored = await restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: artifactNetwork({ calls }) });
  assert.equal(restored.state.runId, '1');
  assert.equal(restored.artifactId, 9);
  assert.equal(calls.find((call) => call.url === 'https://artifact.test/state.zip').headers, undefined);
  await assert.rejects(() => restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: artifactNetwork({ wrongSha: true }) }), /does not match/);
});

test('no adoption artifact establishes baseline but a recent persistence gap fails closed', async () => {
  const restored = await restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: artifactNetwork({ missing: true }) });
  assert.equal(restored.state, null);
  await assert.rejects(() => restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: artifactNetwork({ missing: true, gap: true }) }), /missing production-state artifact/);
  await assert.rejects(() => restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: artifactNetwork({ gap: true }) }), /missing production-state artifact/);
});

test('Actions authentication or retrieval failure never becomes a first-run reset', async () => {
  await assert.rejects(() => restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '3',
    fetchImpl: async () => ({ ok: false, status: 403 }) }), /baseline not reset/);
});

test('legacy whole-sitemap command cannot bypass deployment delta eligibility', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/indexnow-submit.js'), '--from-sitemap',
    'build-recovery/sitemap.xml', '--dry-run'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Direct URL\/sitemap submissions are disabled/);
});

test('workflow plans after build and persists only after successful Pages deployment', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy-pages.yml'), 'utf8');
  const ordered = ['- name: Build site', '- name: Prepare deployment-aware IndexNow delta', '- name: Upload artifact',
    '- name: Deploy to GitHub Pages', '- name: Finalize deployment-aware IndexNow', '- name: Retain production IndexNow state and receipt'];
  const positions = ordered.map((name) => workflow.indexOf(name));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, positions.slice().sort((first, second) => first - second));
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /id: indexnow\s+if: steps\.deployment\.outcome == 'success'\s+continue-on-error: true/);
  assert.match(workflow, /if: always\(\) && steps\.deployment\.outcome == 'success'/);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.doesNotMatch(workflow, /--from-sitemap|lastmod/i);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.doesNotMatch(packageJson.scripts['indexnow:submit'], /--from-sitemap/);
});

test('existing production artifact has 1499 eligible pages and unchanged fingerprints across reads', () => {
  const output = path.join(__dirname, '..', 'build-recovery');
  const first = snapshotFromBuild(output);
  const second = snapshotFromBuild(output);
  assert.equal(first.pages.length, 1499);
  assert.equal(first.id, second.id);
  assert.equal(planDelta(second, state(first)).candidates.length, 0);
});

test('a rerun restores its previous successful attempt journal without overwriting it', async () => {
  const calls = [];
  const restored = await restoreProductionState({ repository: 'owner/repository', token: 'PRIVATE_TOKEN', runId: '1',
    fetchImpl: artifactNetwork({ rerun: true, calls }) });
  assert.equal(restored.artifactId, 9);
  assert.equal(restored.state.runId, '1');
  assert.ok(calls.some((call) => call.url.includes('filter=all')));
});