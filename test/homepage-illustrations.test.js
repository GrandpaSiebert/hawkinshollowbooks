const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const artworks = require('../data/homepage-illustrations.json').illustrations;
const attr = (node, name) => (node.attrs || []).find(item => item.name === name)?.value || '';
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
function elements(node, tag) {
  return [...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap(child => elements(child, tag))];
}
function homepage() {
  assert.ok(fs.existsSync(path.join(output, 'index.html')), 'build the site before checking the homepage artifact');
  return parse5.parse(fs.readFileSync(path.join(output, 'index.html'), 'utf8'));
}

test('homepage keeps six discovery links, nine series paths, both free resources and the original welcome art', () => {
  const document = homepage();
  const anchors = elements(document, 'a');
  const choices = ['Explore Books', 'Meet a Character', 'Visit a Place', 'Explore a Friendship', 'Find a Family Activity', 'Celebrate a Season', 'Kids Songs', 'Nursery Rhymes'];
  for (const label of choices) {
    const link = anchors.find(anchor => attr(anchor, 'aria-label') === label);
    assert.ok(link, label);
    assert.ok(elements(link, 'h3').some(heading => text(heading) === label), 'text remains navigable independently of art');
    assert.ok(fs.existsSync(path.join(output, attr(link, 'href'))));
    assert.equal(elements(link, 'img').length, 1);
    assert.equal(attr(elements(link, 'img')[0], 'alt'), '', 'linked preview is decorative beside its complete text label');
  }
  for (const series of require('../data/series.json').series) {
    const heading = elements(document, 'h3').find(node => text(node) === series.title);
    assert.ok(heading, series.title);
    const card = heading.parentNode;
    assert.equal(elements(card, 'figure').length, 1);
    assert.match(text(elements(card, 'figcaption')[0]), /A book from this series/);
    const target = series.slug === 'storybooks' ? 'storybook-shelf.html' : series.slug + '.html';
    assert.ok(elements(card, 'a').some(link => attr(link, 'href') === target));
  }
  const welcome = require('../data/banners.json').home;
  assert.equal(attr(elements(document, 'img')[0], 'src'), welcome.image);
});

test('homepage previews reuse published book identities and verified resource art without cropped or large originals', () => {
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated/public-discovery-index.json'), 'utf8'));
  const document = homepage();
  const images = elements(document, 'img').slice(1);
  assert.equal(images.length, 17);
  let bytes = 0;
  for (const artwork of artworks) {
    const image = images.find(node => attr(node, 'src') === artwork.image);
    assert.ok(image, artwork.key);
    assert.equal(attr(image, 'loading'), 'lazy');
    assert.ok(Number(attr(image, 'width')) > 0 && Number(attr(image, 'height')) > 0);
    if (artwork.bookId) {
      const book = index.records.find(record => record.type === 'book' && record.id === artwork.bookId);
      assert.ok(book, artwork.bookId + ' is published and eligible');
      assert.equal(book.image.replace(/^\//, ''), artwork.source);
      assert.equal(book.href, artwork.sourcePage);
    }
    if (artwork.image.startsWith('https:')) {
      assert.ok(index.records.some(record => record.href === artwork.sourcePage && record.image === artwork.image));
    } else {
      const imagePath = path.join(output, artwork.image);
      assert.ok(fs.statSync(imagePath).size > 0, 'real image bytes, not a placeholder');
      bytes += fs.statSync(imagePath).size;
    }
  }
  assert.ok(bytes < 1024 * 1024, 'all local below-the-fold previews together stay below 1 MB');
  for (const figure of elements(document, 'figure')) {
    if (attr(figure, 'class') !== 'home-series-preview') continue;
    assert.match(attr(elements(figure, 'img')[0], 'alt'), /^Cover of /);
  }
});
