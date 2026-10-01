const fs = require('fs');
const path = require('path');
const { inspectImageAsset } = require('./image-asset');
const {
  attachPublishedTitleArt,
  getTitleArtKey,
  getTitleArtPublicUrl,
  sha256
} = require('./freebie-title-art-media');

const root = path.join(__dirname, '..');
const freebieIndexPath = path.join(root, 'generated', 'freebie-index.json');
const outputDirs = ['build', 'build-recovery'];
const CANONICAL_ID_PATTERN = /^HH-[SR]-\d{4}$/;

function safeId(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function slug(record) {
  const title = String(record.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return title ? `${safeId(record.canonicalId)}-${title}` : safeId(record.canonicalId);
}

function fail(message) {
  throw new Error(`Freebie title-art validation failed: ${message}`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getReferencedTitleArtUrls(html) {
  return Array.from(html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi), (match) => match[1])
    .filter((src) => src.includes('/Freebies/Title%20Art/'));
}

function validateOutput(outputDir, records, requirePublished, publication) {
  const outputRoot = path.join(root, outputDir);
  if (!fs.existsSync(outputRoot)) fail(`${outputDir}/ is missing`);
  let publishedCount = 0;
  const collectionHtmlByPath = new Map();
  const expectedUrls = new Set();

  for (const record of records) {
    const id = record.canonicalId;
    const collectionDir = record.contentType === 'rhyme' ? 'nursery-rhymes' : 'songs';
    const collectionPath = record.contentType === 'rhyme' ? 'nursery-rhymes.html' : 'kids-songs.html';
    const detailPath = `${collectionDir}/${slug(record)}.html`;
    const collectionFile = path.join(outputRoot, collectionPath);
    const detailFile = path.join(outputRoot, detailPath);
    if (!fs.existsSync(detailFile)) fail(`${outputDir}/${detailPath} is missing`);
    if (!fs.existsSync(collectionFile)) fail(`${outputDir}/${collectionPath} is missing`);

    if (!collectionHtmlByPath.has(collectionPath)) {
      collectionHtmlByPath.set(collectionPath, fs.readFileSync(collectionFile, 'utf8'));
    }
    const collectionHtml = collectionHtmlByPath.get(collectionPath);
    const detailHtml = fs.readFileSync(detailFile, 'utf8');
    const relativeDetailLink = `href="${detailPath}"`;
    if (!collectionHtml.includes(relativeDetailLink)) fail(`${id} is absent from ${outputDir}/${collectionPath}`);

    if (!record.illustrationAssetKey) {
      if (record.illustrationSourcePath) fail(`${id} has a source illustration without an asset key`);
      if (getReferencedTitleArtUrls(collectionHtml).some((url) => url.includes(`${id}.webp`))
        || getReferencedTitleArtUrls(detailHtml).some((url) => url.includes(`${id}.webp`))) {
        fail(`${id} has an external title-art URL despite having no resolved source artwork`);
      }
      continue;
    }

    if (!record.illustrationSourcePath || !record.illustrationProvenance) fail(`${id} has incomplete source-art provenance`);
    const expectedKey = getTitleArtKey(id);
    if (record.illustrationAssetKey !== expectedKey) fail(`${id} has an incorrect R2 key: ${record.illustrationAssetKey}`);
    const sourceFile = path.join(root, 'Library', ...record.illustrationSourcePath.split('/'));
    if (!fs.existsSync(sourceFile)) fail(`${id} source image is missing: ${record.illustrationSourcePath}`);
    const sourceBytes = fs.readFileSync(sourceFile);
    if (sourceBytes.length === 0 || !inspectImageAsset(sourceBytes, sourceFile)) {
      fail(`${id} source image is empty or invalid: ${record.illustrationSourcePath}`);
    }
    if (sha256(sourceBytes) !== record.illustrationSourceSha256) {
      fail(`${id} source hash changed after canonical discovery`);
    }

    if (!record.illustrationPublished) {
      if (record.illustrationUrl) fail(`${id} has a URL without verified publication state`);
      if (requirePublished) fail(`${id} source illustration has no verified R2 publication`);
      continue;
    }

    const expectedUrl = getTitleArtPublicUrl(id);
    if (record.illustrationUrl !== expectedUrl) fail(`${id} has an unexpected public URL: ${record.illustrationUrl}`);
    const publicationEntry = ((publication && publication.records) || [])
      .find((entry) => String(entry.canonicalId || '').toUpperCase() === id && entry.status === 'verified');
    if (!publicationEntry
      || publicationEntry.key !== expectedKey
      || Number(publicationEntry.sizeBytes) <= 0
      || Number(publicationEntry.width) <= 0
      || Number(publicationEntry.height) <= 0
      || Number(publicationEntry.width) > 1200
      || Number(publicationEntry.height) > 1200) {
      fail(`${id} publication receipt is missing valid verified derivative metadata`);
    }
    if (!collectionHtml.includes(`src="${expectedUrl}"`)) fail(`${id} collection card does not use its verified public URL`);
    if (!detailHtml.includes(`src="${expectedUrl}"`)) fail(`${id} detail ribbon does not use the same verified public URL`);
    const expectedAlt = `alt="Title illustration for ${escapeHtml(record.title)}"`;
    if (!collectionHtml.includes(expectedAlt) || !detailHtml.includes(expectedAlt)) {
      fail(`${id} is missing canonical-title alt text in one of its renderers`);
    }
    expectedUrls.add(expectedUrl);
    publishedCount += 1;
  }

  const localFreebieAssets = path.join(outputRoot, 'assets', 'freebies');
  if (fs.existsSync(localFreebieAssets) && fs.readdirSync(localFreebieAssets).length > 0) {
    fail(`${outputDir}/ contains duplicate local freebie delivery assets`);
  }

  for (const collectionPage of ['kids-songs.html', 'nursery-rhymes.html']) {
    const indexFile = path.join(outputRoot, collectionPage);
    const html = fs.readFileSync(indexFile, 'utf8');
    for (const url of getReferencedTitleArtUrls(html)) {
      if (!expectedUrls.has(url)) fail(`${outputDir}/${collectionPage} references an unverified title-art URL: ${url}`);
    }
  }

  console.log(`${outputDir}: ${publishedCount} external title-art URLs verified; no local delivery copies.`);
}

function main() {
  if (!fs.existsSync(freebieIndexPath)) fail('generated/freebie-index.json is missing');
  const rawRecords = JSON.parse(fs.readFileSync(freebieIndexPath, 'utf8')).records || [];
  const publicationPath = path.join(root, 'generated', 'freebie-title-art-publication.json');
  const publication = fs.existsSync(publicationPath)
    ? JSON.parse(fs.readFileSync(publicationPath, 'utf8'))
    : null;
  const records = attachPublishedTitleArt(rawRecords, publication);
  const requirePublished = String(process.env.REQUIRE_FREEBIE_TITLE_ART_PUBLICATION || '').toLowerCase() === 'true';
  const seenIds = new Set();
  for (const record of records) {
    const id = String(record.canonicalId || '');
    if (!CANONICAL_ID_PATTERN.test(id)) fail(`invalid canonical ID ${id || '(empty)'}`);
    if (seenIds.has(id)) fail(`duplicate canonical ID ${id}`);
    if (!['song', 'rhyme'].includes(record.contentType)) fail(`${id} has invalid content type ${record.contentType}`);
    seenIds.add(id);
  }

  const counts = {};
  for (const type of ['song', 'rhyme']) {
    const typedRecords = records.filter((record) => record.contentType === type);
    counts[type] = {
      resolved: typedRecords.filter((record) => Boolean(record.illustrationAssetKey)).length,
      absent: typedRecords.filter((record) => !record.illustrationAssetKey).length
    };
  }
  for (const outputDir of outputDirs) validateOutput(outputDir, records, requirePublished, publication);
  const published = records.filter((record) => record.illustrationPublished);
  console.log(`Artwork: Songs ${counts.song.resolved} resolved / ${counts.song.absent} absent; Rhymes ${counts.rhyme.resolved} resolved / ${counts.rhyme.absent} absent; ${published.length} externally verified.`);
}

main();