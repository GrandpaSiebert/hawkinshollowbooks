const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const contractPath = path.join(root, 'docs', 'architecture', 'canonical-id-contract.md');
const defaultReportPath = path.join(root, 'generated', 'validation', 'canonical-id-report.json');
const authorityRegistryPath = path.join(root, 'data', 'canonical-authority-registry.json');
const bookIdRegex = /^HH-(?:[A-Z]|C\+|HR)-[0-9]{4}$/;

function isValidBookId(value) {
  return bookIdRegex.test(value);
}

const legacyPresentationRegexes = [
  /^SB[0-9]{3,4}$/i,
  /^FR[0-9]{3,4}$/i,
  /^SR[0-9]{3,4}$/i,
  /^GT[0-9]{3,4}$/i,
  /^TT[0-9]{3,4}$/i,
  /^HR[0-9]{3,4}$/i,
  /^BT[0-9]{3,4}$/i,
  /^BL[0-9]{3,4}$/i,
  /^HSP[0-9]{3,4}$/i,
  /^Story[-_ ]?[0-9]+$/i,
  /^Book[-_ ]?[0-9]+$/i,
  /^Character[-_ ]?[0-9]+$/i,
  /^HHA[0-9]{3,4}$/i
];

function parseArgs(argv) {
  const args = {
    strict: false,
    reportPath: defaultReportPath
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--strict') {
      args.strict = true;
    } else if (token === '--report' && argv[i + 1]) {
      args.reportPath = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function loadJson(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isLegacyPresentationId(value) {
  const text = String(value || '').trim();
  return legacyPresentationRegexes.some((regex) => regex.test(text));
}

function buildSuggestedCanonicalId(rawId, seriesSlug) {
  const text = String(rawId || '').trim();
  const digitMatch = text.match(/([0-9]{1,6})$/);
  const sequence = digitMatch ? String(digitMatch[1]).padStart(4, '0').slice(-4) : '0001';

  // Limited mode mapping only where contract discussions already established confidence.
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

  const mode = modeBySeriesSlug[String(seriesSlug || '').toLowerCase()] || 'MODE';
  return `HH-${mode}-${sequence}`;
}

function messageRecord(severity, layer, file, field, entityLabel, value, message, expected) {
  return {
    severity,
    layer,
    file,
    field,
    entity: entityLabel,
    value,
    message,
    expected
  };
}

function initializeCoverage() {
  return {
    books: { canonical: 0, total: 0, remaining: 0 },
    characters: { canonical: 0, total: 0, remaining: 0 },
    environments: { canonical: 0, total: 0, remaining: 0 },
    relationships: { canonical: 0, total: 0, remaining: 0 }
  };
}

function initializeSourceSummary() {
  return {
    books: { dataRecords: 0, worldCanonRecords: null, canonicalAuthority: 'Book Model', activeCanonicalSource: 'data/books.json' },
    characters: { dataRecords: 0, worldCanonRecords: null, canonicalAuthority: 'Character Directory', activeCanonicalSource: 'data/characters.json' },
    environments: { dataRecords: 0, worldCanonRecords: null, canonicalAuthority: 'World Canon', activeCanonicalSource: 'generated/world-canon-index.json' },
    relationships: { dataRecords: 0, worldCanonRecords: null, canonicalAuthority: 'World Canon', activeCanonicalSource: 'generated/world-canon-index.json' }
  };
}

function loadCanonicalAuthorityRegistry() {
  if (!fs.existsSync(authorityRegistryPath)) {
    throw new Error('Missing canonical authority registry: data/canonical-authority-registry.json');
  }
  const parsed = JSON.parse(fs.readFileSync(authorityRegistryPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.entities || typeof parsed.entities !== 'object') {
    throw new Error('Invalid canonical authority registry: expected an entities object.');
  }
  return parsed;
}

function getRegistryEntityConfig(registry, entityKey) {
  const entities = registry && registry.entities ? registry.entities : {};
  const configured = entities[entityKey];
  if (!configured || !configured.canonicalAuthority || !configured.canonicalSource || !configured.canonicalPath) {
    throw new Error(`Canonical authority registry is missing the ${entityKey} source contract.`);
  }
  return configured;
}

function resolvePathValue(sourceObject, sourcePath) {
  if (!sourcePath) {
    return sourceObject;
  }

  return String(sourcePath)
    .split('.')
    .filter((token) => token.length > 0)
    .reduce((current, token) => {
      if (!current || typeof current !== 'object') {
        return null;
      }
      return current[token];
    }, sourceObject);
}

function selectAuthoritativeRecords(entityKey, registryConfig, sourcePayloadsByFile) {
  const canonicalPayload = sourcePayloadsByFile[registryConfig.canonicalSource] || null;
  const canonicalRecords = resolvePathValue(canonicalPayload, registryConfig.canonicalPath);
  return Array.isArray(canonicalRecords) ? canonicalRecords : [];
}

function toCanonicalLookupKey(value) {
  return String(value || '').trim().toUpperCase();
}

function getCanonicalIdForLookup(record, entityKey) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  if (entityKey === 'books') {
    return getBookIdentity(record).canonicalId || String(record.id || '').trim();
  }

  const genericIdentity = getEntityIdentity(record);
  return genericIdentity.canonicalId || String(record.id || '').trim();
}

function buildCanonicalLookupMaps(booksData, charactersData, worldCanonIndex, authorityRegistry) {
  const sourcePayloadsByFile = {
    'data/books.json': booksData || {},
    'data/characters.json': charactersData || {},
    'generated/world-canon-index.json': worldCanonIndex || {}
  };

  const lookupByEntity = {
    books: new Map(),
    characters: new Map(),
    environments: new Map(),
    relationships: new Map()
  };

  for (const entityKey of Object.keys(lookupByEntity)) {
    const registryConfig = getRegistryEntityConfig(authorityRegistry, entityKey);
    const records = selectAuthoritativeRecords(entityKey, registryConfig, sourcePayloadsByFile);
    for (const record of records) {
      const canonicalId = getCanonicalIdForLookup(record, entityKey);
      const lookupKey = toCanonicalLookupKey(canonicalId);
      if (!lookupKey) {
        continue;
      }
      if (!lookupByEntity[entityKey].has(lookupKey)) {
        lookupByEntity[entityKey].set(lookupKey, canonicalId);
      }
    }
  }

  return lookupByEntity;
}

function validateWorldResolutionStage1(booksData, lookupMaps, state) {
  const books = Array.isArray(booksData && booksData.books) ? booksData.books : [];
  const referenceSpecs = [
    { fieldName: 'characters', targetEntity: 'characters', targetLabel: 'character' },
    { fieldName: 'environments', targetEntity: 'environments', targetLabel: 'environment' },
    { fieldName: 'relatedBooks', targetEntity: 'books', targetLabel: 'book' }
  ];

  for (const book of books) {
    const bookCanonicalId = getBookIdentity(book).canonicalId || String(book.slug || '').trim() || 'UNKNOWN-BOOK';
    const bookLabel = `Book ${bookCanonicalId}`;

    for (const spec of referenceSpecs) {
      const values = Array.isArray(book && book[spec.fieldName]) ? book[spec.fieldName] : [];
      for (let i = 0; i < values.length; i += 1) {
        const referenceValue = String(values[i] || '').trim();
        if (!referenceValue) {
          continue;
        }

        state.worldResolution.referencesChecked += 1;
        const lookupKey = toCanonicalLookupKey(referenceValue);
        if (lookupMaps[spec.targetEntity] && lookupMaps[spec.targetEntity].has(lookupKey)) {
          continue;
        }

        state.worldResolution.unresolved += 1;
        state.errors.push(messageRecord(
          'error',
          'Layer 3 - World Resolution',
          'data/books.json',
          `${spec.fieldName}[${i}]`,
          bookLabel,
          referenceValue,
          'Unresolved reference.',
          `No ${spec.targetLabel} with canonical ID ${referenceValue} exists in authoritative ${spec.targetEntity} records.`
        ));
      }
    }
  }
}

function getEntityIdentity(entry) {
  const identity = entry && typeof entry.identity === 'object' ? entry.identity : {};
  const canonicalId = String(identity.canonicalId || entry.canonicalId || '').trim();

  const aliases = [];
  if (Array.isArray(identity.legacyAliases)) {
    aliases.push(...identity.legacyAliases);
  }
  if (Array.isArray(entry && entry.legacyAliases)) {
    aliases.push(...entry.legacyAliases);
  }

  return {
    canonicalId,
    legacyAliases: Array.from(new Set(
      aliases
        .map((value) => String(value || '').trim())
        .filter((value) => value.length > 0)
    ))
  };
}

function registerCanonicalIdentity(state, canonicalId, entityLabel, file, field) {
  const dedupeKey = String(canonicalId || '').toUpperCase();
  if (!dedupeKey) {
    return;
  }

  if (state.globalCanonicalOwners.has(dedupeKey)) {
    const originalOwner = state.globalCanonicalOwners.get(dedupeKey);
    state.errors.push(messageRecord(
      'error',
      'Layer 2 - Identity Uniqueness',
      file,
      field,
      entityLabel,
      canonicalId,
      `Duplicate canonical identifier detected. Already assigned to ${originalOwner}.`,
      'Assign a unique canonical ID to each canonical entity.'
    ));
    return;
  }

  state.globalCanonicalOwners.set(dedupeKey, entityLabel);
}

function getBookIdentity(book) {
  const identity = book && typeof book.identity === 'object' ? book.identity : {};
  const canonicalId = String(identity.canonicalId || book.canonicalId || '').trim();
  const legacyAliases = [];

  if (Array.isArray(identity.legacyAliases)) {
    legacyAliases.push(...identity.legacyAliases);
  }
  if (Array.isArray(book.legacyAliases)) {
    legacyAliases.push(...book.legacyAliases);
  }
  if (typeof book.code === 'string' && book.code.trim()) {
    legacyAliases.push(book.code.trim());
  }

  const dedupedAliases = Array.from(new Set(
    legacyAliases
      .map((value) => String(value || '').trim())
      .filter((value) => value.length > 0)
  ));

  return {
    canonicalId,
    legacyAliases: dedupedAliases,
    hasTopLevelCode: typeof book.code === 'string' && book.code.trim().length > 0
  };
}

function getCharacterIdentity(character) {
  const identity = getEntityIdentity(character);

  if (typeof (character && character.code) === 'string' && character.code.trim()) {
    identity.legacyAliases = Array.from(new Set([...identity.legacyAliases, character.code.trim()]));
  }

  return {
    canonicalId: identity.canonicalId,
    legacyAliases: identity.legacyAliases,
    hasTopLevelCode: typeof (character && character.code) === 'string' && character.code.trim().length > 0
  };
}

function getGenericCanonicalCoverage(records, getter) {
  const values = Array.isArray(records) ? records : [];
  const total = values.length;
  const canonical = values
    .map((entry) => String(getter(entry) || '').trim())
    .filter((value) => value.length > 0)
    .length;

  return {
    total,
    canonical,
    remaining: Math.max(0, total - canonical)
  };
}

function validateBooks(records, state) {
  const books = Array.isArray(records && records.books) ? records.books : [];
  state.coverage.books.total = books.length;
  state.coverage.books.canonical = 0;

  books.forEach((book, index) => {
    const title = String(book && (book.title || book.slug || '')).trim() || `books[${index}]`;
    const identity = getBookIdentity(book);
    const canonicalId = identity.canonicalId;
    const compatibilityCode = identity.legacyAliases[0] || '';

    if (!canonicalId) {
      if (compatibilityCode) {
        const suggested = buildSuggestedCanonicalId(compatibilityCode, book.seriesSlug);
        state.errors.push(messageRecord(
          'error',
          'Layer 6 - Legacy Compatibility',
          'data/books.json',
          'canonicalId',
          `Book "${title}"`,
          compatibilityCode,
          `Presentation identifier detected. "${compatibilityCode}" is being used where immutable canonical identity is required.`,
          `${suggested} (format HH-[MODE]-NNNN)`
        ));
      } else {
        state.errors.push(messageRecord(
          'error',
          'Layer 1 - Identity Format',
          'data/books.json',
          'canonicalId',
          `Book "${title}"`,
          '',
          'Missing canonical identifier for publication record.',
          'HH-[MODE]-NNNN (example HH-A-0001)'
        ));
      }
    } else {
      state.canonicalIdsChecked += 1;
      state.coverage.books.canonical += 1;

      registerCanonicalIdentity(state, canonicalId, `Book "${title}"`, 'data/books.json', 'identity.canonicalId');

      if (isLegacyPresentationId(canonicalId)) {
        const suggested = buildSuggestedCanonicalId(canonicalId, book.seriesSlug);
        state.errors.push(messageRecord(
          'error',
          'Layer 6 - Legacy Compatibility',
          'data/books.json',
          'canonicalId',
          `Book "${title}"`,
          canonicalId,
          'Presentation identifier detected in canonical field.',
          `${suggested} (format HH-[MODE]-NNNN)`
        ));
      } else if (!isValidBookId(canonicalId)) {
        state.errors.push(messageRecord(
          'error',
          'Layer 1 - Identity Format',
          'data/books.json',
          'canonicalId',
          `Book "${title}"`,
          canonicalId,
          'Canonical publication ID does not match required contract format.',
          'HH-[MODE]-NNNN (regex ^HH-(?:[A-Z]|C\\+|HR)-[0-9]{4}$)'
        ));
      }
    }

    if (identity.hasTopLevelCode) {
      state.warnings.push(messageRecord(
        'warning',
        'Layer 6 - Legacy Compatibility',
        'data/books.json',
        'code',
        `Book "${title}"`,
        book.code,
        'Legacy presentation code exists as a top-level field.',
        'Move compatibility aliases under identity.legacyAliases and treat canonical identity as identity.canonicalId.'
      ));
    }

    identity.legacyAliases.forEach((alias, aliasIndex) => {
      if (!isLegacyPresentationId(alias)) {
        state.warnings.push(messageRecord(
          'warning',
          'Layer 6 - Legacy Compatibility',
          'data/books.json',
          `identity.legacyAliases[${aliasIndex}]`,
          `Book "${title}"`,
          alias,
          'Alias does not match known legacy presentation patterns.',
          'Use legacyAliases only for historical presentation IDs during migration.'
        ));
      }
    });

    ['characters', 'environments', 'relatedBooks'].forEach((fieldName) => {
      const values = Array.isArray(book && book[fieldName]) ? book[fieldName] : [];
      values.forEach((entry, refIndex) => {
        if (typeof entry !== 'string') {
          return;
        }
        const refValue = entry.trim();
        if (!refValue) {
          return;
        }

        state.referencesChecked += 1;
        if (isLegacyPresentationId(refValue)) {
          state.errors.push(messageRecord(
            'error',
            'Layer 6 - Legacy Compatibility',
            'data/books.json',
            `${fieldName}[${refIndex}]`,
            `Book "${title}"`,
            refValue,
            'Reference uses a presentation identifier instead of canonical identity.',
            'Reference canonical IDs only (example HH-A-0001).'
          ));
        }
      });
    });
  });

  state.coverage.books.remaining = Math.max(0, state.coverage.books.total - state.coverage.books.canonical);
}

function validateCharacters(records, state) {
  const characters = Array.isArray(records && records.characters) ? records.characters : [];
  state.coverage.characters.total = characters.length;
  state.coverage.characters.canonical = 0;

  characters.forEach((character, index) => {
    const name = String(character && (character.name || character.slug || '')).trim() || `characters[${index}]`;
    const identity = getCharacterIdentity(character);
    const canonicalId = identity.canonicalId;
    const compatibilityCode = identity.legacyAliases[0] || '';

    if (!canonicalId) {
      state.errors.push(messageRecord(
        'error',
        'Layer 1 - Identity Format',
        'data/characters.json',
        'identity.canonicalId',
        `Character "${name}"`,
        compatibilityCode,
        'Missing canonical identifier for character record.',
        'Provide an immutable canonical ID (example HH-CHR-0001).'
      ));
    } else {
      state.canonicalIdsChecked += 1;
      state.coverage.characters.canonical += 1;

      registerCanonicalIdentity(state, canonicalId, `Character "${name}"`, 'data/characters.json', 'identity.canonicalId');

      if (isLegacyPresentationId(canonicalId)) {
        state.errors.push(messageRecord(
          'error',
          'Layer 6 - Legacy Compatibility',
          'data/characters.json',
          'identity.canonicalId',
          `Character "${name}"`,
          canonicalId,
          'Presentation identifier detected in character canonical field.',
          'Character identities must be immutable canonical IDs, not presentation codes.'
        ));
      }
    }

    if (identity.hasTopLevelCode) {
      state.warnings.push(messageRecord(
        'warning',
        'Layer 6 - Legacy Compatibility',
        'data/characters.json',
        'code',
        `Character "${name}"`,
        character.code,
        'Legacy presentation code exists as a top-level field.',
        'Keep temporarily for compatibility, then remove once consumers switch to identity.canonicalId.'
      ));
    }
  });

  state.coverage.characters.remaining = Math.max(0, state.coverage.characters.total - state.coverage.characters.canonical);
}

function validateWorldCanonRecords(entityKey, records, state) {
  const entities = Array.isArray(records) ? records : [];
  const coverage = state.coverage[entityKey];
  coverage.total = entities.length;
  coverage.canonical = 0;
  const label = entityKey === 'environments' ? 'Environment' : 'Relationship';
  const prefix = entityKey === 'environments' ? 'environment' : 'relationship';

  entities.forEach((entity, index) => {
    const name = String(entity && (entity.name || entity.slug || '')).trim() || `${prefix}[${index}]`;
    const canonicalId = String(entity && entity.id || '').trim();
    if (!canonicalId) {
      state.errors.push(messageRecord(
        'error',
        'Layer 1 - Identity Format',
        'generated/world-canon-index.json',
        'id',
        `${label} "${name}"`,
        '',
        'Missing canonical identifier in current Library-derived World Canon record.',
        'Provide the persisted identifier assigned by the Library entity ID registry.'
      ));
      return;
    }

    state.canonicalIdsChecked += 1;
    coverage.canonical += 1;
    registerCanonicalIdentity(
      state,
      canonicalId,
      `${label} "${name}"`,
      'generated/world-canon-index.json',
      'id'
    );
  });

  coverage.remaining = Math.max(0, coverage.total - coverage.canonical);
}

function populateCoverageFromData(charactersData, worldCanonIndex, authorityRegistry, state) {
  const worldCanonEnvironments = (worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.environments) || [];
  const worldCanonRelationships = (worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.relationships) || [];
  const booksConfig = getRegistryEntityConfig(authorityRegistry, 'books');
  const charactersConfig = getRegistryEntityConfig(authorityRegistry, 'characters');
  const environmentsConfig = getRegistryEntityConfig(authorityRegistry, 'environments');
  const relationshipsConfig = getRegistryEntityConfig(authorityRegistry, 'relationships');

  const bookRecords = loadJson(path.join('data', 'books.json'));
  const books = Array.isArray(bookRecords && bookRecords.books) ? bookRecords.books : [];
  state.sourceSummary.books.dataRecords = books.length;
  state.sourceSummary.characters.dataRecords = Array.isArray(charactersData && charactersData.characters)
    ? charactersData.characters.length
    : 0;
  state.sourceSummary.environments.dataRecords = worldCanonEnvironments.length;
  state.sourceSummary.relationships.dataRecords = worldCanonRelationships.length;
  state.sourceSummary.books.activeCanonicalSource = booksConfig.canonicalSource;
  state.sourceSummary.characters.activeCanonicalSource = charactersConfig.canonicalSource;
  state.sourceSummary.environments.activeCanonicalSource = environmentsConfig.canonicalSource;
  state.sourceSummary.relationships.activeCanonicalSource = relationshipsConfig.canonicalSource;
  state.sourceSummary.books.canonicalAuthority = booksConfig.canonicalAuthority;
  state.sourceSummary.characters.canonicalAuthority = charactersConfig.canonicalAuthority;
  state.sourceSummary.environments.canonicalAuthority = environmentsConfig.canonicalAuthority;
  state.sourceSummary.relationships.canonicalAuthority = relationshipsConfig.canonicalAuthority;

  if (environmentsConfig.canonicalSource === 'generated/world-canon-index.json' && worldCanonEnvironments.length > 0) {
    state.sourceSummary.environments.activeCanonicalSource = `${environmentsConfig.canonicalSource} (${environmentsConfig.canonicalPath})`;
  }
  if (relationshipsConfig.canonicalSource === 'generated/world-canon-index.json' && worldCanonRelationships.length > 0) {
    state.sourceSummary.relationships.activeCanonicalSource = `${relationshipsConfig.canonicalSource} (${relationshipsConfig.canonicalPath})`;
  }

  state.coverage.characters = getGenericCanonicalCoverage(
    charactersData && charactersData.characters,
    (entry) => entry && entry.identity && entry.identity.canonicalId
  );

}

function printCoverage(state) {
  const lines = [
    ['Books', state.coverage.books],
    ['Characters', state.coverage.characters],
    ['Environments', state.coverage.environments],
    ['Relationships', state.coverage.relationships]
  ];

  console.log('');
  console.log('Canonical Adoption');
  for (const [label, value] of lines) {
    if (!value || !Number.isFinite(value.total)) {
      continue;
    }
    console.log(`${label}: ${value.canonical} / ${value.total} canonical (${value.remaining} remaining)`);
  }

  console.log('');
  console.log('Canonical Authority Summary');
  const sourceLines = [
    ['Books', state.sourceSummary.books],
    ['Characters', state.sourceSummary.characters],
    ['Environments', state.sourceSummary.environments],
    ['Relationships', state.sourceSummary.relationships]
  ];

  for (const [label, source] of sourceLines) {
    if (!source) {
      continue;
    }
    const worldCanonPart = Number.isFinite(source.worldCanonRecords)
      ? `, world-canon records: ${source.worldCanonRecords}`
      : '';
    console.log(`${label}: authority: ${source.canonicalAuthority}; data records: ${source.dataRecords}${worldCanonPart}; active source: ${source.activeCanonicalSource}`);
  }

  console.log('');
  console.log('World Resolution');
  console.log(`References resolved: ${state.worldResolution.referencesChecked - state.worldResolution.unresolved} / ${state.worldResolution.referencesChecked}`);
  console.log(`Unresolved references: ${state.worldResolution.unresolved}`);
}

function printHumanReport(state, strict) {
  const hasErrors = state.errors.length > 0;
  const status = hasErrors ? 'FAIL' : 'PASS';

  console.log('Canonical ID Validation Report');
  console.log(`Contract: ${path.relative(root, contractPath)}`);
  console.log(`Status: ${status}`);
  console.log(`Mode: ${strict ? 'strict' : 'report-only'}`);
  console.log('');
  console.log(`Canonical IDs checked: ${state.canonicalIdsChecked}`);
  console.log(`References checked: ${state.referencesChecked}`);
  console.log(`Warnings: ${state.warnings.length}`);
  console.log(`Errors: ${state.errors.length}`);

  printCoverage(state);

  if (state.warnings.length > 0) {
    console.log('');
    console.log('Warnings');
    state.warnings.forEach((warning, index) => {
      console.log(`${index + 1}. ${warning.entity} (${warning.file} -> ${warning.field})`);
      console.log(`   Found: ${warning.value}`);
      console.log(`   ${warning.message}`);
      if (warning.expected) {
        console.log(`   Guidance: ${warning.expected}`);
      }
    });
  }

  if (state.errors.length > 0) {
    console.log('');
    console.log('Errors');
    state.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.entity} (${error.file} -> ${error.field})`);
      if (error.value) {
        console.log(`   Found: ${error.value}`);
      }
      console.log(`   ${error.message}`);
      if (error.expected) {
        console.log(`   Expected: ${error.expected}`);
      }
    });
  }
}

function writeMachineReport(state, reportPath, strict) {
  const payload = {
    generatedAt: new Date().toISOString(),
    contractPath: path.relative(root, contractPath),
    status: state.errors.length > 0 ? 'FAIL' : 'PASS',
    mode: strict ? 'strict' : 'report-only',
    layers: [
      'Layer 1 - Identity Format',
      'Layer 2 - Identity Uniqueness',
      'Layer 3 - World Resolution',
      'Layer 5 - Canonical Adoption',
      'Layer 6 - Legacy Compatibility'
    ],
    summary: {
      canonicalIdsChecked: state.canonicalIdsChecked,
      referencesChecked: state.referencesChecked,
      worldResolutionReferencesChecked: state.worldResolution.referencesChecked,
      worldResolutionUnresolved: state.worldResolution.unresolved,
      warnings: state.warnings.length,
      errors: state.errors.length
    },
    canonicalAuthorityRegistryPath: path.relative(root, authorityRegistryPath),
    canonicalAuthorityRegistry: state.authorityRegistry,
    sourceSummary: state.sourceSummary,
    adoption: state.coverage,
    coverage: state.coverage,
    worldResolution: state.worldResolution,
    warnings: state.warnings,
    errors: state.errors
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function run(options) {
  const booksData = loadJson(path.join('data', 'books.json'));
  const charactersData = loadJson(path.join('data', 'characters.json'));
  const worldCanonIndex = loadJson(path.join('generated', 'world-canon-index.json'));
  const authorityRegistry = loadCanonicalAuthorityRegistry();

  const state = {
    canonicalIdsChecked: 0,
    referencesChecked: 0,
    warnings: [],
    errors: [],
    coverage: initializeCoverage(),
    worldResolution: {
      referencesChecked: 0,
      unresolved: 0
    },
    sourceSummary: initializeSourceSummary(),
    authorityRegistry,
    globalCanonicalOwners: new Map()
  };

  const lookupMaps = buildCanonicalLookupMaps(
    booksData,
    charactersData,
    worldCanonIndex,
    authorityRegistry
  );

  populateCoverageFromData(charactersData, worldCanonIndex, authorityRegistry, state);
  validateWorldResolutionStage1(booksData, lookupMaps, state);
  validateBooks(booksData, state);
  validateCharacters(charactersData, state);
  validateWorldCanonRecords('environments', worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.environments, state);
  validateWorldCanonRecords('relationships', worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.relationships, state);
  writeMachineReport(state, options.reportPath, options.strict);
  printHumanReport(state, options.strict);

  console.log('');
  console.log(`Machine report: ${path.relative(root, options.reportPath)}`);

  if (options.strict && state.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(args);
}

module.exports = {
  run,
  parseArgs,
  isValidBookId
};