function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getInfoField(record, key) {
  const field = (record.infoFields || []).find((entry) => entry.key === key);
  return field ? String(field.value || '').trim() : '';
}

function buildCharacterAliases(characters) {
  const aliases = [];
  const firstNames = new Map();
  for (const character of characters || []) {
    const identity = character.identity || {};
    const canonicalId = String(identity.canonicalId || '').toUpperCase();
    const name = String(character.name || '').trim();
    if (!canonicalId || !name) continue;
    const firstName = normalizeSearchText(name).split(' ')[0];
    firstNames.set(firstName, (firstNames.get(firstName) || 0) + 1);
    for (const value of [name, character.code, ...(identity.legacyAliases || [])]) {
      const normalized = normalizeSearchText(value);
      if (normalized) aliases.push({ canonicalId, name, normalized });
    }
  }

  for (const character of characters || []) {
    const canonicalId = String(character.identity && character.identity.canonicalId || '').toUpperCase();
    const name = String(character.name || '').trim();
    const firstName = normalizeSearchText(name).split(' ')[0];
    if (canonicalId && name && firstNames.get(firstName) === 1) {
      aliases.push({ canonicalId, name, normalized: firstName });
    }
  }

  const unique = new Map();
  for (const alias of aliases) unique.set(`${alias.canonicalId}:${alias.normalized}`, alias);
  return Array.from(unique.values()).sort((left, right) => right.normalized.length - left.normalized.length);
}

function getOpeningCastClause(value) {
  const cast = String(value || '').trim();
  if (!cast) return '';
  const stop = /[.!?;](?:\s|$)/.exec(cast);
  return (stop ? cast.slice(0, stop.index) : cast).replace(/\([^)]*\)/g, ' ');
}

function extractCanonicalParticipants(castValue, characterAliases) {
  const clause = normalizeSearchText(getOpeningCastClause(castValue));
  if (!clause) return [];
  const paddedClause = ` ${clause} `;
  const found = [];
  const seen = new Set();

  for (const alias of characterAliases || []) {
    const phrase = ` ${alias.normalized} `;
    const index = paddedClause.indexOf(phrase);
    if (index < 0) continue;
    const start = Math.max(0, index - 24);
    const end = Math.min(paddedClause.length, index + phrase.length + 40);
    const context = paddedClause.slice(start, end);
    if (/\b(?:not|excluding|excluded|available|considered|off scene|offscene)\b/.test(context)) continue;
    if (seen.has(alias.canonicalId)) continue;
    seen.add(alias.canonicalId);
    found.push({ canonicalId: alias.canonicalId, name: alias.name, index });
  }

  return found
    .sort((left, right) => left.index - right.index)
    .map(({ canonicalId, name }) => ({ canonicalId, name }));
}

function extractLiteralRouteLocations(routeValue) {
  const route = String(routeValue || '').trim();
  if (!route) return [];
  return route
    .replace(/(?:→|->)/g, '|')
    .split(/[|,;]/)
    .flatMap((segment) => {
      const cleaned = segment.trim().replace(/^with\s+/i, '').replace(/\s+details?\s*$/i, '');
      return cleaned.split(/\s+and\s+/i);
    })
    .map((location) => location.trim().replace(/^with\s+/i, '').replace(/\s+details?\s*$/i, '').trim())
    .filter(Boolean)
    .filter((location, index, all) => all.findIndex((entry) => normalizeSearchText(entry) === normalizeSearchText(location)) === index);
}

function getCanonicalLocations(routeValue, entityIndex) {
  const route = ` ${normalizeSearchText(routeValue)} `;
  if (!route.trim()) return [];
  const places = [
    ...((entityIndex && entityIndex.byType && entityIndex.byType.environments) || []),
    ...((entityIndex && entityIndex.byType && entityIndex.byType.landmarks) || [])
  ];
  return places
    .filter((place) => {
      const name = normalizeSearchText(place.name || place.title);
      return name && route.includes(` ${name} `);
    })
    .map((place) => ({
      id: String(place.id || ''),
      name: String(place.name || place.title || place.id || ''),
      type: String(place.type || ''),
      href: String(place.entityPageHref || place.href || '')
    }));
}

