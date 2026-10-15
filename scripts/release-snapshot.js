const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const APPROVAL_SCHEMA_VERSION = 1;
const APPROVAL_PURPOSE = 'prepare-release-snapshot';
const APPROVED_STORY_MASTER_EXCEPTIONS = [];

function canonicalJson(value) {
  const sortObject = (input) => {
    if (Array.isArray(input)) return input.map(sortObject);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sortObject(input[key])]));
  };
  return `${JSON.stringify(sortObject(value), null, 2)}\n`;
}

function parseJsonRejectDuplicateKeys(text) {
  let index = 0;
  const skipWhitespace = () => {
    while (/[ \t\r\n]/.test(text[index] || '')) index += 1;
  };
  const parseString = () => {
    const start = index;
    if (text[index] !== '"') throw new Error('Invalid JSON string.');
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
    }
    throw new Error('Unterminated JSON string.');
  };
  const parseValue = () => {
    skipWhitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === '{') {
      index += 1;
      skipWhitespace();
      const entries = [];
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return {};
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) throw new Error(`Duplicate JSON member name: ${key}`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') throw new Error('Invalid JSON object.');
        index += 1;
        entries.push([key, parseValue()]);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return Object.fromEntries(entries);
        }
        if (text[index] !== ',') throw new Error('Invalid JSON object.');
        index += 1;
      }
    }
    if (text[index] === '[') {
      index += 1;
      skipWhitespace();
      const values = [];
      if (text[index] === ']') {
        index += 1;
        return values;
      }
      while (true) {
        values.push(parseValue());
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return values;
        }
        if (text[index] !== ',') throw new Error('Invalid JSON array.');
        index += 1;
      }
    }
    const remainder = text.slice(index);
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(remainder);
    if (!literal) throw new Error('Invalid JSON value.');
    index += literal[0].length;
    return JSON.parse(literal[0]);
  };
  const result = parseValue();
  skipWhitespace();
  if (index !== text.length) throw new Error('Unexpected data after JSON value.');
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
    throw new Error(`Unsafe relative path: ${String(value)}`);
  }
  if (value.startsWith('/') || /^[a-z]:/i.test(value)) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  const segments = value.split('/');
  const invalidWindowsSegment = (segment) => /[<>:"|?*]/.test(segment)
    || /[ .]$/.test(segment)
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || invalidWindowsSegment(segment))) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return segments.join('/');
}

function resolveContainedPath(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...normalized.split('/'));
  const relative = path.relative(absoluteRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes its root: ${relativePath}`);
  }
  assertNoSymlinkAncestors(target);
  return target;
}

function pathsOverlap(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  const relative = path.relative(a, b);
  const reverse = path.relative(b, a);
  return !relative || !reverse
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    || (!reverse.startsWith(`..${path.sep}`) && reverse !== '..' && !path.isAbsolute(reverse));
}

function resolvePhysicalPath(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      const physical = fs.realpathSync(current);
      return path.resolve(physical, ...suffix.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function assertOutsideProtectedPaths(candidatePath, protectedPaths) {
  const candidate = path.resolve(candidatePath);
  for (const protectedPath of protectedPaths) {
    if (protectedPath && (pathsOverlap(candidate, protectedPath)
        || pathsOverlap(resolvePhysicalPath(candidate), resolvePhysicalPath(protectedPath)))) {
      throw new Error(`Destination overlaps protected path: ${path.resolve(protectedPath)}`);
    }
  }
  assertNoSymlinkAncestors(candidate);
}

function assertNoSymlinkAncestors(targetPath) {
  const absolutePath = path.resolve(targetPath);
  const root = path.parse(absolutePath).root;
  const segments = absolutePath.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Path crosses a symbolic link: ${current}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

function sourceSetProjection(value) {
  return {
    payloads: value.payloads,
    scannerMetadata: value.scannerMetadata,
    trackedInputs: value.trackedInputs,
    liveBookIds: value.liveBookIds,
    storyMasterExceptions: value.storyMasterExceptions,
    discrepancies: value.discrepancies
  };
}

function calculateSourceSetSha256(value) {
  return sha256(canonicalJson(sourceSetProjection(value)));
}

function manifestWithoutSnapshotId(manifest) {
  const { snapshotId, ...content } = manifest;
  return content;
}

function calculateSnapshotId(manifest) {
  return sha256(canonicalJson(manifestWithoutSnapshotId(manifest)));
}

function calculateManifestSha256(manifest) {
  return sha256(canonicalJson(manifest));
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = allowed.slice().sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has missing or unexpected fields.`);
  }
}

