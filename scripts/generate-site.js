const fs = require('fs');
const path = require('path');
const { writeLibraryArtifacts } = require('./library-scanner');
const { writeAmazonKdpArtifact } = require('./amazon-kdp-import');
const { writeCharacterCanonArtifact } = require('./character-canon-import');
const { writeWorldCanonArtifacts } = require('./world-canon-import');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function toOutputAssetPath(assetPath, pathPrefix = '') {
  return `${pathPrefix}${assetPath.replace(/^\//, '')}`;
}

function getBannerForPage(page, banners) {
  if (!page || !banners) {
    return null;
  }

  const candidates = [page.bannerSlug, page.slug === 'index' ? 'home' : null, page.slug];
  for (const key of candidates) {
    if (key && banners[key]) {
      return banners[key];
    }
  }

  return null;
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toBookPageSlug(book) {
  const safeId = (book.id || 'unknown')
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeTitle = (book.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return safeTitle ? `${safeId}-${safeTitle}` : safeId;
}

function getBookPageHref(book) {
  return `books/${toBookPageSlug(book)}.html`;
}

function getEntityPageHref(entityType, entityId, entityName = '') {
  const safeType = toSlug(entityType || 'entity') || 'entity';
  const safeId = (toSlug(entityId || 'unknown') || 'unknown').slice(0, 48);
  const safeName = (toSlug(entityName || '') || '').slice(0, 48);
  return `entities/${safeType}/${safeName ? `${safeId}-${safeName}` : safeId}.html`;
}

function mapStatusToAvailability(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'live') {
    return 'https://schema.org/InStock';
  }
  if (normalized === 'preorder' || normalized === 'pre-order') {
    return 'https://schema.org/PreOrder';
  }
  return 'https://schema.org/Discontinued';
}

function createSearchIndex(libraryIndex, amazonLookup) {
  const records = ((libraryIndex && libraryIndex.books) || []).map((book) => {
    const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
    const keywords = [
      book.id,
      book.title,
      book.series,
      book.seriesCode,
      amazon ? amazon.asin : '',
      amazon && amazon.identifiers ? amazon.identifiers.paperbackAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.hardcoverAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.kindleAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn10 : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn13 : ''
    ]
      .filter((value) => Boolean(value))
      .map((value) => String(value));

    return {
      type: 'book',
      id: book.id,
      title: book.title || book.id,
      series: book.series || '',
      href: getBookPageHref(book),
      asin: amazon ? amazon.asin || '' : '',
      amazonUrl: amazon ? amazon.url || '' : '',
      purchaseLinks: amazon
        ? {
            paperback: amazon.links ? amazon.links.paperback || '' : '',
            hardcover: amazon.links ? amazon.links.hardcover || '' : '',
            kindle: amazon.links ? amazon.links.kindle || '' : ''
          }
        : { paperback: '', hardcover: '', kindle: '' },
      keywords
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRecords: records.length,
      byType: {
        books: records.length,
        characters: 0,
        relationships: 0,
        environments: 0,
        landmarks: 0,
        activities: 0,
        resources: 0
      }
    },
    records
  };
}

function createMergedBookIndex(libraryIndex, amazonLookup) {
  const records = ((libraryIndex && libraryIndex.books) || []).map((book) => {
    const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
    return {
      id: book.id,
      title: book.title || book.id,
      series: book.series || '',
      seriesCode: book.seriesCode || '',
      pageHref: getBookPageHref(book),
      folder: book.folder || '',
      files: book.files || [],
      fileTypes: book.fileTypes || [],
      amazon: amazon || null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      recordCount: records.length,
      withAmazonDataCount: records.filter((record) => Boolean(record.amazon)).length
    },
    records
  };
}

function writeMergedBookIndex(siteRoot, mergedBookIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'merged-book-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(mergedBookIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

function createEntityIndex(
  mergedBookIndex,
  charactersData,
  characterCanonIndex,
  worldCanonIndex,
  relationshipsData,
  environmentsData,
  landmarksData,
  resourcesData,
  libraryScan
) {
  const files = (libraryScan && libraryScan.files) || [];
  const sourceDocumentsByType = {
    characters: files.filter((file) => file.category === 'Characters').map((file) => file.path),
    relationships: files.filter((file) => file.category === 'Relationships').map((file) => file.path),
    environments: files.filter((file) => file.category === 'Environments').map((file) => file.path),
    landmarks: files.filter((file) => file.category === 'Landmarks').map((file) => file.path),
    resources: files.filter((file) => file.category === 'Ribbons').map((file) => file.path)
  };

  const books = ((mergedBookIndex && mergedBookIndex.records) || []).map((record) => ({
    type: 'book',
    id: record.id,
    name: record.title,
    href: record.pageHref,
    entityPageHref: getEntityPageHref('book', record.id, record.title),
    series: record.series,
    seriesCode: record.seriesCode,
    sources: {
      libraryFolder: record.folder,
      amazonRecordId: record.amazon ? record.amazon.id : null
    },
    purchaseLinks: record.amazon && record.amazon.links
      ? {
          paperback: record.amazon.links.paperback || '',
          hardcover: record.amazon.links.hardcover || '',
          kindle: record.amazon.links.kindle || ''
        }
      : { paperback: '', hardcover: '', kindle: '' },
    identifiers: record.amazon && record.amazon.identifiers
      ? {
          asin: record.amazon.asin || '',
          paperbackAsin: record.amazon.identifiers.paperbackAsin || '',
          hardcoverAsin: record.amazon.identifiers.hardcoverAsin || '',
          kindleAsin: record.amazon.identifiers.kindleAsin || '',
          isbn: record.amazon.identifiers.isbn || '',
          isbn10: record.amazon.identifiers.isbn10 || '',
          isbn13: record.amazon.identifiers.isbn13 || ''
        }
      : {}
  }));

  const characterCanonLookup = new Map();
  for (const record of (characterCanonIndex && characterCanonIndex.records) || []) {
    if (record && record.id) {
      characterCanonLookup.set(String(record.id).toLowerCase(), record);
    }
    if (record && record.slug) {
      characterCanonLookup.set(String(record.slug).toLowerCase(), record);
    }
  }

  const characters = ((charactersData && charactersData.characters) || []).map((character) => {
    const code = character.code || '';
    const matchedSourceDocs = sourceDocumentsByType.characters.filter((docPath) => {
      const fileName = path.basename(docPath).toLowerCase();
      return code && (fileName.startsWith(`${code.toLowerCase()} `) || fileName.startsWith(`${code.toLowerCase()}-`));
    });
    const canon = characterCanonLookup.get(String(character.code || '').toLowerCase())
      || characterCanonLookup.get(String(character.slug || '').toLowerCase())
      || null;

    const entityHref = getEntityPageHref('character', character.code || character.slug, character.name);
    return {
      type: 'character',
      id: character.code || character.slug,
      slug: character.slug,
      name: character.name,
      role: character.role || '',
      href: entityHref,
      entityPageHref: entityHref,
      legacyHref: `characters/${character.slug}.html`,
      published: character.published === true,
      sourceDocuments: matchedSourceDocs,
      canon: canon
        ? {
            sourceDocument: canon.sourceDocument,
            textExcerpt: canon.textExcerpt || '',
            mentions: canon.mentions || { characters: [], environments: [], landmarks: [] }
          }
        : null
    };
  });

  const relationshipFallback = ((relationshipsData && relationshipsData.relationships) || []).map((relationship, index) => ({
    type: 'relationship',
    id: relationship.id || relationship.slug || `relationship-${index + 1}`,
    name: relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`,
    href: getEntityPageHref(
      'relationship',
      relationship.id || relationship.slug || `relationship-${index + 1}`,
      relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'relationship',
      relationship.id || relationship.slug || `relationship-${index + 1}`,
      relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`
    ),
    ...relationship
  }));
  const canonRelationships = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.relationships) || [])
    .map((relationship) => ({
      ...relationship,
      type: 'relationship',
      href: getEntityPageHref('relationship', relationship.id, relationship.name),
      entityPageHref: getEntityPageHref('relationship', relationship.id, relationship.name)
    }));
  const relationships = canonRelationships.length > 0 ? canonRelationships : relationshipFallback;

  const environmentFallback = ((environmentsData && environmentsData.environments) || []).map((environment, index) => ({
    type: 'environment',
    id: environment.id || environment.slug || `environment-${index + 1}`,
    name: environment.name || environment.title || environment.slug || `Environment ${index + 1}`,
    href: getEntityPageHref(
      'environment',
      environment.id || environment.slug || `environment-${index + 1}`,
      environment.name || environment.title || environment.slug || `Environment ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'environment',
      environment.id || environment.slug || `environment-${index + 1}`,
      environment.name || environment.title || environment.slug || `Environment ${index + 1}`
    ),
    ...environment
  }));
  const canonEnvironments = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.environments) || [])
    .map((environment) => ({
      ...environment,
      type: 'environment',
      href: getEntityPageHref('environment', environment.id, environment.name),
      entityPageHref: getEntityPageHref('environment', environment.id, environment.name)
    }));
  const environments = canonEnvironments.length > 0 ? canonEnvironments : environmentFallback;

  const landmarkFallback = ((landmarksData && landmarksData.landmarks) || []).map((landmark, index) => ({
    type: 'landmark',
    id: landmark.id || landmark.slug || `landmark-${index + 1}`,
    name: landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`,
    href: getEntityPageHref(
      'landmark',
      landmark.id || landmark.slug || `landmark-${index + 1}`,
      landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'landmark',
      landmark.id || landmark.slug || `landmark-${index + 1}`,
      landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`
    ),
    ...landmark
  }));
  const canonLandmarks = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.landmarks) || [])
    .map((landmark) => ({
      ...landmark,
      type: 'landmark',
      href: getEntityPageHref('landmark', landmark.id, landmark.name),
      entityPageHref: getEntityPageHref('landmark', landmark.id, landmark.name)
    }));
  const landmarks = canonLandmarks.length > 0 ? canonLandmarks : landmarkFallback;

  const resources = ((resourcesData && resourcesData.resources) || []).map((resource, index) => ({
    type: 'resource',
    id: resource.id || resource.slug || `resource-${index + 1}`,
    name: resource.name || resource.title || resource.slug || `Resource ${index + 1}`,
    href: getEntityPageHref('resource', resource.id || resource.slug || `resource-${index + 1}`, resource.title || resource.name || resource.slug || ''),
    entityPageHref: getEntityPageHref('resource', resource.id || resource.slug || `resource-${index + 1}`, resource.title || resource.name || resource.slug || ''),
    ...resource
  }));

  const activities = [];

  const byType = {
    books,
    characters,
    relationships,
    environments,
    landmarks,
    activities,
    resources
  };

  const entities = [
    ...books,
    ...characters,
    ...relationships,
    ...environments,
    ...landmarks,
    ...activities,
    ...resources
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalEntities: entities.length,
      byType: {
        books: books.length,
        characters: characters.length,
        relationships: relationships.length,
        environments: environments.length,
        landmarks: landmarks.length,
        activities: activities.length,
        resources: resources.length
      }
    },
    sourceDocumentsByType,
    byType,
    entities
  };
}

function writeEntityIndex(siteRoot, entityIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'entity-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(entityIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

function createSearchIndexFromEntityIndex(entityIndex) {
  const records = [];

  for (const book of (entityIndex.byType && entityIndex.byType.books) || []) {
    records.push({
      type: 'book',
      id: book.id,
      title: book.name,
      series: book.series || '',
      href: book.href || '',
      asin: book.identifiers && book.identifiers.asin ? book.identifiers.asin : '',
      amazonUrl: book.purchaseLinks && book.purchaseLinks.paperback ? book.purchaseLinks.paperback : '',
      purchaseLinks: book.purchaseLinks || { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        book.id,
        book.name,
        book.series,
        book.seriesCode,
        book.identifiers ? book.identifiers.asin : '',
        book.identifiers ? book.identifiers.paperbackAsin : '',
        book.identifiers ? book.identifiers.hardcoverAsin : '',
        book.identifiers ? book.identifiers.kindleAsin : '',
        book.identifiers ? book.identifiers.isbn : '',
        book.identifiers ? book.identifiers.isbn10 : '',
        book.identifiers ? book.identifiers.isbn13 : ''
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const character of (entityIndex.byType && entityIndex.byType.characters) || []) {
    records.push({
      type: 'character',
      id: character.id,
      title: character.name,
      series: 'Characters',
      href: character.href || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        character.id,
        character.slug,
        character.name,
        character.role,
        character.legacyHref,
        ...(character.canon && character.canon.mentions ? character.canon.mentions.characters || [] : []),
        ...(character.canon && character.canon.mentions ? character.canon.mentions.environments || [] : []),
        ...(character.canon && character.canon.mentions ? character.canon.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const relationship of (entityIndex.byType && entityIndex.byType.relationships) || []) {
    records.push({
      type: 'relationship',
      id: relationship.id,
      title: relationship.name,
      series: 'Relationships',
      href: relationship.href || relationship.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        relationship.id,
        relationship.name,
        ...(relationship.mentions ? relationship.mentions.characters || [] : []),
        ...(relationship.mentions ? relationship.mentions.environments || [] : []),
        ...(relationship.mentions ? relationship.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const environment of (entityIndex.byType && entityIndex.byType.environments) || []) {
    records.push({
      type: 'environment',
      id: environment.id,
      title: environment.name,
      series: 'Environments',
      href: environment.href || environment.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        environment.id,
        environment.slug,
        environment.name,
        ...(environment.mentions ? environment.mentions.characters || [] : []),
        ...(environment.mentions ? environment.mentions.environments || [] : []),
        ...(environment.mentions ? environment.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const landmark of (entityIndex.byType && entityIndex.byType.landmarks) || []) {
    records.push({
      type: 'landmark',
      id: landmark.id,
      title: landmark.name,
      series: 'Landmarks',
      href: landmark.href || landmark.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        landmark.id,
        landmark.slug,
        landmark.name,
        ...(landmark.mentions ? landmark.mentions.characters || [] : []),
        ...(landmark.mentions ? landmark.mentions.environments || [] : []),
        ...(landmark.mentions ? landmark.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const resource of (entityIndex.byType && entityIndex.byType.resources) || []) {
    records.push({
      type: 'resource',
      id: resource.id,
      title: resource.name,
      series: 'Resources',
      href: resource.href || resource.entityPageHref || (resource.slug ? `${resource.slug}.html` : ''),
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [resource.id, resource.slug, resource.name, resource.description]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRecords: records.length,
      byType: {
        books: ((entityIndex.byType && entityIndex.byType.books) || []).length,
        characters: ((entityIndex.byType && entityIndex.byType.characters) || []).length,
        relationships: ((entityIndex.byType && entityIndex.byType.relationships) || []).length,
        environments: ((entityIndex.byType && entityIndex.byType.environments) || []).length,
        landmarks: ((entityIndex.byType && entityIndex.byType.landmarks) || []).length,
        activities: ((entityIndex.byType && entityIndex.byType.activities) || []).length,
        resources: ((entityIndex.byType && entityIndex.byType.resources) || []).length
      }
    },
    records
  };
}

function normalizeEntityKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createEntityGraph(entityIndex) {
  const entities = (entityIndex && entityIndex.entities) || [];
  const nodes = entities.map((entity) => ({
    id: `${entity.type}:${entity.id}`,
    entityType: entity.type,
    entityId: entity.id,
    name: entity.name || entity.title || entity.id,
    href: entity.entityPageHref || entity.href || '',
    provenance: {
      sourceDocuments: entity.sourceDocuments || (entity.sourceDocument ? [entity.sourceDocument] : []),
      sourceDocument: entity.sourceDocument || (entity.canon ? entity.canon.sourceDocument : null)
    }
  }));

  const byTypeAndName = new Map();
  for (const entity of entities) {
    const type = entity.type;
    const keys = [entity.name, entity.title, entity.id, entity.slug]
      .filter((value) => Boolean(value))
      .map((value) => normalizeEntityKey(value));
    for (const key of keys) {
      const mapKey = `${type}:${key}`;
      if (!byTypeAndName.has(mapKey)) {
        byTypeAndName.set(mapKey, []);
      }
      byTypeAndName.get(mapKey).push(entity);
    }
  }

  const edges = [];
  const unresolvedMentions = [];
  const seenEdgeKeys = new Set();

  function addMentionEdges(sourceEntity, mentionedNames, targetType, relationshipType, sourceDocument) {
    for (const mention of mentionedNames || []) {
      const key = normalizeEntityKey(mention);
      const candidates = byTypeAndName.get(`${targetType}:${key}`) || [];
      if (candidates.length === 0) {
        unresolvedMentions.push({
          from: `${sourceEntity.type}:${sourceEntity.id}`,
          targetType,
          mention,
          provenance: {
            sourceArtifact: 'generated/entity-index.json',
            sourceDocument: sourceDocument || null,
            extractor: 'canon-mention-match-v1'
          }
        });
        continue;
      }

      for (const targetEntity of candidates) {
        const edgeKey = `${sourceEntity.type}:${sourceEntity.id}->${targetEntity.type}:${targetEntity.id}:${relationshipType}`;
        if (seenEdgeKeys.has(edgeKey)) {
          continue;
        }
        seenEdgeKeys.add(edgeKey);

        edges.push({
          id: `EDGE-${String(edges.length + 1).padStart(6, '0')}`,
          from: `${sourceEntity.type}:${sourceEntity.id}`,
          to: `${targetEntity.type}:${targetEntity.id}`,
          relationshipType,
          mention,
          provenance: {
            sourceArtifact: 'generated/entity-index.json',
            sourceDocument: sourceDocument || null,
            extractor: 'canon-mention-match-v1'
          }
        });
      }
    }
  }

  for (const character of (entityIndex.byType && entityIndex.byType.characters) || []) {
    const mentions = character.canon && character.canon.mentions ? character.canon.mentions : null;
    const sourceDocument = character.canon ? character.canon.sourceDocument : null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(character, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(character, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
    addMentionEdges(character, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const relationship of (entityIndex.byType && entityIndex.byType.relationships) || []) {
    const mentions = relationship.mentions || null;
    const sourceDocument = relationship.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(relationship, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(relationship, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
    addMentionEdges(relationship, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const environment of (entityIndex.byType && entityIndex.byType.environments) || []) {
    const mentions = environment.mentions || null;
    const sourceDocument = environment.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(environment, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(environment, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const landmark of (entityIndex.byType && entityIndex.byType.landmarks) || []) {
    const mentions = landmark.mentions || null;
    const sourceDocument = landmark.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(landmark, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(landmark, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      unresolvedMentionCount: unresolvedMentions.length
    },
    nodes,
    edges,
    unresolvedMentions
  };
}

function writeEntityGraph(siteRoot, entityGraph) {
  const outputPath = path.join(siteRoot, 'generated', 'entity-graph.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(entityGraph, null, 2)}\n`, 'utf8');
  return outputPath;
}

function writeSearchIndex(siteRoot, searchIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'search-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

function getEntitiesForType(entityIndex, type) {
  const byType = (entityIndex && entityIndex.byType) || {};
  if (type === 'book') {
    return byType.books || [];
  }
  if (type === 'character') {
    return byType.characters || [];
  }
  if (type === 'relationship') {
    return byType.relationships || [];
  }
  if (type === 'environment') {
    return byType.environments || [];
  }
  if (type === 'landmark') {
    return byType.landmarks || [];
  }
  if (type === 'resource') {
    return byType.resources || [];
  }
  if (type === 'activity') {
    return byType.activities || [];
  }
  return [];
}

function renderUniversalEntityPage(entity, entityIndex, entityGraph, site, nav, config) {
  const nodeId = `${entity.type}:${entity.id}`;
  const nodeMap = new Map(((entityGraph && entityGraph.nodes) || []).map((node) => [node.id, node]));
  const node = nodeMap.get(nodeId) || null;
  const edges = ((entityGraph && entityGraph.edges) || []).filter(
    (edge) => edge.from === nodeId || edge.to === nodeId
  );

  const identityRows = [
    `<p><strong>Entity Type:</strong> ${entity.type}</p>`,
    `<p><strong>Entity ID:</strong> ${entity.id}</p>`
  ];
  if (entity.series) {
    identityRows.push(`<p><strong>Series:</strong> ${entity.series}</p>`);
  }
  if (entity.sourceDocument) {
    identityRows.push(`<p><strong>Source Document:</strong> <code>${entity.sourceDocument}</code></p>`);
  }
  if (entity.legacyHref) {
    identityRows.push(`<p><a class="button" href="../../${entity.legacyHref}">Open Legacy Character Page</a></p>`);
  }

  const storyText = entity.canon && entity.canon.textExcerpt
    ? entity.canon.textExcerpt
    : entity.textExcerpt || entity.description || '';

  const connectionsHtml = edges.length === 0
    ? '<p>No typed connections are available yet for this entity.</p>'
    : `<ul>${edges.slice(0, 60).map((edge) => {
      const isOutgoing = edge.from === nodeId;
      const otherNodeId = isOutgoing ? edge.to : edge.from;
      const otherNode = nodeMap.get(otherNodeId);
      const label = otherNode ? `${otherNode.name} (${otherNode.entityType})` : otherNodeId;
      const href = otherNode && otherNode.href ? `../../${otherNode.href}` : '';
      const link = href ? `<a href="${href}">${label}</a>` : label;
      const sourceDoc = edge.provenance && edge.provenance.sourceDocument
        ? `<code>${edge.provenance.sourceDocument}</code>`
        : 'unknown source';
      return `<li>${isOutgoing ? 'From' : 'To'} ${link} via <strong>${edge.relationshipType}</strong> (${sourceDoc})</li>`;
    }).join('')}</ul>`;

  const resourceLinks = [];
  if (entity.type === 'book' && entity.purchaseLinks) {
    if (entity.purchaseLinks.paperback) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>`);
    }
    if (entity.purchaseLinks.hardcover) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>`);
    }
    if (entity.purchaseLinks.kindle) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>`);
    }
  }
  if (entity.href) {
    resourceLinks.push(`<a class="button" href="../../${entity.href}">Open Primary Entity Destination</a>`);
  }
  if (resourceLinks.length === 0) {
    resourceLinks.push('<p>No direct resources are mapped for this entity yet.</p>');
  }

  const connectedCandidates = [];
  const seenConnectionIds = new Set();
  for (const edge of edges) {
    const otherNodeId = edge.from === nodeId ? edge.to : edge.from;
    if (!otherNodeId || seenConnectionIds.has(otherNodeId)) {
      continue;
    }
    seenConnectionIds.add(otherNodeId);
    const otherNode = nodeMap.get(otherNodeId);
    if (!otherNode) {
      continue;
    }
    connectedCandidates.push({
      id: otherNode.entityId,
      name: otherNode.name,
      type: otherNode.entityType,
      entityPageHref: otherNode.href
    });
  }

  const continueExploring = connectedCandidates.length > 0
    ? connectedCandidates.slice(0, 8)
    : getEntitiesForType(entityIndex, entity.type)
      .filter((candidate) => candidate.id !== entity.id)
      .slice(0, 8);
  const continueHtml = continueExploring.length === 0
    ? '<p>More entities of this type are coming soon.</p>'
    : `<ul>${continueExploring.map((candidate) => {
      const href = candidate.entityPageHref || candidate.href || '';
      if (!href) {
        return `<li>${candidate.name || candidate.title || candidate.id}</li>`;
      }
      return `<li><a href="../../${href}">${candidate.name || candidate.title || candidate.id}</a></li>`;
    }).join('')}</ul>`;

  const debugNodeProvenance = node && node.provenance
    ? `<ul>
        <li><strong>sourceDocument:</strong> ${node.provenance.sourceDocument || 'unknown'}</li>
        <li><strong>sourceDocuments:</strong> ${(node.provenance.sourceDocuments || []).join(', ') || 'none'}</li>
      </ul>`
    : '<p>No node provenance available.</p>';

  const debugEdges = edges.length === 0
    ? '<p>No graph edges for this entity yet.</p>'
    : `<ul>${edges.slice(0, 60).map((edge) => {
      const direction = edge.from === nodeId ? 'outgoing' : 'incoming';
      const counterpart = edge.from === nodeId ? edge.to : edge.from;
      return `<li>
        <strong>${edge.relationshipType}</strong> (${direction}) to ${counterpart}<br />
        mention: ${edge.mention || 'n/a'}<br />
        sourceArtifact: ${(edge.provenance && edge.provenance.sourceArtifact) || 'unknown'}<br />
        sourceDocument: ${(edge.provenance && edge.provenance.sourceDocument) || 'unknown'}<br />
        extractor: ${(edge.provenance && edge.provenance.extractor) || 'unknown'}
      </li>`;
    }).join('')}</ul>`;

  return renderLayout(
    entity.name || entity.title || entity.id,
    `Entity profile for ${entity.name || entity.title || entity.id}`,
    `<section class="content-card">
      <h1>${entity.name || entity.title || entity.id}</h1>
      ${identityRows.join('')}
    </section>

    <section class="content-card">
      <h2>Story</h2>
      <p>${storyText || 'Canonical story details will appear here as ingestion expands.'}</p>
    </section>

    <section class="content-card">
      <h2>Connections</h2>
      ${connectionsHtml}
    </section>

    <section class="content-card">
      <h2>Resources</h2>
      ${resourceLinks.join(' ')}
    </section>

    <section class="content-card">
      <h2>Where would you like to wander next?</h2>
      <p>People who explored ${entity.name || entity.title || entity.id} also wandered through:</p>
      ${continueHtml}
    </section>

    <aside id="entity-debug-panel" class="content-card entity-debug-panel" hidden>
      <h2>Developer Provenance Panel</h2>
      <p>This panel is shown because <code>?debug=true</code> is present.</p>
      <h3>Identity</h3>
      <p><strong>Node ID:</strong> ${nodeId}</p>
      <p><strong>Entity Path:</strong> ${(entity.entityPageHref || entity.href || 'n/a')}</p>

      <h3>Source Canon</h3>
      ${debugNodeProvenance}

      <h3>Graph Connections</h3>
      ${debugEdges}

      <h3>Generated Page</h3>
      <p>Renderer: <code>renderUniversalEntityPage</code></p>
      <p>Graph source: <code>generated/entity-graph.json</code></p>
      <p>Entity source: <code>generated/entity-index.json</code></p>
    </aside>

    <script>
      (function () {
        var panel = document.getElementById('entity-debug-panel');
        if (!panel) {
          return;
        }
        var params = new URLSearchParams(window.location.search || '');
        if (String(params.get('debug') || '').toLowerCase() === 'true') {
          panel.hidden = false;
        }
      })();
    </script>`,
    site,
    nav,
    `${site.domain}/${entity.entityPageHref || entity.href || ''}`,
    config,
    null,
    '../../'
  );
}

function renderSearchSection() {
  return `<section class="content-card" aria-labelledby="library-search">
      <h2 id="library-search">Search Hawkins Hollow</h2>
      <p>Search across books, characters, places, relationships, and activities from one shared memory.</p>
      <label for="library-search-input"><strong>Search by title, name, ID, series, ASIN, or keywords</strong></label>
      <input id="library-search-input" class="search-input" type="search" placeholder="Try: Lillian, Zy'ar, HH-B-0001" />
      <p class="search-hint">We found a few different paths to explore around Hawkins Hollow.</p>
      <div id="library-search-results" class="search-results" aria-live="polite"></div>
    </section>

    <script>
      (function () {
        const input = document.getElementById('library-search-input');
        const resultsEl = document.getElementById('library-search-results');
        if (!input || !resultsEl) {
          return;
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderMessage(message) {
          resultsEl.innerHTML = '<p>' + escapeHtml(message) + '</p>';
        }

        function getTypeLabel(type) {
          const labels = {
            book: '📚 Books',
            character: '👧 Characters',
            environment: '🌳 Places',
            landmark: '📍 Landmarks',
            relationship: '❤️ Relationships',
            activity: '🎁 Activities',
            resource: '🧰 Resources'
          };
          return labels[type] || ('🔎 ' + (type || 'Other'));
        }

        function groupRecordsByType(records) {
          return records.reduce(function (groups, item) {
            const record = item && item.record ? item.record : item;
            const key = (record.type || 'other').toLowerCase();
            if (!groups[key]) {
              groups[key] = [];
            }
            groups[key].push(item);
            return groups;
          }, {});
        }

        function getTypeSortRank(type) {
          const order = {
            book: 1,
            character: 2,
            environment: 3,
            landmark: 4,
            relationship: 5,
            activity: 6,
            resource: 7,
            other: 8
          };
          return order[type] || 99;
        }

        function toSearchableText(record) {
          return [
            record.type,
            record.id,
            record.title,
            record.series,
            record.asin,
            (record.keywords || []).join(' ')
          ]
            .join(' ')
            .toLowerCase();
        }

        function summarizeRecord(record, graphByNodeId, graphEdgesByNodeId) {
          const type = (record.type || '').toLowerCase();
          const nodeId = type && record.id ? (type + ':' + record.id) : '';
          const nodeEdges = nodeId && graphEdgesByNodeId[nodeId] ? graphEdgesByNodeId[nodeId] : [];
          const node = nodeId && graphByNodeId[nodeId] ? graphByNodeId[nodeId] : null;

          if (type === 'book') {
            return {
              kind: 'Book',
              summary: nodeEdges.length > 0
                ? ('Connected to ' + nodeEdges.length + ' entity relationship(s).')
                : 'Cataloged in Hawkins Hollow library index.'
            };
          }

          if (type === 'character') {
            const friendNames = nodeEdges
              .map(function (edge) {
                const otherId = edge.from === nodeId ? edge.to : edge.from;
                const other = graphByNodeId[otherId];
                return other && other.entityType === 'character' ? other.name : '';
              })
              .filter(Boolean)
              .slice(0, 3);
            const friendLine = friendNames.length > 0
              ? ('Friends and neighbors: ' + friendNames.join(', ') + (friendNames.length >= 3 ? '...' : '') + '.')
              : 'Character connections are growing as canon extraction expands.';
            return {
              kind: 'Character',
              summary: friendLine
            };
          }

          if (type === 'environment' || type === 'landmark') {
            const visitorNames = nodeEdges
              .filter(function (edge) { return edge.relationshipType === 'mentions-character'; })
              .map(function (edge) {
                const otherId = edge.from === nodeId ? edge.to : edge.from;
                const other = graphByNodeId[otherId];
                return other && other.entityType === 'character' ? other.name : '';
              })
              .filter(Boolean)
              .slice(0, 4);
            const visitorLine = visitorNames.length > 0
              ? ('Visited by ' + visitorNames.join(', ') + (visitorNames.length >= 4 ? '...' : '') + '.')
              : 'Place references are ready for more story links.';
            return {
              kind: type === 'environment' ? 'Place' : 'Landmark',
              summary: visitorLine
            };
          }

          if (type === 'relationship') {
            return {
              kind: 'Relationship',
              summary: nodeEdges.length > 0
                ? ('Maps to ' + nodeEdges.length + ' graph connection(s).')
                : 'Relationship indexed and ready for deeper linking.'
            };
          }

          if (type === 'activity') {
            return {
              kind: 'Activity',
              summary: 'Activity entries will grow as companion package extraction expands.'
            };
          }

          return {
            kind: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Entity',
            summary: node
              ? ('Connected to ' + nodeEdges.length + ' graph relationship(s).')
              : 'Indexed in Hawkins Hollow memory.'
          };
        }

        function renderResults(records, query) {
          if (!query) {
            renderMessage('Start typing to search the library index.');
            return;
          }

          if (records.length === 0) {
            renderMessage('No matches found for "' + query + '".');
            return;
          }

          const limitedRecords = records.slice(0, 60);
          const grouped = groupRecordsByType(limitedRecords);
          const groupKeys = Object.keys(grouped).sort(function (a, b) {
            const rankDiff = getTypeSortRank(a) - getTypeSortRank(b);
            if (rankDiff !== 0) {
              return rankDiff;
            }
            return a.localeCompare(b);
          });

          const groupsHtml = groupKeys.map(function (type) {
            const items = grouped[type].map(function (item) {
              const record = item.record || item;
              const details = item.details || { kind: record.type || 'Entity', summary: '' };
              const meta = [record.id, record.series].filter(Boolean).join(' | ');
              const href = record.href || '#';
              return '<article class="search-result-item">'
                + '<h4><a href="' + escapeHtml(href) + '">' + escapeHtml(record.title || record.id || 'Untitled') + '</a></h4>'
                + '<p class="search-result-kind">' + escapeHtml(details.kind || 'Entity') + '</p>'
                + (meta ? '<p>' + escapeHtml(meta) + '</p>' : '')
                + (record.asin ? '<p>ASIN: ' + escapeHtml(record.asin) + '</p>' : '')
                + (details.summary ? '<p class="search-result-summary">' + escapeHtml(details.summary) + '</p>' : '')
                + '</article>';
            }).join('');

            return '<section class="search-group">'
              + '<h3>' + escapeHtml(getTypeLabel(type)) + ' (' + grouped[type].length + ')</h3>'
              + items
              + '</section>';
          }).join('');

          resultsEl.innerHTML = '<p><strong>' + records.length + '</strong> result(s)</p>' + groupsHtml;
        }

        Promise.all([
          fetch('generated/search-index.json').then(function (response) { return response.json(); }),
          fetch('generated/entity-graph.json').then(function (response) { return response.json(); }).catch(function () { return { nodes: [], edges: [] }; })
        ])
          .then(function (payloads) {
            const payload = payloads[0] || { records: [] };
            const graph = payloads[1] || { nodes: [], edges: [] };
            const records = Array.isArray(payload.records) ? payload.records : [];
            const graphByNodeId = (graph.nodes || []).reduce(function (map, node) {
              map[node.id] = node;
              return map;
            }, {});
            const graphEdgesByNodeId = (graph.edges || []).reduce(function (map, edge) {
              if (!map[edge.from]) {
                map[edge.from] = [];
              }
              if (!map[edge.to]) {
                map[edge.to] = [];
              }
              map[edge.from].push(edge);
              map[edge.to].push(edge);
              return map;
            }, {});
            renderMessage('Start typing to search the library index.');
            input.addEventListener('input', function () {
              const query = input.value.trim().toLowerCase();
              const terms = query.split(/\s+/).filter(Boolean);
              const filtered = records.filter(function (record) {
                const searchable = toSearchableText(record);
                return terms.every(function (term) {
                  return searchable.indexOf(term) !== -1;
                });
              });
              renderResults(filtered.map(function (record) {
                const details = summarizeRecord(record, graphByNodeId, graphEdgesByNodeId);
                return {
                  record: record,
                  details: details
                };
              }), input.value.trim());
            });
          })
          .catch(function () {
            renderMessage('Search index could not be loaded.');
          });
      })();
    </script>`;
}

function buildAmazonLookup(amazonIndex) {
  const map = new Map();
  for (const record of (amazonIndex && amazonIndex.records) || []) {
    if (record && record.id) {
      map.set(record.id.toUpperCase(), record);
    }
  }
  return map;
}

function renderSeriesCardsFromLibraryIndex(libraryIndex, seriesName, amazonLookup) {
  const books = ((libraryIndex && libraryIndex.books) || [])
    .filter((book) => (book.series || '').toLowerCase() === seriesName.toLowerCase())
    .sort((a, b) => a.id.localeCompare(b.id));

  if (books.length === 0) {
    return '<p class="status-label">No books discovered yet in this series.</p>';
  }

  return `<div class="card-grid">${books
    .map((book) => {
      const pdf = (book.files || []).find((file) => file.toLowerCase().endsWith('.pdf'));
      const fileCount = (book.files || []).length;
      const detailHref = getBookPageHref(book);
      const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
      const links = amazon && amazon.links ? amazon.links : {};
      const buttons = [
        links.paperback ? `<a class="button" href="${links.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>` : '',
        links.hardcover ? `<a class="button" href="${links.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>` : '',
        links.kindle ? `<a class="button" href="${links.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>` : ''
      ]
        .filter((value) => Boolean(value))
        .join(' ');
      const amazonLine = buttons || (amazon && amazon.url
        ? `<a href="${amazon.url}" target="_blank" rel="noopener noreferrer">View on Amazon</a>`
        : 'Amazon listing not linked yet');
      return `<article class="book-card">
          <h3>${book.title || book.id}</h3>
          <p><strong>ID:</strong> ${book.id}</p>
          <p><strong>Series:</strong> ${book.series || 'Unknown'}</p>
          <p><strong>Files Indexed:</strong> ${fileCount}</p>
          <p>${pdf ? 'PDF discovered in Library' : 'PDF not discovered yet'}</p>
          <p>${amazonLine}</p>
          <a class="button" href="${detailHref}">Open Book Details</a>
        </article>`;
    })
    .join('')}</div>`;
}

function renderIndexedBookDetailPage(book, site, nav, config, amazonLookup) {
  const detailPath = getBookPageHref(book);
  const files = (book.files || []).sort();
  const previewFiles = files.slice(0, 20);
  const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
  const fileTypeSummary = ((book.fileTypes || [])
    .map((item) => `${item.extension.toUpperCase()}: ${item.count}`)
    .join(' | ')) || 'No file type data';

  const amazonBlock = amazon
    ? `<p><strong>Publication Status:</strong> ${amazon.status || 'Unknown'}</p>
      <p><strong>Publication Date:</strong> ${amazon.publicationDate || 'Unknown'}</p>
      <p><strong>Amazon Price:</strong> ${amazon.price || 'Unknown'}</p>
      <p><strong>Paperback ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.paperbackAsin) || 'Not provided'}</p>
      <p><strong>Hardcover ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.hardcoverAsin) || 'Not provided'}</p>
      <p><strong>Kindle ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.kindleAsin) || 'Not provided'}</p>
      <p><strong>ISBN:</strong> ${(amazon.identifiers && amazon.identifiers.isbn) || 'Not provided'}</p>
      <p><strong>ISBN-10:</strong> ${(amazon.identifiers && amazon.identifiers.isbn10) || 'Not provided'}</p>
      <p><strong>ISBN-13:</strong> ${(amazon.identifiers && amazon.identifiers.isbn13) || 'Not provided'}</p>
      <p><strong>Series (Catalog):</strong> ${amazon.series || book.series || 'Unknown'}</p>
      <p>
        ${amazon.links && amazon.links.paperback ? `<a class="button" href="${amazon.links.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>` : ''}
        ${amazon.links && amazon.links.hardcover ? `<a class="button" href="${amazon.links.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>` : ''}
        ${amazon.links && amazon.links.kindle ? `<a class="button" href="${amazon.links.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>` : ''}
      </p>
      ${amazon.url ? `<p><a href="${amazon.url}" target="_blank" rel="noopener noreferrer">Primary Amazon Link</a></p>` : ''}`
    : '<p><strong>Amazon Listing:</strong> No workbook match found for this book ID yet.</p>';

  const fileList = previewFiles
    .map((file) => `<li><code>${file}</code></li>`)
    .join('');

  const isbnValues = amazon && amazon.identifiers
    ? [amazon.identifiers.isbn13, amazon.identifiers.isbn10, amazon.identifiers.isbn].filter((value) => Boolean(value))
    : [];
  const offers = [];
  if (amazon && amazon.links) {
    if (amazon.links.paperback) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.paperback,
        availability: mapStatusToAvailability(amazon.status),
        itemCondition: 'https://schema.org/NewCondition',
        category: 'Paperback',
        price: (amazon.price || '').replace(/[^0-9.]/g, '') || undefined,
        priceCurrency: amazon.price ? 'USD' : undefined
      });
    }
    if (amazon.links.hardcover) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.hardcover,
        availability: mapStatusToAvailability(amazon.status),
        itemCondition: 'https://schema.org/NewCondition',
        category: 'Hardcover'
      });
    }
    if (amazon.links.kindle) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.kindle,
        availability: mapStatusToAvailability(amazon.status),
        category: 'EBook'
      });
    }
  }

  const jsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title || book.id,
    identifier: book.id,
    url: `${site.domain}/${detailPath}`,
    inLanguage: 'en',
    bookEdition: amazon && amazon.edition ? amazon.edition : undefined,
    isbn: isbnValues.length > 0 ? isbnValues : undefined,
    isPartOf: book.series
      ? {
          '@type': 'CreativeWorkSeries',
          name: book.series
        }
      : undefined,
    offers: offers.length > 0 ? offers : undefined
  };
  const jsonLd = JSON.stringify(jsonLdObject, null, 2);

  return renderLayout(
    `${book.title || book.id}`,
    `Library record ${book.id}`,
    `<section class="content-card">
      <p class="eyebrow">Library Record</p>
      <h1>${book.title || book.id}</h1>
      <p><strong>ID:</strong> ${book.id}</p>
      <p><strong>Series:</strong> ${book.series || 'Unknown'}</p>
      <p><strong>Series Code:</strong> ${book.seriesCode || 'Unknown'}</p>
      <p><strong>Folder:</strong> <code>${book.folder || 'Unknown'}</code></p>
      <p><strong>Indexed File Types:</strong> ${fileTypeSummary}</p>
      <p><strong>Total Files Indexed:</strong> ${files.length}</p>
      ${amazonBlock}
      <p>
        <a class="button" href="../books.html">Back to Books</a>
      </p>
    </section>

    <section class="content-card">
      <h2>Discovered Files</h2>
      <p>Showing the first ${previewFiles.length} of ${files.length} files from the Library scan.</p>
      <ul>${fileList}</ul>
    </section>

    <script type="application/ld+json">${jsonLd}</script>`,
    site,
    nav,
    `${site.domain}/${detailPath}`,
    config,
    null,
    '../'
  );
}

function renderLayout(title, description, content, site, nav, canonicalUrl, config, banner, pathPrefix = '') {
  const devBanner = config.previewMode
    ? `<section class="dev-banner"><strong>${config.previewMessage}</strong><br />${config.previewSubmessage}</section>`
    : '';
  const bannerTitle = banner ? banner.title || title : title;
  const bannerSubtitle = banner ? banner.subtitle || '' : '';
  const bannerAlt = banner && banner.alt ? banner.alt : bannerTitle;
  const bannerIdAttr = banner && banner.bannerId ? ` data-banner-id="${banner.bannerId}"` : '';
  const bannerImage = banner && banner.image
    ? `<img class="page-banner-image" src="${pathPrefix}${banner.image}" alt="${bannerAlt}"${bannerIdAttr} />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} | ${site.siteName}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="stylesheet" href="${pathPrefix}styles.css" />
  </head>
  <body>
    ${devBanner}
    <header class="site-header">
      <div class="brand">${site.siteName}</div>
      <nav class="site-nav" aria-label="Primary navigation">
        ${nav.items.map((item) => `<a href="${pathPrefix}${item.href}">${item.label}</a>`).join('')}
      </nav>
    </header>

    <main class="page-shell">
      ${bannerTitle ? `<section class="page-banner">${bannerImage}<div class="page-banner-copy"><h1>${bannerTitle}</h1>${bannerSubtitle ? `<p>${bannerSubtitle}</p>` : ''}</div></section>` : ''}
      ${content}
    </main>

    <footer class="site-footer">
      <p>${site.footerText}</p>
    </footer>
  </body>
