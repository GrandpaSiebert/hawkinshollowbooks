const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROUTING_WORKBOOK = 'Hawkins Hollow Website to YouTube Routing Master.xlsx';
const CANONICAL_ID_PATTERN = /^HH-[SR]-\d{4}$/i;

// Row 0 is the sheet banner and row 1 is the column header, so records begin at row 2.
const HEADER_ROW_INDEX = 1;
const COLUMN = {
  canonicalId: 0,
  title: 1,
  type: 2,
  websiteUrl: 3,
  youtubeUrl: 4,
  playlist: 5,
  status: 6
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cell(row, index) {
  return String((row && row[index]) || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(value) {
  const url = cell([value], 0);
  return /^https?:\/\//i.test(url) ? url : '';
}

function parseRoutingWorkbook(workbookPath) {
  const workbook = XLSX.readFile(workbookPath);
  const records = new Map();
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      blankrows: false
    });

    let sheetRecordCount = 0;
    for (let index = HEADER_ROW_INDEX + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const canonicalId = cell(row, COLUMN.canonicalId).toUpperCase();
      if (!CANONICAL_ID_PATTERN.test(canonicalId) || records.has(canonicalId)) {
        continue;
      }

      records.set(canonicalId, {
        canonicalId,
        routingTitle: cell(row, COLUMN.title),
        type: cell(row, COLUMN.type),
        websiteUrl: normalizeUrl(cell(row, COLUMN.websiteUrl)),
        youtubeUrl: normalizeUrl(cell(row, COLUMN.youtubeUrl)),
        playlist: cell(row, COLUMN.playlist),
        status: cell(row, COLUMN.status),
        sourceWorkbook: ROUTING_WORKBOOK,
        sourceSheet: sheetName
      });
      sheetRecordCount += 1;
    }

    sheets.push({ sheetName, recordCount: sheetRecordCount });
  }

  return { records: Array.from(records.values()).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId)), sheets };
}

function writeFreebieRoutingArtifact(siteRoot, outputDir = path.join(siteRoot, 'generated')) {
  const workbookPath = path.join(siteRoot, 'Library', ROUTING_WORKBOOK);
  const artifactPath = path.join(outputDir, 'freebie-routing-index.json');
  ensureDir(outputDir);

  if (!fs.existsSync(workbookPath)) {
    const empty = {
      generatedAt: new Date().toISOString(),
      sourceWorkbook: ROUTING_WORKBOOK,
      missingWorkbook: true,
      summary: { recordCount: 0, withYouTubeUrl: 0, sheets: [] },
      records: []
    };
    fs.writeFileSync(artifactPath, `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
    return { artifactPath, summary: { ...empty.summary, missingWorkbook: true } };
  }

  const { records, sheets } = parseRoutingWorkbook(workbookPath);
  const summary = {
    recordCount: records.length,
    withYouTubeUrl: records.filter((record) => Boolean(record.youtubeUrl)).length,
    songRecords: records.filter((record) => /^HH-S-/i.test(record.canonicalId)).length,
    rhymeRecords: records.filter((record) => /^HH-R-/i.test(record.canonicalId)).length,
    sheets
  };

  fs.writeFileSync(
    artifactPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      sourceWorkbook: ROUTING_WORKBOOK,
      authorityClass: 'Website to YouTube Routing Master',
      summary,
      records
    }, null, 2)}\n`,
    'utf8'
  );

  return { artifactPath, summary: { ...summary, missingWorkbook: false } };
}

module.exports = {
  writeFreebieRoutingArtifact
};
