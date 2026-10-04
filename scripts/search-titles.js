const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const overrides = require('./search-title-overrides');

const PREFERRED_LENGTH = 60;
const MAXIMUM_LENGTH = 70;
const LONG_TITLE_EXCEPTIONS = Object.freeze({});
const PHRASE_ABBREVIATIONS = [
  [/\bReverse[- ]Counting Fingerplay\b/gi, 'Reverse Counting'],
  [/\bCumulative Object Rhyme\b/gi, 'Cumulative Rhyme'],
  [/\bShadow[- ]Question Fingerplay\b/gi, 'Shadow Questions'],
  [/\bPause[- ]Word Nursery Chant\b/gi, 'Pause-Word Chant'],
  [/\bMissing[- ]Rhyme Participation Verse\b/gi, 'Missing-Rhyme Verse'],
  [/\bTurn[- ]Taking Tongue Twister\b/gi, 'Turn-Taking Twister'],
  [/\bLayered Body[- ]Percussion Scene\b/gi, 'Body-Percussion'],
  [/\bBody Percussion Scene\b/gi, 'Body Percussion'],
  [/\bOne[- ]Note Character Study\b/gi, 'One-Note Study'],
  [/\bUneven[- ]Meter Walking Song\b/gi, 'Uneven-Meter Song'],
  [/\bSilence[- ]Centered Call Song\b/gi, 'Silence-Centered Calls'],
  [/\bSolo[- ]To[- ]Group Transformation\b/gi, 'Solo-to-Group'],
  [/\bTempo[- ]Changing Work Song\b/gi, 'Tempo-Changing Song'],
  [/\bSoundscape With A Sung Coda\b/gi, 'Soundscape and Coda']
];

function titleLength(title) {
  return Array.from(title).length;
}

function getFreebieSearchTitle(record, siteName) {
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const id = String(record.canonicalId || '');
  if (!/^HH-[SR]-\d{4}$/.test(id) || !title) {
    throw new Error(`Invalid freebie search-title identity: ${id}`);
  }
  const override = overrides[id];
  if (override) {
    if (override.canonicalTitle !== title || !override.reason) {
      throw new Error(`Search-title override is stale or undocumented: ${id}`);
    }
    return override.title;
  }
  const branded = `${title} | ${siteName}`;
  if (titleLength(branded) <= PREFERRED_LENGTH) return branded;
  if (titleLength(title) <= PREFERRED_LENGTH) return title;

  // Only an exact trailing catalog sequence is redundant, not an arbitrary number.
  let concise = title.replace(new RegExp(` ${Number(id.slice(-4))}$`), '');
  for (const [pattern, replacement] of PHRASE_ABBREVIATIONS) {
    if (titleLength(concise) <= PREFERRED_LENGTH) break;
    concise = concise.replace(pattern, replacement);
  }
  return concise;
}

