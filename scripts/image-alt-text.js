const descriptions = require('../data/image-alt-text.json');

function imageKey(source) {
  let key = String(source || '').split(/[?#]/)[0];
  try { key = decodeURIComponent(key); } catch { /* Preserve a literal path with an invalid percent escape. */ }
  return key.replace(/\\/g, '/').replace(/^(?:(?:\.\.?\/)|\/)+/, '');
}

const reviewed = new Map();
for (const image of descriptions.images) {
  for (const source of [image.image, ...(image.aliases || [])]) {
    const key = imageKey(source);
    if (reviewed.has(key)) throw new Error(`Duplicate reviewed image description: ${key}`);
    reviewed.set(key, image);
  }
}

function getImageAlt(kind, label, source) {
  if (kind === 'decorative') return '';
  const entry = reviewed.get(imageKey(source));
  if (entry) return entry.alt;
  const name = String(label || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('An informative image requires an identifying title or name.');
  const prefix = { cover: 'Cover image for ', title: 'Title illustration for ', portrait: 'Portrait of ', place: 'Illustration of ', relationship: 'Relationship portrait of ', banner: '' }[kind];
  if (prefix === undefined) throw new Error(`Unknown image purpose: ${kind}`);
  return prefix + name;
}

function imageAlt(kind, label, source) {
  return getImageAlt(kind, label, source).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

module.exports = { getImageAlt, imageAlt, imageKey, reviewed };
