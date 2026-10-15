const APPROVED_COMPATIBILITY_REDIRECTS = [
  {
    route: 'books/HH-C+-0007-callen-crow-s-lost-feather-cover.html',
    targetRoute: 'books/HH-C+-0007-callen-crow-s-lost-feather.html'
  },
  {
    route: 'books/HH-C+-0007-callen-crow-s-lost-feather-cover-characters.html',
    targetRoute: 'books/HH-C+-0007-callen-crow-s-lost-feather-characters.html'
  }
];

function getCanonicalBookId(book) {
  return String((book && ((book.identity && book.identity.canonicalId) || book.canonicalId || book.code || book.id)) || '').trim();
}

function createKdpLiveBookIdSet(publicationRecords) {
  return new Set((publicationRecords || [])
    .filter(isKdpLivePublicationRecord)
    .map((record) => String(record.id || '').trim().toUpperCase())
    .filter(Boolean));
}

function isKdpLivePublicationRecord(record) {
  return String(record && record.status || '').trim().toLowerCase() === 'live';
}

function isKdpLiveBook(book, liveBookIds) {
  return liveBookIds instanceof Set && liveBookIds.has(getCanonicalBookId(book).toUpperCase());
}

function createCanonicalBookRouteRegistry(indexedBooks, getBookPageHref, liveBookIds = new Set()) {
  const routes = new Map();
  const ambiguousIds = new Set();

  for (const book of indexedBooks || []) {
    const canonicalId = getCanonicalBookId(book).toUpperCase();
    const href = String(getBookPageHref(book) || '');
    if (!canonicalId || !isKdpLiveBook(book, liveBookIds) || !/^books\/[a-z0-9+-]+\.html$/i.test(href)) continue;
    if (ambiguousIds.has(canonicalId)) continue;
    if (routes.has(canonicalId) && routes.get(canonicalId) !== href) {
      routes.delete(canonicalId);
      ambiguousIds.add(canonicalId);
      continue;
    }
    routes.set(canonicalId, href);
  }

  return routes;
}

function getCanonicalBookRoute(book, routeRegistry) {
  const canonicalId = getCanonicalBookId(book).toUpperCase();
  return canonicalId && routeRegistry ? routeRegistry.get(canonicalId) || '' : '';
}

function getPublishedRoutableBooks(books, routeRegistry) {
  return (books || []).filter((book) => Boolean(getCanonicalBookRoute(book, routeRegistry)));
}

function getBookCharactersRoute(bookHref) {
  return String(bookHref || '').replace(/\.html$/i, '-characters.html');
}

module.exports = {
  APPROVED_COMPATIBILITY_REDIRECTS,
  createCanonicalBookRouteRegistry,
  createKdpLiveBookIdSet,
  getBookCharactersRoute,
  getCanonicalBookId,
  getCanonicalBookRoute,
  getPublishedRoutableBooks,
  isKdpLiveBook,
  isKdpLivePublicationRecord
};