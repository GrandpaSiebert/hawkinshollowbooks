const fs = require('fs');
const path = require('path');
const {
  snapshotFromBuild,
  validateState
} = require('./indexnow-deployment');
const {
  assertBootstrapState,
  reconcileLedger,
  validateLedger
} = require('./sitemap-lastmod-ledger');

const root = path.join(__dirname, '..');
const BASELINE_PATH = path.join(root, 'data', 'sitemap-lastmod-baseline.json');
const PREVIOUS_STATE_PATH = path.join(root, '.indexnow', 'previous-state.json');
const CANDIDATE_PATH = path.join(root, '.indexnow', 'lastmod-candidate.json');
const URL_ENTRY_PATTERN = /  <url>\r?\n    <loc>([^<]+)<\/loc>\r?\n(?:    <lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>\r?\n)?  <\/url>/g;

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read trusted sitemap lastmod state at ${filePath}: ${error.message}`);
  }
}

function loadPreviousLedger(baselinePath = BASELINE_PATH, previousStatePath = PREVIOUS_STATE_PATH) {
  const baseline = readJson(baselinePath);
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  if (inCi && !fs.existsSync(previousStatePath)) {
    throw new Error('Trusted prior production state must be restored before generating sitemap lastmod.');
  }
  let previousState = null;
  if (fs.existsSync(previousStatePath)) {
    previousState = readJson(previousStatePath);
    if (inCi && previousState === null) {
      throw new Error('A successful prior Pages state is required to establish the sitemap lastmod baseline.');
    }
    if (previousState !== null) validateState(previousState);
  }
  return assertBootstrapState(previousState, baseline);
}

function addLastmodToSitemap(xml, ledger) {
  validateLedger(ledger);
  const entries = new Map(ledger.entries.map((entry) => [entry.url, entry]));
  const seen = new Set();
  let count = 0;
  const output = xml.replace(URL_ENTRY_PATTERN, (record, encodedUrl) => {
    const url = encodedUrl.replace(/&amp;/g, '&');
    const entry = entries.get(url);
    if (!entry) throw new Error(`Sitemap URL has no fingerprinted lastmod record: ${url}`);
    if (seen.has(url)) throw new Error(`Duplicate sitemap URL while adding lastmod: ${url}`);
    seen.add(url);
    count += 1;
    return `  <url>\n    <loc>${encodedUrl}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n  </url>`;
  });
  if (count !== entries.size || seen.size !== entries.size) {
    throw new Error(`Sitemap and lastmod ledger URL sets differ (${count} sitemap records, ${entries.size} ledger records).`);
  }
  return output;
}

function writeSitemapLastmod(outputDirs, options = {}) {
  const directories = Array.from(outputDirs || []);
  if (directories.length === 0) throw new Error('At least one generated site directory is required.');
  const primaryDirectory = directories[0];
  const previousLedger = options.previousLedger || loadPreviousLedger();
  const deploymentDate = options.deploymentDate === undefined
    ? process.env.HH_SITEMAP_DEPLOYMENT_DATE
    : options.deploymentDate;
  const current = snapshotFromBuild(primaryDirectory);
  const ledger = reconcileLedger(current.pages, previousLedger, deploymentDate || undefined);

  for (const directory of directories) {
    const sitemapPath = path.join(directory, 'sitemap.xml');
    const xml = fs.readFileSync(sitemapPath, 'utf8');
    fs.writeFileSync(sitemapPath, addLastmodToSitemap(xml, ledger), 'utf8');
  }
  fs.mkdirSync(path.dirname(CANDIDATE_PATH), { recursive: true });
  fs.writeFileSync(CANDIDATE_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  return ledger;
}

module.exports = {
  BASELINE_PATH,
  PREVIOUS_STATE_PATH,
  CANDIDATE_PATH,
  addLastmodToSitemap,
  loadPreviousLedger,
  writeSitemapLastmod
};
