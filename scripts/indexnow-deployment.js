const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const parse5 = require('parse5');
const AdmZip = require('adm-zip');
const { submit } = require('./indexnow-submit');
const { validateLedger } = require('./sitemap-lastmod-ledger');

const ORIGIN = 'https://hawkinshollowbooks.com';
const HOST = 'hawkinshollowbooks.com';
const FORMAT_VERSION = 1;
const FINGERPRINT_VERSION = 1;
const STATE_ARTIFACT = 'indexnow-production-state';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const PUBLIC_KEY = 'e4b3aad43c3b4ece93f1a3b5b6962b38';
const KEY_LOCATION = `${ORIGIN}/${PUBLIC_KEY}.txt`;

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalPageUrl(value) {
  const url = new URL(value);
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.href !== value) {
    throw new Error('Only exact HTTPS Hawkins Hollow canonical URLs are eligible.');
  }
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\\') || pathname.includes('\u0000') || (pathname !== '/' && pathname.includes('//'))) {
    throw new Error('Noncanonical pathname rejected.');
  }
  if (pathname !== '/' && !pathname.endsWith('.html')) throw new Error('Assets and infrastructure are not eligible.');
  if (/^\/(?:assets|images|generated|scripts|styles|feeds)\//i.test(pathname)
    || /^\/books\/HH-[SR]-/i.test(pathname)
    || /^\/entities\/book\/hh-[sr]-/i.test(pathname)
    || /^\/(?:the-porch-light|google[a-z0-9]+)\.html$/i.test(pathname)
    || pathname.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new Error('Non-indexable compatibility or infrastructure route rejected.');
  }
  return value;
}

