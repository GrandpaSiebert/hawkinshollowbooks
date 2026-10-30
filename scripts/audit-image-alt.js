const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const { reviewed, imageKey } = require('./image-alt-text');

const attr = (node, name) => (node.attrs || []).find(item => item.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
function elements(node, tag) {
  return [...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap(child => elements(child, tag))];
}
function ancestors(node) {
  const result = [];
  for (let parent = node.parentNode; parent; parent = parent.parentNode) result.push(parent);
  return result;
}
function hasClass(node, name) { return (attr(node, 'class') || '').split(/\s+/).includes(name); }
function sourceKey(page, source) {
  if (/^https?:/i.test(source)) return source;
  return imageKey(path.posix.normalize(path.posix.join(path.posix.dirname(page), source)));
}
function decorativeContext(node) {
  const parents = ancestors(node);
  const hidden = parents.find(parent => attr(parent, 'aria-hidden') === 'true');
  if (hidden) {
    const link = parents.find(parent => parent.tagName === 'a');
    if (hasClass(hidden, 'home-discovery-illustration')) return Boolean(link && attr(link, 'href')
      && attr(link, 'aria-label') && elements(link, 'h3').some(heading => text(heading).trim()));
    if (link && (attr(link, 'tabindex') !== '-1' || !attr(link, 'href'))) return false;
    const card = parents.find(parent => hasClass(parent, 'discovery-card') || hasClass(parent, 'home-discovery-card'));
    return Boolean(card && elements(card, 'h3').some(heading => text(heading).trim()));
  }
  const link = parents.find(parent => parent.tagName === 'a');
  return Boolean(link && (hasClass(link, 'map-place-card') || hasClass(link, 'character-card'))
    && attr(link, 'href') && elements(link, 'h3').some(heading => text(heading).trim()));
}
function auditDocument(html, page = 'index.html') {
  const document = parse5.parse(html);
  const issues = [];
  const records = elements(document, 'img').map((node, index) => {
    const alt = attr(node, 'alt');
    const src = attr(node, 'src') || '';
    const key = sourceKey(page, src);
    const entry = reviewed.get(key);
    const decorative = decorativeContext(node);
    const issue = message => issues.push({ page, index, src, alt, message });
    if (alt === undefined) issue('Missing alt attribute');
    else if (alt === '') { if (!decorative) issue('Empty alt without a named, redundant card context'); }
    else if (!alt.trim() || /^(?:image|photo|picture|illustration|thumbnail|banner|cover|undefined|null|placeholder)(?:\s*\d+)?[.!]?$/i.test(alt.trim())
      || /\.(?:png|jpe?g|webp|gif)$/i.test(alt.trim())) issue('Generic, blank, or filename alternative');
    else if (decorative && ancestors(node).some(parent => parent.tagName === 'a'
      && elements(parent, 'h3').some(heading => text(heading).trim() === alt.trim()))) issue('Redundant image alternative in a fully named card link');
    else if (entry && alt !== entry.alt) issue('Alternative does not match reviewed artwork description');
    const link = ancestors(node).find(parent => parent.tagName === 'a');
    if (link && !ancestors(node).some(parent => attr(parent, 'aria-hidden') === 'true')) {
      const name = attr(link, 'aria-label') || text(link).trim() || elements(link, 'img').map(image => attr(image, 'alt') || '').join(' ').trim();
      if (!name) issue('Linked image has no accessible destination name');
    }
    return { page, index, src, alt: alt === undefined ? null : alt, decorative: alt === '', reviewed: Boolean(entry) };
  });
  return { records, issues };
}
function auditSite(root) {
  let pages = 0;
  const records = [], issues = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filename);
      else if (entry.name.endsWith('.html')) {
        pages++;
        const result = auditDocument(fs.readFileSync(filename, 'utf8'), path.relative(root, filename).replace(/\\/g, '/'));
        records.push(...result.records); issues.push(...result.issues);
      }
    }
  }
  visit(root);
  return { pages, images: records.length, missing: records.filter(record => record.alt === null).length,
    decorative: records.filter(record => record.decorative).length, issues, records };
}
if (require.main === module) {
  const report = auditSite(path.resolve(process.argv[2] || 'build-recovery'));
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pages: report.pages, images: report.images, missing: report.missing, decorative: report.decorative, issues: report.issues }, null, 2));
  if (report.issues.length) process.exitCode = 1;
}
module.exports = { auditDocument, auditSite, elements, attr, text, sourceKey };