function createFreebieDiscoveryVocabulary(records, characters, entityIndex) {
  const participantNames = new Map();
  for (const character of characters || []) {
    const canonicalId = String(character.identity && character.identity.canonicalId || '').toUpperCase();
    const name = String(character.name || '').trim();
    if (canonicalId && name) participantNames.set(canonicalId, { canonicalId, name });
  }
  const places = new Map();
  for (const place of [
    ...((entityIndex && entityIndex.byType && entityIndex.byType.environments) || []),
    ...((entityIndex && entityIndex.byType && entityIndex.byType.landmarks) || [])
  ]) {
    const id = String(place.id || '');
    const name = String(place.name || place.title || '').trim();
    if (id && name) places.set(id, { id, name, type: String(place.type || '') });
  }
  const literalLocations = new Map();
  for (const record of records || []) {
    for (const location of record.literalLocations || []) {
      const normalized = normalizeSearchText(location);
      if (normalized) literalLocations.set(normalized, String(location).trim());
    }
  }
  const firstNameCounts = new Map();
  for (const participant of participantNames.values()) {
    const firstName = normalizeSearchText(participant.name).split(' ')[0];
    firstNameCounts.set(firstName, (firstNameCounts.get(firstName) || 0) + 1);
  }
  return {
    participants: Array.from(participantNames.values()),
    uniqueParticipantFirstNames: Array.from(firstNameCounts).filter(([, count]) => count === 1).map(([name]) => name),
    places: Array.from(places.values()),
    literalLocations: Array.from(literalLocations.values())
  };
}

function getStructuredQueryKinds(records, query, vocabulary = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return new Set();
  const participantNames = (vocabulary.participants || []).map((participant) => normalizeSearchText(participant.name));
  if (participantNames.length === 0) {
    participantNames.push(...(records || []).flatMap((record) => (record.participants || []).map((participant) => normalizeSearchText(participant.name))));
  }
  const firstNames = new Map();
  for (const name of new Set(participantNames)) {
    const firstName = name.split(' ')[0];
    firstNames.set(firstName, (firstNames.get(firstName) || 0) + 1);
  }
  const kinds = new Set();
  if (participantNames.some((name) => name === normalizedQuery)
    || (!normalizedQuery.includes(' ') && firstNames.get(normalizedQuery) === 1)) {
    kinds.add('participants');
  }

  const locationNames = [
    ...(vocabulary.places || []).map((place) => normalizeSearchText(place.name)),
    ...(vocabulary.literalLocations || []).map(normalizeSearchText),
    ...(records || []).flatMap((record) => [
      ...(record.literalLocations || []),
      ...(record.canonicalLocations || []).map((location) => location.name)
    ].map(normalizeSearchText))
  ];
  if (locationNames.some((name) => name === normalizedQuery || name.startsWith(`${normalizedQuery} `))) {
    kinds.add('locations');
  }
  return kinds;
}

function createFreebieDiscoveryRecords(records, characters, entityIndex, getDetailHref, routingById = new Map()) {
  const characterAliases = buildCharacterAliases(characters);
  return (records || []).map((record) => {
    const theme = getInfoField(record, 'theme');
    const ageLane = getInfoField(record, 'age lane');
    const skill = getInfoField(record, 'skill');
    const emotionalHook = getInfoField(record, 'emotional hook');
    const cast = getInfoField(record, 'cast');
    const route = getInfoField(record, 'route');
    const participants = extractCanonicalParticipants(cast, characterAliases);
    const literalLocations = extractLiteralRouteLocations(route);
    const canonicalLocations = getCanonicalLocations(route, entityIndex);
    const routing = routingById.get(String(record.canonicalId || '').toUpperCase());
    const searchableValues = [
      record.canonicalId,
      record.title,
      ...participants.map((participant) => participant.name),
      ...literalLocations,
      ...canonicalLocations.map((location) => location.name),
      theme,
      ageLane,
      skill,
      emotionalHook,
      record.centralHook,
      record.description,
      route
    ].filter(Boolean).map((value) => String(value).trim());
    const contentType = String(record.contentType || '');
    const typeLabel = contentType === 'song' ? 'Kids Song' : 'Nursery Rhyme';

    return {
      canonicalId: String(record.canonicalId || '').toUpperCase(),
      contentType,
      typeLabel,
      title: String(record.title || record.canonicalId || ''),
      href: typeof getDetailHref === 'function' ? getDetailHref(record) : '',
      participants,
      literalLocations,
      canonicalLocations,
      theme,
      ageLane,
      skill,
      emotionalHook,
      description: String(record.description || ''),
      centralHook: String(record.centralHook || ''),
      illustrationUrl: record.illustrationPublished ? record.illustrationUrl : '',
      illustrationPublished: Boolean(record.illustrationPublished),
      youtubeUrl: routing && /^https?:\/\//i.test(String(routing.youtubeUrl || '')) ? routing.youtubeUrl : '',
      keywords: searchableValues,
      searchText: normalizeSearchText(searchableValues.join(' ')),
      provenance: {
        participants: cast ? 'manuscript-info:cast' : '',
        locations: route ? 'manuscript-info:route' : '',
        theme: theme ? 'manuscript-info:theme' : '',
        ageLane: ageLane ? 'manuscript-info:age-lane' : '',
        description: record.description ? 'approved-manuscript-description-section' : ''
      }
    };
  });
}

