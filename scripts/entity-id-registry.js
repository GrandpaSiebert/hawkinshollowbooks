const fs = require('fs');
const path = require('path');

const REGISTRY_VERSION = 1;
const REGISTRY_RELATIVE_PATH = path.join('data', 'entity-id-registry.json');
const TYPE_PREFIX = Object.freeze({ relationship: 'REL', environment: 'ENV', landmark: 'LND' });

function fail(message) {
  throw new Error(`Entity ID registry: ${message}`);
}

function parseId(type, id) {
  const match = new RegExp(`^${TYPE_PREFIX[type]}-(\\d{4,})$`).exec(String(id));
  if (!match) fail(`${JSON.stringify(id)} is not a valid ${type} ID (${TYPE_PREFIX[type]}-NNNN)`);
  return Number(match[1]);
}

function formatId(type, number) {
  return `${TYPE_PREFIX[type]}-${String(number).padStart(4, '0')}`;
}

function splitKey(key) {
  const index = String(key).indexOf(':');
  const type = index > 0 ? key.slice(0, index) : '';
  if (!TYPE_PREFIX[type] || index === key.length - 1) fail(`malformed entry key ${JSON.stringify(key)}`);
  return { type, sourcePath: key.slice(index + 1) };
}

function sourceIdentity(sourcePath) {
  return String(sourcePath).normalize('NFC').toLowerCase();
}

function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('registry must be an object');
  if (registry.version !== REGISTRY_VERSION) fail(`unsupported version ${JSON.stringify(registry.version)}`);
  for (const field of ['nextByType', 'entries', 'retired']) {
    if (!registry[field] || typeof registry[field] !== 'object' || Array.isArray(registry[field])) {
      fail(`"${field}" must be an object`);
    }
  }

  const idOwners = new Map();
  const identityOwners = new Map();
  const highest = Object.fromEntries(Object.keys(TYPE_PREFIX).map((type) => [type, 0]));
  const claim = (id, owner, type) => {
    const number = parseId(type, id);
    if (idOwners.has(id)) fail(`duplicate ID ${id} claimed by ${idOwners.get(id)} and ${owner}`);
    idOwners.set(id, owner);
    highest[type] = Math.max(highest[type], number);
  };

  for (const [key, entry] of Object.entries(registry.entries)) {
    const { type, sourcePath } = splitKey(key);
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') fail(`entry ${JSON.stringify(key)} has no id`);
    if (entry.state !== undefined && entry.state !== 'reserved') fail(`entry ${JSON.stringify(key)} has unknown state ${JSON.stringify(entry.state)}`);
    claim(entry.id, key, type);
    const identity = sourceIdentity(sourcePath);
    if (identityOwners.has(identity)) {
      fail(`duplicate source ${JSON.stringify(sourcePath)} claimed by ${identityOwners.get(identity)} and ${key}`);
    }
    identityOwners.set(identity, key);
  }
  for (const [id, entry] of Object.entries(registry.retired)) {
    const type = Object.keys(TYPE_PREFIX).find((candidate) => id.startsWith(`${TYPE_PREFIX[candidate]}-`));
    if (!type) fail(`retired ID ${JSON.stringify(id)} has no known prefix`);
    if (!entry || typeof entry.reason !== 'string' || !entry.reason) fail(`retired ID ${id} needs a reason`);
    claim(id, `retired:${id}`, type);
  }
  for (const type of Object.keys(TYPE_PREFIX)) {
    const next = registry.nextByType[type];
    if (!Number.isInteger(next) || next <= highest[type]) {
      fail(`nextByType.${type} (${next}) must be an integer greater than the highest assigned or retired ${type} ID (${highest[type]})`);
    }
  }
  return registry;
}

function loadRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) fail(`${registryPath} is missing; it is the authoritative path-to-ID mapping and must be checked in`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    fail(`${registryPath} is not valid JSON (${error.message})`);
  }
  return validateRegistry(parsed);
}

function sortObject(object) {
  return Object.fromEntries(Object.keys(object).sort(codeUnitCompare).map((key) => [key, object[key]]));
}

function serializeRegistry(registry) {
  return `${JSON.stringify({
    version: registry.version,
    nextByType: sortObject(registry.nextByType),
    entries: sortObject(registry.entries),
    retired: sortObject(registry.retired)
  }, null, 2)}\n`;
}

/**
 * Resolves canonical IDs for the current source set from the persisted registry.
 * Known paths keep their ID; unknown paths are allocated monotonically in
 * code-unit path order, so enumeration order never matters. Absent sources keep
 * their IDs; an absent entry marked state "reserved" (authoritative but
 * unpublished) is also exempt from rename detection. A new source appearing
 * while another unreserved source disappears is treated as a possible rename and
 * throws, as does anything else ambiguous.
 */
function resolveIds(registry, sourcesByType, { allowNewAllocations = true } = {}) {
  validateRegistry(registry);
  const next = {
    ...registry,
    nextByType: { ...registry.nextByType },
    entries: { ...registry.entries },
    retired: { ...registry.retired }
  };
  const ids = {};
  const allocated = [];
  const missing = [];
  const seenIdentities = new Map();

  for (const type of Object.keys(TYPE_PREFIX)) {
    const sources = sourcesByType[type] || [];
    for (const sourcePath of sources) {
      const identity = sourceIdentity(sourcePath);
      if (seenIdentities.has(identity)) {
        fail(`duplicate canonical source ${JSON.stringify(sourcePath)} (also ${JSON.stringify(seenIdentities.get(identity))})`);
      }
      seenIdentities.set(identity, sourcePath);
    }

    const present = new Set(sources.map((sourcePath) => `${type}:${sourcePath}`));
    const unknown = [...new Set(sources)].filter((sourcePath) => !next.entries[`${type}:${sourcePath}`]);
    const absent = Object.keys(next.entries)
      .filter((key) => splitKey(key).type === type && !present.has(key))
      .sort(codeUnitCompare);
    const unexplainedAbsent = absent.filter((key) => next.entries[key].state !== 'reserved');

    if (unknown.length && unexplainedAbsent.length) {
      fail(`possible rename/move of ${unexplainedAbsent.map((key) => JSON.stringify(splitKey(key).sourcePath)).join(', ')} `
        + `with new ${type} source(s) ${unknown.map((value) => JSON.stringify(value)).join(', ')}; `
        + 'refusing to guess. Edit the registry entry key to the new path (rename), or add the old ID to "retired" (removal).');
    }
    if (unknown.length && !allowNewAllocations) {
      fail(`unregistered ${type} source(s) ${unknown.map((value) => JSON.stringify(value)).join(', ')}; `
        + 'run the build locally and commit data/entity-id-registry.json before deploying');
    }
    for (const key of unexplainedAbsent) missing.push({ type, sourcePath: splitKey(key).sourcePath, id: next.entries[key].id });

    for (const sourcePath of unknown.sort(codeUnitCompare)) {
      const id = formatId(type, next.nextByType[type]);
      next.nextByType[type] += 1;
      next.entries[`${type}:${sourcePath}`] = { id };
      allocated.push({ type, sourcePath, id });
    }

    ids[type] = Object.fromEntries(sources.map((sourcePath) => [sourcePath, next.entries[`${type}:${sourcePath}`].id]));
  }

  validateRegistry(next);
  return { registry: next, ids, allocated, missing };
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

module.exports = {
  REGISTRY_RELATIVE_PATH,
  TYPE_PREFIX,
  loadRegistry,
  resolveIds,
  serializeRegistry,
  validateRegistry,
  writeIfChanged
};
