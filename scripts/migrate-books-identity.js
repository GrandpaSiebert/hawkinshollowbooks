const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const booksPath = path.join(root, 'data', 'books.json');

const modeBySeriesSlug = {
  'storybooks': 'A',
  'first-readers': 'B',
  'second-readers': 'C',
  'growing-together': 'D',
  'tender-times': 'E',
  'hero-play-poems': 'F',
  'basic-training': 'G',
  'bedtime-library': 'H',
  'holiday-story-poems': 'I'
};

function toSequence(raw, fallbackSortOrder) {
  const text = String(raw || '').trim();
  const match = text.match(/([0-9]{1,6})$/);
  if (match) {
    return String(match[1]).padStart(4, '0').slice(-4);
  }

  const order = Number(fallbackSortOrder || 0);
  if (Number.isFinite(order) && order > 0) {
    return String(order).padStart(4, '0').slice(-4);
  }

  return '0001';
}

function deriveCanonicalId(book) {
  const seriesSlug = String(book && book.seriesSlug ? book.seriesSlug : '').toLowerCase();
  const mode = modeBySeriesSlug[seriesSlug] || 'Z';
  const existingAlias = book && book.code ? book.code : '';
  const sequence = toSequence(existingAlias, book && book.sortOrder);
  return `HH-${mode}-${sequence}`;
}

function normalizeAliases(...values) {
  const seen = new Set();
  const aliases = [];
  for (const value of values.flat()) {
    const text = String(value || '').trim();
    if (!text) {
      continue;
    }
    const key = text.toUpperCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    aliases.push(text);
  }
  return aliases;
}

function migrateBook(book) {
  const existingIdentity = book && typeof book.identity === 'object' ? book.identity : {};
  const existingCanonical = String(existingIdentity.canonicalId || book.canonicalId || '').trim();
  const canonicalId = existingCanonical || deriveCanonicalId(book);

  const legacyAliases = normalizeAliases(
    existingIdentity.legacyAliases,
    book.legacyAliases,
    book.code
  );

  const migrated = {
    slug: book.slug,
    identity: {
      canonicalId,
      legacyAliases
    },
    title: book.title,
    seriesSlug: book.seriesSlug,
    coverImage: book.coverImage,
    description: book.description,
    summary: book.summary,
    characters: Array.isArray(book.characters) ? book.characters : [],
    published: Boolean(book.published),
    sortOrder: book.sortOrder
  };

  for (const [key, value] of Object.entries(book)) {
    if (Object.prototype.hasOwnProperty.call(migrated, key)) {
      continue;
    }
    if (key === 'code' || key === 'canonicalId' || key === 'legacyAliases' || key === 'identity') {
      continue;
    }
    migrated[key] = value;
  }

  return migrated;
}

function run() {
  const payload = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
  const books = Array.isArray(payload.books) ? payload.books : [];

  payload.books = books.map(migrateBook);

  fs.writeFileSync(booksPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${payload.books.length} books to identity.canonicalId + identity.legacyAliases`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
