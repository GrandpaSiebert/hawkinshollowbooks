const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const { inspectImageAsset } = require('../scripts/image-asset');
const { getImageAlt } = require('../scripts/image-alt-text');

const root = path.join(__dirname, '..');
const output = path.join(root, 'build-recovery');
const attribute = (node, name) => (node.attrs || []).find((entry) => entry.name === name)?.value || '';
const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const find = (node, predicate) => [
  ...(predicate(node) ? [node] : []),
  ...(node.childNodes || []).flatMap((child) => find(child, predicate))
];
const hasClass = (node, name) => attribute(node, 'class').split(/\s+/).includes(name);
const parsePage = (route) => parse5.parse(fs.readFileSync(path.join(output, route), 'utf8'));
const resolveAsset = (source, route) => path.join(output,
  decodeURIComponent(new URL(source, `https://hawkinshollowbooks.com/${route}`).pathname).replace(/^\//, ''));

test('every map destination has a small, accessible place thumbnail and a working link', () => {
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated', 'entity-index.json'), 'utf8'));
  const places = [...index.byType.environments, ...index.byType.landmarks];
  const cards = find(parsePage('map.html'), (node) => hasClass(node, 'map-place-card'));
  assert.equal(cards.length, places.length);
  for (const place of places) {
    const card = cards.find((node) => attribute(node, 'href') === place.entityPageHref);
    assert.ok(card, `${place.name}: map card exists`);
    assert.ok(fs.existsSync(path.join(output, place.entityPageHref)), `${place.name}: destination exists`);
    const image = find(card, (node) => node.tagName === 'img')[0];
    assert.ok(image, `${place.name}: thumbnail exists`);
    assert.equal(attribute(image, 'alt'), '', 'thumbnail repeats the destination heading inside the same link');
    assert.ok(find(card, node => node.tagName === 'h3').some(heading => text(heading) === place.name),
      `${place.name}: visible heading supplies the accessible destination name`);
    assert.equal(attribute(image, 'loading'), 'lazy');
    const bytes = fs.readFileSync(resolveAsset(attribute(image, 'src'), 'map.html'));
    const dimensions = inspectImageAsset(bytes, '.webp');
    assert.ok(dimensions && dimensions.width <= 480 && dimensions.height <= 320, `${place.name}: bounded WebP`);
    assert.ok(bytes.length < 150 * 1024, `${place.name}: thumbnail stays below 150 KiB`);
  }
});

test('place neighbor cards show each character’s own introduction and portrait', () => {
  const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters;
  const index = JSON.parse(fs.readFileSync(path.join(output, 'generated', 'entity-index.json'), 'utf8'));
  const places = [...index.byType.environments, ...index.byType.landmarks];
  let checked = 0;
  for (const place of places) {
    const route = place.entityPageHref;
    const section = find(parsePage(route), (node) => attribute(node, 'aria-labelledby') === 'place-neighbors')[0];
    assert.ok(section, `${place.name}: neighbors section exists`);
    const cards = find(section, (node) => hasClass(node, 'character-neighbor-card'));
    const introductions = [];
    for (const card of cards) {
      const link = find(card, (node) => node.tagName === 'a')[0];
      const character = characters.find((entry) => attribute(link, 'href') === `../../characters/${entry.slug}.html`);
      assert.ok(character, `${place.name}: links to a known character`);
      const paragraphs = find(card, (node) => node.tagName === 'p');
      assert.ok(paragraphs.some((paragraph) => text(paragraph).trim() === character.description),
        `${place.name}: ${character.name} has their own introduction`);
      assert.doesNotMatch(text(card), /is often part of what makes .* feel familiar/);
      const image = find(card, (node) => node.tagName === 'img')[0];
      assert.equal(attribute(image, 'alt'), getImageAlt('portrait', character.name, character.heroImage));
      assert.notEqual(attribute(image, 'alt'), character.name, 'portrait adds reviewed visual details beyond the destination name');
      assert.ok(fs.existsSync(resolveAsset(attribute(image, 'src'), route)));
      introductions.push(character.description);
      checked += 1;
    }
    assert.equal(new Set(introductions).size, introductions.length, `${place.name}: introductions differ`);
  }
  assert.ok(checked > 0, 'place neighbor cards were checked');
});
