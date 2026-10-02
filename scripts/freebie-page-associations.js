const PLACE_TYPES = new Set(['environment', 'landmark']);

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function getPlaceKey(type, id) {
  return `${String(type || '').trim().toLowerCase()}:${normalizeId(id)}`;
}

function appearsInLiteralLocation(name, literalLocation) {
  const normalizedName = String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedLocation = String(literalLocation || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return Boolean(normalizedName && normalizedLocation && normalizedName === normalizedLocation);
}

function addAssociation(associations, key, record) {
  const entries = associations.get(key) || [];
  if (!entries.some((entry) => entry.canonicalId === record.canonicalId)) {
    entries.push(record);
    associations.set(key, entries);
  }
}

function summarizeAssociations(associations, pageTypes = null, onlyType = '') {
  let pagesWithSongs = 0;
  let pagesWithRhymes = 0;
  let songAssociations = 0;
  let rhymeAssociations = 0;

  for (const [key, records] of associations) {
    if (onlyType && pageTypes.get(key) !== onlyType) continue;
    const songIds = new Set(records.filter((record) => record.contentType === 'song').map((record) => record.canonicalId));
    const rhymeIds = new Set(records.filter((record) => record.contentType === 'rhyme').map((record) => record.canonicalId));
    if (songIds.size > 0) pagesWithSongs += 1;
    if (rhymeIds.size > 0) pagesWithRhymes += 1;
    songAssociations += songIds.size;
    rhymeAssociations += rhymeIds.size;
  }

  return {
    pagesWithAtLeastOneSong: pagesWithSongs,
    pagesWithAtLeastOneNurseryRhyme: pagesWithRhymes,
    totalSongAssociations: songAssociations,
    totalNurseryRhymeAssociations: rhymeAssociations
  };
}

function createFreebiePageAssociationIndex(records, characters, entities) {
  const characterPages = new Map();
  for (const character of characters || []) {
    const canonicalId = normalizeId(character.identity && character.identity.canonicalId);
    if (canonicalId && character.slug && character.published !== false) {
      characterPages.set(canonicalId, character);
    }
  }

  const placePages = new Map();
  const placePageTypes = new Map();
  for (const entity of entities || []) {
    const type = String(entity.type || '').trim().toLowerCase();
    const id = normalizeId(entity.id);
    const href = String(entity.entityPageHref || entity.href || '').trim();
    if (!PLACE_TYPES.has(type) || !id || !href) continue;
    const key = getPlaceKey(type, id);
    placePages.set(key, entity);
    placePageTypes.set(key, type);
  }

  const byCharacterCanonicalId = new Map();
  const byPlaceKey = new Map();
  const unresolvedParticipants = [];
  const unresolvedLocations = [];
  const unattachedRouteLocations = [];
  const unresolvedFreebieDetailLinks = [];
  const seenUnresolved = new Set();

  for (const record of records || []) {
    const canonicalId = normalizeId(record.canonicalId);
    if (!canonicalId || !['song', 'rhyme'].includes(record.contentType)) continue;
    if (!String(record.href || '').trim()) unresolvedFreebieDetailLinks.push(canonicalId);

    const seenParticipants = new Set();
    for (const participant of record.participants || []) {
      const participantId = normalizeId(participant.canonicalId);
      if (!participantId || seenParticipants.has(participantId)) continue;
      seenParticipants.add(participantId);
      if (!characterPages.has(participantId)) {
        const key = `${canonicalId}:${participantId}`;
        if (!seenUnresolved.has(key)) {
          seenUnresolved.add(key);
          unresolvedParticipants.push({
            freebieCanonicalId: canonicalId,
            participantCanonicalId: participantId,
            participantName: String(participant.name || '')
          });
        }
        continue;
      }
      addAssociation(byCharacterCanonicalId, participantId, record);
    }

    const literalLocations = Array.isArray(record.literalLocations) ? record.literalLocations : [];
    const canonicalLocations = Array.isArray(record.canonicalLocations) ? record.canonicalLocations : [];
    const attachedLiteralLocations = new Set();
    const seenPlaces = new Set();

    for (const location of canonicalLocations) {
      const type = String(location.type || '').trim().toLowerCase();
      const id = normalizeId(location.id);
      const name = String(location.name || '').trim();
      if (!PLACE_TYPES.has(type) || !id || !name) continue;
      const matchedLiteralIndices = [];
      literalLocations.forEach((literalLocation, index) => {
        if (appearsInLiteralLocation(name, literalLocation)) matchedLiteralIndices.push(index);
      });
      const key = getPlaceKey(type, id);
      if (matchedLiteralIndices.length === 0) continue;
      if (!placePages.has(key)) {
        const unresolvedKey = `${canonicalId}:${key}:no-page`;
        if (!seenUnresolved.has(unresolvedKey)) {
          seenUnresolved.add(unresolvedKey);
          unresolvedLocations.push({
            freebieCanonicalId: canonicalId,
            locationCanonicalId: id,
            locationType: type,
            locationName: name,
            reason: 'no-established-page'
          });
        }
        continue;
      }

      matchedLiteralIndices.forEach((index) => attachedLiteralLocations.add(index));
      if (!seenPlaces.has(key)) {
        seenPlaces.add(key);
        addAssociation(byPlaceKey, key, record);
      }
    }

    literalLocations.forEach((literalLocation, index) => {
      if (!attachedLiteralLocations.has(index)) {
        unattachedRouteLocations.push({
          freebieCanonicalId: canonicalId,
          literalLocation: String(literalLocation || '').trim()
        });
      }
    });
  }

  for (const entries of byCharacterCanonicalId.values()) {
    entries.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
  }
  for (const entries of byPlaceKey.values()) {
    entries.sort((left, right) => left.canonicalId.localeCompare(right.canonicalId));
  }
  const unattachedRouteLocationValues = Array.from(new Map(unattachedRouteLocations.map((entry) => {
    const value = String(entry.literalLocation || '').trim();
    return [value.toLowerCase().replace(/\s+/g, ' '), value];
  })).values()).sort((left, right) => left.localeCompare(right));

  return {
    byCharacterCanonicalId,
    byPlaceKey,
    report: {
      characters: summarizeAssociations(byCharacterCanonicalId),
      environmentPages: summarizeAssociations(byPlaceKey, placePageTypes, 'environment'),
      landmarkPages: summarizeAssociations(byPlaceKey, placePageTypes, 'landmark'),
      placePages: summarizeAssociations(byPlaceKey),
      unattachedRouteLocationCount: unattachedRouteLocations.length,
      unattachedRouteLocationValues,
      unattachedRouteLocations,
      unresolvedParticipantCount: unresolvedParticipants.length,
      unresolvedParticipants,
      unresolvedLocationCount: unresolvedLocations.length,
      unresolvedLocations,
      unresolvedFreebieDetailLinks: Array.from(new Set(unresolvedFreebieDetailLinks)).sort()
    }
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFreebieAssociationSections(records, options = {}) {
  const uniqueRecords = Array.from(new Map((records || [])
    .filter((record) => record && record.canonicalId && record.href && ['song', 'rhyme'].includes(record.contentType))
    .map((record) => [normalizeId(record.canonicalId), record])).values());
  if (uniqueRecords.length === 0) return '';

  const prefix = String(options.hrefPrefix || '');
  const sectionId = String(options.idPrefix || 'freebie-associations')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'freebie-associations';
  const renderGroup = (contentType, heading, idSuffix) => {
    const group = uniqueRecords.filter((record) => record.contentType === contentType);
    if (group.length === 0) return '';
    const cards = group.map((record) => {
      const title = String(record.title || record.canonicalId);
      const label = contentType === 'song' ? 'Kids Song' : 'Nursery Rhyme';
      const detailHref = `${prefix}${record.href}`;
      const media = record.illustrationUrl
        ? `<img src="${escapeHtml(record.illustrationUrl)}" alt="Title illustration for ${escapeHtml(title)}" loading="lazy" width="110" />`
        : '<div class="character-story-thumb-placeholder" aria-hidden="true"></div>';
      const description = String(record.description || record.centralHook || '').trim();
      return `<article class="character-story-card freebie-association-card" data-freebie-association data-canonical-id="${escapeHtml(record.canonicalId)}">
        <div class="character-story-media">${media}</div>
        <div class="character-story-copy">
          <p class="character-neighbor-tag">${label}</p>
          <h3><a class="character-story-link" href="${escapeHtml(detailHref)}">${escapeHtml(title)}</a></h3>
          <p class="story-metadata-line">${escapeHtml(record.canonicalId)}</p>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
          <p><a class="character-story-link" href="${escapeHtml(detailHref)}">Open ${label} &rarr;</a></p>
        </div>
      </article>`;
    }).join('');
    return `<h3 id="${sectionId}-${idSuffix}">${heading}</h3><div class="character-story-list freebie-association-list">${cards}</div>`;
  };

  return `<section class="content-card freebie-associations" aria-labelledby="${sectionId}-heading">
    <h2 id="${sectionId}-heading">Songs and Nursery Rhymes</h2>
    ${renderGroup('song', 'Kids Songs', 'songs')}
    ${renderGroup('rhyme', 'Nursery Rhymes', 'nursery-rhymes')}
  </section>`;
}

module.exports = { createFreebiePageAssociationIndex, renderFreebieAssociationSections };