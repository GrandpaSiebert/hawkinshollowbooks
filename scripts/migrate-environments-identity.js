const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const environmentsPath = path.join(root, 'data', 'environments.json');

function pad4(value) {
  return String(value).padStart(4, '0');
}

function buildCanonicalMap(environments) {
  const ranked = [...environments]
    .map((environment, index) => ({
      environment,
      index,
      sortOrder: Number(environment.sortOrder || 0)
    }))
    .sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      const aSlug = String(a.environment.slug || '').toLowerCase();
      const bSlug = String(b.environment.slug || '').toLowerCase();
      return aSlug.localeCompare(bSlug);
    });

  const bySlug = new Map();
  ranked.forEach((entry, i) => {
    const slug = String(entry.environment.slug || '').trim();
    if (!slug) {
      return;
    }
    bySlug.set(slug, `HH-ENV-${pad4(i + 1)}`);
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

function migrateEnvironment(environment, canonicalBySlug) {
  const existingIdentity = environment && typeof environment.identity === 'object' ? environment.identity : {};
  const slug = String(environment.slug || '').trim();
  const canonicalId = String(existingIdentity.canonicalId || '').trim()
    || canonicalBySlug.get(slug)
    || '';

  const legacyAliases = normalizeAliases(
    existingIdentity.legacyAliases,
    environment.legacyAliases,
    environment.code
  );

  const migrated = {
    slug: environment.slug,
    identity: {
      canonicalId,
      legacyAliases
    }
  };

  // Keep top-level code during migration for compatibility if present.
  if (environment.code) {
    migrated.code = environment.code;
  }

  for (const [key, value] of Object.entries(environment)) {
    if (key === 'slug' || key === 'identity' || key === 'canonicalId' || key === 'legacyAliases' || key === 'code') {
      continue;
    }
    migrated[key] = value;
  }

  return migrated;
}

function run() {
  const payload = JSON.parse(fs.readFileSync(environmentsPath, 'utf8'));
  const environments = Array.isArray(payload.environments) ? payload.environments : [];
  const canonicalBySlug = buildCanonicalMap(environments);

  payload.environments = environments.map((environment) => migrateEnvironment(environment, canonicalBySlug));

  fs.writeFileSync(environmentsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Migrated ${payload.environments.length} environments to identity.canonicalId + identity.legacyAliases`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
