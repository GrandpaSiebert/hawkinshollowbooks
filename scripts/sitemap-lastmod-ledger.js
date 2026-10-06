const crypto = require('crypto');

const ORIGIN = 'https://hawkinshollowbooks.com';
const FORMAT_VERSION = 1;
const BASELINE_MEANING = 'Stage 4D tracking baseline, not historical content modification metadata.';
const SNAPSHOT_FORMAT_VERSION = 1;
const FINGERPRINT_VERSION = 1;

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function fail(message) {
  throw new Error(`Sitemap lastmod ledger: ${message}`);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`invalid date ${JSON.stringify(value)}; expected YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(`invalid calendar date ${JSON.stringify(value)}`);
  }
  return value;
}

function validateUrl(value) {
  if (typeof value !== 'string') fail(`URL must be a string, received ${JSON.stringify(value)}`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`invalid URL ${JSON.stringify(value)}`);
  }
  if (url.origin !== ORIGIN || url.username || url.password || url.href !== value || url.search || url.hash
    || (url.pathname !== '/' && !url.pathname.endsWith('.html'))) {
    fail(`noncanonical public URL ${JSON.stringify(value)}`);
  }
  return value;
}

function validatePages(pages) {
  if (!Array.isArray(pages)) fail('fingerprint pages must be an array');
  const seen = new Set();
  const sorted = pages.map((page) => {
    if (!page || typeof page !== 'object') fail('fingerprint page must be an object');
    validateUrl(page.url);
    if (!/^[a-f0-9]{64}$/.test(page.fingerprint)) {
      fail(`invalid public fingerprint for ${page.url}`);
    }
    if (seen.has(page.url)) fail(`duplicate URL ${page.url}`);
    seen.add(page.url);
    return { url: page.url, fingerprint: page.fingerprint };
  }).sort((first, second) => compareText(first.url, second.url));
  return sorted;
}

function validateSeedBaseline(ledger) {
  validateLedger(ledger);
  const pages = ledger.entries.map(({ url, fingerprint }) => ({ url, fingerprint }));
  const expectedSnapshotId = digest(JSON.stringify({
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    origin: ORIGIN,
    pages
  }));
  if (expectedSnapshotId !== ledger.baseline.snapshotId) {
    fail('checked-in seed fingerprints do not match their successful-deployment snapshot provenance');
  }
  if (ledger.entries.some((entry) => entry.lastmod !== ledger.baseline.trackingDate)) {
    fail('initial seed dates must all equal the one-time tracking-baseline date');
  }
  return ledger;
}

function validateLedger(ledger, pages) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)
    || ledger.formatVersion !== FORMAT_VERSION || ledger.origin !== ORIGIN) {
    fail('missing, corrupt, or incompatible ledger');
  }
  const baseline = ledger.baseline;
  if (!baseline || typeof baseline !== 'object'
    || !/^[a-f0-9]{40}$/.test(baseline.deploymentSha)
    || !/^\d+$/.test(String(baseline.runId))
    || !/^[a-f0-9]{64}$/.test(baseline.snapshotId)
    || baseline.meaning !== BASELINE_MEANING) {
    fail('invalid tracking-baseline provenance');
  }
  validateDate(baseline.trackingDate);
  if (!Array.isArray(ledger.entries)) fail('entries must be an array');
  const seen = new Set();
  let previousUrl = '';
  const entries = ledger.entries.map((entry) => {
    if (!entry || typeof entry !== 'object') fail('entry must be an object');
    validateUrl(entry.url);
    if (!/^[a-f0-9]{64}$/.test(entry.fingerprint)) {
      fail(`invalid fingerprint for ${entry.url}`);
    }
    validateDate(entry.lastmod);
    if (entry.lastmod < baseline.trackingDate) {
      fail(`lastmod for ${entry.url} predates the tracking baseline`);
    }
    if (seen.has(entry.url)) fail(`duplicate URL ${entry.url}`);
    if (previousUrl && compareText(previousUrl, entry.url) >= 0) {
      fail('entries must be sorted by canonical URL');
    }
    seen.add(entry.url);
    previousUrl = entry.url;
    return { url: entry.url, fingerprint: entry.fingerprint, lastmod: entry.lastmod };
  });
  if (pages !== undefined) {
    const expected = validatePages(pages);
    if (expected.length !== entries.length) fail('ledger does not cover the exact current sitemap URL set');
    for (let index = 0; index < expected.length; index += 1) {
      if (entries[index].url !== expected[index].url
        || entries[index].fingerprint !== expected[index].fingerprint) {
        fail(`ledger fingerprint provenance does not match ${expected[index].url}`);
      }
    }
  }
  return ledger;
}

function createBaselineLedger(pages, provenance) {
  const sorted = validatePages(pages);
  if (!provenance || !/^[a-f0-9]{40}$/.test(provenance.deploymentSha)
    || !/^\d+$/.test(String(provenance.runId))
    || !/^[a-f0-9]{64}$/.test(provenance.snapshotId)) {
    fail('cannot establish baseline without successful-deployment provenance');
  }
  validateDate(provenance.trackingDate);
  return validateLedger({
    formatVersion: FORMAT_VERSION,
    origin: ORIGIN,
    baseline: {
      deploymentSha: provenance.deploymentSha,
      runId: String(provenance.runId),
      snapshotId: provenance.snapshotId,
      trackingDate: provenance.trackingDate,
      meaning: BASELINE_MEANING
    },
    entries: sorted.map((page) => ({
      ...page,
      lastmod: provenance.trackingDate
    }))
  }, sorted);
}

function reconcileLedger(currentPages, previousLedger, deploymentDate) {
  validateLedger(previousLedger);
  const current = validatePages(currentPages);
  const previousByUrl = new Map(previousLedger.entries.map((entry) => [entry.url, entry]));
  const suppliedDate = deploymentDate === undefined ? null : validateDate(deploymentDate);
  const entries = current.map((page) => {
    const previous = previousByUrl.get(page.url);
    if (previous && previous.fingerprint === page.fingerprint) {
      return { ...page, lastmod: previous.lastmod };
    }
    if (!suppliedDate) {
      fail(`no successful-deployment date supplied for new or changed URL ${page.url}`);
    }
    if (previous && suppliedDate < previous.lastmod) {
      fail(`deployment date ${suppliedDate} precedes ${page.url} lastmod ${previous.lastmod}`);
    }
    return { ...page, lastmod: suppliedDate };
  });
  return validateLedger({
    formatVersion: previousLedger.formatVersion,
    origin: previousLedger.origin,
    baseline: previousLedger.baseline,
    entries
  }, current);
}

function assertBootstrapState(previousState, baselineLedger) {
  validateSeedBaseline(baselineLedger);
  if (previousState && previousState.lastmod) {
    const trusted = validateLedger(previousState.lastmod, previousState.snapshot.pages);
    if (trusted.baseline.deploymentSha !== baselineLedger.baseline.deploymentSha
      || trusted.baseline.runId !== baselineLedger.baseline.runId
      || trusted.baseline.snapshotId !== baselineLedger.baseline.snapshotId
      || trusted.baseline.trackingDate !== baselineLedger.baseline.trackingDate) {
      fail('successful-deployment state has different one-time tracking-baseline provenance');
    }
    return trusted;
  }
  if (previousState) {
    if (previousState.deploymentSha !== baselineLedger.baseline.deploymentSha
      || String(previousState.runId) !== baselineLedger.baseline.runId
      || previousState.snapshot.id !== baselineLedger.baseline.snapshotId) {
      fail('legacy successful-deployment state does not match the one-time tracking baseline');
    }
    validateLedger(baselineLedger, previousState.snapshot.pages);
    return baselineLedger;
  }
  return baselineLedger;
}

module.exports = {
  ORIGIN,
  FORMAT_VERSION,
  BASELINE_MEANING,
  validateDate,
  validateLedger,
  validateSeedBaseline,
  createBaselineLedger,
  reconcileLedger,
  assertBootstrapState
};
