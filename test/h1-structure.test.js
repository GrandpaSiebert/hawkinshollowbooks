const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parse5 = require('parse5');

const repoRoot = path.join(__dirname, '..');
const buildRoot = path.join(repoRoot, 'build-recovery');

function getElements(node, tagName, elements = []) {
  if (node.tagName === tagName) {
    elements.push(node);
  }
  for (const child of node.childNodes || []) {
    getElements(child, tagName, elements);
  }
  return elements;
}

function getTextContent(node) {
  if (node.nodeName === '#text') {
    return node.value;
  }
  return (node.childNodes || []).map(getTextContent).join('');
}

function getAttribute(node, name) {
  return (node.attrs || []).find((attribute) => attribute.name === name)?.value || '';
}

test('generated indexable canonical pages each have exactly one non-empty H1', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const sitemap = fs.readFileSync(path.join(buildRoot, 'sitemap.xml'), 'utf8');
  const canonicalUrls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
  assert.ok(canonicalUrls.length > 0, 'Generated sitemap contains no canonical URLs.');

  const violations = [];
  for (const canonicalUrl of canonicalUrls) {
    const url = new URL(canonicalUrl);
    const route = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const html = fs.readFileSync(path.join(buildRoot, route), 'utf8');
    const document = parse5.parse(html);
    const canonicalLinks = getElements(document, 'link').filter((link) => (
      getAttribute(link, 'rel').split(/\s+/).includes('canonical')
    ));
    const robots = getElements(document, 'meta').find((meta) => (
      getAttribute(meta, 'name').toLowerCase() === 'robots'
    ));
    const headings = getElements(document, 'h1').map((heading) => getTextContent(heading).trim());

    if (canonicalLinks.length !== 1
      || getAttribute(canonicalLinks[0], 'href') !== canonicalUrl
      || /(?:^|,)\s*noindex\b/i.test(getAttribute(robots || {}, 'content'))
      || headings.length !== 1
      || headings.some((heading) => !heading)) {
      violations.push({
        path: `/${route}`,
        canonicalLinks: canonicalLinks.length,
        noindex: /(?:^|,)\s*noindex\b/i.test(getAttribute(robots || {}, 'content')),
        h1Count: headings.length,
        h1Text: headings
      });
    }
  }

  assert.deepEqual(violations, [], `Invalid generated indexable canonical pages:\n${JSON.stringify(violations, null, 2)}`);
});
