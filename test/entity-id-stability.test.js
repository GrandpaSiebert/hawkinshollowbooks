const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REGISTRY_RELATIVE_PATH,
  loadRegistry,
  resolveIds,
  serializeRegistry,
  validateRegistry
} = require('../scripts/entity-id-registry');
const { writeWorldCanonArtifacts } = require('../scripts/world-canon-import');

const root = path.join(__dirname, '..');
const registryFile = path.join(root, REGISTRY_RELATIVE_PATH);
const FARMHOUSE = 'Environments/Farmhouse Exterior Visual Canon.docx';
const clone = (value) => JSON.parse(JSON.stringify(value));
const registry = () => loadRegistry(registryFile);

function sourcesOf(reg, type, { includeReserved = false } = {}) {
  return Object.entries(reg.entries)
    .filter(([key, entry]) => key.startsWith(`${type}:`) && (includeReserved || entry.state !== 'reserved'))
    .map(([key]) => key.slice(type.length + 1));
}
function sourceSet(reg, options) {
  return {
    environment: sourcesOf(reg, 'environment', options),
    landmark: sourcesOf(reg, 'landmark', options),
    relationship: sourcesOf(reg, 'relationship', options)
  };
}
function shuffled(values, seed) {
  const result = values.slice();
  let state = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function productionEnvironmentIds(reg) {
  return Object.fromEntries(sourcesOf(reg, 'environment').map((source) => [source, reg.entries[`environment:${source}`].id]));
}
function withoutFarmhouse(ids) {
  const copy = { ...ids };
  delete copy[FARMHOUSE];
  return copy;
}
function withStrictEntityIds(callback) {
  const previous = process.env.HH_ENTITY_ID_STRICT;
  process.env.HH_ENTITY_ID_STRICT = '1';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.HH_ENTITY_ID_STRICT;
    else process.env.HH_ENTITY_ID_STRICT = previous;
  }
}

test('established sources resolve to their exact persisted IDs, matching production and the checked-in canon snapshot', () => {
  const reg = registry();
  const fallback = JSON.parse(fs.readFileSync(path.join(root, 'data', 'world-canon-fallback.json'), 'utf8'));
  const result = resolveIds(reg, sourceSet(reg));
  assert.deepEqual(result.allocated, []);
  assert.equal(Object.keys(result.ids.environment).length, 31);
  assert.equal(Object.keys(result.ids.landmark).length, 32);
  assert.equal(Object.keys(result.ids.relationship).length, 28);
  const expectedEnvironments = sourcesOf(reg, 'environment').sort();
  assert.equal(expectedEnvironments.length, 31);
  const byId = Object.fromEntries(Object.entries(result.ids.environment).map(([source, id]) => [id, source]));
  for (let number = 1; number <= 30; number += 1) {
    assert.ok(byId[`ENV-${String(number).padStart(4, '0')}`], `ENV-${number} must remain assigned`);
  }
  for (const [type, records] of [['environment', fallback.byType.environments], ['landmark', fallback.byType.landmarks], ['relationship', fallback.byType.relationships]]) {
    for (const record of records) {
      assert.equal(reg.entries[`${type}:${record.sourceDocument}`].id, record.id, record.sourceDocument);
    }
  }
});

