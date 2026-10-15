const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const buildRoot = path.join(repoRoot, 'build-recovery');

function findHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findHtmlFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

test('generated search navigation targets the functional homepage search interface', () => {
  assert.ok(fs.existsSync(path.join(buildRoot, 'index.html')), 'generate the site before running this output test');
  const links = [];

  for (const sourcePath of findHtmlFiles(buildRoot)) {
    const html = fs.readFileSync(sourcePath, 'utf8');
    const sourceRelativePath = path.relative(buildRoot, sourcePath).split(path.sep).join('/');
    for (const match of html.matchAll(/href="([^"]*#library-search)"/g)) {
      links.push({ href: match[1], sourceRelativePath });
    }
  }

  assert.ok(links.length > 0, 'expected generated search navigation links');

  for (const { href, sourceRelativePath } of links) {
    const targetUrl = new URL(href, `https://hawkinshollowbooks.com/${sourceRelativePath}`);
    const targetRelativePath = decodeURIComponent(targetUrl.pathname).replace(/^\/+/, '');
    const targetPath = path.join(buildRoot, targetRelativePath);
    assert.ok(fs.existsSync(targetPath), `${sourceRelativePath} links to missing page: ${href}`);

    const targetHtml = fs.readFileSync(targetPath, 'utf8');
    assert.match(targetHtml, /<h2 id="library-search">Search Hawkins Hollow<\/h2>/, `${href} has no search heading`);
    assert.match(targetHtml, /id="library-search-input"/, `${href} has no search input`);
    assert.match(targetHtml, /id="library-search-results"/, `${href} has no search results region`);
    assert.match(targetHtml, /getElementById\('library-search-input'\)/, `${href} has no search behavior`);
  }
});
