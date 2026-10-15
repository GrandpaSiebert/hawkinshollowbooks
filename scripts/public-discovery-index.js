const { isPublicEntityEligible } = require('./public-surface-eligibility');
function interestLabel(value) {
  const text = String(value || '').trim();
  if (/website freebie|present in manuscript|clearly inferred/i.test(text)) return '';
  return text.split(/\s*[—;]\s*|\s+through\s+/i)[0].replace(/^and\s+/i, '').trim();
}
function ageLabel(value) {
  const match = String(value || '').match(/ages?\s*(\d+)\s*[–—-]\s*(\d+)/i);
  if (match) return 'Ages ' + match[1] + '–' + match[2];
  const newborn = String(value || '').match(/newborn through age\s*(\d+)/i);
  return newborn ? 'Newborn–' + newborn[1] : '';
}

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
  bookThemesById = new Map(),
  bookMetadataById = new Map()
) {
  const entityByHref = new Map((entityIndex.entities || [])
    .flatMap((entity) => [entity.entityPageHref, entity.href, entity.legacyHref].filter(Boolean).map(href => [href, entity]))
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
    .flatMap((entity) => [entity.identity && entity.identity.canonicalId, entity.id].filter(Boolean).map(id => [String(id).toUpperCase(), entity])));
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
    const resolve = node => { const split = node.indexOf(':'); return searchNodeForEntity(node.slice(0, split), node.slice(split + 1)); };
    const from = resolve(edge.from); const to = resolve(edge.to);
    addRelated(from, to);
    addRelated(to, from);
  }
  for (const record of freebieRecords || []) {
    const from = searchNodeForEntity(record.contentType, record.canonicalId);
    for (const participant of record.participants || []) {
      const to = searchNodeForEntity('character', participant.canonicalId, participant.name);
      addRelated(from, to); addRelated(to, from);
    }
    for (const place of record.canonicalLocations || []) {
      const to = searchNodeForEntity(place.type, place.id);
      addRelated(from, to); addRelated(to, from);
    }
  }
  for (const characterEntry of characterBookIndex || []) {
    const characterNode = searchNodeForEntity('character', characterEntry.canonicalCharacterId, characterEntry.characterName);
    for (const book of characterEntry.books || []) {
      const bookNode = searchNodeForEntity('book', book.canonicalId || book.bookId);
      addRelated(bookNode, characterNode);
      addRelated(characterNode, bookNode);
    }
  }

  const records = (searchRecords || [])
    .filter((record) => record.href)
    .map((record) => {
      const entity = entityByHref.get(record.href) || {};
      const freebie = freebieById.get(String(record.id || '').toUpperCase()) || {};
      const metadata = bookMetadataById.get(String(record.id || '').toUpperCase()) || {};
      const href = record.type === 'character' && entity.slug
        ? `characters/${entity.slug}.html`
        : record.href;
      const tags = [
        ...(Array.isArray(record.theme) ? record.theme : [record.theme])
          .concat(bookThemesById.get(String(record.id || '').toUpperCase()) || [])
          .filter((tag) => typeof tag === 'string' && tag.trim())
          .map((label) => ({ kind: 'interest', label: interestLabel(label) }))
          .filter(tag => tag.label && tag.label.length <= 64),
        ...(metadata.feelings || []).map(label => ({ kind: 'feeling', label })),
        ageLabel(record.ageLane || metadata.readingGuidance) && { kind: 'age', label: ageLabel(record.ageLane || metadata.readingGuidance) },
        freebie.skill && { kind: 'activity', label: freebie.skill },
        false
      ].filter(Boolean);
      const relatedCandidates = Array.from(relatedByNode.get(`${record.type}:${String(record.id || '').toUpperCase()}`) || [])
        .map((nodeId) => searchByNode.get(nodeId))
        .filter(Boolean)
        .sort((a,b) => a.type.localeCompare(b.type))
        .filter((item, i, all) => all.findIndex(other => other.href === item.href) === i)
        .map((item) => {
          const entity = entityByCanonicalId.get(String(item.id || '').toUpperCase());
          const href = item.type === 'character' && entity && entity.slug
            ? `characters/${entity.slug}.html`
            : item.href;
          return { type: item.type, title: item.title, href };
        });
      const selected = []; const selectedTypes = new Set();
      for (const item of relatedCandidates) { if (!selectedTypes.has(item.type)) { selected.push(item); selectedTypes.add(item.type); } }
      for (const item of relatedCandidates) { if (selected.length >= 8) break; if (!selected.includes(item)) selected.push(item); }
      const related = selected.slice(0, 8);
      const image = freebie.illustrationPublished
        ? freebie.illustrationUrl
        : (metadata.image || entity.coverImage || entity.heroImage || entity.image || '');
      return {
        type: record.type,
        id: record.id,
        title: record.title,
        href,
        summary: metadata.summary || freebie.description || entity.description || '',
        series: metadata.series || '',
        seriesSlug: metadata.seriesSlug || '',
        readingGuidance: metadata.readingGuidance || '',
        image: String(image || '').replace(/\\/g, '/'),
        tags: Array.from(new Map(tags.map((tag) => [`${tag.kind}:${tag.label.toLowerCase()}`, tag])).values()),
        related
      };
    });
  const canonicalLabels = new Map();
  for (const record of records) for (const tag of record.tags) {
    const key = tag.kind + ":" + tag.label.toLowerCase();
    if (!canonicalLabels.has(key)) canonicalLabels.set(key, tag.label);
    tag.label = canonicalLabels.get(key);
  }
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
