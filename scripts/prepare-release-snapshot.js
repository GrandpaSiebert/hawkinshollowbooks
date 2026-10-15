const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const crypto = require('crypto');
const { parseWorkbook } = require('./amazon-kdp-import');
const { scanLibrary } = require('./library-scanner');
const { SUPPORTED_IMAGE_EXTENSIONS, inspectImageAsset } = require('./image-asset');
const {
  APPROVED_STORY_MASTER_EXCEPTIONS,
  SCHEMA_VERSION,
  assertNoSymlinkAncestors,
  assertOutsideProtectedPaths,
  calculateSnapshotId,
  calculateSourceSetSha256,
  canonicalJson,
  normalizeRelativePath,
  parseJsonRejectDuplicateKeys,
  resolveContainedPath,
  sha256,
  validateManifest,
  verifyApproval,
  walkNoLinks
} = require('./release-snapshot');

const repositoryRoot = path.resolve(__dirname, '..');
const CANON_CATEGORIES = new Map([
  ['Characters', 'canon-character'],
  ['Relationships', 'canon-relationship'],
  ['Environments', 'canon-environment'],
  ['Landmarks', 'canon-landmark']
]);

function parseArgs(argv) {
  const options = {
    repositoryRoot,
    libraryRoot: '',
    charactersPath: '',
    entityRegistryPath: '',
    archiveRoot: '',
    workbookPath: '',
    approvalFile: '',
    signatureFile: '',
    trustedKeysFile: '',
    trustedKeyFingerprint: '',
    destination: '',
    inventoryOutput: '',
    inventoryOnly: false
  };
  const valueOptions = new Map([
    ['--repository-root', 'repositoryRoot'],
    ['--library-root', 'libraryRoot'],
    ['--characters', 'charactersPath'],
    ['--entity-registry', 'entityRegistryPath'],
    ['--archive-root', 'archiveRoot'],
    ['--workbook', 'workbookPath'],
    ['--approval-file', 'approvalFile'],
    ['--signature-file', 'signatureFile'],
    ['--trusted-keys', 'trustedKeysFile'],
    ['--trusted-key-fingerprint', 'trustedKeyFingerprint'],
    ['--destination', 'destination'],
    ['--inventory-output', 'inventoryOutput']
  ]);
  const seenOptions = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (seenOptions.has(option)) throw new Error(`Duplicate command-line option: ${option}`);
    seenOptions.add(option);
    if (option === '--inventory-only') {
      options.inventoryOnly = true;
      continue;
    }
    const field = valueOptions.get(option);
    if (!field || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${option}`);
    options[field] = field === 'trustedKeyFingerprint'
      ? argv[index + 1]
      : path.resolve(argv[index + 1]);
    index += 1;
  }
  options.libraryRoot ||= path.join(options.repositoryRoot, 'Library');
  options.charactersPath ||= path.join(options.repositoryRoot, 'data', 'characters.json');
  options.entityRegistryPath ||= path.join(options.repositoryRoot, 'data', 'entity-id-registry.json');
  options.workbookPath ||= path.join(options.repositoryRoot, 'Amazon KDP Info.xlsx');
  return options;
}

function ensureRegularFile(filePath, label) {
  const stats = fs.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} must be a regular, non-symlink file.`);
  return stats;
}

function pathExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function statFingerprint(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
}

