const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const CANONICAL_ID_PATTERN = /^HH-([SR])-\d{4}$/i;

const SECTION_SCHEMA = {
  song: {
    contentType: 'song',
    info: ['Song Info'],
    description: ['Central Hook and Song Promise'],
    text: ['Final Lyrics', 'Final Lyrics \u2014 Frozen'],
    cues: ['Performance and Participation Cues', 'Performance Cues'],
    // Two authoritative Song Info vocabularies exist; both map onto the same visitor-facing fields.
    infoLabels: {
      'series': 'Series',
      'format': 'Format',
      'mode': 'Mode',
      'age lane': 'Age lane',
      'theme': 'Theme',
      'emotional hook': 'Emotional hook',
      'cast': 'Cast',
      'weather': 'Weather',
      'route': 'Route',
      'energy': 'Energy',
      'participation': 'Participation',
      'estimated duration': 'Estimated duration',
      'primary age lane': 'Age lane',
      'purpose': 'Theme',
      'mood and energy': 'Energy',
      'participation style': 'Participation'
      // 'cast lock' and 'cast note' are production-authority fields, not the public Cast field.
    }
  },
  rhyme: {
    contentType: 'rhyme',
    info: ['Rhyme Info'],
    description: ['Creative Angle and Dominant Anchor'],
    text: ['Final Nursery Rhyme'],
    cues: ['Optional Action and Caregiver Cues'],
    infoLabels: {
      'series': 'Series',
      'format': 'Format',
      'mode': 'Mode',
      'age lane': 'Age lane',
      'theme': 'Theme',
      'skill': 'Skill',
      'cast': 'Cast',
      'weather': 'Weather',
      'route': 'Route',
      'performance style': 'Performance style',
      'estimated spoken length': 'Estimated spoken length'
    }
  }
};

// Every heading here closes the preceding section; only allow-listed sections are ever published.
const KNOWN_SECTION_HEADINGS = [
  'Song Info', 'Rhyme Info',
  'Central Hook and Song Promise', 'Creative Angle and Dominant Anchor',
  'Structure Map', 'Final Lyrics', 'Final Lyrics \u2014 Frozen', 'Final Nursery Rhyme',
  'Performance and Participation Cues', 'Performance Cues',
  'Optional Action and Caregiver Cues', 'Ending Cue',
  'First Aloud and Natural-Language Pass', 'Pre-Visual World-State Ledger',
  'Melody and Arrangement Brief', 'Title-Picture Rationale',
  'Mandatory Title-Picture Scene Selection',
  'Generator-Ready Title-Picture Prompt', 'Craft Notes', 'Final QC'
];

const PRODUCTION_LINE_PATTERN = /^(title picture prompt|negative prompt|selected active scene|prompt)\s*:/i;
const STANZA_LABEL_PATTERN = /^(spoken cue|intro|outro|verse\s*\d*|pre-chorus|chorus|final chorus|refrain|bridge|tag|coda)\b[^.!?]*$/i;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Each Word paragraph becomes one block; <w:br/> line breaks inside it are preserved as separate lines.
function getBlocks(docxPath) {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error(`word/document.xml is missing in ${docxPath}`);
  }

  const xml = entry.getData().toString('utf8');
  return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g))
    .map((match) => {
      const withBreaks = match[1]
        .replace(/<w:(?:br|cr)(?:\s[^>]*)?\s*\/>/g, '\n')
        .replace(/<w:tab(?:\s[^>]*)?\s*\/>/g, ' ');
      return decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ''))
        .split('\n')
        .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
        .filter(Boolean);
    })
    .filter((lines) => lines.length > 0);
}

function normalizeHeading(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/:$/, '').toLowerCase();
}

function matchSectionHeading(block) {
  if (block.length !== 1) {
    return null;
  }
  const normalized = normalizeHeading(block[0]);
  return KNOWN_SECTION_HEADINGS.find((heading) => normalizeHeading(heading) === normalized) || null;
}

function collectSections(blocks) {
  const sections = new Map();
  let currentHeading = null;

  for (const block of blocks) {
    const heading = matchSectionHeading(block);
    if (heading) {
      currentHeading = heading;
      if (!sections.has(heading)) {
        sections.set(heading, []);
      }
      continue;
    }
    if (currentHeading) {
      sections.get(currentHeading).push(block);
    }
  }

  return sections;
}

function parseInfoFields(blocks, labelMap) {
  const fields = [];
  const seen = new Set();

  for (const block of blocks) {
    for (const line of block) {
      const match = /^([^:]{2,60}):\s*(.+)$/.exec(line);
      if (!match) {
        continue;
      }
      const sourceLabel = match[1].replace(/\s+/g, ' ').trim().toLowerCase();
      const displayLabel = labelMap[sourceLabel];
      if (!displayLabel) {
        continue;
      }
      const key = displayLabel.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fields.push({ key, label: displayLabel, value: match[2].trim() });
    }
  }

  return fields;
}

function parseDescription(blocks) {
  let centralHook = '';
  const paragraphs = [];

  for (const block of blocks) {
    for (const line of block) {
      if (PRODUCTION_LINE_PATTERN.test(line)) {
        continue;
      }
      const hookMatch = /^hook\s*:\s*(.+)$/i.exec(line);
      if (hookMatch) {
        if (!centralHook) {
          centralHook = hookMatch[1].trim();
        }
        continue;
      }
      paragraphs.push(line);
    }
  }

  return { centralHook, description: paragraphs.join(' ').replace(/\s+/g, ' ').trim() };
}

