const CONTINUATION_COLLECTIONS = Object.freeze({
  stories: 'relatedStoriesAll',
  places: 'relatedPlacesAll',
  people: 'relatedPeopleAll',
  relationships: 'relatedRelationshipsAll'
});

function surface(state, reason, redirectTo = '') {
  const primary = state === 'primary';
  return Object.freeze({
    generated: state !== 'withdrawn',
    indexable: primary,
    sitemap: primary,
    search: primary,
    navigation: primary,
    robots: primary ? '' : 'noindex, follow',
    state,
    reason,
    redirectTo
  });
}

function getPublicSurfaceEligibility({ route = '', entity, freebieEntity = false, experience, continuationType, legacy = false }) {
  if (continuationType) {
    const collection = CONTINUATION_COLLECTIONS[continuationType];
    if (!collection) throw new Error(`Unknown Character continuation: ${continuationType}`);
    if (!experience || !Array.isArray(experience[collection])) {
      throw new Error(`Missing current-build Character collection: ${collection}`);
    }
    return experience[collection].length
      ? surface('primary', 'Current-build structured continuation contains useful records.')
      : surface('withdrawn', 'Empty current-build Character continuation.');
  }
  if (route === 'storybook-series.html') {
    return surface('redirect', 'Storybooks primary destination is Storybook Shelf.', 'storybook-shelf.html');
  }
  if (entity) {
    if (entity.type === 'book') {
      return freebieEntity
        ? surface('withdrawn', 'Song/Rhyme primary detail replaces competing Book entity surface.')
        : surface('secondary', 'Internal Book entity retained; ordinary Book detail is the visitor destination.');
    }
    if (entity.type === 'character' && entity.slug === 'pop-pop-farmer-hawkins') {
      return surface('secondary', 'Preserved secondary authoring/canon surface pending editorial decision.');
    }
    if (entity.type === 'resource' && entity.id === 'reading-order') {
      return surface('secondary', 'Reading Order is an unfinished internal resource, not a public guide.');
    }
  }
  return legacy
    ? surface('secondary', 'Preserved legacy compatibility surface.')
    : surface('primary', 'Existing public visitor destination.');
}

module.exports = { CONTINUATION_COLLECTIONS, getPublicSurfaceEligibility };