async function hashFile(filePath) {
  assertNoSymlinkAncestors(filePath);
  const before = ensureRegularFile(filePath, `Source ${filePath}`);
  const realPathBefore = fs.realpathSync(filePath);
  const fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  try {
    const opened = fs.fstatSync(fileDescriptor);
    if (!opened.isFile() || statFingerprint(before) !== statFingerprint(opened)) {
      throw new Error(`Source changed before being hashed: ${filePath}`);
    }
    for await (const chunk of fs.createReadStream(null, { fd: fileDescriptor, autoClose: false })) {
      sizeBytes += chunk.length;
      hash.update(chunk);
    }
    const openedAfter = fs.fstatSync(fileDescriptor);
    const after = fs.lstatSync(filePath);
    if (statFingerprint(opened) !== statFingerprint(openedAfter)
        || statFingerprint(openedAfter) !== statFingerprint(after)
        || realPathBefore !== fs.realpathSync(filePath)
        || sizeBytes !== after.size) {
      throw new Error(`Source changed while being hashed: ${filePath}`);
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

function getLibraryScan(libraryRoot) {
  const resolvedRoot = path.resolve(libraryRoot);
  if (path.basename(resolvedRoot).toLowerCase() !== 'library') {
    throw new Error('Library root must be a directory named Library.');
  }
  assertNoSymlinkAncestors(resolvedRoot);
  ensureDirectoryNotLink(resolvedRoot, 'Library root');
  const { files } = walkNoLinks(resolvedRoot);
  const scan = scanLibrary(path.dirname(resolvedRoot));
  if (scan.scan.missingLibrary) throw new Error('Library root disappeared during source inventory.');
  const fileSet = new Set(files.map((file) => path.relative(resolvedRoot, file.absolutePath).split(path.sep).join('/')));
  const scanPaths = scan.scan.files.map((file) => file.path);
  if (scanPaths.some((sourcePath) => !fileSet.has(sourcePath))) {
    throw new Error('Library changed while scanner metadata was being collected.');
  }
  const metadata = {
    folders: scan.scan.folders.slice().sort((a, b) => a.localeCompare(b, 'en')),
    files: scan.scan.files.map((file) => ({
      path: file.path,
      name: file.name,
      category: file.category,
      extension: file.extension,
      sizeBytes: file.sizeBytes,
      lastModifiedUtc: file.lastModifiedUtc
    })).sort((a, b) => a.path.localeCompare(b.path, 'en'))
  };
  return { scan, metadata };
}

function ensureDirectoryNotLink(directory, label) {
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a real directory, not a symlink.`);
}

function indexFilesByPath(scan) {
  const result = new Map();
  for (const record of scan.index.books) {
    for (const sourcePath of record.files) {
      if (!result.has(sourcePath)) result.set(sourcePath, []);
      result.get(sourcePath).push(record);
    }
  }
  return result;
}

function addPayloadCandidate(candidates, seen, record) {
  const normalizedSourcePath = normalizeRelativePath(record.sourcePath);
  const sourceKey = normalizedSourcePath.toLowerCase();
  if (seen.has(sourceKey)) throw new Error(`Ambiguous source mapping for ${record.sourcePath}.`);
  seen.add(sourceKey);
  candidates.push({ ...record, sourcePath: normalizedSourcePath });
}

function mapBookIdentity(sourcePath, fileRecords) {
  const owners = fileRecords.get(sourcePath) || [];
  const ids = [...new Set(owners.map((record) => record.id))];
  if (ids.length !== 1) throw new Error(`Source file has ${ids.length} scanner identities: ${sourcePath}`);
  return ids[0];
}

function selectFreebieManuscript(record) {
  const matcher = new RegExp(`^${record.id}(?![0-9A-Za-z-])`, 'i');
  const matches = record.files.filter((filePath) => path.posix.extname(filePath).toLowerCase() === '.docx'
    && matcher.test(path.posix.basename(filePath)));
  if (matches.length !== 1) {
    throw new Error(`Expected one canonical manuscript for ${record.id}; found ${matches.length}.`);
  }
  return matches[0];
}

function selectFreebieIllustration(libraryRoot, record) {
  const matcher = new RegExp(`^${record.id}(?![A-Za-z0-9])`, 'i');
  const candidates = record.files
    .filter((sourcePath) => {
      const basename = path.posix.basename(sourcePath);
      return matcher.test(basename) && SUPPORTED_IMAGE_EXTENSIONS.includes(path.posix.extname(basename).toLowerCase());
    })
    .sort((left, right) => {
      const byExtension = SUPPORTED_IMAGE_EXTENSIONS.indexOf(path.posix.extname(left).toLowerCase())
        - SUPPORTED_IMAGE_EXTENSIONS.indexOf(path.posix.extname(right).toLowerCase());
      return byExtension || left.localeCompare(right, 'en');
    });
  for (const sourcePath of candidates) {
    const absolutePath = resolveContainedPath(libraryRoot, sourcePath);
    ensureRegularFile(absolutePath, `Freebie illustration ${sourcePath}`);
    const bytes = fs.readFileSync(absolutePath);
    if (inspectImageAsset(bytes, sourcePath)) return { sourcePath, expectedSha256: sha256(bytes) };
  }
  return null;
}

function loadJsonWithHash(filePath, label, sourcePath) {
  ensureRegularFile(filePath, label);
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new Error(`${label} must be a regular file.`);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (statFingerprint(before) !== statFingerprint(after) || bytes.length !== after.size) {
      throw new Error(`${label} changed while being read.`);
    }
    return {
      value: parseJsonRejectDuplicateKeys(bytes.toString('utf8')),
      trackedInput: {
        sourcePath,
        sizeBytes: bytes.length,
        sha256: sha256(bytes)
      }
    };
  } finally {
    fs.closeSync(fd);
  }
}

function loadTrustedKeys(filePath) {
  const loaded = loadJsonWithHash(filePath, 'Trusted approval-key configuration', 'trusted-approval-keys.json').value;
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)
      || Object.keys(loaded).sort().join(',') !== 'keys,schemaVersion'
      || loaded.schemaVersion !== 1 || !Array.isArray(loaded.keys)) {
    throw new Error('Trusted approval-key configuration has an invalid schema.');
  }
  return loaded.keys;
}

function loadDetachedSignature(filePath) {
  ensureRegularFile(filePath, 'Detached approval signature');
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(text)) {
    throw new Error('Detached approval signature must be a base64-encoded Ed25519 signature.');
  }
  const signature = Buffer.from(text, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== text) {
    throw new Error('Detached approval signature is malformed.');
  }
  return signature;
}

function getCanonIdentities(scan, repoRoot, charactersPath, entityRegistryPath) {
  const charactersRelativePath = path.relative(repoRoot, charactersPath).split(path.sep).join('/');
  const entityRegistryRelativePath = path.relative(repoRoot, entityRegistryPath).split(path.sep).join('/');
  const charactersSource = loadJsonWithHash(charactersPath, 'Characters registry', charactersRelativePath);
  const entityRegistrySource = loadJsonWithHash(entityRegistryPath, 'Entity ID registry', entityRegistryRelativePath);
  const characters = charactersSource.value;
  const entityRegistry = entityRegistrySource.value;
  const characterRecords = characters.characters || [];
  const registryEntries = entityRegistry.entries || {};
  const canonByPath = new Map();
  const characterDocs = scan.scan.files.filter((file) => file.category === 'Characters' && file.extension === 'docx');
  const characterIds = new Set();
  const characterNameMappings = characterRecords.map((character) => {
    const canonicalId = String(character.identity && character.identity.canonicalId || '').trim().toUpperCase();
    if (!/^HH-CHR-\d{4}$/.test(canonicalId)) {
      throw new Error(`Character record ${character.slug || character.code || '(unnamed)'} has no valid canonical ID.`);
    }
    if (characterIds.has(canonicalId)) throw new Error(`Duplicate Character canonical ID: ${canonicalId}`);
    characterIds.add(canonicalId);
    return {
      canonicalId,
      names: [character.code, character.slug, ...((character.identity && character.identity.legacyAliases) || [])]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    };
  });
  const characterSourcesById = new Map();
  for (const file of characterDocs) {
    const basename = path.posix.basename(file.path).toLowerCase();
    const matches = characterNameMappings.filter(({ names }) => names.some((name) =>
      basename.startsWith(`${name} `) || basename.startsWith(`${name}-`)));
    const identities = new Set(matches.map((match) => match.canonicalId));
    if (identities.size !== 1) {
      throw new Error(`Character canon source resolves to ${identities.size} distinct canonical identities: ${file.path}`);
    }
    const canonicalId = [...identities][0];
    if (characterSourcesById.has(canonicalId)) {
      throw new Error(`Multiple Character canon documents map to ${canonicalId}.`);
    }
    characterSourcesById.set(canonicalId, file.path);
    canonByPath.set(file.path, canonicalId);
  }

  const categoryType = new Map([
    ['Relationships', 'relationship'],
    ['Environments', 'environment'],
    ['Landmarks', 'landmark']
  ]);
  for (const file of scan.scan.files) {
    const type = categoryType.get(file.category);
    if (!type || file.extension !== 'docx') continue;
    const registryRecord = registryEntries[`${type}:${file.path}`];
    if (!registryRecord || !registryRecord.id) throw new Error(`Missing canonical registry mapping for ${file.path}.`);
    if (canonByPath.has(file.path)) throw new Error(`Duplicate canon identity mapping for ${file.path}.`);
    canonByPath.set(file.path, String(registryRecord.id));
  }
  for (const file of characterDocs) {
    if (!canonByPath.has(file.path)) throw new Error(`Missing Character registry mapping for ${file.path}.`);
  }
  return {
    canonByPath,
    trackedInputs: [charactersSource.trackedInput, entityRegistrySource.trackedInput]
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'en'))
  };
}

async function createInventory(options) {
  const repoRoot = path.resolve(options.repositoryRoot);
  const libraryRoot = path.resolve(options.libraryRoot);
  const workbookPath = path.resolve(options.workbookPath);
  const charactersPath = path.resolve(options.charactersPath);
  const entityRegistryPath = path.resolve(options.entityRegistryPath);
  const expectedCharacterRegistryPath = path.join(repoRoot, 'data', 'characters.json');
  const expectedEntityRegistryPath = path.join(repoRoot, 'data', 'entity-id-registry.json');
  if (charactersPath !== expectedCharacterRegistryPath || entityRegistryPath !== expectedEntityRegistryPath) {
    throw new Error('Snapshot inventory requires the exact tracked registries data/characters.json and data/entity-id-registry.json.');
  }
  const { scan, metadata } = getLibraryScan(libraryRoot);
  const byPath = indexFilesByPath(scan);
  const sourceCandidates = [];
  const seenPaths = new Set();
  const discrepancies = [];
  const sourceHashes = new Map();

  const discoveredStoryMasters = [];
  for (const file of scan.scan.files) {
    if (file.category !== 'Books' || file.extension !== 'docx'
        || !/Story Master\.docx$/i.test(path.posix.basename(file.path))) continue;
    discoveredStoryMasters.push({
      canonicalId: mapBookIdentity(file.path, byPath),
      role: 'book-story-master',
      sourcePath: file.path
    });
  }
  const storiesById = new Map();
  for (const story of discoveredStoryMasters) {
    if (!storiesById.has(story.canonicalId)) storiesById.set(story.canonicalId, []);
    storiesById.get(story.canonicalId).push(story);
  }
  for (const [canonicalId, stories] of storiesById) {
    if (stories.length > 1) throw new Error(`Multiple Story Masters map to ${canonicalId}.`);
    if (APPROVED_STORY_MASTER_EXCEPTIONS.some((exception) => exception.canonicalId === canonicalId)) {
      discrepancies.push({
        type: 'unresolved-book-story-master',
        canonicalId,
        sourcePath: stories[0].sourcePath
      });
      continue;
    }
    addPayloadCandidate(sourceCandidates, seenPaths, stories[0]);
  }

  for (const record of scan.index.books.filter((book) => book.contentType === 'song' || book.contentType === 'rhyme')) {
    const manuscriptPath = selectFreebieManuscript(record);
    addPayloadCandidate(sourceCandidates, seenPaths, {
      canonicalId: record.id,
      role: 'freebie-manuscript',
      sourcePath: manuscriptPath
    });
    const illustrationPath = selectFreebieIllustration(libraryRoot, record);
    if (illustrationPath) {
      addPayloadCandidate(sourceCandidates, seenPaths, {
        canonicalId: record.id,
        role: 'freebie-illustration',
        sourcePath: illustrationPath.sourcePath,
        expectedSha256: illustrationPath.expectedSha256
      });
    }
  }

  const canon = getCanonIdentities(scan, repoRoot, charactersPath, entityRegistryPath);
  for (const file of scan.scan.files) {
    const role = CANON_CATEGORIES.get(file.category);
    if (!role || file.extension !== 'docx') continue;
    if (path.posix.basename(file.path).startsWith('~$')) continue;
    const canonicalId = canon.canonByPath.get(file.path);
    if (!canonicalId) throw new Error(`Missing canonical identity for ${file.path}.`);
    addPayloadCandidate(sourceCandidates, seenPaths, {
      canonicalId,
      role,
      sourcePath: file.path
    });
  }

  const workbookHashBefore = await hashFile(workbookPath);
  const liveRecords = parseWorkbook(workbookPath).filter((record) => record.isLive);
  const workbookHash = await hashFile(workbookPath);
  if (workbookHashBefore.sha256 !== workbookHash.sha256 || workbookHashBefore.sizeBytes !== workbookHash.sizeBytes) {
    throw new Error('KDP workbook changed while publication identities were being read.');
  }
  const liveBookIds = liveRecords.map((record) => record.id).sort((a, b) => a.localeCompare(b, 'en'));
  if (new Set(liveBookIds).size !== liveBookIds.length) throw new Error('KDP workbook contains duplicate Live canonical IDs.');
  const availableBookIds = new Set(scan.index.books
    .filter((book) => book.contentType === 'book')
    .map((book) => book.id));
  for (const id of liveBookIds) {
    if (!availableBookIds.has(id)) throw new Error(`KDP Live book has no Library identity: ${id}`);
    if (!sourceCandidates.some((record) => record.role === 'book-story-master' && record.canonicalId === id)
        && !APPROVED_STORY_MASTER_EXCEPTIONS.some((exception) => exception.canonicalId === id)) {
      throw new Error(`KDP Live book is missing a Story Master without an approved exception: ${id}`);
    }
  }
  for (const exception of APPROVED_STORY_MASTER_EXCEPTIONS) {
    if (!liveBookIds.includes(exception.canonicalId)) {
      throw new Error(`Approved Story Master exception is not KDP Live: ${exception.canonicalId}`);
    }
    if (sourceCandidates.some((record) => record.role === 'book-story-master' && record.canonicalId === exception.canonicalId)) {
      throw new Error(`Approved no-Story-Master exception unexpectedly has a DOCX: ${exception.canonicalId}`);
    }
  }

  const tracked = canon.trackedInputs;
  for (const input of tracked) {
    const absolutePath = resolveContainedPath(repoRoot, input.sourcePath);
    const actual = await hashFile(absolutePath);
    if (actual.sizeBytes !== input.sizeBytes || actual.sha256 !== input.sha256) {
      throw new Error(`Tracked identity input changed during inventory: ${input.sourcePath}`);
    }
  }
  const payloads = [];
  for (const source of sourceCandidates) {
    const { expectedSha256, ...payloadSource } = source;
    const absolutePath = resolveContainedPath(libraryRoot, payloadSource.sourcePath);
    const hash = await hashFile(absolutePath);
    if (expectedSha256 && expectedSha256 !== hash.sha256) {
      throw new Error(`Freebie illustration changed after selection: ${payloadSource.sourcePath}`);
    }
    payloads.push({
      ...payloadSource,
      sizeBytes: hash.sizeBytes,
      sha256: hash.sha256,
      payloadPath: `payload/Library/${source.sourcePath}`
    });
    sourceHashes.set(payloadSource.sourcePath, hash);
  }
  for (let index = 0; index < discrepancies.length; index += 1) {
    const discrepancy = discrepancies[index];
    const absolutePath = resolveContainedPath(libraryRoot, discrepancy.sourcePath);
    const hash = await hashFile(absolutePath);
    discrepancies[index] = { ...discrepancy, ...hash };
    sourceHashes.set(discrepancy.sourcePath, hash);
  }
  payloads.push({
    canonicalId: null,
    role: 'kdp-workbook',
    sourcePath: 'Amazon KDP Info.xlsx',
    ...workbookHash,
    payloadPath: 'payload/controls/Amazon KDP Info.xlsx'
  });
  payloads.sort((a, b) => a.payloadPath.localeCompare(b.payloadPath, 'en'));

  const inventory = {
    schemaVersion: SCHEMA_VERSION,
    payloads,
    scannerMetadata: metadata,
    trackedInputs: tracked,
    liveBookIds,
    storyMasterExceptions: APPROVED_STORY_MASTER_EXCEPTIONS,
    discrepancies: discrepancies.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath, 'en'))
  };
  const secondScan = getLibraryScan(libraryRoot);
  if (canonicalJson(secondScan.metadata) !== canonicalJson(metadata)) {
    throw new Error('Library scanner metadata changed during source inventory.');
  }
  for (const input of tracked) {
    const actual = await hashFile(resolveContainedPath(repoRoot, input.sourcePath));
    if (actual.sizeBytes !== input.sizeBytes || actual.sha256 !== input.sha256) {
      throw new Error(`Tracked identity input changed during source inventory: ${input.sourcePath}`);
    }
  }
  const workbookFinal = await hashFile(workbookPath);
  if (workbookFinal.sizeBytes !== workbookHash.sizeBytes || workbookFinal.sha256 !== workbookHash.sha256) {
    throw new Error('KDP workbook changed during source inventory.');
  }
  for (const [sourcePath, expected] of sourceHashes) {
    const actual = await hashFile(resolveContainedPath(libraryRoot, sourcePath));
    if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
      throw new Error(`Library source changed during inventory: ${sourcePath}`);
    }
  }
  inventory.sourceSetSha256 = calculateSourceSetSha256(inventory);
  inventory.workbookSha256 = workbookHash.sha256;
  return inventory;
}

function manifestFromInventory(inventory) {
  const manifest = {
    schemaVersion: inventory.schemaVersion,
    sourceSetSha256: inventory.sourceSetSha256,
    payloads: inventory.payloads,
    scannerMetadata: inventory.scannerMetadata,
    trackedInputs: inventory.trackedInputs,
    liveBookIds: inventory.liveBookIds,
    storyMasterExceptions: inventory.storyMasterExceptions,
    discrepancies: inventory.discrepancies
  };
  manifest.snapshotId = calculateSnapshotId(manifest);
  return validateManifest(manifest);
}

function assertOptionsOutsideSources(options, outputPath) {
  const protectedPaths = [
    path.resolve(options.repositoryRoot),
    path.resolve(options.libraryRoot),
    path.resolve(options.archiveRoot)
  ];
  if (!options.archiveRoot) throw new Error('--archive-root is required to protect the OneDrive archive.');
  assertOutsideProtectedPaths(outputPath, protectedPaths);
}

async function copyAndVerify(sourcePath, destinationPath, expected) {
  assertNoSymlinkAncestors(sourcePath);
  assertNoSymlinkAncestors(destinationPath);
  const sourceBefore = ensureRegularFile(sourcePath, `Source ${sourcePath}`);
  const sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const sourceFdBefore = fs.fstatSync(sourceFd);
  if (!sourceFdBefore.isFile() || statFingerprint(sourceBefore) !== statFingerprint(sourceFdBefore)) {
    fs.closeSync(sourceFd);
    throw new Error(`Source changed before copying: ${sourcePath}`);
  }
  const hash = require('crypto').createHash('sha256');
  let sizeBytes = 0;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    await pipeline(
      fs.createReadStream(null, { fd: sourceFd, autoClose: false }),
      new Transform({
        transform(chunk, encoding, callback) {
          sizeBytes += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        }
      }),
      fs.createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 })
    );
    const sourceAfter = fs.fstatSync(sourceFd);
    if (statFingerprint(sourceFdBefore) !== statFingerprint(sourceAfter)
        || sizeBytes !== expected.sizeBytes || hash.digest('hex') !== expected.sha256) {
      throw new Error(`Source changed or failed integrity verification: ${sourcePath}`);
    }
  } finally {
    fs.closeSync(sourceFd);
  }
}

async function prepareSnapshot(options) {
  if (!options.destination || !options.approvalFile || !options.signatureFile
      || !options.trustedKeysFile || !options.trustedKeyFingerprint) {
    throw new Error('--destination, --approval-file, --signature-file, --trusted-keys, and --trusted-key-fingerprint are required for preparation.');
  }
  assertOptionsOutsideSources(options, options.destination);
  assertOptionsOutsideSources(options, options.approvalFile);
  assertOptionsOutsideSources(options, options.signatureFile);
  assertOptionsOutsideSources(options, options.trustedKeysFile);
  if (pathExists(options.destination)) throw new Error(`Snapshot destination already exists: ${options.destination}`);

  const inventory = await createInventory(options);
  if (inventory.discrepancies.length) {
    throw new Error(`Source inventory has ${inventory.discrepancies.length} unresolved discrepancy; candidate preparation is blocked.`);
  }
  const workbookHash = inventory.workbookSha256;
  const approval = loadJsonWithHash(options.approvalFile, 'Signed approval record', 'signed-approval.json').value;
  const signature = loadDetachedSignature(options.signatureFile);
  const trustedKeys = loadTrustedKeys(options.trustedKeysFile);
  verifyApproval(
    approval,
    signature,
    trustedKeys,
    inventory.sourceSetSha256,
    workbookHash,
    options.trustedKeyFingerprint
  );
  const manifest = manifestFromInventory(inventory);

  const destinationParent = path.dirname(path.resolve(options.destination));
  fs.mkdirSync(destinationParent, { recursive: true });
  const staging = path.join(destinationParent, `.${path.basename(options.destination)}.partial-${process.pid}-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    for (const payload of manifest.payloads) {
      assertOutsideProtectedPaths(staging, [
        options.repositoryRoot,
        options.libraryRoot,
        options.archiveRoot,
        options.workbookPath
      ]);
      const sourcePath = payload.role === 'kdp-workbook'
        ? options.workbookPath
        : resolveContainedPath(options.libraryRoot, payload.sourcePath);
      const targetPath = resolveContainedPath(staging, payload.payloadPath);
      await copyAndVerify(sourcePath, targetPath, payload);
    }
    const finalInventory = await createInventory(options);
    if (finalInventory.sourceSetSha256 !== inventory.sourceSetSha256) {
      throw new Error('Source set changed during snapshot preparation.');
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), canonicalJson(manifest), { flag: 'wx', mode: 0o600 });
    validateManifest(JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8')));
    await verifyCandidateDirectory(staging, manifest, options.repositoryRoot);
    if (pathExists(options.destination)) throw new Error(`Snapshot destination appeared during preparation: ${options.destination}`);
    fs.renameSync(staging, options.destination);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    snapshotId: manifest.snapshotId,
    manifestSha256: sha256(canonicalJson(manifest)),
    payloadCount: manifest.payloads.length,
    liveBookCount: manifest.liveBookIds.length,
    destination: path.resolve(options.destination)
  };
}

async function verifyCandidateDirectory(candidatePath, suppliedManifest, repositoryPath) {
  const candidate = path.resolve(candidatePath);
  assertNoSymlinkAncestors(candidate);
  ensureDirectoryNotLink(candidate, 'Snapshot candidate');
  const candidateEntries = walkCandidateEntries(candidate);
  const manifestPath = path.join(candidate, 'manifest.json');
  ensureRegularFile(manifestPath, 'Snapshot manifest');
  const serializedManifest = fs.readFileSync(manifestPath, 'utf8');
  const manifest = suppliedManifest || JSON.parse(serializedManifest);
  validateManifest(manifest);
  if (serializedManifest !== canonicalJson(manifest)) throw new Error('Snapshot manifest is not canonically serialized.');

  const expectedFiles = new Set(['manifest.json']);
  const expectedDirectories = new Set();
  for (const payload of manifest.payloads) {
    const filePath = resolveContainedPath(candidate, payload.payloadPath);
    expectedFiles.add(payload.payloadPath);
    const segments = payload.payloadPath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join('/'));
    }
    ensureRegularFile(filePath, `Snapshot payload ${payload.payloadPath}`);
    const stats = fs.statSync(filePath);
    if (stats.size !== payload.sizeBytes) throw new Error(`Snapshot payload size mismatch: ${payload.sourcePath}`);
    const actual = await hashFile(filePath);
    if (actual.sha256 !== payload.sha256) throw new Error(`Snapshot payload hash mismatch: ${payload.sourcePath}`);
  }

  const actualEntries = candidateEntries.files;
  if (actualEntries.some((entry) => !expectedFiles.has(entry))) {
    throw new Error(`Snapshot candidate contains an unexpected file: ${actualEntries.find((entry) => !expectedFiles.has(entry))}`);
  }
  if (actualEntries.length !== expectedFiles.size) throw new Error('Snapshot candidate is missing one or more files.');
  if (candidateEntries.directories.some((entry) => !expectedDirectories.has(entry))
      || candidateEntries.directories.length !== expectedDirectories.size) {
    throw new Error('Snapshot candidate contains missing or unexpected directories.');
  }
  const workbookPayload = manifest.payloads.find((payload) => payload.role === 'kdp-workbook');
  const workbookPath = resolveContainedPath(candidate, workbookPayload.payloadPath);
  const candidateLiveIds = parseWorkbook(workbookPath)
    .filter((record) => record.isLive)
    .map((record) => record.id)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(candidateLiveIds).size !== candidateLiveIds.length
      || canonicalJson(candidateLiveIds) !== canonicalJson(manifest.liveBookIds)) {
    throw new Error('KDP workbook Live identities do not match the manifest.');
  }
  if (repositoryPath) {
    const repositoryRoot = path.resolve(repositoryPath);
    for (const input of manifest.trackedInputs) {
      const trackedPath = resolveContainedPath(repositoryRoot, input.sourcePath);
      const actual = await hashFile(trackedPath);
      if (actual.sizeBytes !== input.sizeBytes || actual.sha256 !== input.sha256) {
        throw new Error(`Tracked release input does not match candidate: ${input.sourcePath}`);
      }
    }
  }
  return manifest;
}

