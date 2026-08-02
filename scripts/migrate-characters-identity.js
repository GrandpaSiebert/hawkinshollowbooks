const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const charactersPath = path.join(root, 'data', 'characters.json');

function pad4(value) {
  return String(value).padStart(4, '0');
}

function buildCanonicalMap(characters) {
  const ranked = [...characters]
    .map((character, index) => ({
      character,
      index,
      sortOrder: Number(character.sortOrder || 0)
    }))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      const aSlug = String(a.character.slug || '').toLowerCase();
      const bSlug = String(b.character.slug || '').toLowerCase();
      return aSlug.localeCompare(bSlug);
    });

  const bySlug = new Map();
  ranked.forEach((entry, i) => {
    const slug = String(entry.character.slug || '').trim();
    if (!slug) {
      return;
    }
    bySlug.set(slug, `HH-CHR-${pad4(i + 1)}`);
  });

  return bySlug;
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

function migrateCharacter(character, canonicalBySlug) {
  const existingIdentity = character && typeof character.identity === 'object' ? character.identity : {};
  const slug = String(character.slug || '').trim();
  const canonicalId = String(existingIdentity.canonicalId || '').trim()
    || canonicalBySlug.get(slug)
    || '';

  const legacyAliases = normalizeAliases(
    existingIdentity.legacyAliases,
    character.legacyAliases,
    character.code
  );

  const migrated = {
    slug: character.slug,
    identity: {
      canonicalId,
      legacyAliases
    }
  };

  // Keep top-level code during Phase 1B to avoid breaking current consumers.
  if (character.code) {
    migrated.code = character.code;
  }

  for (const [key, value] of Object.entries(character)) {
    if (key === 'slug' || key === 'identity' || key === 'canonicalId' || key === 'legacyAliases' || key === 'code') {
      continue;
    }
    migrated[key] = value;
  }

  return migrated;
}

function run() {
  const payload = JSON.parse(fs.readFileSync(charactersPath, 'utf8'));
  const characters = Array.isArray(payload.characters) ? payload.characters : [];
  const canonicalBySlug = buildCanonicalMap(characters);

  payload.characters = characters.map((character) => migrateCharacter(character, canonicalBySlug));

  fs.writeFileSync(charactersPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${payload.characters.length} characters to identity.canonicalId + identity.legacyAliases`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