test('strict production resolution accepts every registered source without mutating the authoritative registry', () => {
  const reg = registry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-id-strict-known-'));
  try {
    const authoritativePath = path.join(dir, REGISTRY_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(authoritativePath), { recursive: true });
    fs.copyFileSync(registryFile, authoritativePath);
    const original = fs.readFileSync(authoritativePath);
    const files = Object.entries(sourceSet(reg, { includeReserved: true })).flatMap(([type, sources]) => {
      const category = { environment: 'Environments', landmark: 'Landmarks', relationship: 'Relationships' }[type];
      return sources.map((source) => ({
        category, extension: 'docx', path: source, sizeBytes: 1, lastModifiedUtc: '2026-01-01T00:00:00.000Z'
      }));
    });

    withStrictEntityIds(() => writeWorldCanonArtifacts(dir, { characters: [] }, { files }));

    assert.deepEqual(resolveIds(reg, sourceSet(reg, { includeReserved: true }), { allowNewAllocations: false }).allocated, []);
    assert.deepEqual(fs.readFileSync(authoritativePath), original);
    const generatedRegistry = fs.readFileSync(path.join(dir, 'generated', 'entity-id-registry.json'));
    assert.deepEqual(generatedRegistry, original);
    const environments = JSON.parse(fs.readFileSync(path.join(dir, 'generated', 'environment-canon-index.json'), 'utf8'));
    const farmhouse = environments.records.find((record) => record.sourceDocument === FARMHOUSE);
    assert.equal(farmhouse.id, 'ENV-0032');
    assert.deepEqual(productionEnvironmentIds(reg),
      Object.fromEntries(environments.records.map((record) => [record.sourceDocument, record.id])));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('strict production resolution rejects an unknown canonical source without mutating the authoritative registry', () => {
  const reg = registry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-id-strict-unknown-'));
  try {
    const authoritativePath = path.join(dir, REGISTRY_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(authoritativePath), { recursive: true });
    fs.copyFileSync(registryFile, authoritativePath);
    const original = fs.readFileSync(authoritativePath);
    const files = Object.entries(sourceSet(reg, { includeReserved: true })).flatMap(([type, sources]) => {
      const category = { environment: 'Environments', landmark: 'Landmarks', relationship: 'Relationships' }[type];
      return sources.map((source) => ({
        category, extension: 'docx', path: source, sizeBytes: 1, lastModifiedUtc: '2026-01-01T00:00:00.000Z'
      }));
    });
    files.push({
      category: 'Environments',
      extension: 'docx',
      path: 'Environments/Unregistered Canonical Place Visual Canon.docx',
      sizeBytes: 1,
      lastModifiedUtc: '2026-01-01T00:00:00.000Z'
    });

    assert.throws(
      () => withStrictEntityIds(() => writeWorldCanonArtifacts(dir, { characters: [] }, { files })),
      /unregistered environment source/
    );
    assert.deepEqual(fs.readFileSync(authoritativePath), original);
    assert.equal(fs.existsSync(path.join(dir, 'generated', 'entity-id-registry.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('source enumeration order never changes any ID', () => {
  const reg = registry();
  const baseline = resolveIds(reg, sourceSet(reg, { includeReserved: true })).ids;
  const forward = sourceSet(reg, { includeReserved: true });
  const reversed = Object.fromEntries(Object.entries(forward).map(([type, values]) => [type, values.slice().reverse()]));
  assert.deepEqual(resolveIds(reg, reversed).ids, baseline);
  for (const seed of [1, 7, 42, 2026, 31337]) {
    const random = Object.fromEntries(Object.entries(forward).map(([type, values]) => [type, shuffled(values, seed)]));
    assert.deepEqual(resolveIds(reg, random).ids, baseline, `seed ${seed}`);
  }
});

test('a lexically earlier new source cannot shift established IDs and receives the next monotonic ID', () => {
  const reg = registry();
  const before = resolveIds(reg, sourceSet(reg)).ids;
  const sources = sourceSet(reg);
  sources.environment.push('Environments/Aardvark Hollow Visual Canon.docx');
  const result = resolveIds(reg, sources);
  assert.deepEqual(result.allocated, [{ type: 'environment', sourcePath: 'Environments/Aardvark Hollow Visual Canon.docx', id: 'ENV-0035' }]);
  for (const [source, id] of Object.entries(before.environment)) assert.equal(result.ids.environment[source], id, source);
  assert.deepEqual(result.ids.landmark, before.landmark);
  assert.deepEqual(result.ids.relationship, before.relationship);
  assert.equal(result.registry.nextByType.environment, 36);
  assert.equal(reg.nextByType.environment, 35, 'input registry must not be mutated');
});

test('removing a source keeps its ID reserved and never recycles it', () => {
  const reg = registry();
  const gone = 'Environments/Barn Lane Visual Canon.docx';
  const goneId = reg.entries[`environment:${gone}`].id;
  const sources = sourceSet(reg);
  sources.environment = sources.environment.filter((source) => source !== gone);
  const removed = resolveIds(reg, sources);
  assert.equal(removed.registry.entries[`environment:${gone}`].id, goneId);
  assert.deepEqual(removed.missing.map((entry) => entry.id), [goneId]);
  assert.equal(Object.keys(removed.ids.environment).length, 30);

  const withNew = clone(sources);
  withNew.environment.push('Environments/Brand New Visual Canon.docx');
  assert.throws(() => resolveIds(reg, withNew), /possible rename\/move/);

  const retiredReg = clone(reg);
  delete retiredReg.entries[`environment:${gone}`];
  retiredReg.retired[goneId] = { reason: 'Source deliberately removed.' };
  const reused = resolveIds(retiredReg, withNew);
  assert.notEqual(reused.ids.environment['Environments/Brand New Visual Canon.docx'], goneId);
  assert.equal(reused.ids.environment['Environments/Brand New Visual Canon.docx'], 'ENV-0035');

  const reusing = clone(retiredReg);
  reusing.entries['environment:Environments/Other Visual Canon.docx'] = { id: goneId };
  assert.throws(() => validateRegistry(reusing), new RegExp(`duplicate ID ${goneId} claimed by`));
});

test('duplicate ID claims fail closed', () => {
  const reg = registry();
  const duplicate = clone(reg);
  duplicate.entries['environment:Environments/Extra Visual Canon.docx'] = { id: 'ENV-0001' };
  assert.throws(() => validateRegistry(duplicate), /duplicate ID ENV-0001/);
  const crossType = clone(reg);
  crossType.entries['landmark:Landmarks/Extra Visual Canon.docx'] = { id: 'ENV-0002' };
  assert.throws(() => validateRegistry(crossType), /not a valid landmark ID/);
});

test('duplicate canonical source or path claims fail closed', () => {
  const reg = registry();
  const sources = sourceSet(reg);
  sources.environment.push(sources.environment[0]);
  assert.throws(() => resolveIds(reg, sources), /duplicate canonical source/);
  const caseVariant = sourceSet(reg);
  caseVariant.environment.push(caseVariant.environment[0].toUpperCase());
  assert.throws(() => resolveIds(reg, caseVariant), /duplicate canonical source/);
  const doubled = clone(reg);
  doubled.entries['environment:environments/barn lane visual canon.docx'] = { id: 'ENV-0099' };
  assert.throws(() => validateRegistry(doubled), /duplicate source/);
});

test('unknown sources receive deterministic, non-conflicting IDs regardless of discovery order', () => {
  const reg = registry();
  const added = ['Landmarks/Zebra Post Visual Canon.docx', 'Landmarks/Apple Gate Visual Canon.docx'];
  const forward = sourceSet(reg);
  forward.landmark.push(...added);
  const reverse = sourceSet(reg);
  reverse.landmark.push(...added.slice().reverse());
  const first = resolveIds(reg, forward);
  const second = resolveIds(reg, shuffledSources(reverse, 99));
  assert.deepEqual(first.ids, second.ids);
  assert.equal(first.ids.landmark[added[1]], 'LND-0033');
  assert.equal(first.ids.landmark[added[0]], 'LND-0034');
  assert.equal(new Set(Object.values(first.ids.landmark)).size, Object.keys(first.ids.landmark).length);
  assert.equal(serializeRegistry(first.registry), serializeRegistry(second.registry));
});
function shuffledSources(sources, seed) {
  return Object.fromEntries(Object.entries(sources).map(([type, values]) => [type, shuffled(values, seed)]));
}

test('rename or move ambiguity fails closed unless the registry is explicitly migrated', () => {
  const reg = registry();
  const oldPath = 'Environments/Barn Lane Visual Canon.docx';
  const newPath = 'Environments/Barn Lane Renamed Visual Canon.docx';
  const sources = sourceSet(reg);
  sources.environment = sources.environment.map((source) => (source === oldPath ? newPath : source));
  assert.throws(() => resolveIds(reg, sources), /possible rename\/move of "Environments\/Barn Lane Visual Canon.docx".*refusing to guess/);

  const migrated = clone(reg);
  migrated.entries[`environment:${newPath}`] = migrated.entries[`environment:${oldPath}`];
  delete migrated.entries[`environment:${oldPath}`];
  const result = resolveIds(migrated, sources);
  assert.equal(result.ids.environment[newPath], reg.entries[`environment:${oldPath}`].id);
  assert.deepEqual(result.allocated, []);
});

test('missing, malformed and inconsistent registries fail instead of silently resetting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-id-registry-'));
  try {
    assert.throws(() => loadRegistry(path.join(dir, 'absent.json')), /is missing/);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.throws(() => loadRegistry(bad), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const reg = registry();
  const mutations = [
    [(copy) => { copy.version = 2; }, /unsupported version/],
    [(copy) => { copy.entries['environment:Environments/X.docx'] = {}; }, /has no id/],
    [(copy) => { copy.entries['environment:Environments/X.docx'] = { id: 'ENV-12' }; }, /not a valid environment ID/],
    [(copy) => { copy.entries['environment:Environments/X.docx'] = { id: 'ENV-0099', state: 'bogus' }; }, /unknown state/],
    [(copy) => { copy.entries['widget:X'] = { id: 'ENV-0099' }; }, /malformed entry key/],
    [(copy) => { copy.nextByType.environment = 30; }, /must be an integer greater than the highest/],
    [(copy) => { copy.retired['ENV-0090'] = {}; }, /needs a reason/],
    [(copy) => { delete copy.retired; }, /"retired" must be an object/]
  ];
  for (const [mutate, expected] of mutations) {
    const copy = clone(reg);
    mutate(copy);
    assert.throws(() => validateRegistry(copy), expected);
  }
});

test('Farmhouse Exterior resolves to ENV-0032 without changing any established Environment ID', () => {
  const reg = registry();
  const farmhouse = reg.entries[`environment:${FARMHOUSE}`];
  assert.deepEqual(farmhouse, { id: 'ENV-0032' });
  assert.equal(reg.entries['environment:Environments/Farmhouse Porch Visual Canon.docx'].id, 'ENV-0010');

  const production = productionEnvironmentIds(reg);
  assert.equal(Object.keys(production).length, 31);
  assert.equal(production[FARMHOUSE], 'ENV-0032');
  const resolved = resolveIds(reg, sourceSet(reg));
  assert.deepEqual(resolved.ids.environment, production, 'publishing Farmhouse changes no established Environment ID');
  assert.deepEqual(resolved.allocated, []);

  const withoutFarmhouseSources = sourceSet(reg);
  withoutFarmhouseSources.environment = withoutFarmhouseSources.environment.filter((source) => source !== FARMHOUSE);
  const absent = resolveIds(reg, withoutFarmhouseSources);
  assert.deepEqual(absent.ids.environment, withoutFarmhouse(production));
  assert.deepEqual(absent.missing, [{ type: 'environment', sourcePath: FARMHOUSE, id: 'ENV-0032' }]);
  assert.equal(absent.registry.entries[`environment:${FARMHOUSE}`].id, 'ENV-0032', 'ENV-0032 remains assigned');

  const newWithFarmhouse = sourceSet(reg);
  newWithFarmhouse.environment.push('Environments/Another Place Visual Canon.docx');
  const next = resolveIds(reg, newWithFarmhouse);
  assert.equal(next.ids.environment['Environments/Another Place Visual Canon.docx'], 'ENV-0035');
  assert.deepEqual(next.ids.environment, { ...production, 'Environments/Another Place Visual Canon.docx': 'ENV-0035' });
});

test('the former path-sorted sequential allocation is what would have renumbered 21 Environments', () => {
  const reg = registry();
  const empty = { version: 1, nextByType: { environment: 1, landmark: 1, relationship: 1 }, entries: {}, retired: {} };
  const production = productionEnvironmentIds(reg);
  const publishedWithoutFarmhouse = withoutFarmhouse(production);
  const sourcesWithoutFarmhouse = sourcesOf(reg, 'environment').filter((source) => source !== FARMHOUSE);
  const legacyWithoutFarmhouse = resolveIds(empty, { environment: sourcesWithoutFarmhouse }).ids.environment;
  assert.deepEqual(legacyWithoutFarmhouse, publishedWithoutFarmhouse, 'legacy sequential assignment matched published sources before Farmhouse');
  const legacyWithFarmhouse = resolveIds(empty, { environment: sourcesOf(reg, 'environment') }).ids.environment;
  assert.equal(legacyWithFarmhouse[FARMHOUSE], 'ENV-0010');
  const shifted = Object.keys(publishedWithoutFarmhouse).filter((source) => legacyWithFarmhouse[source] !== production[source]);
  assert.equal(shifted.length, 21);
  const protectedIds = resolveIds(reg, sourceSet(reg)).ids.environment;
  assert.equal(Object.keys(production).filter((source) => protectedIds[source] !== production[source]).length, 0);
});

test('clean and warmed importer runs produce identical identity registries and never touch the authoritative file', () => {
  const reg = registry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-id-build-'));
  try {
    fs.mkdirSync(path.join(dir, 'data'));
    fs.copyFileSync(registryFile, path.join(dir, REGISTRY_RELATIVE_PATH));
    const categories = { environment: 'Environments', landmark: 'Landmarks', relationship: 'Relationships' };
    const files = Object.entries(categories).flatMap(([type, category]) => (
      shuffled(sourcesOf(reg, type, { includeReserved: true }), 5).map((source) => ({
        category, extension: 'docx', path: source, sizeBytes: 1, lastModifiedUtc: '2026-01-01T00:00:00.000Z'
      }))
    ));
    const outputDir = path.join(dir, 'generated');
    const snapshot = () => {
      const world = JSON.parse(fs.readFileSync(path.join(outputDir, 'world-canon-index.json'), 'utf8'));
      delete world.generatedAt;
      return { registry: fs.readFileSync(path.join(outputDir, 'entity-id-registry.json'), 'utf8'), world };
    };
    writeWorldCanonArtifacts(dir, { characters: [] }, { files }, outputDir);
    const clean = snapshot();
    writeWorldCanonArtifacts(dir, { characters: [] }, { files: files.slice().reverse() }, outputDir);
    const warmed = snapshot();
    assert.equal(clean.registry, warmed.registry);
    assert.deepEqual(clean.world, warmed.world);
    assert.equal(clean.registry, fs.readFileSync(registryFile, 'utf8'));
    assert.equal(fs.readFileSync(path.join(dir, REGISTRY_RELATIVE_PATH), 'utf8'), fs.readFileSync(registryFile, 'utf8'));
    const environments = Object.fromEntries(clean.world.byType.environments.map((record) => [record.sourceDocument, record.id]));
    assert.equal(environments[FARMHOUSE], 'ENV-0032');
    assert.equal(clean.world.byType.environments.length, 31);

    fs.rmSync(outputDir, { recursive: true });
    writeWorldCanonArtifacts(dir, { characters: [] }, { files }, outputDir);
    assert.equal(snapshot().registry, clean.registry, 'removing generated state cannot change identity');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the generated registry from the real build equals the authoritative checked-in mapping', () => {
  const generated = path.join(root, 'generated', 'entity-id-registry.json');
  assert.ok(fs.existsSync(generated), 'run the generator first');
  assert.equal(fs.readFileSync(generated, 'utf8'), fs.readFileSync(registryFile, 'utf8'));
});
