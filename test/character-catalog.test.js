const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const { validateCharacterCatalog } = require('../scripts/validate-character-catalog');

test('catalog validation rejects missing, empty, whitespace-only, and non-text descriptions', () => {
  const errors = validateCharacterCatalog({ characters: [
    { name: 'Missing' },
    { name: 'Empty', description: '' },
    { name: 'Whitespace', description: ' \n\t ' },
    { name: 'Non-text', description: 42 },
    { name: 'Ready', description: 'A thoughtful neighbor.' },
    { name: 'Draft', description: '', published: false }
  ] });
  assert.equal(errors.length, 4);
  for (const name of ['Missing', 'Empty', 'Whitespace', 'Non-text']) {
    assert.ok(errors.some((error) => error.includes(`"${name}"`)));
  }
  assert.deepEqual(validateCharacterCatalog({}), ['Character directory must contain a characters array.']);
});

test('every published character has a visible introduction in the generated catalog', () => {
  const root = path.join(__dirname, '..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8'));
  assert.deepEqual(validateCharacterCatalog(data), []);
  const document = parse5.parse(fs.readFileSync(path.join(root, 'build-recovery', 'characters.html'), 'utf8'));
  const find = (node, predicate) => [
    ...(predicate(node) ? [node] : []),
    ...(node.childNodes || []).flatMap((child) => find(child, predicate))
  ];
  const attribute = (node, name) => (node.attrs || []).find((entry) => entry.name === name)?.value || '';
  const text = (node) => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
  const cards = find(document, (node) => attribute(node, 'class').split(/\s+/).includes('character-card'));
  const published = data.characters.filter((character) => character.published !== false);
  assert.equal(cards.length, published.length);
  for (const character of published) {
    const card = cards.find((node) => attribute(node, 'href') === `characters/${character.slug}.html`);
    assert.ok(card, `${character.name}: catalog card exists`);
    const paragraphs = find(card, (node) => node.tagName === 'p');
    assert.ok(paragraphs.some((paragraph) => text(paragraph).trim() === character.description.trim()),
      `${character.name}: the catalog shows the complete introduction`);
  }
});
