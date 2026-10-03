const fs = require('fs');
const path = require('path');
const { getTitleArtPublicUrl } = require('./freebie-title-art-media');
const { inspectImageAsset } = require('./image-asset');

const META_DESCRIPTION_LIMIT = 160;
const SOCIAL_IMAGE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const localImageVerification = new Map();
const EDITORIAL_DESCRIPTION_PATTERNS = [
  /\bchild-facing question\b/i,
  /\bdominant anchor\b/i,
  /\bcreative angle\b/i,
  /\bcentral hook(?: and song promise)?\b/i,
  /\bwithout naming\b/i,
  /\bwithout the (?:song|rhyme) sounding like a lesson\b/i,
  /\b(?:rather than|instead of) (?:a )?(?:manners |belonging )?lesson\b/i,
  /\b(?:generator-ready|quality control|final qc|production prompt|internal note|working draft|under review)\b/i,
  /\b(?:qc|prompt|prompts|production notes?|unpublished|source document|pipeline|renderer|developer)\b/i,
  /\bactual engine\b/i,
  /\bcanonical story details will appear here as ingestion expands\b/i
];

function isEditorialDescriptionSentence(sentence) {
  return EDITORIAL_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(String(sentence || '')));
}

function clipAtWord(value, limit = META_DESCRIPTION_LIMIT) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const maxContentLength = Math.max(1, limit - 3);
  let clipped = text.slice(0, maxContentLength);
  const lastSpace = clipped.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxContentLength * 0.65)) clipped = clipped.slice(0, lastSpace);
  return `${clipped.trimEnd()}...`;
}

function normalizeMetaDescription(value, fallback = '', limit = META_DESCRIPTION_LIMIT) {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text && text.length <= limit && !isEditorialDescriptionSentence(text)) return text;
  const sentences = (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isEditorialDescriptionSentence(sentence));
  let result = '';

  for (const sentence of sentences) {
    const candidate = result ? `${result} ${sentence}` : sentence;
    if (candidate.length <= limit) {
      result = candidate;
      continue;
    }
    if (!result) result = clipAtWord(sentence, limit);
    break;
  }

  if (!result && fallback) {
    const fallbackText = String(fallback).replace(/\s+/g, ' ').trim();
    const fallbackSentences = (fallbackText.match(/[^.!?]+(?:[.!?]+|$)/g) || [fallbackText])
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence && !isEditorialDescriptionSentence(sentence));
    result = fallbackSentences.length > 0 ? fallbackSentences[0] : '';
  }

  return clipAtWord(result, limit);
}

function getFreebieMetaDescription(record, collection) {
  const title = String(record && (record.title || record.canonicalId) || '');
  const noun = collection && collection.contentType === 'rhyme' ? 'nursery rhyme' : 'song';
  const fallback = `${title} is a Hawkins Hollow ${noun} to share aloud.`;
  const description = normalizeMetaDescription(record && record.description, '');
  if (description.length >= 50 && !isEditorialDescriptionSentence(record && record.description)) return description;

  const lines = ((record && record.text) || [])
    .flatMap((stanza) => stanza.lines || [])
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length === 0) return normalizeMetaDescription(fallback, fallback);

  const prefix = `${noun === 'song' ? 'Song' : 'Nursery rhyme'}: ${title}. `;
  const excerptLimit = Math.max(1, META_DESCRIPTION_LIMIT - prefix.length - 2);
  if (excerptLimit < 30) return normalizeMetaDescription(fallback, fallback);
  let excerpt = '';
  for (const line of lines) {
    const candidate = excerpt ? `${excerpt} ${line}` : line;
    if (candidate.length <= excerptLimit) {
      excerpt = candidate;
      continue;
    }
    if (!excerpt) excerpt = clipAtWord(line, excerptLimit);
    break;
  }

  return normalizeMetaDescription(`${prefix}"${excerpt}"`, fallback);
}

function getEntityMetaDescription(entity) {
  const name = String(entity && (entity.name || entity.title || entity.id) || 'Hawkins Hollow');
  if (entity && entity.type === 'book') {
    const series = String(entity.series || '').trim();
    const source = series
      ? `${name} is a book in ${series}. Explore its connections to people and places in Hawkins Hollow.`
      : `${name} is part of the Hawkins Hollow book collection. Explore its connected people and places.`;
    return normalizeMetaDescription(source, `${name} is a book in Hawkins Hollow.`);
  }
  if (entity && entity.type === 'character') {
    const publicDescription = normalizeMetaDescription(entity.description, '');
    return normalizeMetaDescription(`Meet ${name} in Hawkins Hollow. ${publicDescription}`, `Meet ${name} in Hawkins Hollow.`);
  }
  if (entity && entity.type === 'resource') {
    return normalizeMetaDescription(entity.description, `Explore ${name}, a family resource from Hawkins Hollow.`);
  }
  return normalizeMetaDescription(entity && entity.description, `Explore ${name} and its connections in Hawkins Hollow.`);
}

function normalizeMetadataTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function encodePathSegment(segment) {
  let decoded = String(segment || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = String(segment || '');
  }
  return encodeURIComponent(decoded);
}

function getVerifiedSocialImageUrl(banner, siteDomain, projectRoot) {
  if (!banner || !banner.image) return '';
  const image = String(banner.image).trim();

  if (banner.imageIsExternal) {
    const match = /^https:\/\/library\.hawkinshollowbooks\.com\/Freebies\/Title%20Art\/(HH-[SR]-\d{4})\.webp$/i.exec(image);
    if (!banner.imageVerified || banner.bannerId !== 'freebie-title-art' || !match) return '';
    const expectedUrl = getTitleArtPublicUrl(match[1]);
    return image === expectedUrl ? expectedUrl : '';
  }

  const assetPath = image.replace(/\\/g, '/').replace(/^\/+/, '');
  const absolutePath = path.resolve(projectRoot, assetPath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!assetPath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return '';
  if (/placeholder/i.test(assetPath) || !SOCIAL_IMAGE_EXTENSIONS.has(path.extname(assetPath).toLowerCase())) return '';
  if (!fs.existsSync(absolutePath)) return '';
  if (!localImageVerification.has(absolutePath)) {
    localImageVerification.set(absolutePath, Boolean(inspectImageAsset(fs.readFileSync(absolutePath), assetPath)));
  }
  if (!localImageVerification.get(absolutePath)) return '';

  const encodedPath = assetPath.split('/').map(encodePathSegment).join('/');
  return new URL(encodedPath, `${String(siteDomain || '').replace(/\/+$/, '')}/`).toString();
}

module.exports = {
  EDITORIAL_DESCRIPTION_PATTERNS,
  META_DESCRIPTION_LIMIT,
  getEntityMetaDescription,
  getFreebieMetaDescription,
  getVerifiedSocialImageUrl,
  isEditorialDescriptionSentence,
  normalizeMetadataTitle,
  normalizeMetaDescription
};