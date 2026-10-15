const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const parse5 = require('parse5');
const { filterEligibleCharacterBooks } = require('../scripts/character-book-discovery');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');

function elements(node, tag, result = []) {
  if (node.tagName === tag) result.push(node);
  for (const child of node.childNodes || []) elements(child, tag, result);
  return result;
}

function attribute(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}

function textContent(node) {
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function parsePage(route) {
  return parse5.parse(fs.readFileSync(path.join(output, route), 'utf8'));
}

function routeForHref(href, sourceRoute) {
  const url = new URL(href, `https://hawkinshollowbooks.com/${sourceRoute}`);
  return decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
}

function generate() {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-site.js')], {
    cwd: root,
    env: { ...process.env, HH_SITEMAP_DEPLOYMENT_DATE: process.env.HH_SITEMAP_DEPLOYMENT_DATE || '2026-10-09' },
    stdio: 'pipe'
  });
}

before(generate);

test('character Book associations exclude ineligible routes and duplicate canonical IDs', () => {
  const eligibleRoutes = new Set(['books/HH-A-0001-first-friend.html']);
  const books = filterEligibleCharacterBooks([
    { canonicalId: 'HH-A-0001', href: 'books/HH-A-0001-first-friend.html' },
    { canonicalId: 'HH-A-0001', href: 'books/HH-A-0001-first-friend.html' },
    { canonicalId: 'HH-A-0002', href: 'books/HH-A-0002-unpublished-story.html' },
    { canonicalId: 'HH-A-0003', href: '' }
  ], eligibleRoutes);

  assert.deepEqual(books, [
    { canonicalId: 'HH-A-0001', href: 'books/HH-A-0001-first-friend.html' }
  ]);
});

test('character profiles show eligible canonical Book previews without duplicating other discovery sections', () => {
  const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters
    .filter((character) => character.published !== false);
  const associations = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-character-book-index.json'), 'utf8')).records;
  const publicSurfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'public-surface-index.json'), 'utf8')).records;
  const eligibleBookRoutes = new Set(publicSurfaces
    .filter((record) => record.route.startsWith('books/')
      && !record.route.endsWith('-characters.html')
      && record.state === 'primary'
      && record.navigation)
    .map((record) => record.route));
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const associationByCharacter = new Map(associations.map((record) => [
    record.canonicalCharacterId,
    record.books
  ]));

  let eligibleAssociationCount = 0;
  let profilesWithBooks = 0;
  for (const character of characters) {
    const canonicalCharacterId = String(character.identity && character.identity.canonicalId || '').toUpperCase();
    const sourceBooks = associationByCharacter.get(canonicalCharacterId) || [];
    const expectedRoutes = Array.from(new Set(sourceBooks
      .map((book) => book.bookHref)
      .filter((href) => eligibleBookRoutes.has(href))))
      .sort((left, right) => left.localeCompare(right));
    eligibleAssociationCount += expectedRoutes.length;

    const profileRoute = `characters/${character.slug}.html`;
    const document = parsePage(profileRoute);
    const bookSection = elements(document, 'section')
      .find((section) => attribute(section, 'aria-labelledby') === 'character-books');
    if (expectedRoutes.length === 0) {
      assert.equal(bookSection, undefined, `${character.slug}: no empty Book section`);
      continue;
    }

    profilesWithBooks += 1;
    assert.ok(bookSection, `${character.slug}: eligible Book associations should be displayed`);
    assert.equal(
      elements(bookSection, 'h2').some((heading) => textContent(heading).includes('Books Featuring This Character')),
      true,
      `${character.slug}: accessible Book section heading`
    );

    const cards = elements(bookSection, 'article');
    const expectedPreview = expectedRoutes.slice(0, 6);
    assert.equal(cards.length, expectedPreview.length, `${character.slug}: preview card count`);
    const actualRoutes = cards.map((card) => {
      const anchor = elements(card, 'a')[0];
      assert.ok(anchor, `${character.slug}: Book card has a meaningful link`);
      const title = elements(card, 'h3').map(textContent).join('').trim();
      assert.ok(title, `${character.slug}: Book card has a meaningful title`);
      const images = elements(card, 'img');
      if (images.length) assert.match(attribute(images[0], 'alt'), /^Cover image for .+/);
      const target = routeForHref(attribute(anchor, 'href'), profileRoute);
      assert.ok(fs.existsSync(path.join(output, target)), `${character.slug}: Book link resolves to ${target}`);
      assert.ok(eligibleBookRoutes.has(target), `${character.slug}: Book link is publicly eligible`);
      assert.ok(sitemapRoutes.has(target), `${character.slug}: Book route is in the sitemap`);
      return target;
    });
    assert.deepEqual(actualRoutes, expectedPreview, `${character.slug}: canonical eligible Books appear once`);

    const continuationRoute = `characters/${character.slug}-stories.html`;
    assert.ok(sitemapRoutes.has(continuationRoute), `${character.slug}: full Book trail remains publicly reachable`);
    const continuationDocument = parsePage(continuationRoute);
    const continuationRoutes = elements(continuationDocument, 'a')
      .map((anchor) => routeForHref(attribute(anchor, 'href'), continuationRoute))
      .filter((route) => route.startsWith('books/'));
    assert.deepEqual(continuationRoutes, expectedRoutes, `${character.slug}: full trail keeps every eligible canonical Book`);
    assert.ok(continuationRoutes.every((route) => eligibleBookRoutes.has(route)), `${character.slug}: ineligible Books stay out`);
  }

  assert.equal(profilesWithBooks, 18);
  assert.ok(eligibleAssociationCount > 0, 'eligible Character-to-Book associations remain discoverable');

  const aralynn = parsePage('characters/aralynn-fox.html');
  for (const sectionId of [
    'character-aralynn-fox-freebies-heading',
    'character-people',
    'character-wander',
    'character-connections'
  ]) {
    assert.ok(elements(aralynn, 'h2').some((heading) => attribute(heading, 'id') === sectionId), `preserved section ${sectionId}`);
  }
  for (const groupId of ['character-aralynn-fox-freebies-songs', 'character-aralynn-fox-freebies-nursery-rhymes']) {
    assert.ok(elements(aralynn, 'h3').some((heading) => attribute(heading, 'id') === groupId), `preserved resource group ${groupId}`);
  }
  for (const prefix of ['../songs/', '../nursery-rhymes/']) {
    const resourceRoutes = elements(aralynn, 'a')
      .map((anchor) => attribute(anchor, 'href'))
      .filter((href) => href.startsWith(prefix))
      .map((href) => routeForHref(href, 'characters/aralynn-fox.html'));
    assert.ok(resourceRoutes.length > 0, `${prefix}: existing Character associations remain linked`);
    for (const route of resourceRoutes) assert.ok(fs.existsSync(path.join(output, route)), `${prefix}: ${route} resolves`);
  }
});

