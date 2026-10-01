const crypto = require('crypto');
const sharp = require('sharp');
const { inspectImageAsset } = require('./image-asset');

const TITLE_ART_FORMAT_VERSION = 1;
const TITLE_ART_DERIVATIVE_VERSION = 'webp-1200-q82-e4-v1';
const TITLE_ART_R2_PREFIX = 'Freebies/Title Art/';
const DEFAULT_LIBRARY_BASE_URL = 'https://library.hawkinshollowbooks.com';
const CANONICAL_FREEBIE_ID = /^HH-[SR]-\d{4}$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function getTitleArtKey(canonicalId) {
  const id = String(canonicalId || '').toUpperCase();
  if (!CANONICAL_FREEBIE_ID.test(id)) {
    throw new Error(`Invalid canonical freebie ID for title art: ${canonicalId}`);
  }
  return `${TITLE_ART_R2_PREFIX}${id}.webp`;
}

function getTitleArtPublicUrl(canonicalId, baseUrl = DEFAULT_LIBRARY_BASE_URL) {
  const key = getTitleArtKey(canonicalId);
  return `${String(baseUrl || DEFAULT_LIBRARY_BASE_URL).replace(/\/+$/, '')}/${encodeURI(key)}`;
}

async function generateTitleArtDerivative(sourceBytes, sourcePath) {
  const sourceImage = inspectImageAsset(sourceBytes, sourcePath);
  if (!sourceImage) {
    throw new Error(`Title-art source is not a supported nonempty image: ${sourcePath}`);
  }

  const derivativeBytes = await sharp(sourceBytes)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const derivativeImage = inspectImageAsset(derivativeBytes, '.webp');
  if (!derivativeImage) {
    throw new Error(`Generated title-art derivative is not a valid WebP: ${sourcePath}`);
  }

  const sourceAspect = sourceImage.width / sourceImage.height;
  const derivativeAspect = derivativeImage.width / derivativeImage.height;
  if (Math.min(Math.abs(sourceAspect - derivativeAspect), Math.abs((1 / sourceAspect) - derivativeAspect)) > 0.005) {
    throw new Error(`Generated title-art derivative changed the source aspect ratio: ${sourcePath}`);
  }
  if (derivativeImage.width > 1200 || derivativeImage.height > 1200) {
    throw new Error(`Generated title-art derivative exceeds the 1200px bound: ${sourcePath}`);
  }

  return {
    bytes: derivativeBytes,
    sourceSha256: sha256(sourceBytes),
    derivativeSha256: sha256(derivativeBytes),
    sourceImage,
    derivativeImage
  };
}

function attachPublishedTitleArt(records, publication, baseUrl = DEFAULT_LIBRARY_BASE_URL) {
  const entries = new Map(((publication && publication.records) || [])
    .filter((entry) => entry && entry.status === 'verified')
    .map((entry) => [String(entry.canonicalId || '').toUpperCase(), entry]));
  const publicationIsCurrent = publication
    && publication.formatVersion === TITLE_ART_FORMAT_VERSION
    && publication.derivativeVersion === TITLE_ART_DERIVATIVE_VERSION;

  return (records || []).map((record) => {
    const illustrationAssetKey = record.illustrationSourcePath ? getTitleArtKey(record.canonicalId) : '';
    const entry = publicationIsCurrent ? entries.get(String(record.canonicalId || '').toUpperCase()) : null;
    const matchesCurrentSource = entry
      && entry.key === illustrationAssetKey
      && entry.sourcePath === record.illustrationSourcePath
      && entry.sourceSha256 === record.illustrationSourceSha256
      && /^[a-f0-9]{64}$/i.test(String(entry.derivativeSha256 || ''))
      && Number(entry.sizeBytes) > 0
      && entry.url === getTitleArtPublicUrl(record.canonicalId, baseUrl);

    return {
      ...record,
      illustrationAssetKey,
      illustrationUrl: matchesCurrentSource ? entry.url : '',
      illustrationPublished: Boolean(matchesCurrentSource)
    };
  });
}

module.exports = {
  DEFAULT_LIBRARY_BASE_URL,
  TITLE_ART_DERIVATIVE_VERSION,
  TITLE_ART_FORMAT_VERSION,
  TITLE_ART_R2_PREFIX,
  attachPublishedTitleArt,
  generateTitleArtDerivative,
  getTitleArtKey,
  getTitleArtPublicUrl,
  sha256
};