function attributes(node) {
  return Object.fromEntries((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
}

function nodes(document) {
  const result = [];
  function visit(node) {
    result.push(node);
    for (const child of node.childNodes || []) visit(child);
  }
  visit(document);
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

function publicRepresentation(node) {
  if (node.nodeName === '#comment' || node.nodeName === '#documentType') return null;
  if (node.nodeName === '#text') return node.value.replace(/\s+/g, ' ').trim() || null;
  const attrs = attributes(node);
  if (attrs.id === 'entity-debug-panel' || String(attrs.class || '').split(/\s+/).includes('dev-banner')) return null;
  if (node.tagName === 'details' && (node.childNodes || []).some((child) => child.tagName === 'summary'
    && JSON.stringify(publicRepresentation(child)).includes('Developer Mode:'))) return null;
  if (node.tagName === 'script') {
    if (String(attrs.type || '').toLowerCase() !== 'application/ld+json') return null;
    const text = (node.childNodes || []).map((child) => child.value || '').join('');
    return ['script', 'application/ld+json', stableJson(JSON.parse(text))];
  }
  if (node.tagName === 'link' && String(attrs.rel || '').split(/\s+/).includes('stylesheet')) return null;
  if (node.tagName === 'meta' && /^(?:build-time|deployment-sha|generated-at)$/i.test(attrs.name || '')) return null;
  const publicAttrs = Object.entries(attrs)
    .filter(([name]) => name !== 'class' && name !== 'style' && !/^on|^data-(?:build|deployment|generated)/i.test(name))
    .sort(([first], [second]) => compareText(first, second));
  const children = (node.childNodes || []).map(publicRepresentation).filter((child) => child !== null);
  return [node.tagName || node.nodeName, publicAttrs, children];
}

function fingerprintPage(html, expectedUrl) {
  canonicalPageUrl(expectedUrl);
  const document = parse5.parse(html);
  const allNodes = nodes(document);
  const canonicals = allNodes.filter((node) => node.tagName === 'link'
    && String(attributes(node).rel || '').split(/\s+/).includes('canonical'));
  if (canonicals.length !== 1 || attributes(canonicals[0]).href !== expectedUrl) {
    throw new Error('Sitemap page must have exactly one matching canonical URL.');
  }
  const noindex = allNodes.some((node) => node.tagName === 'meta'
    && /^(?:robots|googlebot|bingbot)$/i.test(attributes(node).name || '')
    && /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(attributes(node).content || ''));
  if (noindex) throw new Error('Non-indexable page cannot enter the canonical snapshot.');
  return digest(JSON.stringify(publicRepresentation(document)));
}

function snapshotId(pages) {
  return digest(JSON.stringify({ formatVersion: FORMAT_VERSION, fingerprintVersion: FINGERPRINT_VERSION, origin: ORIGIN, pages }));
}

function createSnapshot(pages) {
  const sorted = pages.slice().sort((first, second) => compareText(first.url, second.url));
  const snapshot = { formatVersion: FORMAT_VERSION, fingerprintVersion: FINGERPRINT_VERSION, origin: ORIGIN,
    id: snapshotId(sorted), pages: sorted };
  validateSnapshot(snapshot);
  return snapshot;
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.formatVersion !== FORMAT_VERSION || snapshot.fingerprintVersion !== FINGERPRINT_VERSION
    || snapshot.origin !== ORIGIN || !Array.isArray(snapshot.pages)) throw new Error('Untrusted or incompatible snapshot.');
  const seen = new Set();
  for (const page of snapshot.pages) {
    canonicalPageUrl(page.url);
    if (!/^[a-f0-9]{64}$/.test(page.fingerprint) || seen.has(page.url)) throw new Error('Invalid or duplicate canonical snapshot entry.');
    seen.add(page.url);
  }
  const sorted = snapshot.pages.slice().sort((first, second) => compareText(first.url, second.url));
  if (snapshot.id !== snapshotId(sorted) || JSON.stringify(sorted) !== JSON.stringify(snapshot.pages)) throw new Error('Snapshot integrity mismatch.');
  return snapshot;
}

function snapshotFromBuild(outputDirectory) {
  const xml = fs.readFileSync(path.join(outputDirectory, 'sitemap.xml'), 'utf8');
  const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1].replace(/&amp;/g, '&'));
  if (urls.length === 0) throw new Error('An empty canonical universe cannot establish a baseline.');
  if (new Set(urls).size !== urls.length) throw new Error('Duplicate sitemap URL rejected.');
  return createSnapshot(urls.map((url) => {
    canonicalPageUrl(url);
    const pathname = decodeURIComponent(new URL(url).pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const html = fs.readFileSync(path.join(outputDirectory, relative), 'utf8');
    return { url, fingerprint: fingerprintPage(html, url) };
  }));
}

function validateState(state) {
  if (!state || state.formatVersion !== FORMAT_VERSION || state.deploymentSucceeded !== true
    || !/^[a-f0-9]{40}$/.test(state.deploymentSha) || !/^\d+$/.test(String(state.runId))
    || !Array.isArray(state.pending)) throw new Error('Invalid production state.');
  validateSnapshot(state.snapshot);
  if (Object.hasOwn(state, 'lastmod')) validateLedger(state.lastmod, state.snapshot.pages);
  for (const entry of state.pending) {
    canonicalPageUrl(entry.url);
    if (!['added', 'updated', 'deleted'].includes(entry.operation) || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) {
      throw new Error('Invalid pending canonical notification.');
    }
  }
  if (state.id !== stateId(state)) throw new Error('Production state integrity mismatch.');
  return state;
}

function stateId(state) {
  const material = { snapshotId: state.snapshot.id, deploymentSha: state.deploymentSha,
    runId: state.runId, pending: state.pending };
  if (Object.hasOwn(state, 'lastmod')) material.lastmod = state.lastmod;
  return digest(JSON.stringify(material));
}

function makeState(snapshot, deploymentSha, runId, pending, lastmod) {
  const state = { formatVersion: FORMAT_VERSION, deploymentSucceeded: true, deploymentSha, runId: String(runId), snapshot, pending };
  if (lastmod !== undefined) {
    validateLedger(lastmod, snapshot.pages);
    state.lastmod = lastmod;
  }
  state.id = stateId(state);
  return validateState(state);
}

function planDelta(current, previousState = null) {
  validateSnapshot(current);
  if (previousState) validateState(previousState);
  const currentByUrl = new Map(current.pages.map((page) => [page.url, page.fingerprint]));
  const previousByUrl = new Map(previousState ? previousState.snapshot.pages.map((page) => [page.url, page.fingerprint]) : []);
  const counts = { added: 0, updated: 0, deleted: 0, unchanged: 0 };
  const candidates = new Map();
  if (!previousState) {
    return { firstRun: true, reason: 'No trustworthy previous Stage 4C production state; baseline only, no backfill.',
      previousBaselineId: null, currentSnapshotId: current.id, counts: { ...counts, unchanged: current.pages.length }, candidates: [] };
  }
  for (const [url, fingerprint] of currentByUrl) {
    const operation = !previousByUrl.has(url) ? 'added' : previousByUrl.get(url) !== fingerprint ? 'updated' : 'unchanged';
    counts[operation] += 1;
    if (operation !== 'unchanged') candidates.set(url, { url, fingerprint, operation });
  }
  for (const [url, fingerprint] of previousByUrl) {
    if (!currentByUrl.has(url)) { counts.deleted += 1; candidates.set(url, { url, fingerprint, operation: 'deleted' }); }
  }
  for (const pending of previousState.pending) {
    if (candidates.has(pending.url)) continue;
    candidates.set(pending.url, { url: pending.url, fingerprint: currentByUrl.get(pending.url) || pending.fingerprint,
      operation: currentByUrl.has(pending.url) ? 'updated' : 'deleted' });
  }
  return { firstRun: false, reason: 'Compared actual public content with previous successfully deployed snapshot.',
    previousBaselineId: previousState.id, currentSnapshotId: current.id, counts,
    candidates: Array.from(candidates.values()).sort((first, second) => compareText(first.url, second.url)) };
}

function classifyResponse(status) {
  if (status === 200) return 'success';
  if (status === 202) return 'accepted-key-validation-pending';
  if (status === 400) return 'malformed-request';
  if (status === 403) return 'key-authorization-failure';
  if (status === 422) return 'url-host-key-mismatch';
  if (status === 429) return 'throttled';
  if (status >= 500) return 'transient-remote-failure';
  return 'unexpected-http-response';
}

async function finalizeDeployment(options) {
  const { current, previousState = null, deploymentSha, runId, fetchImpl = fetch, checkpoint = async () => {} } = options;
  if (options.buildSucceeded !== true || options.deploymentSucceeded !== true) {
    return { state: previousState, receipt: null, status: 'not-deployed' };
  }
  if (options.lastmod !== undefined) validateLedger(options.lastmod, current.pages);
  const batchSize = options.batchSize || 10000;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw new Error('Invalid IndexNow batch size.');
  const plan = planDelta(current, previousState);
  let state = makeState(current, deploymentSha, runId, plan.candidates, options.lastmod);
  const receipt = { formatVersion: FORMAT_VERSION, deploymentSha, runId: String(runId), deploymentSucceeded: true,
    previousBaselineId: plan.previousBaselineId, currentBaselineId: state.id, snapshotId: current.id,
    firstRun: plan.firstRun, reason: plan.reason, counts: plan.counts,
    candidateUrlCount: plan.candidates.length, previousPendingCount: previousState ? previousState.pending.length : 0,
    submittedUrlCount: 0, acceptedUrlCount: 0, pendingUrlCount: plan.candidates.length,
    batchCount: 0, batches: [], submittedUrls: [], keyLocation: KEY_LOCATION,
    timestamp: new Date().toISOString(), status: plan.firstRun ? 'baseline-established' : 'unchanged' };
  await checkpoint(state, receipt);
  if (plan.candidates.length === 0) return { state, receipt, status: receipt.status };

  try {
    const keyResponse = await fetchImpl(KEY_LOCATION, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (keyResponse.status !== 200 || (await keyResponse.text()).trim() !== PUBLIC_KEY) {
      receipt.status = 'key-verification-failed';
      receipt.keyVerificationStatus = keyResponse.status;
      receipt.keyVerificationResult = classifyResponse(keyResponse.status);
      await checkpoint(state, receipt);
      return { state, receipt, status: receipt.status };
    }
  } catch {
    receipt.status = 'key-verification-network-failure';
    await checkpoint(state, receipt);
    return { state, receipt, status: receipt.status };
  }

  for (let offset = 0; offset < plan.candidates.length; offset += batchSize) {
    const batch = plan.candidates.slice(offset, offset + batchSize);
    const urlList = batch.map((entry) => canonicalPageUrl(entry.url));
    let result;
    try {
      result = await submit({ host: HOST, key: PUBLIC_KEY, keyLocation: KEY_LOCATION, urlList }, ENDPOINT, fetchImpl);
    } catch {
      result = { status: null, ok: false };
    }
    receipt.submittedUrlCount += urlList.length;
    receipt.submittedUrls.push(...urlList);
    receipt.batchCount += 1;
    receipt.batches.push({ number: receipt.batchCount, urlCount: urlList.length, urls: urlList,
      httpStatus: result.status, result: result.status === null ? 'transient-network-failure' : classifyResponse(result.status),
      timestamp: new Date().toISOString() });
    if (result.ok) {
      const acknowledged = new Set(urlList);
      state = makeState(current, deploymentSha, runId, state.pending.filter((entry) => !acknowledged.has(entry.url)), options.lastmod);
      receipt.acceptedUrlCount += urlList.length;
    }
    receipt.pendingUrlCount = state.pending.length;
    receipt.currentBaselineId = state.id;
    receipt.status = state.pending.length ? 'submission-failed-pending' : 'submitted';
    await checkpoint(state, receipt);
    if (!result.ok) break;
  }
  return { state, receipt, status: receipt.status };
}

async function restoreProductionState({ repository, token, runId, fetchImpl = fetch }) {
  if (!repository || !token) throw new Error('Actions repository and read-scoped token are required for production-state retrieval.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid Actions repository.');
  const base = `https://api.github.com/repos/${repository}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
    'User-Agent': 'hawkins-hollow-indexnow-deployment' };
  async function json(url) {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Actions state retrieval failed (HTTP ${response.status}); baseline not reset.`);
    return response.json();
  }
  const artifacts = [];
  for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
    const payload = await json(`${base}/actions/artifacts?per_page=100&page=${pageNumber}`);
    artifacts.push(...(payload.artifacts || []).filter((artifact) => !artifact.expired
      && (artifact.name === STATE_ARTIFACT || artifact.name.startsWith(`${STATE_ARTIFACT}-`))));
    if ((payload.artifacts || []).length < 100 || artifacts.length > 0) break;
    if (pageNumber === 20) throw new Error('Artifact history exceeded bounded retrieval; baseline not reset.');
  }
  artifacts.sort((first, second) => second.id - first.id);
  let selected = null;
  for (const artifact of artifacts) {
    const sourceRun = await json(`${base}/actions/runs/${artifact.workflow_run.id}`);
    if (sourceRun.head_branch !== 'main' || sourceRun.path !== '.github/workflows/deploy-pages.yml'
      || (sourceRun.status !== 'completed' && String(sourceRun.id) !== String(runId))) continue;
    const jobs = await json(`${base}/actions/runs/${sourceRun.id}/jobs?filter=all&per_page=100`);
    if (!(jobs.jobs || []).some((job) => (job.steps || []).some((step) => step.name === 'Deploy to GitHub Pages'
      && step.conclusion === 'success'))) continue;
    const download = await fetchImpl(`${base}/actions/artifacts/${artifact.id}/zip`, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(30000)
    });
    let archiveResponse = download;
    if (download.status === 302) {
      const location = download.headers.get('location');
      if (!location || new URL(location).protocol !== 'https:') throw new Error('Invalid artifact download location.');
      archiveResponse = await fetchImpl(location, { signal: AbortSignal.timeout(30000) });
    }
    if (!archiveResponse.ok) throw new Error(`Production state download failed (HTTP ${archiveResponse.status}).`);
    const zip = new AdmZip(Buffer.from(await archiveResponse.arrayBuffer()));
    const entry = zip.getEntry('state.json');
    if (!entry) throw new Error('Production state artifact is missing state.json.');
    const restored = validateState(JSON.parse(entry.getData().toString('utf8')));
    if (restored.deploymentSha !== sourceRun.head_sha || restored.runId !== String(sourceRun.id)) {
      throw new Error('Production state artifact does not match its successful deployment.');
    }
    if (!Number.isFinite(Date.parse(artifact.created_at))) throw new Error('Production artifact creation provenance is invalid.');
    selected = { state: restored, artifactId: artifact.id, sourceRunId: sourceRun.id, createdAt: artifact.created_at };
    break;
  }

  const history = await json(`${base}/actions/workflows/deploy-pages.yml/runs?branch=main&per_page=20`);
  for (const sourceRun of history.workflow_runs || []) {
    if (String(sourceRun.id) === String(runId) || sourceRun.status !== 'completed') continue;
    const jobs = await json(`${base}/actions/runs/${sourceRun.id}/jobs?filter=all&per_page=100`);
    const steps = (jobs.jobs || []).flatMap((job) => job.steps || []);
    const deployments = steps.filter((step) => step.name === 'Deploy to GitHub Pages' && step.conclusion === 'success');
    if (!deployments.length) continue;
    const adopted = steps.some((step) => step.name === 'Finalize deployment-aware IndexNow');
    const newerThanArtifact = !selected || deployments.some((step) =>
      Date.parse(step.completed_at || sourceRun.updated_at) > Date.parse(selected.createdAt));
    if (adopted && newerThanArtifact) {
      const expired = Date.now() - Date.parse(sourceRun.updated_at) > 90 * 24 * 60 * 60 * 1000;
      if (!selected && expired) return { state: null, artifactId: null, reason: 'Prior production state exceeded 90-day retention; baseline only, no historical backfill.' };
      throw new Error('Successful Pages deployment has a missing production-state artifact. Re-run that deployment to recover its journal before proceeding.');
    }
  }
  return selected || { state: null, artifactId: null, reason: 'No trustworthy prior Stage 4C production artifact exists; first adoption baseline only.' };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

