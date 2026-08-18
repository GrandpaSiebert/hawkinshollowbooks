#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    urls: [],
    fromSitemap: '',
    key: process.env.INDEXNOW_KEY || '',
    keyLocation: process.env.INDEXNOW_KEY_LOCATION || '',
    host: process.env.INDEXNOW_HOST || '',
    endpoint: process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow',
    dryRun: false,
    limit: 0
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--url') {
      args.urls.push(String(argv[i + 1] || '').trim());
      i += 1;
      continue;
    }
    if (token === '--from-sitemap') {
      args.fromSitemap = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--key') {
      args.key = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--key-location') {
      args.keyLocation = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--host') {
      args.host = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--endpoint') {
      args.endpoint = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token === '--limit') {
      const parsed = Number.parseInt(String(argv[i + 1] || '0'), 10);
      args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getRoot() {
  return path.resolve(__dirname, '..');
}

function loadSiteOrigin(rootDir) {
  const configPath = path.join(rootDir, 'data', 'site-config.json');
  const sitePath = path.join(rootDir, 'data', 'site.json');

  let candidate = '';
  if (fs.existsSync(configPath)) {
    const config = readJson(configPath);
    candidate = String(config.siteUrl || '').trim();
  }
  if (!candidate && fs.existsSync(sitePath)) {
    const site = readJson(sitePath);
    candidate = String(site.domain || '').trim();
  }
  if (!candidate) {
    return '';
  }

  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function parseSitemapUrls(sitemapPath) {
  if (!fs.existsSync(sitemapPath)) {
    throw new Error(`Sitemap not found at ${sitemapPath}`);
  }
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const matches = xml.match(/<loc>([^<]+)<\/loc>/gi) || [];
  return matches
    .map((entry) => entry.replace(/<\/?loc>/gi, '').trim())
    .filter((entry) => Boolean(entry));
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function normalizeHost(hostOrUrl) {
  if (!hostOrUrl) {
    return '';
  }
  try {
    return new URL(hostOrUrl).host;
  } catch {
    return String(hostOrUrl).replace(/^https?:\/\//i, '').replace(/\/.*/, '').trim();
  }
}

async function submit(payload, endpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    bodyText
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = getRoot();
  const inferredOrigin = loadSiteOrigin(root);

  let urls = dedupe(args.urls);
  if (args.fromSitemap) {
    const sitemapPath = path.isAbsolute(args.fromSitemap)
      ? args.fromSitemap
      : path.join(root, args.fromSitemap);
    urls = dedupe(urls.concat(parseSitemapUrls(sitemapPath)));
  }

  if (args.limit > 0) {
    urls = urls.slice(0, args.limit);
  }

  const key = String(args.key || '').trim();
  if (!/^[a-fA-F0-9]{32,128}$/.test(key)) {
    throw new Error('IndexNow key is missing or invalid. Pass --key or set INDEXNOW_KEY.');
  }

  const host = normalizeHost(args.host || inferredOrigin);
  if (!host) {
    throw new Error('Unable to determine host. Pass --host or set siteUrl/domain in data config.');
  }

  const keyLocation = String(args.keyLocation || `${inferredOrigin}/${key}.txt`).trim();
  if (!keyLocation) {
    throw new Error('Unable to determine keyLocation. Pass --key-location or set INDEXNOW_KEY_LOCATION.');
  }

  if (urls.length === 0) {
    throw new Error('No URLs provided. Pass --url and/or --from-sitemap.');
  }

  const payload = {
    host,
    key,
    keyLocation,
    urlList: urls
  };

  if (args.dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      endpoint: args.endpoint,
      urlCount: urls.length,
      payload
    }, null, 2));
    return;
  }

  const result = await submit(payload, args.endpoint);
  console.log(JSON.stringify({
    endpoint: args.endpoint,
    urlCount: urls.length,
    status: result.status,
    statusText: result.statusText,
    ok: result.ok,
    responseBody: result.bodyText
  }, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[indexnow] ${error.message}`);
  process.exitCode = 1;
});