function parseCanonicalQueryId(query, contentType) {
  const compact = String(query || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const expectedMode = contentType === 'song' ? 'S' : (contentType === 'rhyme' ? 'R' : '');
  let match = /^HH([SR])(\d{1,4})$/.exec(compact);
  if (match) {
    if (expectedMode && match[1] !== expectedMode) return { recognized: true, id: '' };
    return { recognized: true, id: `HH-${match[1]}-${match[2].padStart(4, '0')}` };
  }
  match = /^(\d{1,4})$/.exec(compact);
  if (match && expectedMode) {
    return { recognized: true, id: `HH-${expectedMode}-${match[1].padStart(4, '0')}` };
  }
  return { recognized: false, id: '' };
}

function filterFreebieRecords(records, query, contentType = '', vocabulary = {}) {
  const collection = (records || []).filter((record) => !contentType || record.contentType === contentType);
  const rawQuery = String(query || '').trim();
  if (!rawQuery) return collection;
  const parsedId = parseCanonicalQueryId(rawQuery, contentType);
  if (parsedId.recognized) return collection.filter((record) => record.canonicalId === parsedId.id);
  const structuredKinds = getStructuredQueryKinds(collection, rawQuery, vocabulary);
  if (structuredKinds.size > 0) {
    const normalizedQuery = normalizeSearchText(rawQuery);
    return collection.filter((record) => {
      const participantMatch = structuredKinds.has('participants')
        && (record.participants || []).some((participant) => normalizeSearchText(participant.name) === normalizedQuery
          || (!normalizedQuery.includes(' ') && normalizeSearchText(participant.name).split(' ')[0] === normalizedQuery));
      const locationMatch = structuredKinds.has('locations')
        && [
          ...(record.literalLocations || []),
          ...(record.canonicalLocations || []).map((location) => location.name)
        ].some((location) => {
          const normalizedLocation = normalizeSearchText(location);
          return normalizedLocation === normalizedQuery || normalizedLocation.startsWith(`${normalizedQuery} `);
        });
      return participantMatch || locationMatch;
    });
  }
  const terms = normalizeSearchText(rawQuery).split(' ').filter(Boolean);
  if (!terms.length) return collection;
  return collection.filter((record) => terms.every((term) => String(record.searchText || '').includes(term)));
}

function createFreebieSearchIndexRecord(record) {
  return {
    type: record.contentType,
    id: record.canonicalId,
    title: record.title,
    series: record.typeLabel,
    href: record.href,
    asin: '',
    amazonUrl: '',
    purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
    summary: record.description || record.centralHook || '',
    imageUrl: record.illustrationUrl || '',
    youtubeUrl: record.youtubeUrl || '',
    participants: record.participants,
    literalLocations: record.literalLocations,
    canonicalLocations: record.canonicalLocations,
    theme: record.theme,
    ageLane: record.ageLane,
    keywords: record.keywords,
    searchText: record.searchText
  };
}

module.exports = {
  buildCharacterAliases,
  createFreebieDiscoveryRecords,
  createFreebieDiscoveryVocabulary,
  createFreebieSearchIndexRecord,
  extractCanonicalParticipants,
  extractLiteralRouteLocations,
  filterFreebieRecords,
  getCanonicalLocations,
  normalizeSearchText,
  parseCanonicalQueryId
};