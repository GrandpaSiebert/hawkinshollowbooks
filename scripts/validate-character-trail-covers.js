const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const characters = JSON.parse(fs.readFileSync(path.join(root, 'data', 'characters.json'), 'utf8')).characters || [];
const models = JSON.parse(fs.readFileSync(path.join(root, 'data', 'books.json'), 'utf8')).books || [];
const library = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'library-index.json'), 'utf8')).books || [];
const associations = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-character-book-index.json'), 'utf8')).records || [];
const modelById = new Map(models.map((book) => [String(book.identity && book.identity.canonicalId || '').toUpperCase(), book]));
const libraryById = new Map(library.map((book) => [String(book.id || '').toUpperCase(), book]));
const normalize = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const failures = [];
let aligned = 0;
let withheld = 0;

for (const association of associations) {
  const character = characters.find((entry) => String(entry.identity && entry.identity.canonicalId || '').toUpperCase() === String(association.canonicalCharacterId || '').toUpperCase());
  if (!character) continue;
  const pages = [`${character.slug}.html`, `${character.slug}-stories.html`].map((name) => fs.readFileSync(path.join(buildDir, 'characters', name), 'utf8'));
  for (const bookAssociation of association.books || []) {
    const libraryBook = libraryById.get(String(bookAssociation.bookId || '').toUpperCase());
    const model = modelById.get(String(bookAssociation.bookId || '').toUpperCase());
    const cover = model && model.coverImage && libraryBook && normalize(model.title) === normalize(libraryBook.title) ? String(model.coverImage).replace(/^\//, '') : '';
    if (cover) aligned += 1;
    else withheld += 1;
    for (const page of pages) {
      const cards = Array.from(page.matchAll(/<article class="character-story-card">([\s\S]*?)<\/article>/g)).map((match) => match[1]);
      const card = cards.find((markup) => markup.includes(`href="../${bookAssociation.bookHref}"`));
      if (!card) { failures.push(`${character.slug}: card missing ${bookAssociation.bookId}`); continue; }
      if (cover && !card.includes(`src="../${cover}"`)) failures.push(`${character.slug}: aligned cover missing ${bookAssociation.bookId}`);
      if (!cover && /<img src="\.\.\/assets\/covers\//.test(card)) failures.push(`${character.slug}: unproven cover rendered ${bookAssociation.bookId}`);
    }
  }
}
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Character trail cover validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ associations: aligned + withheld, aligned, withheld, unproven: 0 }, null, 2));
}