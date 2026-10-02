function getCanonicalBookId(book) {
  return String((book && ((book.identity && book.identity.canonicalId) || book.canonicalId || book.code || book.id)) || '').trim();
}

function createCanonicalBookRouteRegistry(indexedBooks, getBookPageHref) {
  const routes = new Map();
  const ambiguousIds = new Set();

  for (const book of indexedBooks || []) {
    const canonicalId = getCanonicalBookId(book).toUpperCase();
    const href = String(getBookPageHref(book) || '');
    if (!canonicalId || !/^books\/[a-z0-9+-]+\.html$/i.test(href)) continue;
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
  return (books || []).filter((book) => book.published !== false
    && Boolean(getCanonicalBookRoute(book, routeRegistry)));
}

function getBookCharactersRoute(bookHref) {
  return String(bookHref || '').replace(/\.html$/i, '-characters.html');
}

module.exports = {
  createCanonicalBookRouteRegistry,
  getBookCharactersRoute,
  getCanonicalBookId,
  getCanonicalBookRoute,
  getPublishedRoutableBooks
};