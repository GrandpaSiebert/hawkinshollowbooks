const path = require('path');

const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function getImageFormat(extension) {
  const normalized = String(extension || '').toLowerCase();
  if (normalized === '.png') return 'png';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'jpeg';
  if (normalized === '.webp') return 'webp';
  return '';
}

function inspectPng(buffer) {
  if (buffer.length < 45 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let hasImageData = false;
  let hasEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return null;
    if (offset === 8) {
      if (chunkType !== 'IHDR' || length !== 13) return null;
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (chunkType === 'IDAT' && length > 0) hasImageData = true;
    if (chunkType === 'IEND') {
      hasEnd = length === 0 && chunkEnd === buffer.length;
      break;
    }
    offset = chunkEnd;
  }

  return width > 0 && height > 0 && hasImageData && hasEnd ? { format: 'png', width, height } : null;
}

function inspectJpeg(buffer) {
  if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8
    || buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    return null;
  }

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions = null;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return null;
      dimensions = { format: 'jpeg', width, height };
    }
    if (marker === 0xda) {
      const scanDataStart = offset + segmentLength;
      return dimensions && segmentLength >= 6 && scanDataStart < buffer.length - 2
        ? dimensions
        : null;
    }
    offset += segmentLength;
  }
  return null;
}

function inspectWebp(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
    || buffer.readUInt32LE(4) + 8 !== buffer.length) {
    return null;
  }

  let offset = 12;
  let extendedDimensions = null;
  let frameDimensions = null;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkEnd = chunkDataStart + chunkLength;
    if (chunkEnd > buffer.length) return null;

    if (chunkType === 'VP8X' && chunkLength === 10) {
      extendedDimensions = {
        format: 'webp',
        width: 1 + buffer.readUIntLE(chunkDataStart + 4, 3),
        height: 1 + buffer.readUIntLE(chunkDataStart + 7, 3)
      };
    } else if (chunkType === 'VP8 ' && chunkLength >= 10
      && buffer[chunkDataStart + 3] === 0x9d
      && buffer[chunkDataStart + 4] === 0x01
      && buffer[chunkDataStart + 5] === 0x2a) {
      frameDimensions = {
        format: 'webp',
        width: buffer.readUInt16LE(chunkDataStart + 6) & 0x3fff,
        height: buffer.readUInt16LE(chunkDataStart + 8) & 0x3fff
      };
    } else if (chunkType === 'VP8L' && chunkLength >= 5 && buffer[chunkDataStart] === 0x2f) {
      const bits = buffer.readUInt32LE(chunkDataStart + 1);
      frameDimensions = {
        format: 'webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1
      };
    } else if (chunkType === 'ANMF' && chunkLength >= 16) {
      frameDimensions = extendedDimensions;
    }

    offset = chunkEnd + (chunkLength % 2);
  }
  if (offset !== buffer.length) return null;
  const dimensions = extendedDimensions || frameDimensions;
  return dimensions && dimensions.width > 0 && dimensions.height > 0 && frameDimensions ? dimensions : null;
}

function inspectImageAsset(value, extensionOrPath) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.alloc(0);
  const extension = path.extname(String(extensionOrPath || '')) || String(extensionOrPath || '');
  const expectedFormat = getImageFormat(extension);
  if (!expectedFormat || buffer.length === 0) return null;

  let image;
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') image = inspectPng(buffer);
  else if (buffer[0] === 0xff && buffer[1] === 0xd8) image = inspectJpeg(buffer);
  else if (buffer.toString('ascii', 0, 4) === 'RIFF') image = inspectWebp(buffer);
  return image && image.format === expectedFormat ? image : null;
}

module.exports = {
  SUPPORTED_IMAGE_EXTENSIONS,
  inspectImageAsset
};