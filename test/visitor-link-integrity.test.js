const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');

function textContent(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textContent).join('');
}

function elements(node, tagName, result = []) {
  if (node.tagName === tagName) result.push(node);
  for (const child of node.childNodes || []) elements(child, tagName, result);
  return result;
}

function attribute(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}

function isHiddenFromVisitors(ancestors) {
  return ancestors.some((ancestor) => (ancestor.attrs || []).some((entry) => entry.name === 'hidden')
    || (ancestor.tagName === 'details'
      && (ancestor.childNodes || []).some((child) => child.tagName === 'summary'
        && /developer mode/i.test(textContent(child)))));
}

function visitAnchors(node, ancestors, visitor) {
  if (node.tagName === 'a') visitor(node, ancestors);
  const nextAncestors = node.tagName ? [...ancestors, node] : ancestors;
  for (const child of node.childNodes || []) visitAnchors(child, nextAncestors, visitor);
}

function sitemapRoutes() {
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  return [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map((match) => decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, ''));
}

function routeFile(route) {
  let file = path.join(output, route || 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  return file;
}

function localTarget(sourceRoute, href) {
  if (!href || href.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const targetUrl = new URL(href, `https://hawkinshollowbooks.com/${sourceRoute}`);
  const targetRoute = decodeURIComponent(targetUrl.pathname).replace(/^\/+/, '');
  return targetRoute || null;
}

test('nested Character Connections resolve to their canonical public routes', () => {
  assert.ok(fs.existsSync(path.join(output, 'sitemap.xml')), 'generate the site before running output tests');
  const route = 'entities/character/ale-aleea-caracara.html';
  const document = parse5.parse(fs.readFileSync(path.join(output, route), 'utf8'));
  const connectionsSection = elements(document, 'section')
    .find((section) => elements(section, 'h2')
      .some((heading) => /^connections$/i.test(textContent(heading).trim())));
  assert.ok(connectionsSection, `${route} should render a Connections section`);

  const links = [];
  visitAnchors(connectionsSection, [], (anchor, ancestors) => {
    if (isHiddenFromVisitors(ancestors)) return;
    const href = attribute(anchor, 'href');
    if (/relationship\/rel-0001-aleea-caracara-callen-crow\.html$/.test(href)) links.push(href);
  });
  assert.equal(links.length, 1);
  assert.equal(links[0], '../relationship/rel-0001-aleea-caracara-callen-crow.html');
  const target = localTarget(route, links[0]);
  assert.ok(fs.existsSync(path.join(output, target)), `${route} links to missing route ${links[0]}`);
});

test('all visitor-visible local links from sitemap pages resolve to generated files', () => {
  const routes = sitemapRoutes();
  assert.ok(routes.length > 0, 'sitemap should contain generated routes');
  const unresolved = [];

  for (const sourceRoute of routes) {
    const sourcePath = routeFile(sourceRoute);
    assert.ok(fs.existsSync(sourcePath), `sitemap route is missing: ${sourceRoute}`);
    const document = parse5.parse(fs.readFileSync(sourcePath, 'utf8'));
    visitAnchors(document, [], (anchor, ancestors) => {
      if (isHiddenFromVisitors(ancestors)) return;
      const href = attribute(anchor, 'href');
      const targetRoute = localTarget(sourceRoute, href);
      if (targetRoute && !fs.existsSync(routeFile(targetRoute))) {
        unresolved.push(`${sourceRoute} -> ${href} (${targetRoute})`);
      }
    });
  }

  assert.deepEqual(unresolved, [], `unresolved visitor-visible local links:\n${unresolved.join('\n')}`);
});
