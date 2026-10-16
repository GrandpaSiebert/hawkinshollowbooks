const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const kinds = new Set(['feeling', 'activity', 'interest', 'age']);

// Keep actual Word paragraphs intact: formatting runs can split a single word.
function manuscriptParagraphs(bytes) {
  const xml = new AdmZip(bytes).readAsText('word/document.xml');
  return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g), match => {
    const text = Array.from(match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|cr|tab)\b[^>]*\/>/g), token => token[1] === undefined ? ' ' : token[1]).join('');
    return normalize(text.replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  }).filter(Boolean);
}

function loadBookDiscoveryAnnotations({ libraryRoot, data, eligibleBookIds }) {
  if (data.version !== 1 || !Array.isArray(data.records)) throw Error('Invalid book discovery review document');
  const tagsById = new Map();
  const report = { reviewedBooks: 0, appliedBooks: 0, withheld: [], categories: {} };
  const seen = new Set();
  const sources = new Map();
  const readSource = (name, expectedHash) => {
    if (typeof name !== 'string' || !name || name.includes('\\') || path.isAbsolute(name) || name.split('/').some(part => ['..', '.', ''].includes(part))) throw Error('Invalid review source path');
    const absolute = path.resolve(libraryRoot, name);
    const relative = path.relative(path.resolve(libraryRoot), absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Review source escapes Library');
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw Error('Invalid review source fingerprint');
    if (!sources.has(name)) {
      if (!fs.existsSync(absolute)) sources.set(name, { issue: 'source-missing' });
      else {
        const realRelative = path.relative(fs.realpathSync(libraryRoot), fs.realpathSync(absolute));
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw Error('Review source symlink escapes Library');
        const bytes = fs.readFileSync(absolute);
        sources.set(name, { bytes, hash: crypto.createHash('sha256').update(bytes).digest('hex') });
      }
    }
    const source = sources.get(name);
    return source.issue ? source : source.hash !== expectedHash ? { issue: 'source-changed' } : source;
  };
  for (const record of data.records) {
    if (!/^HH-(?:[A-G]|C\+|HR)-\d{4}$/.test(record.id) || seen.has(record.id)) throw Error('Invalid or duplicate reviewed book ID: ' + record.id);
    seen.add(record.id);
    if (!eligibleBookIds.has(record.id)) continue;
    report.reviewedBooks++;
    const source = readSource(record.sourceDocument, record.sourceSha256);
    if (source.issue) { report.withheld.push({ id: record.id, reason: source.issue }); continue; }
    if (!record.review?.method || !record.review.categories) throw Error('Missing review method/categories: ' + record.id);
    const tags = [];
    for (const [kind, category] of Object.entries(record.review.categories)) {
      if (!kinds.has(kind) || !Array.isArray(category.labels)
        || category.status !== (category.labels.length ? 'reviewed' : 'reviewed-without-label')
        || (!category.labels.length && !category.reason)) throw Error('Invalid reviewed category: ' + record.id);
      const counts = report.categories[kind] ||= { labeledBooks: 0, withoutLabel: 0 };
      if (!category.labels.length) { counts.withoutLabel++; continue; }
      let accepted = false;
      for (const label of category.labels) {
        if (!label.label || label.label.length > 64 || !label.rationale
          || !['explicit', 'strongly-implied'].includes(label.confidence)
          || !['central', 'resolution'].includes(label.significance)
          || !Array.isArray(label.evidence) || !label.evidence.length
          || (kind === 'age' && (label.confidence !== 'explicit' || !/^Ages \d+–\d+$/.test(label.label)))) throw Error('Invalid review evidence: ' + record.id);
        let issue = '';
        for (const evidence of label.evidence) {
          const name = evidence.sourceDocument || record.sourceDocument;
          const supportingSource = evidence.sourceDocument ? readSource(name, evidence.sourceSha256) : source;
          if (supportingSource.issue) { issue = supportingSource.issue; break; }
          if (!normalize(evidence.quote)) throw Error('Empty evidence quotation: ' + record.id);
          if (/\.docx$/i.test(name)) {
            supportingSource.paragraphs ||= manuscriptParagraphs(supportingSource.bytes);
            if (!Number.isInteger(evidence.paragraph) || !supportingSource.paragraphs[evidence.paragraph]?.includes(normalize(evidence.quote))) throw Error('Evidence quotation does not match manuscript: ' + record.id + ' / ' + label.label);
          } else if (/\.pdf$/i.test(name)) {
            // Image-only PDF quotations were visually reviewed, against this exact file.
            if (!Number.isInteger(evidence.pdfPage) || evidence.pdfPage < 1) throw Error('PDF evidence requires a page: ' + record.id);
          } else throw Error('Unsupported review source');
        }
        if (issue) report.withheld.push({ id: record.id, kind, label: label.label, reason: issue });
        else { tags.push({ kind, label: label.label }); accepted = true; }
      }
      if (accepted) counts.labeledBooks++;
    }
    tagsById.set(record.id, tags);
    if (tags.length) report.appliedBooks++;
  }
  return { tagsById, report };
}

module.exports = { loadBookDiscoveryAnnotations, manuscriptParagraphs };