function parseText(blocks, recordTitle) {
  const stanzas = [];
  const normalizedTitle = normalizeHeading(recordTitle);

  for (const block of blocks) {
    if (block.some((line) => PRODUCTION_LINE_PATTERN.test(line))) {
      continue;
    }
    if (block.length === 1) {
      const single = block[0];
      // The manuscript repeats its own title directly under the text heading.
      if (stanzas.length === 0 && normalizeHeading(single) === normalizedTitle) {
        continue;
      }
      if (STANZA_LABEL_PATTERN.test(single)) {
        stanzas.push({ label: single, lines: [] });
        continue;
      }
    }

    const last = stanzas[stanzas.length - 1];
    if (last && last.lines.length === 0) {
      last.lines = block.slice();
    } else {
      stanzas.push({ label: '', lines: block.slice() });
    }
  }

  return stanzas.filter((stanza) => stanza.label || stanza.lines.length > 0);
}

function parseCues(blocks) {
  const cues = [];
  for (const block of blocks) {
    for (const line of block) {
      if (PRODUCTION_LINE_PATTERN.test(line)) {
        continue;
      }
      cues.push(line.replace(/^[-*\u2022]\s*/, ''));
    }
  }
  return cues;
}

function selectPackageFile(record, extension) {
  const canonicalId = String(record.id || '').toUpperCase();
  const files = Array.isArray(record.files) ? record.files : [];
  return files.find((filePath) => {
    if (path.extname(filePath).toLowerCase() !== extension) {
      return false;
    }
    // Association is strictly by canonical ID at the start of the file name.
    return new RegExp(`^${canonicalId}(?![0-9A-Za-z-])`, 'i').test(path.basename(filePath));
  }) || '';
}

function extractManuscript(libraryRoot, record) {
  const canonicalId = String(record.id || '').toUpperCase();
  const idMatch = CANONICAL_ID_PATTERN.exec(canonicalId);
  if (!idMatch) {
    return null;
  }

  const schema = idMatch[1].toUpperCase() === 'S' ? SECTION_SCHEMA.song : SECTION_SCHEMA.rhyme;
  const manuscriptRelativePath = selectPackageFile(record, '.docx');
  if (!manuscriptRelativePath) {
    return { canonicalId, contentType: schema.contentType, withheld: 'missing-manuscript' };
  }

  const blocks = getBlocks(path.join(libraryRoot, manuscriptRelativePath));
  const sections = collectSections(blocks);
  const title = String(record.title || '').trim();
  const sectionBlocks = (headings) => headings.flatMap((heading) => sections.get(heading) || []);
  const usedHeading = (headings) => headings.find((heading) => sections.has(heading)) || '';

  const infoFields = parseInfoFields(sectionBlocks(schema.info), schema.infoLabels);
  const { centralHook, description } = parseDescription(sectionBlocks(schema.description));
  const text = parseText(sectionBlocks(schema.text), title);
  const cues = parseCues(sectionBlocks(schema.cues));

  if (text.length === 0) {
    return { canonicalId, contentType: schema.contentType, withheld: 'missing-authoritative-text' };
  }

  const illustrationRelativePath = selectPackageFile(record, '.png');

  return {
    canonicalId,
    contentType: schema.contentType,
    title,
    description,
    centralHook,
    infoFields,
    text,
    cues,
    illustrationSourcePath: illustrationRelativePath,
    sourceDocument: manuscriptRelativePath,
    lyricHeading: usedHeading(schema.text),
    cuesHeading: usedHeading(schema.cues),
    authorityClass: schema.contentType === 'song' ? 'Mode S Manuscript' : 'Mode R Manuscript'
  };
}

function writeFreebieManuscriptArtifact(siteRoot, libraryIndex, outputDir = path.join(siteRoot, 'generated')) {
  const libraryRoot = path.join(siteRoot, 'Library');
  const records = [];
  const withheld = [];

  for (const record of (libraryIndex && libraryIndex.books) || []) {
    const contentType = String(record.contentType || 'book');
    if (contentType !== 'song' && contentType !== 'rhyme') {
      continue;
    }

    const extracted = extractManuscript(libraryRoot, record);
    if (!extracted) {
      continue;
    }
    if (extracted.withheld) {
      withheld.push(extracted);
      continue;
    }
    records.push(extracted);
  }

  records.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));

  const summary = {
    songCount: records.filter((record) => record.contentType === 'song').length,
    rhymeCount: records.filter((record) => record.contentType === 'rhyme').length,
    withIllustration: records.filter((record) => Boolean(record.illustrationSourcePath)).length,
    withheldCount: withheld.length
  };

  ensureDir(outputDir);
  const artifactPath = path.join(outputDir, 'freebie-index.json');
  fs.writeFileSync(
    artifactPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      libraryRoot: 'Library',
      summary,
      records,
      withheld
    }, null, 2)}\n`,
    'utf8'
  );

  return { artifactPath, summary, records, withheld };
}

module.exports = {
  writeFreebieManuscriptArtifact
};