function validateManifest(manifest) {
  assertExactKeys(manifest, [
    'schemaVersion',
    'snapshotId',
    'sourceSetSha256',
    'payloads',
    'scannerMetadata',
    'trackedInputs',
    'liveBookIds',
    'storyMasterExceptions',
    'discrepancies'
  ], 'Manifest');
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported snapshot schema version.');
  if (!isSha256(manifest.snapshotId) || !isSha256(manifest.sourceSetSha256)) {
    throw new Error('Manifest snapshot identity or source-set hash is invalid.');
  }
  if (!Array.isArray(manifest.payloads) || !Array.isArray(manifest.trackedInputs)
      || !Array.isArray(manifest.liveBookIds) || !Array.isArray(manifest.storyMasterExceptions)) {
    throw new Error('Manifest collections must be arrays.');
  }
  if (!Array.isArray(manifest.discrepancies)) throw new Error('Manifest discrepancies must be an array.');
  if (!manifest.scannerMetadata || !Array.isArray(manifest.scannerMetadata.folders)
      || !Array.isArray(manifest.scannerMetadata.files)) {
    throw new Error('Scanner metadata is incomplete.');
  }
  assertExactKeys(manifest.scannerMetadata, ['folders', 'files'], 'Scanner metadata');

  const payloadPaths = new Set();
  const sourcePaths = new Set();
  const identities = new Set();
  const payloadRoles = new Set([
    'book-story-master',
    'freebie-manuscript',
    'freebie-illustration',
    'canon-character',
    'canon-relationship',
    'canon-environment',
    'canon-landmark',
    'kdp-workbook'
  ]);
  const canonicalIdPatterns = {
    'book-story-master': /^HH-[A-Z+]+-\d{4}$/,
    'freebie-manuscript': /^HH-[SR]-\d{4}$/,
    'freebie-illustration': /^HH-[SR]-\d{4}$/,
    'canon-character': /^HH-CHR-\d{4}$/,
    'canon-relationship': /^REL-\d{4}$/,
    'canon-environment': /^ENV-\d{4}$/,
    'canon-landmark': /^LND-\d{4}$/
  };
  const scannerFilesByPath = new Map(
    manifest.scannerMetadata.files.map((file) => [file.path.toLowerCase(), file])
  );
  let workbookPayloadCount = 0;
  for (const [index, payload] of manifest.payloads.entries()) {
    assertExactKeys(payload, ['canonicalId', 'role', 'sourcePath', 'sizeBytes', 'sha256', 'payloadPath'], `Payload ${index}`);
    normalizeRelativePath(payload.sourcePath);
    normalizeRelativePath(payload.payloadPath);
    if (!payloadRoles.has(payload.role)) throw new Error(`Unknown payload role: ${payload.role}`);
    if (payload.payloadPath !== `payload/${payload.role === 'kdp-workbook' ? 'controls/Amazon KDP Info.xlsx' : `Library/${payload.sourcePath}`}`) {
      throw new Error(`Payload destination does not match its source identity: ${payload.sourcePath}`);
    }
    if (!Number.isSafeInteger(payload.sizeBytes) || payload.sizeBytes < 0 || !isSha256(payload.sha256)) {
      throw new Error(`Payload size or hash is invalid: ${payload.sourcePath}`);
    }
    const pathKey = payload.payloadPath.toLowerCase();
    const sourceKey = payload.sourcePath.toLowerCase();
    if (payloadPaths.has(pathKey) || sourcePaths.has(sourceKey)) throw new Error(`Duplicate payload path: ${payload.sourcePath}`);
    payloadPaths.add(pathKey);
    sourcePaths.add(sourceKey);
    if (payload.role !== 'kdp-workbook') {
      if (!canonicalIdPatterns[payload.role].test(payload.canonicalId || '')) {
        throw new Error(`Canonical identity is invalid for role ${payload.role}: ${payload.sourcePath}`);
      }
      const identityKey = `${payload.role}:${payload.canonicalId.toUpperCase()}`;
      if (identities.has(identityKey)) throw new Error(`Duplicate canonical identity mapping: ${identityKey}`);
      identities.add(identityKey);
      const scannerFile = scannerFilesByPath.get(sourceKey);
      if (!scannerFile) throw new Error(`Payload source is missing from scanner metadata: ${payload.sourcePath}`);
      const category = payload.sourcePath.split('/')[0];
      const extension = path.posix.extname(payload.sourcePath).toLowerCase();
      if (scannerFile.sizeBytes !== payload.sizeBytes || scannerFile.name !== path.posix.basename(payload.sourcePath)
          || scannerFile.category !== category || scannerFile.extension !== extension.slice(1)) {
        throw new Error(`Payload metadata disagrees with scanner metadata: ${payload.sourcePath}`);
      }
      const validRolePath = {
        'book-story-master': category === 'Books' && extension === '.docx'
          && /Story Master\.docx$/i.test(path.posix.basename(payload.sourcePath))
          && path.posix.basename(payload.sourcePath).toUpperCase().startsWith(payload.canonicalId),
        'freebie-manuscript': category === 'Freebies' && extension === '.docx'
          && path.posix.basename(payload.sourcePath).toUpperCase().startsWith(payload.canonicalId),
        'freebie-illustration': category === 'Freebies' && ['.png', '.jpg', '.jpeg', '.webp'].includes(extension)
          && path.posix.basename(payload.sourcePath).toUpperCase().startsWith(payload.canonicalId),
        'canon-character': category === 'Characters' && extension === '.docx',
        'canon-relationship': category === 'Relationships' && extension === '.docx',
        'canon-environment': category === 'Environments' && extension === '.docx',
        'canon-landmark': category === 'Landmarks' && extension === '.docx'
      }[payload.role];
      if (!validRolePath) throw new Error(`Payload path is invalid for role ${payload.role}: ${payload.sourcePath}`);
    } else if (payload.canonicalId !== null) {
      throw new Error('KDP workbook payload must not have a canonical book identity.');
    } else {
      workbookPayloadCount += 1;
      if (payload.sourcePath !== 'Amazon KDP Info.xlsx') throw new Error('KDP workbook source path is invalid.');
    }
  }
  if (workbookPayloadCount !== 1) {
    throw new Error('Manifest must contain exactly one approved KDP workbook.');
  }
  const expectedTrackedPaths = ['data/characters.json', 'data/entity-id-registry.json'];
  const actualTrackedPaths = manifest.trackedInputs.map((input) => input.sourcePath).sort();
  if (canonicalJson(actualTrackedPaths) !== canonicalJson(expectedTrackedPaths)) {
    throw new Error('Manifest must contain exactly the approved tracked registry inputs.');
  }
  const trackedPaths = new Set();
  for (const input of manifest.trackedInputs) {
    assertExactKeys(input, ['sourcePath', 'sizeBytes', 'sha256'], 'Tracked input');
    normalizeRelativePath(input.sourcePath);
    if (trackedPaths.has(input.sourcePath.toLowerCase())) throw new Error(`Duplicate tracked input: ${input.sourcePath}`);
    trackedPaths.add(input.sourcePath.toLowerCase());
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0 || !isSha256(input.sha256)) {
      throw new Error(`Tracked input size or hash is invalid: ${input.sourcePath}`);
    }
  }
  const normalizedLiveIds = manifest.liveBookIds.map((id) => {
    if (typeof id !== 'string' || !/^HH-[A-Z+]+-\d{4}$/.test(id)) throw new Error(`Invalid KDP Live ID: ${id}`);
    return id;
  });
  if (new Set(normalizedLiveIds).size !== normalizedLiveIds.length
      || normalizedLiveIds.some((id, index) => index > 0 && normalizedLiveIds[index - 1].localeCompare(id) > 0)) {
    throw new Error('KDP Live IDs must be unique and sorted.');
  }
  const payloadOrder = manifest.payloads.map((payload) => payload.payloadPath);
  if (canonicalJson(payloadOrder) !== canonicalJson(payloadOrder.slice().sort((a, b) => a.localeCompare(b, 'en')))) {
    throw new Error('Payload records must be sorted by payload path.');
  }
  if (canonicalJson(manifest.trackedInputs.map((input) => input.sourcePath))
      !== canonicalJson(manifest.trackedInputs.map((input) => input.sourcePath).slice().sort((a, b) => a.localeCompare(b, 'en')))) {
    throw new Error('Tracked inputs must be sorted by source path.');
  }
  if (canonicalJson(manifest.scannerMetadata.folders)
      !== canonicalJson(manifest.scannerMetadata.folders.slice().sort((a, b) => a.localeCompare(b, 'en')))) {
    throw new Error('Scanner folders must be sorted.');
  }
  if (canonicalJson(manifest.scannerMetadata.files.map((file) => file.path))
      !== canonicalJson(manifest.scannerMetadata.files.map((file) => file.path).slice().sort((a, b) => a.localeCompare(b, 'en')))) {
    throw new Error('Scanner files must be sorted by path.');
  }
  const scannerFolders = new Set();
  for (const folder of manifest.scannerMetadata.folders) {
    normalizeRelativePath(folder);
    if (scannerFolders.has(folder.toLowerCase())) throw new Error(`Duplicate scanner folder: ${folder}`);
    scannerFolders.add(folder.toLowerCase());
  }
  const scannerFiles = new Set();
  for (const file of manifest.scannerMetadata.files) {
    assertExactKeys(file, ['path', 'name', 'category', 'extension', 'sizeBytes', 'lastModifiedUtc'], 'Scanner file');
    normalizeRelativePath(file.path);
    if (scannerFiles.has(file.path.toLowerCase())) throw new Error(`Duplicate scanner file: ${file.path}`);
    scannerFiles.add(file.path.toLowerCase());
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || typeof file.lastModifiedUtc !== 'string') {
      throw new Error(`Scanner metadata is invalid for ${file.path}.`);
    }
    const discrepancyPaths = new Set();
    for (const discrepancy of manifest.discrepancies) {
      assertExactKeys(discrepancy, ['type', 'canonicalId', 'sourcePath', 'sizeBytes', 'sha256'], 'Source discrepancy');
      normalizeRelativePath(discrepancy.sourcePath);
      if (!/^HH-[A-Z+]+-\d{4}$/.test(discrepancy.canonicalId)
          || discrepancy.type !== 'unresolved-book-story-master'
          || !Number.isSafeInteger(discrepancy.sizeBytes) || discrepancy.sizeBytes < 0
          || !isSha256(discrepancy.sha256)) {
        throw new Error(`Invalid source discrepancy: ${discrepancy.sourcePath}`);
      }
      if (canonicalJson(manifest.discrepancies.map((item) => item.sourcePath))
          !== canonicalJson(manifest.discrepancies.map((item) => item.sourcePath).slice().sort((a, b) => a.localeCompare(b, 'en')))) {
        throw new Error('Source discrepancies must be sorted by path.');
      }
      if (discrepancyPaths.has(discrepancy.sourcePath.toLowerCase())) {
        throw new Error(`Duplicate source discrepancy: ${discrepancy.sourcePath}`);
      }
      discrepancyPaths.add(discrepancy.sourcePath.toLowerCase());
      if (!scannerFilesByPath.has(discrepancy.sourcePath.toLowerCase())) {
        throw new Error(`Discrepancy source is missing from scanner metadata: ${discrepancy.sourcePath}`);
      }
      const scannerRecord = scannerFilesByPath.get(discrepancy.sourcePath.toLowerCase());
      if (scannerRecord.sizeBytes !== discrepancy.sizeBytes || scannerRecord.category !== 'Books'
          || scannerRecord.extension !== 'docx' || !/Story Master\.docx$/i.test(scannerRecord.name)) {
        throw new Error(`Story Master discrepancy does not match scanner metadata: ${discrepancy.sourcePath}`);
      }
      if (!APPROVED_STORY_MASTER_EXCEPTIONS.some((exception) => exception.canonicalId === discrepancy.canonicalId)) {
        throw new Error(`Unrecognized unresolved Story Master identity: ${discrepancy.canonicalId}`);
      }
      if (manifest.payloads.some((payload) => payload.role === 'book-story-master'
          && payload.canonicalId === discrepancy.canonicalId)) {
        throw new Error(`A Story Master cannot be both accepted and unresolved: ${discrepancy.canonicalId}`);
      }
    }
    for (const file of manifest.scannerMetadata.files) {
      const category = file.category;
      const isCanonDoc = ['Characters', 'Relationships', 'Environments', 'Landmarks'].includes(category)
        && file.extension === 'docx' && !file.name.startsWith('~$');
      if (isCanonDoc && !sourcePaths.has(file.path.toLowerCase())) {
        throw new Error(`Required canon DOCX is missing from payloads: ${file.path}`);
      }
      const isStoryMaster = category === 'Books' && file.extension === 'docx'
        && /Story Master\.docx$/i.test(file.name);
      if (isStoryMaster && !sourcePaths.has(file.path.toLowerCase())
          && !discrepancyPaths.has(file.path.toLowerCase())) {
        throw new Error(`Story Master is neither included nor reported as a discrepancy: ${file.path}`);
      }
    }
    for (const exception of manifest.storyMasterExceptions) {
      const hasStoryMaster = manifest.payloads.some((payload) => payload.role === 'book-story-master'
        && payload.canonicalId === exception.canonicalId);
      const hasDiscrepancy = manifest.discrepancies.some((item) => item.canonicalId === exception.canonicalId);
      if (hasStoryMaster && hasDiscrepancy) throw new Error(`Conflicting Story Master disposition: ${exception.canonicalId}`);
    }
    const storyMasterIds = new Set(manifest.payloads
      .filter((payload) => payload.role === 'book-story-master')
      .map((payload) => payload.canonicalId));
    for (const canonicalId of manifest.liveBookIds) {
      if (!storyMasterIds.has(canonicalId)
          && !manifest.storyMasterExceptions.some((exception) => exception.canonicalId === canonicalId)) {
        throw new Error(`KDP Live book has neither a Story Master nor an approved exception: ${canonicalId}`);
      }
    }
  }
  if (canonicalJson(manifest.storyMasterExceptions) !== canonicalJson(APPROVED_STORY_MASTER_EXCEPTIONS)) {
    throw new Error('Story Master exceptions do not match the approved exception set.');
  }
  if (calculateSourceSetSha256(manifest) !== manifest.sourceSetSha256) {
    throw new Error('Manifest source-set hash does not match its contents.');
  }
  if (calculateSnapshotId(manifest) !== manifest.snapshotId) {
    throw new Error('Manifest snapshot ID does not match its contents.');
  }
  return manifest;
}