function walkCandidateEntries(candidate) {
  const files = [];
  const directories = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic link in snapshot candidate: ${absolutePath}`);
      if (stats.isDirectory()) {
        directories.push(path.relative(candidate, absolutePath).split(path.sep).join('/'));
        visit(absolutePath);
      } else if (stats.isFile()) files.push(path.relative(candidate, absolutePath).split(path.sep).join('/'));
      else throw new Error(`Unsupported candidate entry: ${absolutePath}`);
    }
  };
  visit(candidate);
  return { files, directories };
}

function writeInventoryFile(inventory, outputPath, options) {
  assertOptionsOutsideSources(options, outputPath);
  if (pathExists(outputPath)) throw new Error(`Inventory output already exists: ${outputPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = {
    ...inventory,
    workbookSha256: inventory.workbookSha256
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.archiveRoot) throw new Error('--archive-root is required.');
  if (options.inventoryOnly) {
    if (!options.inventoryOutput) throw new Error('--inventory-output is required with --inventory-only.');
    assertOptionsOutsideSources(options, options.inventoryOutput);
    const inventory = await createInventory(options);
    writeInventoryFile(inventory, options.inventoryOutput, options);
    console.log(`Inventory written. Source-set SHA-256: ${inventory.sourceSetSha256}; workbook SHA-256: ${inventory.workbookSha256}; payload files: ${inventory.payloads.length}.`);
    return;
  }
  const result = await prepareSnapshot(options);
  console.log(`Verified local candidate ${result.snapshotId}: ${result.payloadCount} payloads, ${result.liveBookCount} KDP Live books.`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Snapshot preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createInventory,
  manifestFromInventory,
  parseArgs,
  prepareSnapshot,
  verifyCandidateDirectory,
  writeInventoryFile,
  copyAndVerify,
  hashFile
};
