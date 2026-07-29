const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeId(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeStatus(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['yes', 'true', '1', 'y'].includes(normalized)) {
    return true;
  }

  if (['no', 'false', '0', 'n'].includes(normalized)) {
    return false;
  }

  return null;
}

function normalizeHeaderKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function getField(row, candidates) {
  const wanted = new Set(candidates.map((candidate) => normalizeHeaderKey(candidate)));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeaderKey(key))) {
      return value;
    }
  }
  return '';
}

function deriveAsinFromAmazonUrl(url) {
  const text = normalizeString(url);
  if (!text) {
    return '';
  }

  const match = /\/dp\/([A-Z0-9]{10})/i.exec(text) || /\/gp\/product\/([A-Z0-9]{10})/i.exec(text);
  return match ? match[1].toUpperCase() : '';
}

function deriveSeriesCodeFromSheet(sheetName) {
  const match = /^Mode\s+(.+)$/i.exec(sheetName || '');
  return match ? match[1].trim().toUpperCase() : null;
}

function toAmazonUrl(url, asin) {
  const normalizedUrl = normalizeString(url);
  if (normalizedUrl) {
    return normalizedUrl;
  }

  const normalizedAsin = normalizeString(asin);
  return normalizedAsin ? `https://www.amazon.com/dp/${normalizedAsin}` : '';
}

function normalizeAmazonRecord(row, sheetName, seriesCode) {
  const id = normalizeId(getField(row, ['ID', 'HH ID', 'Book ID']));
  if (!id) {
    return null;
  }

  const title = normalizeString(getField(row, ['Title', 'Book Title']));
  const series = normalizeString(getField(row, ['Series']));
  const status = normalizeStatus(getField(row, ['Publication status', 'Status']));

  const paperbackAsin = normalizeString(
    getField(row, ['Paperback ASIN', 'Print ASIN', 'ASIN'])
  ).toUpperCase();
  const hardcoverAsin = normalizeString(
    getField(row, ['Hardcover ASIN'])
  ).toUpperCase();
  const kindleAsin = normalizeString(
    getField(row, ['Kindle ASIN', 'eBook ASIN'])
  ).toUpperCase();

  const paperbackUrl = toAmazonUrl(
    getField(row, ['Paperback URL', 'URL', 'Amazon URL']),
    paperbackAsin || deriveAsinFromAmazonUrl(getField(row, ['URL', 'Amazon URL']))
  );
  const hardcoverUrl = toAmazonUrl(getField(row, ['Hardcover URL']), hardcoverAsin);
  const kindleUrl = toAmazonUrl(getField(row, ['Kindle URL', 'eBook URL']), kindleAsin);

  const isbn = normalizeString(getField(row, ['ISBN']));
  const isbn10 = normalizeString(getField(row, ['ISBN-10', 'ISBN10']));
  const isbn13 = normalizeString(getField(row, ['ISBN-13', 'ISBN13']));

  const primaryAsin = paperbackAsin || kindleAsin || hardcoverAsin || deriveAsinFromAmazonUrl(paperbackUrl);
  const primaryUrl = paperbackUrl || kindleUrl || hardcoverUrl;

  const publicationDate = normalizeString(getField(row, ['Publication date', 'Publiation date']));
  const record = {
    id,
    title,
    series,
    seriesCode,
    status,
    isLive: status === 'live',
    publicationDate,
    copyright: normalizeString(getField(row, ['Copyright'])),
    edition: normalizeString(getField(row, ['Edition'])),
    price: normalizeString(getField(row, ['Price'])),
    trimSize: normalizeString(getField(row, ['Trim size'])),
    pageCount: normalizeString(getField(row, ['Page count'])),
    readingLevel: normalizeString(getField(row, ['Reading Level'])),
    sheet: sheetName,
    identifiers: {
      paperbackAsin,
      hardcoverAsin,
      kindleAsin,
      isbn,
      isbn10,
      isbn13
    },
    links: {
      primary: primaryUrl,
      paperback: paperbackUrl,
      hardcover: hardcoverUrl,
      kindle: kindleUrl
    },
    formats: {
      hardcoverEnabled: normalizeBoolean(getField(row, ['Hardcover'])),
      kindleEnabled: normalizeBoolean(getField(row, ['Kindle'])),
      companionPackEnabled: normalizeBoolean(getField(row, ['Companion Pack'])),
      websiteListed: normalizeBoolean(getField(row, ['Website'])),
      metadataLocked: normalizeBoolean(getField(row, ['Metadata Locked']))
    },
    asin: primaryAsin,
    url: primaryUrl
  };

  return record;
}

function parseWorkbook(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const records = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: '',
      raw: false
    });

    const seriesCode = deriveSeriesCodeFromSheet(sheetName);

    for (const row of rows) {
      const record = normalizeAmazonRecord(row, sheetName, seriesCode);
      if (record) {
        records.push(record);
      }
    }
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  return records;
}

function writeAmazonKdpArtifact(siteRoot, outputDir = path.join(siteRoot, 'generated')) {
  const workbookPath = path.join(siteRoot, 'Amazon KDP Info.xlsx');
  if (!fs.existsSync(workbookPath)) {
    return {
      workbookPath,
      outputPath: null,
      summary: {
        recordCount: 0,
        liveCount: 0,
        missingWorkbook: true
      }
    };
  }

  const records = parseWorkbook(workbookPath);
  const liveRecords = records.filter((record) => record.isLive);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: 'Amazon KDP Info.xlsx',
    summary: {
      recordCount: records.length,
      liveCount: liveRecords.length
    },
    records,
    liveRecords
  };

  ensureDir(outputDir);
  const outputPath = path.join(outputDir, 'amazon-index.json');
  const legacyOutputPath = path.join(outputDir, 'amazon-kdp-index.json');
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  fs.writeFileSync(outputPath, serialized, 'utf8');
  fs.writeFileSync(legacyOutputPath, serialized, 'utf8');

  return {
    workbookPath,
    outputPath,
    legacyOutputPath,
    summary: {
      recordCount: records.length,
      liveCount: liveRecords.length,
      missingWorkbook: false
    }
  };
}

module.exports = {
  writeAmazonKdpArtifact
};