function canonicalApprovalRecord(approval) {
  return canonicalJson(approval);
}

function getApprovalPublicKeyId(publicKey) {
  const keyObject = crypto.createPublicKey(publicKey);
  if (keyObject.asymmetricKeyType !== 'ed25519') throw new Error('Trusted approval key must be Ed25519.');
  return sha256(keyObject.export({ type: 'spki', format: 'der' }));
}

function validateApprovalRecord(approval, sourceSetSha256, workbookSha256) {
  assertExactKeys(approval, [
    'schemaVersion',
    'purpose',
    'sourceSetSha256',
    'workbookSha256',
    'keyId',
    'issuedAt',
    'expiresAt'
  ], 'Approval');
  if (approval.schemaVersion !== APPROVAL_SCHEMA_VERSION) throw new Error('Unsupported approval schema version.');
  if (approval.purpose !== APPROVAL_PURPOSE) throw new Error('Invalid approval purpose.');
  if (!isSha256(approval.sourceSetSha256) || !isSha256(approval.workbookSha256)
      || !isSha256(approval.keyId)) {
    throw new Error('Approval contains an invalid SHA-256 value.');
  }
  const parseTimestamp = (value, label) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
      throw new Error(`Approval ${label} must be a canonical UTC timestamp.`);
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
      throw new Error(`Approval ${label} is invalid.`);
    }
    return timestamp;
  };
  const issuedAt = parseTimestamp(approval.issuedAt, 'issuedAt');
  const expiresAt = parseTimestamp(approval.expiresAt, 'expiresAt');
  const now = Date.now();
  if (issuedAt > now) throw new Error('Approval issuance time is in the future.');
  if (expiresAt <= now || expiresAt <= issuedAt) throw new Error('Approval is expired or has an invalid validity interval.');
  if (approval.sourceSetSha256 !== sourceSetSha256 || approval.workbookSha256 !== workbookSha256) {
    throw new Error('Approval hashes do not match the current source set and workbook.');
  }
}

