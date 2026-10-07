const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_WORKBOOK = path.join(
  ROOT,
  'Library',
  'Hawkins Hollow Website to YouTube Routing Master (version 1).xlsb.xlsx'
);
const DEFAULT_ROUTING_SOURCE = path.join(ROOT, 'data', 'freebie-youtube-routing.json');
const CANONICAL_ID = /^HH-([SR])-(\d{4})$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const EXPECTED_IDS = Array.from({ length: 125 }, (_, index) => index + 1)
  .flatMap((number) => ['S', 'R'].map((mode) => `HH-${mode}-${String(number).padStart(4, '0')}`))
  .sort();

function parseYouTubeVideoId(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error(`Invalid YouTube URL: ${value}`);
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new Error(`Unsupported YouTube URL: ${value}`);
  }

  const host = url.hostname.toLowerCase();
  let videoId = '';
  if (host === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) {
    videoId = url.pathname.split('/')[1];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    const match = /^\/(embed|shorts)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    if (match) {
      videoId = match[2];
    } else if (url.pathname === '/watch') {
      const ids = url.searchParams.getAll('v');
      if (ids.length === 1 && VIDEO_ID.test(ids[0])) videoId = ids[0];
    }
  }

  if (!videoId || !VIDEO_ID.test(videoId)) {
    throw new Error(`Unsupported YouTube URL: ${value}`);
  }
  return videoId;
}

function validateMappings(mappings, { requireComplete = false } = {}) {
  if (!Array.isArray(mappings)) throw new Error('Routing source must contain a mappings array');

  const ids = new Set();
  const videoIds = new Set();
  const normalized = mappings.map((mapping) => {
    const canonicalId = String(mapping && mapping.canonicalId || '').trim().toUpperCase();
    const videoId = String(mapping && mapping.videoId || '').trim();
    const match = CANONICAL_ID.exec(canonicalId);
    if (!match) throw new Error(`Invalid canonical ID: ${canonicalId || '(empty)'}`);
    if (!VIDEO_ID.test(videoId)) throw new Error(`Invalid YouTube video ID for ${canonicalId}`);
    if (ids.has(canonicalId)) throw new Error(`Duplicate canonical ID: ${canonicalId}`);
    if (videoIds.has(videoId)) throw new Error(`Duplicate YouTube video ID: ${videoId}`);
    ids.add(canonicalId);
    videoIds.add(videoId);
    return { canonicalId, videoId };
  }).sort((left, right) => (left.canonicalId < right.canonicalId ? -1 : (left.canonicalId > right.canonicalId ? 1 : 0)));

  if (requireComplete) {
    const missing = EXPECTED_IDS.filter((id) => !ids.has(id));
    const unexpected = Array.from(ids).filter((id) => !EXPECTED_IDS.includes(id));
    if (missing.length || unexpected.length || normalized.length !== EXPECTED_IDS.length) {
      throw new Error(
        `Routing workbook must contain exactly the first 125 Songs and Rhymes; `
        + `missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}`
      );
    }
  }

  return normalized;
}

function parseRoutingWorkbook(workbookPath = DEFAULT_WORKBOOK) {
  const XLSX = require('xlsx');
  const workbook = XLSX.readFile(workbookPath);
  const mappings = [];
  const workbookIds = new Set();

  for (const sheetName of workbook.SheetNames) {
    const mode = /song/i.test(sheetName) ? 'S' : (/rhyme/i.test(sheetName) ? 'R' : '');
    if (!mode) continue;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      blankrows: false
    });

    for (let index = 3; index < rows.length; index += 1) {
      const row = rows[index];
      const canonicalId = String(row[0] || '').replace(/\s+/g, ' ').trim().toUpperCase();
      if (!canonicalId) continue;
      if (!CANONICAL_ID.test(canonicalId)) continue;
      const sequence = Number(canonicalId.slice(-4));
      if (sequence < 1 || sequence > 125) continue;
      if (workbookIds.has(canonicalId)) throw new Error(`Duplicate canonical ID in workbook: ${canonicalId}`);
      workbookIds.add(canonicalId);

      const match = CANONICAL_ID.exec(canonicalId);
      if (match[1] !== mode) throw new Error(`${canonicalId} appears on the wrong worksheet: ${sheetName}`);
      if (!/^Live$/i.test(String(row[6] || '').trim())) {
        throw new Error(`${canonicalId} is not marked Live`);
      }
      mappings.push({
        canonicalId,
        videoId: parseYouTubeVideoId(row[4])
      });
    }
  }

  return validateMappings(mappings, { requireComplete: true });
}

function readFreebieYoutubeRouting(filePath = DEFAULT_ROUTING_SOURCE) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'mappings')) {
    throw new Error('Routing source must contain only a mappings array');
  }
  if (!Array.isArray(parsed.mappings)) throw new Error('Routing source must contain only a mappings array');
  for (const mapping of parsed.mappings) {
    if (!mapping || Object.keys(mapping).length !== 2
      || !Object.hasOwn(mapping, 'canonicalId') || !Object.hasOwn(mapping, 'videoId')) {
      throw new Error('Each routing mapping must contain only canonicalId and videoId');
    }
  }
  return validateMappings(parsed.mappings);
}

function writeFreebieYoutubeRoutingFromWorkbook(
  workbookPath = DEFAULT_WORKBOOK,
  outputPath = DEFAULT_ROUTING_SOURCE
) {
  const mappings = parseRoutingWorkbook(workbookPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ mappings }, null, 2)}\n`, 'utf8');
  return mappings;
}

if (require.main === module) {
  const workbookPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_WORKBOOK;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_ROUTING_SOURCE;
  const mappings = writeFreebieYoutubeRoutingFromWorkbook(workbookPath, outputPath);
  console.log(`Wrote ${mappings.length} validated YouTube mappings to ${path.relative(ROOT, outputPath)}.`);
}

module.exports = {
  parseRoutingWorkbook,
  parseYouTubeVideoId,
  readFreebieYoutubeRouting,
  validateMappings,
  writeFreebieYoutubeRoutingFromWorkbook
};