test('character journeys link only to public routes and always offer a path back to the exploration hub', () => {
  const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters
    .filter((character) => character.published !== false);
  const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
  const sitemapRoutes = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => (
    decodeURIComponent(new URL(match[1]).pathname).replace(/^\/+/, '') || 'index.html'
  )));
  const publicSurfaces = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'public-surface-index.json'), 'utf8')).records;
  const primaryRoutes = new Set(publicSurfaces
    .filter((record) => record.state === 'primary' && record.navigation)
    .map((record) => record.route));
  assert.ok(sitemapRoutes.has('start-here.html'), 'the exploration hub is a public destination');
  assert.ok(primaryRoutes.has('start-here.html'), 'the exploration hub is navigation-eligible');

  for (const character of characters) {
    const profileRoute = `characters/${character.slug}.html`;
    const document = parsePage(profileRoute);
    const internalLinks = elements(document, 'a')
      .map((anchor) => attribute(anchor, 'href'))
      .filter(Boolean)
      .map((href) => ({ href, url: new URL(href, `https://hawkinshollowbooks.com/${profileRoute}`) }))
      .filter(({ url }) => url.origin === 'https://hawkinshollowbooks.com');
    const hubLinks = internalLinks.filter(({ url }) => url.pathname.replace(/^\/+/, '') === 'start-here.html');
    const nextSection = elements(document, 'section')
      .find((section) => attribute(section, 'aria-labelledby') === 'character-next');
    const nextHubLinks = elements(nextSection || {}, 'a')
      .filter((anchor) => routeForHref(attribute(anchor, 'href'), profileRoute) === 'start-here.html');

    assert.equal(hubLinks.length, 2, `${character.slug}: navigation and journey each link to the hub once`);
    assert.equal(nextHubLinks.length, 1, `${character.slug}: one contextual return link at the end of the journey`);
    for (const { href, url } of internalLinks) {
      const target = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      assert.ok(fs.existsSync(path.join(output, target)), `${profileRoute}: ${href} resolves to a generated page`);
      assert.ok(sitemapRoutes.has(target), `${profileRoute}: ${href} targets a public sitemap page`);
      assert.ok(primaryRoutes.has(target), `${profileRoute}: ${href} targets a primary public surface`);
      assert.doesNotMatch(href, /ENV-0032|Farmhouse Exterior/i, `${profileRoute}: local-only place stays private`);
    }
  }
});