async function main() {
  const command = process.argv[2];
  const root = path.join(__dirname, '..');
  const directory = path.join(root, '.indexnow');
  const deploymentSha = process.env.GITHUB_SHA || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  if (command === 'restore') {
    const restored = await restoreProductionState({ repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN, runId });
    if (!restored.state) throw new Error('No verified successful Pages state exists to establish the Stage 4D tracking baseline.');
    writeJson(path.join(directory, 'previous-state.json'), restored.state);
    writeJson(path.join(directory, 'restoration.json'), {
      artifactId: restored.artifactId,
      sourceRunId: String(restored.sourceRunId),
      createdAt: restored.createdAt,
      stateId: restored.state.id
    });
    console.log(JSON.stringify({ restoredStateId: restored.state.id, artifactId: restored.artifactId,
      sourceRunId: restored.sourceRunId, snapshotId: restored.state.snapshot.id,
      canonicalPages: restored.state.snapshot.pages.length }, null, 2));
    return;
  }
  if (command === 'prepare') {
    const current = snapshotFromBuild(path.join(root, 'build-recovery'));
    const restored = process.env.GITHUB_ACTIONS === 'true'
      ? (() => {
        const statePath = path.join(directory, 'previous-state.json');
        const restorationPath = path.join(directory, 'restoration.json');
        if (!fs.existsSync(statePath) || !fs.existsSync(restorationPath)) {
          throw new Error('Trusted production state must be restored before build and deployment preparation.');
        }
        const state = validateState(readJson(statePath));
        const restoration = readJson(restorationPath);
        if (restoration.stateId !== state.id) throw new Error('Restored production state provenance mismatch.');
        return { state, artifactId: restoration.artifactId };
      })()
      : { state: null, artifactId: null, reason: 'Local preparation only; no trusted CI production state supplied.' };
    const plan = planDelta(current, restored.state);
    if (!restored.state) plan.reason = restored.reason;
    writeJson(path.join(directory, 'snapshot.json'), current);
    writeJson(path.join(directory, 'previous-state.json'), restored.state);
    writeJson(path.join(directory, 'plan.json'), { ...plan, deploymentSha, runId, previousArtifactId: restored.artifactId });
    console.log(JSON.stringify({ deploymentSha, previousBaselineId: plan.previousBaselineId, snapshotId: current.id,
      canonicalPages: current.pages.length, firstRun: plan.firstRun, counts: plan.counts,
      candidateUrlCount: plan.candidates.length, reason: plan.reason }, null, 2));
    return;
  }
  if (command === 'preview') {
    const plan = readJson(path.join(directory, 'plan.json'));
    console.log(JSON.stringify({ ...plan, mode: 'dry-run', keyLocation: KEY_LOCATION }, null, 2));
    return;
  }
  if (command !== 'finalize') throw new Error('Use restore, prepare, preview, or finalize.');
  if (process.env.DEPLOYMENT_SUCCEEDED !== 'true') throw new Error('Pages success is required; no submission or baseline advancement performed.');
  const current = validateSnapshot(readJson(path.join(directory, 'snapshot.json')));
  const previousState = readJson(path.join(directory, 'previous-state.json'));
  const lastmod = validateLedger(readJson(path.join(directory, 'lastmod-candidate.json')), current.pages);
  const prepared = readJson(path.join(directory, 'plan.json'));
  if (prepared.deploymentSha !== deploymentSha || prepared.runId !== runId || prepared.currentSnapshotId !== current.id) {
    throw new Error('Prepared snapshot belongs to another deployment.');
  }
  if (fs.readFileSync(path.join(root, `${PUBLIC_KEY}.txt`), 'utf8').trim() !== PUBLIC_KEY) throw new Error('Existing public key file is invalid.');
  const result = await finalizeDeployment({ current, previousState, deploymentSha, runId,
    lastmod,
    buildSucceeded: true, deploymentSucceeded: true,
    checkpoint: async (state, receipt) => {
      receipt.reason = prepared.reason;
      writeJson(path.join(directory, 'state.json'), state);
      writeJson(path.join(directory, 'receipt.json'), receipt);
    } });
  const { submittedUrls, batches, ...summary } = result.receipt;
  console.log(JSON.stringify({ ...summary, batches: batches.map(({ urls, ...batch }) => batch) }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## IndexNow deployment delta\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n`);
  }
  if (result.receipt.pendingUrlCount > 0) {
    console.error('::warning::IndexNow notification failed; successful Pages deployment is retained and pending URLs remain in the production-state artifact.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(`[indexnow deployment] ${error.message}`); process.exitCode = 1; });
}

module.exports = { ORIGIN, HOST, FORMAT_VERSION, FINGERPRINT_VERSION, STATE_ARTIFACT, ENDPOINT, PUBLIC_KEY, KEY_LOCATION,
  canonicalPageUrl, fingerprintPage, createSnapshot, validateSnapshot, snapshotFromBuild, validateState, makeState,
  planDelta, classifyResponse, finalizeDeployment, restoreProductionState };