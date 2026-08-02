const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const authorityRegistryPath = path.join(root, 'data', 'canonical-authority-registry.json');
const sourceRegistryPath = path.join(root, 'data', 'canonical-source-registry.json');

function loadAuthorityRegistry() {
  if (!fs.existsSync(authorityRegistryPath)) {
    throw new Error('Missing canonical authority registry: data/canonical-authority-registry.json');
  }

  const parsed = JSON.parse(fs.readFileSync(authorityRegistryPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.entities) {
    throw new Error('Invalid canonical authority registry format. Expected top-level entities object.');
  }

  return parsed;
}

function projectLegacySourceRegistry(authorityRegistry) {
  const projectedEntities = {};

  for (const [entityKey, config] of Object.entries(authorityRegistry.entities || {})) {
    projectedEntities[entityKey] = {
      canonicalAuthority: config && config.canonicalAuthority ? config.canonicalAuthority : 'Unspecified Authority',
      canonicalSource: config && config.canonicalSource ? config.canonicalSource : '',
      canonicalPath: config && config.canonicalPath ? config.canonicalPath : '',
      compatibilitySource: Object.prototype.hasOwnProperty.call(config || {}, 'compatibilitySource')
        ? config.compatibilitySource
        : null,
      compatibilityPath: Object.prototype.hasOwnProperty.call(config || {}, 'compatibilityPath')
        ? config.compatibilityPath
        : null
    };
  }

  return {
    version: authorityRegistry.version || 1,
    deprecated: true,
    projectionOf: 'data/canonical-authority-registry.json',
    entities: projectedEntities
  };
}

function run() {
  const authorityRegistry = loadAuthorityRegistry();
  const projection = projectLegacySourceRegistry(authorityRegistry);
  const output = `${JSON.stringify(projection, null, 2)}\n`;

  fs.writeFileSync(sourceRegistryPath, output, 'utf8');
  console.log('Projected data/canonical-source-registry.json from data/canonical-authority-registry.json');
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  projectLegacySourceRegistry
};