function familyLabel(route) {
  if (/^books\/.+-characters\.html$/.test(route)) return 'Characters';
  if (route.startsWith('books/')) return 'Book';
  if (/^entities\/(?:book|character)\//.test(route)) return 'Connections';
  if (route.startsWith('entities/environment/')) return 'Environment';
  if (route.startsWith('entities/landmark/')) return 'Landmark';
  if (route.startsWith('characters/')) return 'Character Profile';
  if (route.startsWith('songs/')) return 'Song';
  if (route.startsWith('nursery-rhymes/')) return 'Nursery Rhyme';
  if (route === 'storybook-shelf.html') return 'Shelf';
  if (route === 'storybook-series.html') return 'Series';
  return '';
}

function distinguishTitle(record, siteName) {
  const label = familyLabel(record.route);
  if (!label) throw new Error(`No semantic title distinction for ${record.route}`);
  const suffix = ` | ${siteName}`;
  const base = record.title.endsWith(suffix) ? record.title.slice(0, -suffix.length) : record.title;
  const concise = `${base} | ${label}`;
  const branded = `${concise}${suffix}`;
  return titleLength(branded) <= PREFERRED_LENGTH ? branded : concise;
}

function resolveSearchTitles(records, siteName) {
  const titles = new Map();
  for (const record of records) {
    const group = titles.get(record.title) || [];
    group.push(record);
    titles.set(record.title, group);
  }
  const result = records.map((record) => ({
    ...record,
    title: titles.get(record.title).length > 1 ? distinguishTitle(record, siteName) : record.title
  }));
  const seen = new Map();
  for (const record of result) {
    const title = record.title;
    if (!title.trim() || title !== title.trim() || /(?:\.{3}|\u2026|\uFFFD)/.test(title)) {
      throw new Error(`Invalid document title: ${record.route}: ${title}`);
    }
    for (const match of title.matchAll(/\bHH-[^\s|]+/g)) {
      if (!/^HH-[A-Z]+\+?-\d{4}$/.test(match[0])) {
        throw new Error(`Malformed document-title HH ID: ${record.route}: ${match[0]}`);
      }
    }
    const exception = LONG_TITLE_EXCEPTIONS[record.route];
    if (titleLength(title) > MAXIMUM_LENGTH && !(exception && exception.title === title && exception.reason)) {
      throw new Error(`Document title needs semantic review (${titleLength(title)}): ${record.route}: ${title}`);
    }
    if (seen.has(title)) {
      throw new Error(`Document title collision: ${seen.get(title)} and ${record.route}: ${title}`);
    }
    seen.set(title, record.route);
  }
  return result;
}

function getElements(node, tagName, result = []) {
  if (node.tagName === tagName) result.push(node);
  for (const child of node.childNodes || []) getElements(child, tagName, result);
  return result;
}

function getText(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(getText).join('');
}

function attribute(node, name) {
  return (node.attrs || []).find((entry) => entry.name === name)?.value || '';
}

function readSearchTitlePage(html, route) {
  const document = parse5.parse(html);
  const titles = getElements(document, 'title');
  const canonicals = getElements(document, 'link').filter((link) => attribute(link, 'rel').split(/\s+/).includes('canonical'));
  const robots = getElements(document, 'meta').filter((meta) => attribute(meta, 'name').toLowerCase() === 'robots');
  if (titles.length !== 1 || canonicals.length !== 1 || robots.some((meta) => /\bnoindex\b/i.test(attribute(meta, 'content')))) {
    throw new Error(`Invalid indexable canonical document: ${route}`);
  }
  return {
    route,
    title: getText(titles[0]),
    canonical: attribute(canonicals[0], 'href'),
    h1: getElements(document, 'h1').map(getText)
  };
}

function escapeTitle(title) {
  return title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function finalizeSearchTitles(outputDirs, site) {
  const sitemap = fs.readFileSync(path.join(outputDirs[0], 'sitemap.xml'), 'utf8');
  const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
  if (!urls.length) throw new Error('Cannot validate search titles without sitemap pages.');
  const records = urls.map((canonical) => {
    const url = new URL(canonical);
    const route = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (url.origin !== new URL(site.domain).origin || route.split('/').includes('..')) {
      throw new Error(`Invalid search-title sitemap URL: ${canonical}`);
    }
    const record = readSearchTitlePage(fs.readFileSync(path.join(outputDirs[0], route), 'utf8'), route);
    if (record.canonical !== canonical) throw new Error(`Search-title canonical mismatch: ${route}`);
    return record;
  });
  const resolved = resolveSearchTitles(records, site.siteName);
  for (const outputDir of outputDirs) {
    for (let i = 0; i < resolved.length; i += 1) {
      const record = resolved[i];
      const file = path.join(outputDir, record.route);
      const html = fs.readFileSync(file, 'utf8');
      const current = readSearchTitlePage(html, record.route);
      if (current.title !== records[i].title || current.canonical !== record.canonical) {
        throw new Error(`Search-title output disagreement: ${outputDir}: ${record.route}`);
      }
      if (current.title !== record.title) {
        fs.writeFileSync(file, html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeTitle(record.title)}</title>`), 'utf8');
      }
    }
  }
  const reviews = resolved.filter((record) => titleLength(record.title) > PREFERRED_LENGTH);
  console.log(`Search titles validated: ${resolved.length} unique canonical pages; ${reviews.length} titles need 61-70 character review.`);
  for (const record of reviews) console.log(`[search title review ${titleLength(record.title)}] ${record.route}: ${record.title}`);
}

module.exports = {
  LONG_TITLE_EXCEPTIONS,
  MAXIMUM_LENGTH,
  PREFERRED_LENGTH,
  finalizeSearchTitles,
  getFreebieSearchTitle,
  readSearchTitlePage,
  resolveSearchTitles,
  titleLength
};
