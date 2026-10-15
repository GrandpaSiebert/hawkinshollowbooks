const { isPublicEntityEligible } = require('./public-surface-eligibility');

function createPublicEntityIndex(entityIndex, isBookPublicationEligible) {
  const publicBook = (book) => !isBookPublicationEligible
    || isBookPublicationEligible({ identity: { canonicalId: book.id } });
  const filterEntities = (entities) => (entities || [])
    .filter((entity) => isPublicEntityEligible(entity))
    .filter((entity) => entity.type !== 'book' || publicBook(entity));
  const byType = Object.fromEntries(Object.entries(entityIndex.byType || {})
    .map(([type, entities]) => [type, filterEntities(entities)]));
  const entities = filterEntities(entityIndex.entities);

  return {
    ...entityIndex,
    byType,
    entities
  };
}

function createPublicEntityGraph(entityGraph, publicEntityIndex) {
  const eligibleIds = new Set((publicEntityIndex.entities || [])
    .map((entity) => `${entity.type}:${entity.id}`));
  const nodes = (entityGraph.nodes || [])
    .filter((node) => eligibleIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (entityGraph.edges || [])
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const unresolvedMentions = entityGraph.unresolvedMentions || [];

  return {
    ...entityGraph,
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

function createPublicDiscoveryIndex(
  searchRecords,
  entityIndex,
  entityGraph,
  freebieRecords,
  characterBookIndex = [],
  bookThemesById = new Map()
) {
  const entityByHref = new Map((entityIndex.entities || [])
    .map((entity) => [entity.entityPageHref || entity.href || '', entity])
    .filter(([href]) => Boolean(href)));
  const freebieById = new Map((freebieRecords || [])
    .map((record) => [String(record.canonicalId || '').toUpperCase(), record]));
  const searchByNode = new Map((searchRecords || []).map((record) => [
    `${record.type}:${String(record.id || '').toUpperCase()}`,
    record
  ]));
  const searchNodeByHref = new Map((searchRecords || []).map((record) => [
    record.href,
    `${record.type}:${String(record.id || '').toUpperCase()}`
  ]));
  const searchNodeByTitle = new Map((searchRecords || []).map((record) => [
    `${record.type}:${String(record.title || '').trim().toLowerCase()}`,
    `${record.type}:${String(record.id || '').toUpperCase()}`
  ]));
  const entityByCanonicalId = new Map((entityIndex.entities || [])
    .map((entity) => [String(entity.identity && entity.identity.canonicalId || entity.id || '').toUpperCase(), entity]));
  const relatedByNode = new Map();
  const addRelated = (from, to) => {
    if (!from || !to || from === to || !searchByNode.has(from) || !searchByNode.has(to)) return;
    const related = relatedByNode.get(from) || new Set();
    related.add(to);
    relatedByNode.set(from, related);
  };
  const searchNodeForEntity = (type, id, name = '') => {
    const normalizedId = String(id || '').toUpperCase();
    const entity = entityByCanonicalId.get(normalizedId);
    if (entity && entity.type === type) {
      const primaryHref = type === 'character' && entity.slug
        ? `characters/${entity.slug}.html`
        : entity.entityPageHref || entity.href || '';
      const primaryRecord = searchNodeByHref.get(primaryHref);
      if (primaryRecord) return primaryRecord;
    }
    const direct = `${type}:${normalizedId}`;
    return (searchByNode.has(direct) && direct)
      || searchNodeByTitle.get(`${type}:${String(name).trim().toLowerCase()}`)
      || '';
  };

  for (const edge of (entityGraph && entityGraph.edges) || []) {
    addRelated(edge.from, edge.to);
    addRelated(edge.to, edge.from);
  }
  for (const record of freebieRecords || []) {
    const from = searchNodeForEntity(record.contentType, record.canonicalId);
    for (const participant of record.participants || []) {
      addRelated(from, searchNodeForEntity('character', participant.canonicalId, participant.name));
    }
    for (const place of record.canonicalLocations || []) {
      addRelated(from, searchNodeForEntity(place.type, place.id));
    }
  }
  for (const characterEntry of characterBookIndex || []) {
    const characterNode = searchNodeForEntity('character', characterEntry.canonicalCharacterId, characterEntry.characterName);
    for (const book of characterEntry.books || []) {
      const bookNode = searchNodeForEntity('book', book.canonicalId);
      addRelated(bookNode, characterNode);
      addRelated(characterNode, bookNode);
    }
  }

  const records = (searchRecords || [])
    .filter((record) => record.href)
    .map((record) => {
      const entity = entityByHref.get(record.href) || {};
      const freebie = freebieById.get(String(record.id || '').toUpperCase()) || {};
      const href = record.type === 'character' && entity.slug
        ? `characters/${entity.slug}.html`
        : record.href;
      const tags = [
        ...(Array.isArray(record.theme) ? record.theme : [record.theme])
          .concat(bookThemesById.get(String(record.id || '').toUpperCase()) || [])
          .filter((tag) => typeof tag === 'string' && tag.trim())
          .map((label) => ({ kind: 'interest', label: label.trim() })),
        record.ageLane && { kind: 'age', label: record.ageLane },
        freebie.skill && { kind: 'activity', label: freebie.skill },
        freebie.emotionalHook && { kind: 'feeling', label: freebie.emotionalHook }
      ].filter(Boolean);
      const related = Array.from(relatedByNode.get(`${record.type}:${String(record.id || '').toUpperCase()}`) || [])
        .map((nodeId) => searchByNode.get(nodeId))
        .filter(Boolean)
        .slice(0, 4)
        .map((item) => {
          const entity = entityByCanonicalId.get(String(item.id || '').toUpperCase());
          const href = item.type === 'character' && entity && entity.slug
            ? `characters/${entity.slug}.html`
            : item.href;
          return { type: item.type, title: item.title, href };
        });
      const image = freebie.illustrationPublished
        ? freebie.illustrationUrl
        : (entity.coverImage || entity.heroImage || entity.image || '');
      return {
        type: record.type,
        id: record.id,
        title: record.title,
        href,
        summary: freebie.description || entity.description || '',
        image: String(image || '').replace(/\\/g, '/'),
        tags: Array.from(new Map(tags.map((tag) => [`${tag.kind}:${tag.label.toLowerCase()}`, tag])).values()),
        related
      };
    });
  const facetCounts = new Map();
  for (const record of records) {
    for (const tag of record.tags) {
      const key = `${tag.kind}:${tag.label}`;
      facetCounts.set(key, {
        ...tag,
        count: (facetCounts.get(key) && facetCounts.get(key).count || 0) + 1
      });
    }
  }
  const facets = Array.from(facetCounts.values())
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));

  return { records, facets };
}

module.exports = {
  createPublicDiscoveryIndex,
  createPublicEntityGraph,
  createPublicEntityIndex
};
