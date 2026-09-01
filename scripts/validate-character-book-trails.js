const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters || [];
const index = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-character-book-index.json'), 'utf8')).records || [];
const failures = [];
let renderedCharacters = 0;
let renderedLinks = 0;
let minBooks = Infinity;
let maxBooks = 0;

for (const record of index) {
  const character = characters.find((entry) => String(entry.identity && entry.identity.canonicalId || '').toUpperCase() === String(record.canonicalCharacterId || '').toUpperCase());
  if (!character) {
    failures.push(`${record.canonicalCharacterId}: no canonical character page record`);
    continue;
  }
  const page = fs.readFileSync(path.join(buildDir, 'characters', `${character.slug}.html`), 'utf8');
  const storiesPage = fs.readFileSync(path.join(buildDir, 'characters', `${character.slug}-stories.html`), 'utf8');
  const expected = [...new Set((record.books || []).map((book) => book.bookHref))];
  const sectionMatch = page.match(/<section class="content-card" aria-labelledby="character-book-discovery">([\s\S]*?)<\/section>/);
  if (!sectionMatch) {
    failures.push(`${character.slug}: book discovery section is missing`);
    continue;
  }
  const rendered = Array.from(sectionMatch[1].matchAll(/href="\.\.\/([^"]+)"/g)).map((match) => match[1]);
  const continuationRendered = Array.from(storiesPage.matchAll(/href="\.\.\/([^"#]+\.html)"/g)).map((match) => match[1]).filter((href) => href.startsWith('books/'));
  if (rendered.length !== expected.length || new Set(rendered).size !== rendered.length) failures.push(`${character.slug}: duplicate or missing rendered book links`);
  if (continuationRendered.length !== expected.length || new Set(continuationRendered).size !== continuationRendered.length) failures.push(`${character.slug}: duplicate or missing continuation book links`);
  for (const href of expected) {
    if (!rendered.includes(href)) failures.push(`${character.slug}: missing ${href}`);
    if (!continuationRendered.includes(href)) failures.push(`${character.slug}: continuation missing ${href}`);
    if (!fs.existsSync(path.join(buildDir, href))) failures.push(`${character.slug}: destination missing ${href}`);
  }
  renderedCharacters += 1;
  renderedLinks += rendered.length;
  minBooks = Math.min(minBooks, rendered.length);
  maxBooks = Math.max(maxBooks, rendered.length);
}

const oneBook = index.filter((record) => (record.books || []).length === 1).length;
const multipleBooks = index.filter((record) => (record.books || []).length > 1).length;
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Character book trail validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ representedCharacters: index.length, renderedCharacters, renderedLinks, minBooks: minBooks === Infinity ? 0 : minBooks, maxBooks, oneBook, multipleBooks }, null, 2));
}