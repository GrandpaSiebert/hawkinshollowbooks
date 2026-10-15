function filterEligibleCharacterBooks(books, eligibleRoutes) {
  const seenIds = new Set();
  return (books || []).filter((book) => {
    const canonicalId = String(book && book.canonicalId || '').trim().toUpperCase();
    const href = String(book && book.href || '').trim();
    if (!canonicalId || !href || !eligibleRoutes.has(href) || seenIds.has(canonicalId)) return false;
    seenIds.add(canonicalId);
    return true;
  });
}

module.exports = { filterEligibleCharacterBooks };
