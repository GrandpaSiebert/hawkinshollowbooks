const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, test } = require('node:test');
const {
  APPROVED_COMPATIBILITY_REDIRECTS,
  validatePublishedRoutes
} = require('../scripts/validate-published-routes');

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'published-routes-'));
  temporaryRoots.push(root);
  const domain = 'https://example.test';
  const liveBookRoutes = [
    'books/HH-A-0001-a-story.html',
    'books/HH-C+-0007-callen-crow-s-lost-feather.html'
  ];
  const buildDir = path.join(root, 'build-recovery');
  const booksDir = path.join(buildDir, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'site.json'), JSON.stringify({ domain }));
  fs.writeFileSync(path.join(root, 'generated', 'library-index.json'), JSON.stringify({
    books: [
      { canonicalId: 'HH-A-0001', title: 'A Story', contentType: 'book' },
      { canonicalId: 'HH-C+-0007', title: 'Callen Crow’s Lost Feather', contentType: 'book' }
    ]
  }));
  fs.writeFileSync(path.join(root, 'generated', 'amazon-index.json'), JSON.stringify({
    records: [
      { id: 'HH-A-0001', status: 'Live' },
      { id: 'HH-C+-0007', status: 'Live' }
    ]
  }));
  fs.writeFileSync(path.join(root, 'generated', 'freebie-index.json'), JSON.stringify({ records: [] }));
  fs.writeFileSync(path.join(buildDir, 'sitemap.xml'), `<urlset>${liveBookRoutes.map((route) => `<url><loc>${domain}/${route}</loc></url>`).join('')}</urlset>`);
  for (const route of liveBookRoutes) {
    const canonicalUrl = `${domain}/${route}`;
    fs.writeFileSync(path.join(buildDir, route), [
      `<link rel="canonical" href="${canonicalUrl}" />`,
      `"url": "${canonicalUrl}"`
    ].join('\n'));
  }

  for (const redirect of APPROVED_COMPATIBILITY_REDIRECTS) {
    const targetUrl = `${domain}/${redirect.targetRoute}`;
    const targetPath = path.join(buildDir, redirect.targetRoute);
    const redirectPath = path.join(buildDir, redirect.route);
    const targetHref = path.relative(path.dirname(redirect.route), redirect.targetRoute).replace(/\\/g, '/');
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, `<link rel="canonical" href="${targetUrl}" />`);
    }
    fs.writeFileSync(redirectPath, [
      `<meta http-equiv="refresh" content="0; url=${targetHref}" />`,
      `<link rel="canonical" href="${targetUrl}" />`,
      '<meta name="robots" content="noindex, follow" />'
    ].join('\n'));
  }

  return { root, buildDir };
}

function validate(fixture) {
  return validatePublishedRoutes({ rootDir: fixture.root, buildDir: fixture.buildDir });
}

test('accepts only the two approved C+-0007 compatibility redirects with canonical noindex targets', () => {
  const fixture = createFixture();
  const result = validate(fixture);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary.bookCount, 2);
});

test('rejects invalid redirect destinations, canonical URLs, and indexability', () => {
  const fixture = createFixture();
  const [detailRedirect] = APPROVED_COMPATIBILITY_REDIRECTS;
  const redirectPath = path.join(fixture.buildDir, detailRedirect.route);
  const original = fs.readFileSync(redirectPath, 'utf8');
  fs.writeFileSync(redirectPath, original
    .replace('url=HH-C+-0007-callen-crow-s-lost-feather.html', 'url=HH-A-0001-a-story.html')
    .replace('href="https://example.test/books/HH-C+-0007-callen-crow-s-lost-feather.html"', 'href="https://example.test/unapproved.html"')
    .replace('<meta name="robots" content="noindex, follow" />', '<meta name="robots" content="index, follow" />'));

  const messages = validate(fixture).errors.join('\n');
  assert.match(messages, /compatibility redirect has an invalid target/);
  assert.match(messages, /compatibility redirect has an invalid canonical destination/);
  assert.match(messages, /compatibility redirect must be noindex, follow/);
});

test('rejects compatibility redirects listed in the sitemap', () => {
  const fixture = createFixture();
  const sitemapPath = path.join(fixture.buildDir, 'sitemap.xml');
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const route = APPROVED_COMPATIBILITY_REDIRECTS[0].route;
  fs.writeFileSync(sitemapPath, sitemap.replace('</urlset>', `<url><loc>https://example.test/${route}</loc></url></urlset>`));

  assert.match(validate(fixture).errors.join('\n'), /compatibility redirect must not appear in the sitemap/);
});

test('continues rejecting unapproved Book routes', () => {
  const fixture = createFixture();
  fs.writeFileSync(path.join(fixture.buildDir, 'books', 'HH-A-9999-unapproved.html'), 'unapproved');

  assert.match(validate(fixture).errors.join('\n'), /unexpected book route: books\/HH-A-9999-unapproved\.html/);
});