</html>`;
}

function renderLandingPage(page, site, nav, config, banner) {
  return renderLayout(
    page.title,
    site.tagline,
    `<section class="hero-card">
      <p class="eyebrow">Welcome to</p>
      <h1>${site.siteName}</h1>
      <p>Hawkins Hollow is a place where stories gather, children find their first favorites, and every path leads toward a warm welcome.</p>
      <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
    </section>

    <section class="content-card">
      <h2>Begin your visit</h2>
      <p>Start with the stories, step into the world, and discover the books that make Hawkins Hollow feel like home.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}

function renderArticlePage(page, site, nav, config, banner, libraryIndex, amazonLookup) {
  if (page.slug === 'books') {
    const firstReadersCards = renderSeriesCardsFromLibraryIndex(libraryIndex, 'First Readers', amazonLookup);
    const searchSection = renderSearchSection();
    return renderLayout(
      page.title,
      'Every Hawkins Hollow story belongs somewhere in a larger journey. Some books are perfect for bedtime, some help beginning readers gain confidence, and others offer comfort during difficult moments. Browse the collections below and discover the stories that fit your family best.',
      `<section class="content-card" aria-labelledby="books-introduction">
      <h2 id="books-introduction">Books</h2>
      <p>Every Hawkins Hollow story belongs somewhere in a larger journey. Some books are perfect for bedtime, some help beginning readers gain confidence, and others offer comfort during difficult moments. Browse the collections below and discover the stories that fit your family best.</p>
    </section>

    <section class="content-card" aria-labelledby="books-series">
      <h2 id="books-series">Browse the Collections</h2>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p>Our flagship illustrated storybooks that introduce children to Hawkins Hollow through gentle stories, memorable characters, and everyday adventures.</p>
          <a class="button" href="storybook-shelf.html">Explore Storybooks</a>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p>Simple stories written for children beginning to read independently.</p>
          <p class="status-label">Auto-generated from the Library index.</p>
          ${firstReadersCards}
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p>Longer stories for growing readers ready for richer adventures and conversations.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p>Gentle evening stories created to help families slow down and finish the day together.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p>Stories celebrating friendship, family, cooperation, and belonging.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p>Comforting stories for children working through change, uncertainty, loss, or difficult emotions.</p>
          <p class="status-label">Coming Soon</p>
        </article>
      </div>
    </section>

    ${searchSection}

    <section class="content-card" aria-labelledby="books-closing">
      <h2 id="books-closing">Looking Ahead</h2>
      <p>Every new Hawkins Hollow book begins with one child, one family, and one small moment that matters.</p>
      <p>As new series arrive on the website, this library will continue to grow.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  if (page.slug === 'start-here') {
    return renderLayout(
      page.title,
      'Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.',
      `<section class="content-card start-here-intro">
      <p>Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.</p>
      <p>These books are written to be shared—between children and the grown-ups who love them, between beginning readers and patient listeners, and between families looking for stories that feel warm, familiar, and safe.</p>
    </section>

    <section class="content-card start-here-series" aria-labelledby="choose-a-place-to-begin">
      <h2 id="choose-a-place-to-begin">Choose a Place to Begin</h2>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p>Illustrated stories for shared reading, bedtime, quiet afternoons, and family story time. These books invite children into Hawkins Hollow through gentle adventures, familiar feelings, and characters who learn by living alongside one another.</p>
          <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p>Short, approachable stories for children beginning to read with growing independence. First Readers use brief lines, supportive illustrations, and comfortable pacing without making the child feel hurried or tested.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p>Longer stories for developing readers who are ready for more detail, more conversation, and a little more time inside each Hawkins Hollow moment.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p>Quiet stories made for winding down together. The Bedtime Library offers gentle pacing, emotional warmth, and a comfortable ending for the close of the day.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p>Stories about relationships, cooperation, belonging, and the everyday ways children and families learn to understand one another.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p>Comfort-centered stories for children moving through difficult feelings, uncertainty, change, or moments when reassurance matters most.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>
      </div>
    </section>

    <section class="content-card start-here-grownups" aria-labelledby="for-the-grown-ups">
      <h2 id="for-the-grown-ups">For the Grown-Ups</h2>
      <p>Hawkins Hollow books are written for children, but they are also made to support the adults reading beside them. Many books include gentle discussion prompts, family support pages, or small invitations to talk, listen, remember, and connect.</p>
      <p>There is no test at the end and no single correct way to use a Hawkins Hollow story. Read slowly. Pause when a child wants to pause. Return to a favorite page. Let the story become part of your family's own conversation.</p>
    </section>

    <section class="content-card start-here-closing" aria-labelledby="the-porch-light-is-on">
      <h2 id="the-porch-light-is-on">The Porch Light Is On</h2>
      <p>You do not have to explore everything at once. Begin with one story, one character, or one quiet moment that feels like a good fit. Hawkins Hollow will still be here when you come back.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  return renderLayout(
    page.title,
    page.content,
    `<section class="content-card">
      <p>Grandpa is still setting the table for this part of the Hollow. The path is ready, and the welcome is waiting.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderCharactersPage(site, nav, charactersData, config, banner) {
  const cards = charactersData.characters
    .filter((character) => character.featured === true)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (character) => `<a class="character-card" href="characters/${character.slug}.html" aria-label="Meet ${character.name}">
          <img src="${character.heroImage.replace(/^\//, '')}" alt="${character.name}" width="320" height="180" loading="lazy" />
          <h3>${character.name}</h3>
          <p>${character.description}</p>
        </a>`
    )
    .join('');

  return renderLayout(
    'Meet the Friends of Hawkins Hollow',
    'Every Hawkins Hollow story begins with someone worth knowing.',
    `<section class="content-card" aria-labelledby="characters-introduction">
      <h2 id="characters-introduction">Meet the Friends of Hawkins Hollow</h2>
      <p>Every Hawkins Hollow story begins with someone worth knowing.</p>
      <p>Some are adventurous. Some are quiet. Some ask questions. Some listen carefully. Some need encouragement. Some discover they can encourage someone else.</p>
      <p>Together they make Hawkins Hollow a place where every child can find someone who feels familiar.</p>
    </section>

    <section class="content-card" aria-labelledby="community-of-many-voices">
      <h2 id="community-of-many-voices">A Community of Many Voices</h2>
      <p>Children in Hawkins Hollow are different from one another in personality, interests, abilities, families, and experiences.</p>
      <p>Every character brings something valuable to the community, and every story reminds us that kindness, patience, courage, and belonging often grow through everyday moments.</p>
    </section>

    <section class="content-card" aria-labelledby="characters-youll-meet">
      <h2 id="characters-youll-meet">Characters You'll Meet</h2>
      <div class="character-grid">${cards}</div>
    </section>

    <section class="content-card" aria-labelledby="more-friends-are-waiting">
      <h2 id="more-friends-are-waiting">More Friends Are Waiting</h2>
      <p>Hawkins Hollow continues to grow with every new story.</p>
      <p>As additional books are published, more characters, families, and familiar places will find their home here.</p>
    </section>

    <section class="content-card" aria-labelledby="every-story-begins-with-someone">
      <h2 id="every-story-begins-with-someone">Every Story Begins with Someone</h2>
      <p>Whether you begin with a favorite character or discover someone new along the way, every Hawkins Hollow story offers another opportunity to listen, imagine, and grow together.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters.html`,
    config,
    banner
  );
}

function renderCharacterDetailPage(character, site, nav, config) {
  return renderLayout(
    character.name,
    character.description,
    `<section class="content-card">
      <img src="../${character.heroImage.replace(/^\//, '')}" alt="${character.name}" width="640" height="360" />
      <h1>${character.name}</h1>
      <p>${character.description}</p>
      <p><a href="../characters.html">Back to Meet the Friends of Hawkins Hollow</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters/${character.slug}.html`,
    config,
    null,
    '../'
  );
}

function renderSeriesPage(page, site, nav, seriesData, booksData, config, banner) {
  const series = seriesData.series.find((entry) => entry.slug === page.seriesSlug);

  if (page.slug === 'storybook-shelf') {
    return renderLayout(
      series.title,
      'Welcome to the Hawkins Hollow Storybook Shelf.',
      `<section class="content-card" aria-labelledby="storybook-shelf-introduction">
      <h2 id="storybook-shelf-introduction">Storybook Shelf</h2>
      <p>Welcome to the Hawkins Hollow Storybook Shelf.</p>
      <p>These illustrated stories invite children and families into a gentle countryside community filled with familiar feelings, caring relationships, small adventures, and characters who grow by living alongside one another.</p>
    </section>

    <section class="content-card" aria-labelledby="stories-made-to-be-shared">
      <h2 id="stories-made-to-be-shared">Stories Made to Be Shared</h2>
      <p>Hawkins Hollow Storybooks are created for reading together—at bedtime, during a quiet afternoon, in a classroom reading corner, or anywhere a child and a caring grown-up can pause for a story.</p>
      <p>Each book stands on its own, so families may begin with whichever character, feeling, or adventure seems like the best fit.</p>
    </section>

    <section class="content-card" aria-labelledby="the-shelf-is-growing">
      <h2 id="the-shelf-is-growing">The Shelf Is Growing</h2>
      <p>Individual story listings, book covers, descriptions, and purchase links will be added here as the Hawkins Hollow website continues to grow.</p>
      <p>For now, visitors may learn more about the Storybook Series and explore the rest of Hawkins Hollow.</p>
      <p>
        <a class="button" href="storybook-series.html">About the Storybook Series</a>
        <a class="button" href="books.html">Explore All Book Series</a>
      </p>
      <div class="card-grid" aria-label="Future story listings">
        <article class="book-card">
          <h3>Shelf Space Ready for New Stories</h3>
          <p class="placeholder">Future story listings will appear here as new books are added.</p>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="choose-the-story-that-feels-right">
      <h2 id="choose-the-story-that-feels-right">Choose the Story That Feels Right</h2>
      <p>There is no required reading order in Hawkins Hollow. Begin with one story that catches your attention, share it at your own pace, and return whenever the porch light calls you back.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  const books = (booksData.books || []).filter((book) => book.seriesSlug === series.slug).slice(0, 3);
  const cards = books
    .map(
      (book) => `<article class="book-card">
        <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" loading="lazy" />
        <h3>${book.title}</h3>
        <p><strong>Code:</strong> ${book.code}</p>
        ${book.description ? `<p>${book.description}</p>` : ''}
        <a class="button" href="${book.slug}.html">Read more</a>
      </article>`
    )
    .join('');

  return renderLayout(
    series.title,
    series.description,
    `<section class="content-card">
      <p>${series.description}</p>
      <p><a class="button" href="storybook-series.html">View the Storybook Series</a></p>
    </section>

    <section class="content-card">
      <h2>Books in this series</h2>
      <div class="card-grid">${cards}</div>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderBookDetailPage(page, site, nav, booksData, config, banner) {
  const book = booksData.books.find((entry) => entry.slug === page.bookSlug);
  return renderLayout(
    book.title,
    book.description,
    `<section class="content-card">
      <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" />
      <h2>About this book</h2>
      ${book.description ? `<p>${book.description}</p>` : ''}
      <p><strong>Series:</strong> ${book.seriesSlug}</p>
      <a class="button" href="books.html">Back to books</a>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderUnderConstructionPage(site, nav, constructionData, config, banner) {
  return renderLayout(
    constructionData.title,
    constructionData.message,
    `<section class="hero-card">
      <p class="eyebrow">Under construction</p>
      <h1>${constructionData.title}</h1>
      <p>${constructionData.message}</p>
      <p>
        <a class="button" href="${constructionData.primaryLinkHref}">${constructionData.primaryLinkLabel}</a>
        <a class="button" href="${constructionData.secondaryLinkHref}">${constructionData.secondaryLinkLabel}</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}

function renderReferenceFallbackPage(page, issue, site, nav, constructionData, config, banner) {
  const isLegacy = page.status === 'legacy';
  const label = isLegacy ? 'Legacy route preserved' : 'Under construction';
  const message = isLegacy
    ? 'This historical route is preserved while its original source record is reconciled.'
    : constructionData.message;

  return renderLayout(
    page.title,
    message,
    `<section class="hero-card">
      <p class="eyebrow">${label}</p>
      <h1>${page.title}</h1>
      <p>${message}</p>
      <p><strong>Unresolved ${issue.type} reference:</strong> ${issue.slug}</p>
      <p><a class="button" href="index.html">Return Home</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function getReferenceIssue(page, seriesData, booksData) {
  if (page.template === 'series') {
    const exists = seriesData.series.some((entry) => entry.slug === page.seriesSlug);
    return exists ? null : { type: 'series', slug: page.seriesSlug };
  }

  if (page.template === 'book-detail') {
    const exists = booksData.books.some((entry) => entry.slug === page.bookSlug);
    return exists ? null : { type: 'book', slug: page.bookSlug };
  }

  if (page.status === 'legacy' && page.legacyReference) {
    return page.legacyReference;
  }

  return null;
}

function writePage(fileName, html) {
  const outputPath = path.join(buildDir, fileName);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');
}

function buildSite() {
  const libraryArtifacts = writeLibraryArtifacts(root);
  const amazonArtifacts = writeAmazonKdpArtifact(root);
  console.log(
    `Library index updated: ${libraryArtifacts.summary.fileCount} files, ${libraryArtifacts.summary.indexedBooks} book records.`
  );
  if (amazonArtifacts.summary.missingWorkbook) {
    console.log('Amazon workbook not found. Skipping Amazon KDP index generation.');
  } else {
    console.log(
      `Amazon index updated: ${amazonArtifacts.summary.recordCount} records, ${amazonArtifacts.summary.liveCount} live listings.`
    );
  }

  const site = readJson('data/site.json');
  const nav = readJson('data/navigation.json');
  const pages = readJson('data/pages.json').pages;
  const seriesData = readJson('data/series.json');
  const booksData = readJson('data/books.json');
  const charactersData = readJson('data/characters.json');
  const constructionData = readJson('data/under-construction.json');
  const config = readJson('data/site-config.json');
  const banners = readJson('data/banners.json');
  const libraryScan = readJson('generated/library-scan.json');
  const libraryIndex = readJson('generated/library-index.json');
  const amazonIndex = amazonArtifacts.summary.missingWorkbook
    ? { records: [] }
    : readJson('generated/amazon-index.json');
  const amazonLookup = buildAmazonLookup(amazonIndex);
  const mergedBookIndex = createMergedBookIndex(libraryIndex, amazonLookup);
  const mergedBookIndexPath = writeMergedBookIndex(root, mergedBookIndex);
  const relationshipsData = readJson('data/relationships.json');
  const environmentsData = readJson('data/environments.json');
  const landmarksData = readJson('data/landmarks.json');
  const resourcesData = readJson('data/resources.json');
  const characterCanonArtifacts = writeCharacterCanonArtifact(root, charactersData, libraryScan);
  const characterCanonIndex = readJson('generated/character-canon-index.json');
  const worldCanonArtifacts = writeWorldCanonArtifacts(root, charactersData, libraryScan);
  const worldCanonIndex = readJson('generated/world-canon-index.json');
  const entityIndex = createEntityIndex(
    mergedBookIndex,
    charactersData,
    characterCanonIndex,
    worldCanonIndex,
    relationshipsData,
    environmentsData,
    landmarksData,
    resourcesData,
    libraryScan
  );
  const entityIndexPath = writeEntityIndex(root, entityIndex);
  const entityGraph = createEntityGraph(entityIndex);
  const entityGraphPath = writeEntityGraph(root, entityGraph);
  const searchIndex = createSearchIndexFromEntityIndex(entityIndex);
  const searchIndexPath = writeSearchIndex(root, searchIndex);
  console.log(`Search index updated: ${searchIndex.summary.totalRecords} records.`);
  console.log(
    `Merged book index updated: ${mergedBookIndex.summary.recordCount} records (${mergedBookIndex.summary.withAmazonDataCount} with Amazon data).`
  );
  console.log(
    `Character canon index updated: ${characterCanonArtifacts.summary.recordCount} records (${characterCanonArtifacts.summary.withSourceDocumentCount} with source documents).`
  );
  console.log(
    `World canon index updated: ${worldCanonArtifacts.summary.totalRecords} records (relationships ${worldCanonArtifacts.summary.relationships}, environments ${worldCanonArtifacts.summary.environments}, landmarks ${worldCanonArtifacts.summary.landmarks}).`
  );
  console.log(`Entity index updated: ${entityIndex.summary.totalEntities} entities.`);
  console.log(
    `Entity graph updated: ${entityGraph.summary.nodeCount} nodes, ${entityGraph.summary.edgeCount} edges (${entityGraph.summary.unresolvedMentionCount} unresolved mentions).`
  );

  const pageDefinitions = pages.map((page) => ({ ...page }));
  const existingSlugs = new Set(pageDefinitions.map((page) => page.slug));
  for (const item of nav.items) {
    const slug = item.href.replace(/\.html$/, '');
    if (!existingSlugs.has(slug)) {
      pageDefinitions.push({
        slug,
        title: item.label,
        template: 'under-construction'
      });
      existingSlugs.add(slug);
    }
  }

  const pageReferenceIssues = new Map();
  for (const page of pageDefinitions) {
    const issue = getReferenceIssue(page, seriesData, booksData);
    if (issue) {
      const fallbackAction = page.status === 'legacy' ? 'legacy' : 'under-construction';
      console.warn(
        `[recovery warning] page "${page.slug}": missing ${issue.type} reference "${issue.slug}"; fallback action: ${fallbackAction}`
      );
      pageReferenceIssues.set(page.slug, issue);
    }
  }

  ensureDir(buildDir);
  fs.copyFileSync(path.join(root, 'styles.css'), path.join(buildDir, 'styles.css'));
  if (fs.existsSync(path.join(root, 'assets'))) {
    copyDir(path.join(root, 'assets'), path.join(buildDir, 'assets'));
  }
  if (fs.existsSync(path.join(root, 'generated'))) {
    copyDir(path.join(root, 'generated'), path.join(buildDir, 'generated'));
  }
  ensureDir(path.join(buildDir, 'images'));
  if (!fs.existsSync(path.join(buildDir, 'images', 'placeholder-banner.jpg'))) {
    fs.writeFileSync(path.join(buildDir, 'images', 'placeholder-banner.jpg'), 'placeholder-banner');
  }
  if (!fs.existsSync(path.join(buildDir, 'images', 'placeholder-cover.jpg'))) {
    fs.writeFileSync(path.join(buildDir, 'images', 'placeholder-cover.jpg'), 'placeholder-cover');
  }

  for (const page of pageDefinitions) {
    const banner = getBannerForPage(page, banners);
    const referenceIssue = pageReferenceIssues.get(page.slug);
    let html = '';
    if (referenceIssue) {
      html = renderReferenceFallbackPage(page, referenceIssue, site, nav, constructionData, config, banner);
    } else if (page.slug === 'index') {
      html = renderLandingPage(page, site, nav, config, banner);
    } else if (page.slug === 'characters') {
      html = renderCharactersPage(site, nav, charactersData, config, banner);
    } else if (page.template === 'article') {
      html = renderArticlePage(page, site, nav, config, banner, libraryIndex, amazonLookup);
    } else if (page.template === 'series') {
      html = renderSeriesPage(page, site, nav, seriesData, booksData, config, banner);
    } else if (page.template === 'book-detail') {
      html = renderBookDetailPage(page, site, nav, booksData, config, banner);
    } else {
      html = renderUnderConstructionPage(site, nav, constructionData, config, banner);
    }

    writePage(page.slug === 'index' ? 'index.html' : `${page.slug}.html`, html);
  }

  const featuredCharacters = charactersData.characters
    .filter((character) => character.featured === true)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const character of featuredCharacters) {
    writePage(
      path.join('characters', `${character.slug}.html`),
      renderCharacterDetailPage(character, site, nav, config)
    );
  }

  const indexedBooks = (libraryIndex.books || []).slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const book of indexedBooks) {
    writePage(getBookPageHref(book), renderIndexedBookDetailPage(book, site, nav, config, amazonLookup));
  }

  const allEntities = (entityIndex.entities || []).slice().sort((a, b) => {
    if (a.type === b.type) {
      return String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id));
    }
    return String(a.type).localeCompare(String(b.type));
  });
  for (const entity of allEntities) {
    const pagePath = entity.entityPageHref || getEntityPageHref(entity.type, entity.id, entity.name || entity.title || '');
    writePage(pagePath, renderUniversalEntityPage(entity, entityIndex, entityGraph, site, nav, config));
  }

  console.log(`Generated ${indexedBooks.length} indexed book detail pages.`);
  console.log(`Generated ${allEntities.length} universal entity pages.`);
  console.log(`Copied search index to build output from ${path.relative(root, searchIndexPath)}.`);
  console.log(`Merged book index saved to ${path.relative(root, mergedBookIndexPath)}.`);
  console.log(`Entity index saved to ${path.relative(root, entityIndexPath)}.`);
  console.log(`Entity graph saved to ${path.relative(root, entityGraphPath)}.`);

  console.log('Generated recovery site in build-recovery/');
}

buildSite();