function verifyApproval(approval, signature, trustedKeys, sourceSetSha256, workbookSha256, pinnedFingerprint) {
  validateApprovalRecord(approval, sourceSetSha256, workbookSha256);
  if (!isSha256(pinnedFingerprint)) throw new Error('An independently pinned trusted-key fingerprint is required.');
  if (approval.keyId !== pinnedFingerprint) throw new Error('Approval key fingerprint does not match the independent pin.');
  if (!Array.isArray(trustedKeys) || trustedKeys.length === 0) {
    throw new Error('A separately configured trusted approval-key set is required.');
  }
  const matches = trustedKeys.filter((entry) => entry && entry.keyId === approval.keyId);
  if (matches.length !== 1) throw new Error('Approval signing key is not uniquely trusted.');
  const trustedKey = matches[0];
  assertExactKeys(trustedKey, ['keyId', 'algorithm', 'publicKeyPem', 'purposes', 'status'], 'Trusted key');
  if (trustedKey.algorithm !== 'Ed25519' || trustedKey.status !== 'active'
      || !Array.isArray(trustedKey.purposes) || !trustedKey.purposes.includes(APPROVAL_PURPOSE)) {
    throw new Error('Trusted key is not authorized for snapshot preparation.');
  }
  if (getApprovalPublicKeyId(trustedKey.publicKeyPem) !== trustedKey.keyId) {
    throw new Error('Trusted approval key identifier does not match its public key.');
  }
  if (trustedKey.keyId !== pinnedFingerprint) throw new Error('Trusted public-key fingerprint does not match the independent pin.');
  if (!Buffer.isBuffer(signature) || signature.length !== 64) {
    throw new Error('Detached Ed25519 signature is missing or malformed.');
  }
  const valid = crypto.verify(
    null,
    Buffer.from(canonicalApprovalRecord(approval), 'utf8'),
    crypto.createPublicKey(trustedKey.publicKeyPem),
    signature
  );
  if (!valid) throw new Error('Detached approval signature is invalid.');
  return true;
}

function walkNoLinks(root) {
  const files = [];
  const folders = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${absolutePath}`);
      if (stats.isDirectory()) {
        folders.push(absolutePath);
        visit(absolutePath);
      } else if (stats.isFile()) {
        files.push({ absolutePath, stats });
      } else {
        throw new Error(`Unsupported filesystem entry: ${absolutePath}`);
      }
    }
  };
  visit(root);
  return { files, folders };
}

module.exports = {
  APPROVAL_PURPOSE,
  APPROVAL_SCHEMA_VERSION,
  APPROVED_STORY_MASTER_EXCEPTIONS,
  SCHEMA_VERSION,
  assertOutsideProtectedPaths,
  assertNoSymlinkAncestors,
  calculateManifestSha256,
  calculateSnapshotId,
  calculateSourceSetSha256,
  canonicalJson,
  canonicalApprovalRecord,
  getApprovalPublicKeyId,
  isSha256,
  normalizeRelativePath,
  parseJsonRejectDuplicateKeys,
  resolveContainedPath,
  resolvePhysicalPath,
  sha256,
  validateManifest,
  validateApprovalRecord,
  verifyApproval,
  walkNoLinks
};
