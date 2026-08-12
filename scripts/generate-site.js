const fs = require('fs');
const path = require('path');
const { writeLibraryArtifacts } = require('./library-scanner');
const { writeAmazonKdpArtifact } = require('./amazon-kdp-import');
const { writeCharacterCanonArtifact } = require('./character-canon-import');
const { writeWorldCanonArtifacts } = require('./world-canon-import');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const previewBuildDir = path.join(root, 'build');
const outputDirs = [buildDir, previewBuildDir];
const authorityRegistryPath = path.join(root, 'data', 'canonical-authority-registry.json');
const sourceRegistryPath = path.join(root, 'data', 'canonical-source-registry.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readJsonIfExists(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getDefaultCanonicalAuthorityRegistry() {
  return {
    version: 1,
    entities: {
      books: {
        canonicalAuthority: 'Book Model',
        canonicalSource: 'data/books.json',
        canonicalPath: 'books',
        compatibilitySource: null,
        compatibilityPath: null
      },
      characters: {
        canonicalAuthority: 'Character Canon',
        canonicalSource: 'data/characters.json',
        canonicalPath: 'characters',
        compatibilitySource: null,
        compatibilityPath: null
      },
      environments: {
        canonicalAuthority: 'World Canon',
        canonicalSource: 'generated/world-canon-index.json',
        canonicalPath: 'byType.environments',
        compatibilitySource: 'data/environments.json',
        compatibilityPath: 'environments'
      },
      relationships: {
        canonicalAuthority: 'World Canon',
        canonicalSource: 'generated/world-canon-index.json',
        canonicalPath: 'byType.relationships',
        compatibilitySource: 'data/relationships.json',
        compatibilityPath: 'relationships'
      }
    }
  };
}

function loadCanonicalAuthorityRegistry() {
  const registryPath = fs.existsSync(authorityRegistryPath)
    ? authorityRegistryPath
    : sourceRegistryPath;

  if (!fs.existsSync(registryPath)) {
    return getDefaultCanonicalAuthorityRegistry();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.entities) {
      return getDefaultCanonicalAuthorityRegistry();
    }
    return parsed;
  } catch {
    return getDefaultCanonicalAuthorityRegistry();
  }
}

function projectLegacySourceRegistry(authorityRegistry) {
  const entities = authorityRegistry && authorityRegistry.entities ? authorityRegistry.entities : {};
  const projectedEntities = {};

  for (const [entityKey, config] of Object.entries(entities)) {
    projectedEntities[entityKey] = {
      canonicalAuthority: config && config.canonicalAuthority ? config.canonicalAuthority : 'Unspecified Authority',
      canonicalSource: config && config.canonicalSource ? config.canonicalSource : '',
      canonicalPath: config && config.canonicalPath ? config.canonicalPath : '',
      compatibilitySource: Object.prototype.hasOwnProperty.call(config || {}, 'compatibilitySource')
        ? config.compatibilitySource
        : null,
      compatibilityPath: Object.prototype.hasOwnProperty.call(config || {}, 'compatibilityPath')
        ? config.compatibilityPath
        : null
    };
  }

  return {
    version: authorityRegistry && authorityRegistry.version ? authorityRegistry.version : 1,
    deprecated: true,
    projectionOf: 'data/canonical-authority-registry.json',
    entities: projectedEntities
  };
}

function writeLegacySourceRegistryProjection(authorityRegistry) {
  const projected = projectLegacySourceRegistry(authorityRegistry);
  const nextText = `${JSON.stringify(projected, null, 2)}\n`;
  const currentText = fs.existsSync(sourceRegistryPath)
    ? fs.readFileSync(sourceRegistryPath, 'utf8')
    : null;

  if (currentText === nextText) {
    return false;
  }

  fs.writeFileSync(sourceRegistryPath, nextText, 'utf8');
  return true;
}

function getRegistryEntityConfig(authorityRegistry, entityKey) {
  const defaults = getDefaultCanonicalAuthorityRegistry().entities[entityKey] || {};
  const configured = authorityRegistry && authorityRegistry.entities && authorityRegistry.entities[entityKey]
    ? authorityRegistry.entities[entityKey]
    : {};

  return {
    canonicalAuthority: configured.canonicalAuthority || defaults.canonicalAuthority || 'Unspecified Authority',
    canonicalSource: configured.canonicalSource || defaults.canonicalSource || '',
    canonicalPath: configured.canonicalPath || defaults.canonicalPath || '',
    compatibilitySource: Object.prototype.hasOwnProperty.call(configured, 'compatibilitySource')
      ? configured.compatibilitySource
      : defaults.compatibilitySource,
    compatibilityPath: Object.prototype.hasOwnProperty.call(configured, 'compatibilityPath')
      ? configured.compatibilityPath
      : defaults.compatibilityPath
  };
}

function resolvePathValue(sourceObject, sourcePath) {
  if (!sourcePath) {
    return sourceObject;
  }

  return String(sourcePath)
    .split('.')
    .filter((token) => token.length > 0)
    .reduce((current, token) => {
      if (!current || typeof current !== 'object') {
        return null;
      }
      return current[token];
    }, sourceObject);
}

function selectEntitySourceRecords(entityKey, authorityRegistry, sourceObjectsByFile) {
  const config = getRegistryEntityConfig(authorityRegistry, entityKey);

  const canonicalObject = sourceObjectsByFile[config.canonicalSource] || null;
  const canonicalRecords = resolvePathValue(canonicalObject, config.canonicalPath);
  if (Array.isArray(canonicalRecords) && canonicalRecords.length > 0) {
    return {
      records: canonicalRecords,
      authority: config.canonicalAuthority,
      activeSource: `${config.canonicalSource} (${config.canonicalPath})`
    };
  }

  if (config.compatibilitySource && config.compatibilityPath) {
    const compatibilityObject = sourceObjectsByFile[config.compatibilitySource] || null;
    const compatibilityRecords = resolvePathValue(compatibilityObject, config.compatibilityPath);
    if (Array.isArray(compatibilityRecords) && compatibilityRecords.length > 0) {
      return {
        records: compatibilityRecords,
        authority: config.canonicalAuthority,
        activeSource: `${config.compatibilitySource} (${config.compatibilityPath})`
      };
    }
  }

  return {
    records: Array.isArray(canonicalRecords) ? canonicalRecords : [],
    authority: config.canonicalAuthority,
    activeSource: `${config.canonicalSource} (${config.canonicalPath})`
  };
}

function toOutputAssetPath(assetPath, pathPrefix = '') {
  return `${pathPrefix}${assetPath.replace(/^\//, '')}`;
}

function getBannerForPage(page, banners) {
  if (!page || !banners) {
    return null;
  }

  const candidates = [page.bannerSlug, page.slug === 'index' ? 'home' : null, page.slug];
  for (const key of candidates) {
    if (key && banners[key]) {
      return banners[key];
    }
  }

  return null;
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizePlaceNameForArtwork(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\s*\d+[.)\-\s]*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let placeArtworkLookupCache = null;

function getPlaceArtworkLookup() {
  if (placeArtworkLookupCache) {
    return placeArtworkLookupCache;
  }

  const fromDirectory = (folderName, suffixPattern) => {
    const dirPath = path.join(root, 'assets', folderName);
    const entries = fs.existsSync(dirPath) ? fs.readdirSync(dirPath) : [];
    const map = new Map();
    for (const fileName of entries) {
      const ext = path.extname(fileName).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        continue;
      }
      const withoutExt = path.basename(fileName, ext);
      const baseName = withoutExt
        .replace(suffixPattern, '')
        .replace(/\s+for$/i, '')
        .trim();
      const key = normalizePlaceNameForArtwork(baseName);
      if (!key || map.has(key)) {
        continue;
      }
      map.set(key, `/assets/${folderName}/${fileName}`);
    }
    return map;
  };

  placeArtworkLookupCache = {
    environments: fromDirectory('environments', /-hep-v\d+.*$/i),
    landmarks: fromDirectory('landmarks', /-hlp-v\d+.*$/i)
  };

  return placeArtworkLookupCache;
}

function getPlaceArtworkPathByName(placeName, placeKind = '') {
  const key = normalizePlaceNameForArtwork(placeName);
  if (!key) {
    return '';
  }

  const lookup = getPlaceArtworkLookup();
  const kind = String(placeKind || '').toLowerCase();

  if (kind === 'landmark') {
    return lookup.landmarks.get(key) || lookup.environments.get(key) || '';
  }

  const direct = lookup.environments.get(key) || lookup.landmarks.get(key) || '';
  if (direct) {
    return direct;
  }

  const environmentArtworkAliases = {
    'farmhouse exterior': 'farmhouse porch'
  };
  const aliasKey = environmentArtworkAliases[key] || '';
  if (!aliasKey) {
    return '';
  }

  return lookup.environments.get(aliasKey) || lookup.landmarks.get(aliasKey) || '';
}

function toBookPageSlug(book) {
  const safeId = getCanonicalBookId(book) || 'unknown'
    .toLowerCase()
    .replace(/\+/g, '-plus-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeTitle = (book.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return safeTitle ? `${safeId}-${safeTitle}` : safeId;
}

function getBookPageHref(book) {
  return `books/${toBookPageSlug(book)}.html`;
}

function getBookCoverBanner(book) {
  if (!book || !book.coverImage) {
    return null;
  }

  const title = getBookPublicTitle(book) || getCanonicalBookId(book);
  return {
    image: toOutputAssetPath(book.coverImage),
    alt: `Cover image for ${title}`,
    bannerId: 'book-cover'
  };
}

function getBookCharactersPageHref(book) {
  return `books/${toBookPageSlug(book)}-characters.html`;
}

function getCanonicalBookId(book) {
  return String((book && ((book.identity && book.identity.canonicalId) || book.canonicalId || book.code || book.id)) || '').trim();
}

function getBookLegacyAliases(book) {
  const aliases = book && book.identity && Array.isArray(book.identity.legacyAliases)
    ? book.identity.legacyAliases
    : [];
  return aliases
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0);
}

function getBookPublicTitle(book) {
  return String((book && (book.title || book.name)) || '').trim();
}

function getEntityPageHref(entityType, entityId, entityName = '') {
  const safeType = toSlug(entityType || 'entity') || 'entity';
  const safeId = (toSlug(entityId || 'unknown') || 'unknown').slice(0, 48);
  const safeName = (toSlug(entityName || '') || '').slice(0, 48);
  return `entities/${safeType}/${safeName ? `${safeId}-${safeName}` : safeId}.html`;
}

function mapStatusToAvailability(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'live') {
    return 'https://schema.org/InStock';
  }
  if (normalized === 'preorder' || normalized === 'pre-order') {
    return 'https://schema.org/PreOrder';
  }
  return 'https://schema.org/Discontinued';
}

function createSearchIndex(libraryIndex, amazonLookup) {
  const records = ((libraryIndex && libraryIndex.books) || []).map((book) => {
    const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
    const keywords = [
      book.id,
      book.title,
      book.series,
      book.seriesCode,
      amazon ? amazon.asin : '',
      amazon && amazon.identifiers ? amazon.identifiers.paperbackAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.hardcoverAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.kindleAsin : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn10 : '',
      amazon && amazon.identifiers ? amazon.identifiers.isbn13 : ''
    ]
      .filter((value) => Boolean(value))
      .map((value) => String(value));

    return {
      type: 'book',
      id: book.id,
      title: book.title || book.id,
      series: book.series || '',
      href: getBookPageHref(book),
      asin: amazon ? amazon.asin || '' : '',
      amazonUrl: amazon ? amazon.url || '' : '',
      purchaseLinks: amazon
        ? {
            paperback: amazon.links ? amazon.links.paperback || '' : '',
            hardcover: amazon.links ? amazon.links.hardcover || '' : '',
            kindle: amazon.links ? amazon.links.kindle || '' : ''
          }
        : { paperback: '', hardcover: '', kindle: '' },
      keywords
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRecords: records.length,
      byType: {
        books: records.length,
        characters: 0,
        relationships: 0,
        environments: 0,
        landmarks: 0,
        activities: 0,
        resources: 0
      }
    },
    records
  };
}

function synthesizeLibraryIndexFromBooksData(booksData, seriesData) {
  const seriesBySlug = new Map(((seriesData && seriesData.series) || [])
    .map((entry) => [String(entry.slug || '').toLowerCase(), entry.title || entry.slug || '']));

  const books = ((booksData && booksData.books) || [])
    .filter((book) => Boolean(book && (getCanonicalBookId(book) || book.slug)))
    .map((book) => {
      const seriesSlug = String(book.seriesSlug || '').toLowerCase();
      const seriesTitle = seriesBySlug.get(seriesSlug) || book.seriesSlug || '';
      const id = getCanonicalBookId(book) || String(book.slug || '').toUpperCase();
      const cover = (book.coverImage || '').replace(/^\//, '');
      const files = cover ? [cover] : [];
      return {
        id,
        title: book.title || id,
        series: seriesTitle,
        seriesCode: seriesSlug,
        folder: `Books/${seriesTitle}`,
        files,
        fileTypes: cover
          ? [{ extension: String(cover).toLowerCase().split('.').pop(), count: 1 }]
          : []
      };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    generatedAt: new Date().toISOString(),
    libraryRoot: 'data/books.json',
    synthesized: true,
    summary: {
      indexedBooks: books.length,
      categories: [{ category: 'Books', fileCount: books.length }]
    },
    books
  };
}

function createMergedBookIndex(libraryIndex, amazonLookup) {
  const records = ((libraryIndex && libraryIndex.books) || []).map((book) => {
    const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
    return {
      id: book.id,
      title: book.title || book.id,
      series: book.series || '',
      seriesCode: book.seriesCode || '',
      pageHref: getBookPageHref(book),
      folder: book.folder || '',
      files: book.files || [],
      fileTypes: book.fileTypes || [],
      amazon: amazon || null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      recordCount: records.length,
      withAmazonDataCount: records.filter((record) => Boolean(record.amazon)).length
    },
    records
  };
}

function createLibraryIndexFromManifest(manifest) {
  const records = Array.isArray(manifest && manifest.records) ? manifest.records : [];
  const books = records
    .filter((record) => record && (record.id || record.slug))
    .map((record) => {
      const files = (record.assets || [])
        .map((asset) => asset && asset.key)
        .filter((value) => typeof value === 'string' && value.length > 0);

      const fileTypeCounts = new Map();
      for (const filePath of files) {
        const extension = path.extname(filePath).toLowerCase().replace(/^\./, '') || 'none';
        fileTypeCounts.set(extension, (fileTypeCounts.get(extension) || 0) + 1);
      }

      return {
        id: record.id || String(record.slug || '').toUpperCase(),
        title: record.title || record.id || record.slug,
        series: record.series || '',
        seriesCode: record.seriesCode || '',
        folder: `External/${record.series || 'Library'}`,
        files,
        fileTypes: Array.from(fileTypeCounts.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([extension, count]) => ({ extension, count }))
      };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    generatedAt: new Date().toISOString(),
    libraryRoot: 'generated/manifest/manifest.json',
    synthesized: true,
    fromManifest: true,
    summary: {
      indexedBooks: books.length,
      categories: [{ category: 'Books', fileCount: books.length }]
    },
    books
  };
}

function readLibraryIndexFromManifest(siteRoot) {
  const candidates = [
    path.join(siteRoot, 'generated', 'manifest', 'manifest.json'),
    path.join(siteRoot, 'generated', 'manifest.json')
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const index = createLibraryIndexFromManifest(manifest);
      if ((index.books || []).length > 0) {
        return index;
      }
    } catch (error) {
      console.warn(`Manifest read failed at ${path.relative(siteRoot, filePath)}: ${error.message}`);
    }
  }

  return null;
}

function writeMergedBookIndex(siteRoot, mergedBookIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'merged-book-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(mergedBookIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

const experienceTemplates = {
  default: 'Character Experience',
  quietExplorer: 'Quiet Explorer',
  welcomingGuide: 'Welcoming Guide',
  tinyDiscoverer: 'Tiny Discoverer',
  memoryKeeper: 'Memory Keeper',
  gentleListener: 'Gentle Listener',
  curiousHelper: 'Curious Helper',
  communityBuilder: 'Community Builder',
  steadyCompanion: 'Steady Companion'
};

const characterExperienceProfiles = {
  spe: {
    templateKey: 'quietExplorer',
    visitorFeeling: 'listened to, thoughtful, unhurried, curious',
    arrivalHeading: 'Welcome to Spencer’s quiet corner',
    arrivalBody: 'Spencer rewards patience. This is a place to think before you choose, notice before you speak, and move at the speed of curiosity.',
    storyHeading: "Stories where you'll meet Spencer",
    friendHeading: 'Meet the people Spencer listens to',
    placeHeading: 'Walk somewhere Spencer would notice',
    discoveryHeading: 'Notice a small detail Spencer would not miss',
    discoveryLine: 'Spencer tends to find the little clue that changes how the whole moment feels.',
    nextHeading: 'Where would you like to wander next?',
    nextLine: 'Try a calmer path, a familiar friend, or a place that invites a slower look.'
  },
  ali: {
    templateKey: 'welcomingGuide',
    visitorFeeling: 'welcomed, hopeful, encouraged, included',
    arrivalHeading: 'Welcome to Alice’s welcoming world',
    arrivalBody: 'Alice tends to open the door, make room, and help the next good thing feel possible.',
    storyHeading: "Stories where you'll meet Alice",
    friendHeading: 'Meet the people Alice would invite in',
    placeHeading: 'Walk somewhere Alice would open up for you',
    discoveryHeading: 'Notice a small discovery Alice would celebrate',
    discoveryLine: 'Alice keeps an eye out for the moment when belonging becomes visible.',
    nextHeading: 'Where would you like to go after a warm welcome?',
    nextLine: 'Choose a path that feels open, gentle, or just a little braver than before.'
  },
  ben: {
    templateKey: 'tinyDiscoverer',
    visitorFeeling: 'small, delighted, close to the ground, playful',
    arrivalHeading: 'Welcome to Bentley’s low-to-the-ground world',
    arrivalBody: 'Bentley’s visit is full of tiny victories, close-up wonders, and the kind of delight you only notice when you crouch down.',
    storyHeading: "Stories where you'll meet Bentley",
    friendHeading: 'Meet the friends Bentley would point out',
    placeHeading: 'Walk somewhere small and surprising',
    discoveryHeading: 'Notice something tiny',
    discoveryLine: 'Bentley makes room for the detail that seems small until it turns into the whole story.',
    nextHeading: 'What tiny wonder would you like to find next?',
    nextLine: 'Follow the smallest clue, the softest movement, or the happiest little success.'
  },
  gpa: {
    templateKey: 'memoryKeeper',
    visitorFeeling: 'slow, comfortable, reflective, safe',
    arrivalHeading: 'Welcome to Grandpa’s slow afternoon',
    arrivalBody: 'Grandpa does not rush the visitor. He makes room for stories, pauses, memories, and a place to sit awhile.',
    storyHeading: "Stories where you'll meet Grandpa",
    friendHeading: 'Meet the people Grandpa remembers well',
    placeHeading: 'Walk somewhere Grandpa would point out a bench',
    discoveryHeading: 'Notice a memory Grandpa would tell again',
    discoveryLine: 'Grandpa notices the kind of detail that lingers long after the visit ends.',
    nextHeading: 'Where would you like to rest next?',
    nextLine: 'Choose a story, a place, or a quiet stop that gives the visit room to breathe.'
  }
};

function getCharacterExperienceProfile(character) {
  const characterName = String(character && (character.name || character.slug || character.code) || 'This friend').trim();
  const firstName = characterName.split(' ')[0];
  const key = String(character && character.code ? character.code : character && character.slug ? character.slug : '').toLowerCase();
  return characterExperienceProfiles[key] || {
    templateKey: 'default',
    visitorFeeling: 'curious, comfortable, gently invited',
    arrivalHeading: `Welcome to ${firstName}’s world`,
    arrivalBody: character.description || `${characterName} is part of the welcoming community that makes Hawkins Hollow feel like home.`,
    storyHeading: `Stories where you'll meet ${firstName}`,
    friendHeading: `Meet the people ${firstName} knows`,
    placeHeading: `Walk somewhere with ${firstName}`,
    discoveryHeading: 'Notice something small',
    discoveryLine: `${firstName} often points visitors toward the smallest detail with the biggest heart.`,
    nextHeading: 'Where would you like to wander next?',
    nextLine: 'Choose the next stop that feels easiest to step into.'
  };
}

function stripNarrationLeakagePrefix(value) {
  return String(value || '')
    .replace(/^\s*\d+[a-z]?(?:\.\d+)?(?:\s+\d+)?\s*/i, '')
    .replace(/^\s*[-:;,.]+\s*/, '')
    .replace(/\b(?:Environment|Landmark|Relationship|Character)\s+(?:Card|Sheet)\b\s*/ig, '')
    .replace(/\b(?:Environment\s+Identity|Relationship\s+Function)\b\s*:?\s*/ig, '')
    .replace(/\bVisual\s+Canon\b\s*/ig, '')
    .replace(/^\s*[\u2014\-]\s*/, '')
    .trim();
}

function isLikelyNarrationLeakage(value) {
  const text = String(value || '').trim();
  if (!text) {
    return true;
  }

  if (/^(?:\d+[a-z]?(?:\.\d+)?(?:\s+\d+)?|\d+[a-z]?\.)$/i.test(text)) {
    return true;
  }

  return /visual canon|environment card|relationship sheet|relationship function|environment identity|source document|extractor|mentions-|canonical/i.test(text);
}

function toWarmExcerpt(value, fallback, maxLength = 180) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  const stripped = stripNarrationLeakagePrefix(raw);
  const text = stripped.replace(/\s+/g, ' ').trim();
  if (!text || isLikelyNarrationLeakage(text)) {
    return fallback;
  }
  const firstSentenceMatch = text.match(/^(.{1,220}?[.!?])\s/);
  const firstSentence = firstSentenceMatch ? firstSentenceMatch[1] : text;
  if (!firstSentence || isLikelyNarrationLeakage(firstSentence)) {
    return fallback;
  }
  if (firstSentence.length <= maxLength) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, maxLength - 1).trim()}...`;
}

function resolveCharacterExperienceAsset(character, charactersData, booksData, entityIndex) {
  const allCharacters = (charactersData && charactersData.characters) || [];
  const books = (booksData && booksData.books) || [];
  const graphCharacters = (entityIndex && entityIndex.byType && entityIndex.byType.characters) || [];
  const graphEnvironments = (entityIndex && entityIndex.byType && entityIndex.byType.environments) || [];
  const graphLandmarks = (entityIndex && entityIndex.byType && entityIndex.byType.landmarks) || [];
  const graphRelationships = (entityIndex && entityIndex.byType && entityIndex.byType.relationships) || [];
  const profile = getCharacterExperienceProfile(character);

  const matchedGraphCharacter = graphCharacters.find((entry) => {
    const entryId = String(entry.id || '').toLowerCase();
    const entrySlug = String(entry.slug || '').toLowerCase();
    return entryId === String(character.code || '').toLowerCase()
      || entrySlug === String(character.slug || '').toLowerCase();
  }) || null;

  const mentions = matchedGraphCharacter && matchedGraphCharacter.canon && matchedGraphCharacter.canon.mentions
    ? matchedGraphCharacter.canon.mentions
    : { characters: [], environments: [], landmarks: [] };
  const configuredNeighborhood = character && character.neighborhood ? character.neighborhood : {};
  const configuredRelatedCharacterSlugs = Array.isArray(configuredNeighborhood.relatedCharacterSlugs)
    ? configuredNeighborhood.relatedCharacterSlugs
    : [];
  const configuredRelatedPlaceNames = Array.isArray(configuredNeighborhood.relatedPlaceNames)
    ? configuredNeighborhood.relatedPlaceNames
    : [];

  const selfName = String(character.name || '').toLowerCase();
  const selfFirstName = String(character.name || '').split(' ')[0].toLowerCase();
  const characterFirstName = String(character.name || '').split(' ')[0] || 'This friend';
  const characterSlug = String(character.slug || '').toLowerCase();
  const getNeighborBlurb = (entry) => {
    const fallbackName = String(entry && entry.name ? entry.name : 'This friend').trim().split(' ')[0];
    const description = String(entry && entry.description ? entry.description : '').trim();
    return description || `${fallbackName} is part of the welcoming neighborhood that helps Hawkins Hollow feel like home.`;
  };

  const getRelationshipTag = (sourceKey) => {
    if (sourceKey === 'neighborhood') {
      return 'Neighborhood connection';
    }
    if (sourceKey === 'canon') {
      return 'Recurring story connection';
    }
    if (sourceKey === 'reciprocal') {
      return 'Mutual neighborhood connection';
    }
    return 'Neighbor to meet';
  };

  const buildPlaceVisitorBlurb = (placeName) => `${characterFirstName} often slows down at ${placeName} and notices one small detail worth sharing.`;

  const buildRelationshipVisitorBlurb = (companions) => {
    if (companions) {
      return `${characterFirstName} and ${companions} share moments that help this corner of Hawkins Hollow feel connected.`;
    }
    return `This connection helps ${characterFirstName}'s world feel steady and welcoming.`;
  };

  const toRelatedPersonFromCharacter = (entry, sourceKey) => ({
    name: entry.name,
    href: `${entry.slug}.html`,
    blurb: getNeighborBlurb(entry),
    relationshipTag: getRelationshipTag(sourceKey)
  });

  const relatedPeopleFromCanon = (mentions.characters || [])
    .filter((name) => String(name || '').trim().length > 0)
    .filter((name) => String(name).toLowerCase() !== selfName)
    .map((name) => {
      const matched = allCharacters.find((entry) => String(entry.name || '').toLowerCase() === String(name).toLowerCase());
      return matched
        ? toRelatedPersonFromCharacter(matched, 'canon')
        : {
          name,
          href: '',
          blurb: 'A friend mentioned in this character’s story world.',
          relationshipTag: getRelationshipTag('canon')
        };
    });

  const relatedPeopleFromNeighborhood = configuredRelatedCharacterSlugs
    .map((slug) => allCharacters.find((entry) => String(entry.slug || '').toLowerCase() === String(slug).toLowerCase()))
    .filter(Boolean)
    .filter((entry) => String(entry.slug || '').toLowerCase() !== characterSlug)
    .map((entry) => toRelatedPersonFromCharacter(entry, 'neighborhood'));

  const relatedPeopleFromReciprocalNeighborhood = allCharacters
    .filter((entry) => String(entry.slug || '').toLowerCase() !== characterSlug)
    .filter((entry) => {
      const related = entry.neighborhood && Array.isArray(entry.neighborhood.relatedCharacterSlugs)
        ? entry.neighborhood.relatedCharacterSlugs
        : [];
      return related.some((slug) => String(slug || '').toLowerCase() === characterSlug);
    })
    .map((entry) => toRelatedPersonFromCharacter(entry, 'reciprocal'));

  const relatedPeopleFromFeaturedFallback = allCharacters
    .filter((entry) => String(entry.slug || '').toLowerCase() !== characterSlug)
    .filter((entry) => entry.featured)
    .sort((a, b) => Number(a.sortOrder || 9999) - Number(b.sortOrder || 9999))
    .map((entry) => toRelatedPersonFromCharacter(entry, 'fallback'));

  const mergeUniqueByName = (primaryList, secondaryList, maxItems) => {
    const seen = new Set();
    const merged = [];
    for (const item of [...primaryList, ...secondaryList]) {
      const key = String(item && item.name ? item.name : '').trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
      if (merged.length >= maxItems) {
        break;
      }
    }
    return merged;
  };

  const mergeManyUniqueByName = (lists, maxItems) => {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
      for (const item of list) {
        const key = String(item && item.name ? item.name : '').trim().toLowerCase();
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        merged.push(item);
        if (merged.length >= maxItems) {
          return merged;
        }
      }
    }
    return merged;
  };

  const placeLookup = new Map();
  for (const place of [...graphEnvironments, ...graphLandmarks]) {
    const key = String(place.name || '').toLowerCase();
    if (!placeLookup.has(key)) {
      placeLookup.set(key, place);
    }
  }

  const normalizedCharacterMentions = (value) => (Array.isArray(value) ? value : [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter((name) => name.length > 0);

  const relatedPlacesFromCharacterMentions = [...graphEnvironments, ...graphLandmarks]
    .filter((place) => {
      const placeMentions = place && place.mentions ? place.mentions : {};
      const characters = normalizedCharacterMentions(placeMentions.characters);
      return characters.includes(selfName)
        || characters.includes(selfFirstName)
        || characters.some((name) => name.includes(selfFirstName));
    })
    .map((place) => {
      const href = place.entityPageHref || place.href || '';
      return {
        name: place.name || 'A familiar place',
        href: href ? `../${href}` : '../map.html',
        kind: place.type === 'landmark' ? 'Landmark' : 'Place',
        image: getPlaceArtworkPathByName(place.name || '', place.type === 'landmark' ? 'Landmark' : 'Place'),
        blurb: buildPlaceVisitorBlurb(place.name || 'this place')
      };
    });

  const relatedPlacesFromCanon = [...(mentions.environments || []), ...(mentions.landmarks || [])]
    .filter((name) => String(name || '').trim().length > 0)
    .map((name) => {
      const matched = placeLookup.get(String(name).toLowerCase());
      if (matched) {
        const href = matched.entityPageHref || matched.href || '';
        return {
          name: matched.name || name,
          href: href ? `../${href}` : '',
          kind: matched.type === 'landmark' ? 'Landmark' : 'Place',
          image: getPlaceArtworkPathByName(matched.name || name, matched.type === 'landmark' ? 'Landmark' : 'Place'),
          blurb: buildPlaceVisitorBlurb(matched.name || name)
        };
      }
      return {
        name,
        href: '../map.html',
        kind: 'Place',
        image: getPlaceArtworkPathByName(name, 'Place'),
        blurb: buildPlaceVisitorBlurb(name)
      };
    });

  const relatedPlacesFromNeighborhood = configuredRelatedPlaceNames
    .filter((name) => String(name || '').trim().length > 0)
    .map((name) => {
      const matched = placeLookup.get(String(name).toLowerCase());
      if (matched) {
        const href = matched.entityPageHref || matched.href || '';
        return {
          name: matched.name || name,
          href: href ? `../${href}` : '',
          kind: matched.type === 'landmark' ? 'Landmark' : 'Place',
          image: getPlaceArtworkPathByName(matched.name || name, matched.type === 'landmark' ? 'Landmark' : 'Place'),
          blurb: buildPlaceVisitorBlurb(matched.name || name)
        };
      }
      return {
        name,
        href: '../map.html',
        kind: 'Place',
        image: getPlaceArtworkPathByName(name, 'Place'),
        blurb: buildPlaceVisitorBlurb(name)
      };
    });

  const relatedStories = books
    .filter((book) => (Array.isArray(book.characters) ? book.characters.join(' ') : String(book.characters || '')).toLowerCase().includes(selfFirstName)
      || String(book.title || '').toLowerCase().includes(selfFirstName)
      || String(book.title || '').toLowerCase().includes(selfName))
    .map((book) => ({
      title: book.title,
      href: getBookPageHref(book),
      series: book.series || book.seriesSlug || 'Hawkins Hollow',
      coverImage: String(book.coverImage || '').replace(/^\//, ''),
      description: String(book.description || '').trim(),
      feelings: normalizeStoryGuidanceList(book.feelings, 'feelings'),
      themes: normalizeStoryGuidanceList(book.themes, 'themes')
    }));

  const fallbackStories = books.slice(0, 12).map((book) => ({
    title: book.title,
    href: getBookPageHref(book),
    series: book.series || book.seriesSlug || 'Hawkins Hollow',
    coverImage: String(book.coverImage || '').replace(/^\//, ''),
    description: String(book.description || '').trim(),
    feelings: normalizeStoryGuidanceList(book.feelings, 'feelings'),
    themes: normalizeStoryGuidanceList(book.themes, 'themes')
  }));

  const featuredStories = relatedStories.length > 0 ? relatedStories : fallbackStories;
  const relatedPeopleAll = mergeManyUniqueByName([
    relatedPeopleFromNeighborhood,
    relatedPeopleFromCanon,
    relatedPeopleFromReciprocalNeighborhood,
    relatedPeopleFromFeaturedFallback
  ], 24);

  const relatedPeopleBySlug = relatedPeopleAll
    .map((person) => {
      const href = String(person && person.href ? person.href : '');
      const slug = href.replace(/\.html$/i, '').trim().toLowerCase();
      if (!slug) {
        return null;
      }
      return allCharacters.find((entry) => String(entry.slug || '').toLowerCase() === slug) || null;
    })
    .filter(Boolean);

  const relatedPlacesFromPeopleNeighborhoods = relatedPeopleBySlug
    .flatMap((entry) => (entry.neighborhood && Array.isArray(entry.neighborhood.relatedPlaceNames)
      ? entry.neighborhood.relatedPlaceNames
      : []))
    .filter((name) => String(name || '').trim().length > 0)
    .map((name) => {
      const matched = placeLookup.get(String(name).toLowerCase());
      if (matched) {
        const href = matched.entityPageHref || matched.href || '';
        return {
          name: matched.name || name,
          href: href ? `../${href}` : '../map.html',
          kind: matched.type === 'landmark' ? 'Landmark' : 'Place',
          image: getPlaceArtworkPathByName(matched.name || name, matched.type === 'landmark' ? 'Landmark' : 'Place'),
          blurb: buildPlaceVisitorBlurb(matched.name || name)
        };
      }
      return {
        name,
        href: '../map.html',
        kind: 'Place',
        image: getPlaceArtworkPathByName(name, 'Place'),
        blurb: buildPlaceVisitorBlurb(name)
      };
    });

  const relatedPlacesAll = mergeManyUniqueByName([
    relatedPlacesFromNeighborhood,
    relatedPlacesFromCanon,
    relatedPlacesFromCharacterMentions,
    relatedPlacesFromPeopleNeighborhoods
  ], 24);

  const relatedRelationshipsAll = graphRelationships
    .filter((relationship) => {
      const relationshipMentions = relationship && relationship.mentions ? relationship.mentions : {};
      const characters = normalizedCharacterMentions(relationshipMentions.characters);
      return characters.includes(selfName)
        || characters.includes(selfFirstName)
        || characters.some((name) => name.includes(selfFirstName));
    })
    .map((relationship) => {
      const mentionedCharacters = (relationship.mentions && Array.isArray(relationship.mentions.characters)
        ? relationship.mentions.characters
        : [])
        .filter((name) => String(name || '').trim().length > 0);
      const companions = mentionedCharacters
        .filter((name) => String(name).toLowerCase() !== selfName)
        .join(', ');
      const companionText = companions
        ? `Often seen with ${companions}.`
        : 'A meaningful neighborhood connection.';
      const relationshipStory = buildRelationshipVisitorBlurb(companions);
      return {
        name: relationship.name || relationship.id,
        href: relationship.entityPageHref ? `../${relationship.entityPageHref}` : (relationship.href ? `../${relationship.href}` : ''),
        blurb: relationshipStory,
        relationshipTag: 'Shared connection'
      };
    })
    .slice(0, 24);

  const relatedStoriesAll = featuredStories.slice(0, 24);
  const relatedStoriesPreview = relatedStoriesAll.slice(0, 3);
  const relatedPeoplePreview = relatedPeopleAll.slice(0, 6);
  const relatedPlacesPreview = relatedPlacesAll.slice(0, 6);
  const relatedRelationshipsPreview = relatedRelationshipsAll.slice(0, 3);

  return {
    canonicalId: getCanonicalBookId({ code: character.code, id: character.code }),
    mode: profile.templateKey,
    series: 'characters',
    character,
    experienceType: profile.templateKey,
    visitorFeeling: profile.visitorFeeling,
    profile,
    relatedPeople: relatedPeoplePreview,
    relatedPeoplePreview,
    relatedPeopleAll,
    relatedPlaces: relatedPlacesPreview,
    relatedPlacesPreview,
    relatedPlacesAll,
    relatedStories: relatedStoriesPreview,
    relatedStoriesPreview,
    relatedStoriesAll,
    relatedRelationshipsPreview,
    relatedRelationshipsAll,
    sourceDocument: matchedGraphCharacter && matchedGraphCharacter.canon ? matchedGraphCharacter.canon.sourceDocument : null,
    description: character.description || '',
    heroImage: character.heroImage || ''
  };
}

// Experience templates transform content objects into visitor-centered journeys.
function renderCharacterExperiencePage(experience, site, nav, config, banner) {
  const character = experience.character;
  const profile = experience.profile;
  const characterName = String(character.name || character.slug || experience.canonicalId || 'This friend').trim();
  const characterFirstName = characterName.split(' ')[0];
  const relatedStoryCards = experience.relatedStories
    .map((story) => {
      const coverImage = story.coverImage
        ? `<img src="../${story.coverImage}" alt="Cover image for ${story.title}" loading="lazy" width="110" height="150" />`
        : '<div class="character-story-thumb-placeholder" aria-hidden="true"></div>';
      const description = story.description
        ? story.description
        : `${characterFirstName} is part of this gentle Hawkins Hollow story.`;
      const guidanceLine = getStoryGuidanceLine(story, 3);
      return `<article class="character-story-card">
        <div class="character-story-media">${coverImage}</div>
        <div class="character-story-copy">
          <h3>${story.title}</h3>
          <p>${description}</p>
          ${guidanceLine ? `<p class="story-metadata-line">${guidanceLine}</p>` : ''}
          <p><a class="character-story-link" href="../${story.href}">Read ${story.title} &rarr;</a></p>
        </div>
      </article>`;
    })
    .join('');

  const relatedPeopleLinks = experience.relatedPeople.length > 0
    ? `<ul>${experience.relatedPeople.map((person) => (person.href ? `<li><a href="${person.href}">${person.name}</a></li>` : `<li>${person.name}</li>`)).join('')}</ul>`
    : '<p>More friendships will appear here as the Hollow keeps growing.</p>';

  const relatedPlaceLinks = experience.relatedPlaces.length > 0
    ? `<ul>${experience.relatedPlaces.map((place) => (place.href ? `<li><a href="${place.href}">${place.name}</a></li>` : `<li>${place.name}</li>`)).join('')}</ul>`
    : '<p>Favorite places will be added as new memories are shared.</p>';

  const delightFact = `${character.name.split(' ')[0]} is one of the neighbors children often return to when they want a familiar friend.`;

  return renderLayout(
    character.name,
    experience.visitorFeeling,
    `<section class="content-card" aria-labelledby="character-arrival">
      <img class="character-hero-full" src="../${experience.heroImage.replace(/^\//, '')}" alt="${character.name}" width="640" height="640" />
      <h1 id="character-arrival">${profile.arrivalHeading}</h1>
      <p>${profile.arrivalBody}</p>
      <p><strong>This visit should feel:</strong> ${experience.visitorFeeling}</p>
      <p><strong>Where to go next:</strong> Continue from the story you just read and choose the next place, person, or memory to follow.</p>
      <p>
        <a class="button" href="../books.html">Read another story</a>
        <a class="button" href="../characters.html">Meet more friends</a>
      </p>
    </section>

    <section class="content-card" aria-labelledby="character-together">
      <h2 id="character-together">${profile.storyHeading}</h2>
      <p>These are a few stories where you'll continue getting to know ${characterFirstName}.</p>
      <div class="character-story-list">${relatedStoryCards}</div>
    </section>

    <section class="content-card" aria-labelledby="character-people">
      <h2 id="character-people">${profile.friendHeading}</h2>
      ${relatedPeopleLinks}
    </section>

    <section class="content-card" aria-labelledby="character-wander">
      <h2 id="character-wander">${profile.placeHeading}</h2>
      ${relatedPlaceLinks}
    </section>

    <section class="content-card" aria-labelledby="character-discovery">
      <h2 id="character-discovery">${profile.discoveryHeading}</h2>
      <p>${profile.discoveryLine}</p>
      <p>${delightFact}</p>
    </section>

    <section class="content-card" aria-labelledby="character-next">
      <h2 id="character-next">${profile.nextHeading}</h2>
      <p>${profile.nextLine}</p>
      <p>
        <a class="button" href="../books.html">Read a story</a>
        <a class="button" href="../map.html">Visit a place</a>
        <a class="button" href="../community.html">Join the community</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters/${character.slug}.html`,
    config,
    banner
  );
}

function createEntityIndex(
  mergedBookIndex,
  charactersData,
  characterCanonIndex,
  worldCanonIndex,
  fallbackWorldCanonIndex,
  relationshipsData,
  environmentsData,
  landmarksData,
  resourcesData,
  libraryScan,
  authorityRegistry
) {
  const files = (libraryScan && libraryScan.files) || [];
  const sourceDocumentsByType = {
    characters: files.filter((file) => file.category === 'Characters').map((file) => file.path),
    relationships: files.filter((file) => file.category === 'Relationships').map((file) => file.path),
    environments: files.filter((file) => file.category === 'Environments').map((file) => file.path),
    landmarks: files.filter((file) => file.category === 'Landmarks').map((file) => file.path),
    resources: files.filter((file) => file.category === 'Ribbons').map((file) => file.path)
  };

  const books = ((mergedBookIndex && mergedBookIndex.records) || []).map((record) => ({
    type: 'book',
    id: record.id,
    name: record.title,
    href: record.pageHref,
    entityPageHref: getEntityPageHref('book', record.id, record.title),
    series: record.series,
    seriesCode: record.seriesCode,
    sources: {
      libraryFolder: record.folder,
      amazonRecordId: record.amazon ? record.amazon.id : null
    },
    purchaseLinks: record.amazon && record.amazon.links
      ? {
          paperback: record.amazon.links.paperback || '',
          hardcover: record.amazon.links.hardcover || '',
          kindle: record.amazon.links.kindle || ''
        }
      : { paperback: '', hardcover: '', kindle: '' },
    identifiers: record.amazon && record.amazon.identifiers
      ? {
          asin: record.amazon.asin || '',
          paperbackAsin: record.amazon.identifiers.paperbackAsin || '',
          hardcoverAsin: record.amazon.identifiers.hardcoverAsin || '',
          kindleAsin: record.amazon.identifiers.kindleAsin || '',
          isbn: record.amazon.identifiers.isbn || '',
          isbn10: record.amazon.identifiers.isbn10 || '',
          isbn13: record.amazon.identifiers.isbn13 || ''
        }
      : {}
  }));

  const characterCanonLookup = new Map();
  for (const record of (characterCanonIndex && characterCanonIndex.records) || []) {
    if (record && record.id) {
      characterCanonLookup.set(String(record.id).toLowerCase(), record);
    }
    if (record && record.slug) {
      characterCanonLookup.set(String(record.slug).toLowerCase(), record);
    }
  }

  const characters = ((charactersData && charactersData.characters) || []).map((character) => {
    const code = character.code || '';
    const matchedSourceDocs = sourceDocumentsByType.characters.filter((docPath) => {
      const fileName = path.basename(docPath).toLowerCase();
      return code && (fileName.startsWith(`${code.toLowerCase()} `) || fileName.startsWith(`${code.toLowerCase()}-`));
    });
    const canon = characterCanonLookup.get(String(character.code || '').toLowerCase())
      || characterCanonLookup.get(String(character.slug || '').toLowerCase())
      || null;

    const entityHref = getEntityPageHref('character', character.code || character.slug, character.name);
    return {
      type: 'character',
      id: character.code || character.slug,
      slug: character.slug,
      name: character.name,
      role: character.role || '',
      href: entityHref,
      entityPageHref: entityHref,
      legacyHref: `characters/${character.slug}.html`,
      published: character.published === true,
      sourceDocuments: matchedSourceDocs,
      canon: canon
        ? {
            sourceDocument: canon.sourceDocument,
            textExcerpt: canon.textExcerpt || '',
            mentions: canon.mentions || { characters: [], environments: [], landmarks: [] }
          }
        : null
    };
  });

  const relationshipRecordsFromData = (relationshipsData && relationshipsData.relationships) || [];
  const environmentRecordsFromData = (environmentsData && environmentsData.environments) || [];
  const fallbackWorldCanonRelationships = (fallbackWorldCanonIndex && fallbackWorldCanonIndex.byType && fallbackWorldCanonIndex.byType.relationships) || [];
  const fallbackWorldCanonEnvironments = (fallbackWorldCanonIndex && fallbackWorldCanonIndex.byType && fallbackWorldCanonIndex.byType.environments) || [];
  const fallbackWorldCanonLandmarks = (fallbackWorldCanonIndex && fallbackWorldCanonIndex.byType && fallbackWorldCanonIndex.byType.landmarks) || [];
  const worldCanonRelationships = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.relationships) || []).length > 0
    ? worldCanonIndex.byType.relationships
    : fallbackWorldCanonRelationships;
  const worldCanonEnvironments = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.environments) || []).length > 0
    ? worldCanonIndex.byType.environments
    : fallbackWorldCanonEnvironments;
  const worldCanonLandmarks = ((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.landmarks) || []).length > 0
    ? worldCanonIndex.byType.landmarks
    : fallbackWorldCanonLandmarks;
  const effectiveWorldCanonIndex = {
    ...(worldCanonIndex || {}),
    byType: {
      relationships: worldCanonRelationships,
      environments: worldCanonEnvironments,
      landmarks: worldCanonLandmarks
    }
  };

  const sourceObjectsByFile = {
    'generated/world-canon-index.json': effectiveWorldCanonIndex,
    'data/relationships.json': { relationships: relationshipRecordsFromData },
    'data/environments.json': { environments: environmentRecordsFromData },
    'data/books.json': {},
    'data/characters.json': {}
  };

  const selectedRelationshipSource = selectEntitySourceRecords('relationships', authorityRegistry, sourceObjectsByFile);
  const selectedEnvironmentSource = selectEntitySourceRecords('environments', authorityRegistry, sourceObjectsByFile);

  const relationshipFallback = relationshipRecordsFromData.map((relationship, index) => ({
    type: 'relationship',
    id: relationship.id || relationship.slug || `relationship-${index + 1}`,
    name: relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`,
    href: getEntityPageHref(
      'relationship',
      relationship.id || relationship.slug || `relationship-${index + 1}`,
      relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'relationship',
      relationship.id || relationship.slug || `relationship-${index + 1}`,
      relationship.name || relationship.title || relationship.slug || `Relationship ${index + 1}`
    ),
    ...relationship
  }));
  const canonRelationships = worldCanonRelationships
    .map((relationship) => ({
      ...relationship,
      type: 'relationship',
      href: getEntityPageHref('relationship', relationship.id, relationship.name),
      entityPageHref: getEntityPageHref('relationship', relationship.id, relationship.name)
    }));
  const relationships = selectedRelationshipSource.activeSource.startsWith('generated/world-canon-index.json')
    ? canonRelationships
    : relationshipFallback;

  const environmentFallback = environmentRecordsFromData.map((environment, index) => ({
    type: 'environment',
    id: environment.id || environment.slug || `environment-${index + 1}`,
    name: environment.name || environment.title || environment.slug || `Environment ${index + 1}`,
    href: getEntityPageHref(
      'environment',
      environment.id || environment.slug || `environment-${index + 1}`,
      environment.name || environment.title || environment.slug || `Environment ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'environment',
      environment.id || environment.slug || `environment-${index + 1}`,
      environment.name || environment.title || environment.slug || `Environment ${index + 1}`
    ),
    ...environment
  }));
  const canonEnvironments = worldCanonEnvironments
    .map((environment) => ({
      ...environment,
      type: 'environment',
      href: getEntityPageHref('environment', environment.id, environment.name),
      entityPageHref: getEntityPageHref('environment', environment.id, environment.name)
    }));
  const environments = selectedEnvironmentSource.activeSource.startsWith('generated/world-canon-index.json')
    ? canonEnvironments
    : environmentFallback;

  const landmarkFallback = ((landmarksData && landmarksData.landmarks) || []).map((landmark, index) => ({
    type: 'landmark',
    id: landmark.id || landmark.slug || `landmark-${index + 1}`,
    name: landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`,
    href: getEntityPageHref(
      'landmark',
      landmark.id || landmark.slug || `landmark-${index + 1}`,
      landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`
    ),
    entityPageHref: getEntityPageHref(
      'landmark',
      landmark.id || landmark.slug || `landmark-${index + 1}`,
      landmark.name || landmark.title || landmark.slug || `Landmark ${index + 1}`
    ),
    ...landmark
  }));
  const canonLandmarks = worldCanonLandmarks
    .map((landmark) => ({
      ...landmark,
      type: 'landmark',
      href: getEntityPageHref('landmark', landmark.id, landmark.name),
      entityPageHref: getEntityPageHref('landmark', landmark.id, landmark.name)
    }));
  const landmarks = canonLandmarks.length > 0 ? canonLandmarks : landmarkFallback;

  const resources = ((resourcesData && resourcesData.resources) || []).map((resource, index) => ({
    type: 'resource',
    id: resource.id || resource.slug || `resource-${index + 1}`,
    name: resource.name || resource.title || resource.slug || `Resource ${index + 1}`,
    href: getEntityPageHref('resource', resource.id || resource.slug || `resource-${index + 1}`, resource.title || resource.name || resource.slug || ''),
    entityPageHref: getEntityPageHref('resource', resource.id || resource.slug || `resource-${index + 1}`, resource.title || resource.name || resource.slug || ''),
    ...resource
  }));

  const activities = [];

  const byType = {
    books,
    characters,
    relationships,
    environments,
    landmarks,
    activities,
    resources
  };

  const entities = [
    ...books,
    ...characters,
    ...relationships,
    ...environments,
    ...landmarks,
    ...activities,
    ...resources
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalEntities: entities.length,
      byType: {
        books: books.length,
        characters: characters.length,
        relationships: relationships.length,
        environments: environments.length,
        landmarks: landmarks.length,
        activities: activities.length,
        resources: resources.length
      }
    },
    canonicalAuthoritySelection: {
      relationships: {
        authority: selectedRelationshipSource.authority,
        source: selectedRelationshipSource.activeSource
      },
      environments: {
        authority: selectedEnvironmentSource.authority,
        source: selectedEnvironmentSource.activeSource
      }
    },
    sourceDocumentsByType,
    byType,
    entities
  };
}

function writeEntityIndex(siteRoot, entityIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'entity-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(entityIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

function createSearchIndexFromEntityIndex(entityIndex) {
  const records = [];

  for (const book of (entityIndex.byType && entityIndex.byType.books) || []) {
    records.push({
      type: 'book',
      id: book.id,
      title: book.name,
      series: book.series || '',
      href: book.href || '',
      asin: book.identifiers && book.identifiers.asin ? book.identifiers.asin : '',
      amazonUrl: book.purchaseLinks && book.purchaseLinks.paperback ? book.purchaseLinks.paperback : '',
      purchaseLinks: book.purchaseLinks || { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        book.id,
        book.name,
        book.series,
        book.seriesCode,
        book.identifiers ? book.identifiers.asin : '',
        book.identifiers ? book.identifiers.paperbackAsin : '',
        book.identifiers ? book.identifiers.hardcoverAsin : '',
        book.identifiers ? book.identifiers.kindleAsin : '',
        book.identifiers ? book.identifiers.isbn : '',
        book.identifiers ? book.identifiers.isbn10 : '',
        book.identifiers ? book.identifiers.isbn13 : ''
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const character of (entityIndex.byType && entityIndex.byType.characters) || []) {
    records.push({
      type: 'character',
      id: character.id,
      title: character.name,
      series: 'Characters',
      href: character.href || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        character.id,
        character.slug,
        character.name,
        character.role,
        character.legacyHref,
        ...(character.canon && character.canon.mentions ? character.canon.mentions.characters || [] : []),
        ...(character.canon && character.canon.mentions ? character.canon.mentions.environments || [] : []),
        ...(character.canon && character.canon.mentions ? character.canon.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const relationship of (entityIndex.byType && entityIndex.byType.relationships) || []) {
    records.push({
      type: 'relationship',
      id: relationship.id,
      title: relationship.name,
      series: 'Relationships',
      href: relationship.href || relationship.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        relationship.id,
        relationship.name,
        ...(relationship.mentions ? relationship.mentions.characters || [] : []),
        ...(relationship.mentions ? relationship.mentions.environments || [] : []),
        ...(relationship.mentions ? relationship.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const environment of (entityIndex.byType && entityIndex.byType.environments) || []) {
    records.push({
      type: 'environment',
      id: environment.id,
      title: environment.name,
      series: 'Environments',
      href: environment.href || environment.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        environment.id,
        environment.slug,
        environment.name,
        ...(environment.mentions ? environment.mentions.characters || [] : []),
        ...(environment.mentions ? environment.mentions.environments || [] : []),
        ...(environment.mentions ? environment.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const landmark of (entityIndex.byType && entityIndex.byType.landmarks) || []) {
    records.push({
      type: 'landmark',
      id: landmark.id,
      title: landmark.name,
      series: 'Landmarks',
      href: landmark.href || landmark.entityPageHref || '',
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [
        landmark.id,
        landmark.slug,
        landmark.name,
        ...(landmark.mentions ? landmark.mentions.characters || [] : []),
        ...(landmark.mentions ? landmark.mentions.environments || [] : []),
        ...(landmark.mentions ? landmark.mentions.landmarks || [] : [])
      ]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  for (const resource of (entityIndex.byType && entityIndex.byType.resources) || []) {
    records.push({
      type: 'resource',
      id: resource.id,
      title: resource.name,
      series: 'Resources',
      href: resource.href || resource.entityPageHref || (resource.slug ? `${resource.slug}.html` : ''),
      asin: '',
      amazonUrl: '',
      purchaseLinks: { paperback: '', hardcover: '', kindle: '' },
      keywords: [resource.id, resource.slug, resource.name, resource.description]
        .filter((value) => Boolean(value))
        .map((value) => String(value))
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRecords: records.length,
      byType: {
        books: ((entityIndex.byType && entityIndex.byType.books) || []).length,
        characters: ((entityIndex.byType && entityIndex.byType.characters) || []).length,
        relationships: ((entityIndex.byType && entityIndex.byType.relationships) || []).length,
        environments: ((entityIndex.byType && entityIndex.byType.environments) || []).length,
        landmarks: ((entityIndex.byType && entityIndex.byType.landmarks) || []).length,
        activities: ((entityIndex.byType && entityIndex.byType.activities) || []).length,
        resources: ((entityIndex.byType && entityIndex.byType.resources) || []).length
      }
    },
    records
  };
}

function normalizeEntityKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createEntityGraph(entityIndex) {
  const entities = (entityIndex && entityIndex.entities) || [];
  const nodes = entities.map((entity) => ({
    id: `${entity.type}:${entity.id}`,
    entityType: entity.type,
    entityId: entity.id,
    name: entity.name || entity.title || entity.id,
    href: entity.entityPageHref || entity.href || '',
    provenance: {
      sourceDocuments: entity.sourceDocuments || (entity.sourceDocument ? [entity.sourceDocument] : []),
      sourceDocument: entity.sourceDocument || (entity.canon ? entity.canon.sourceDocument : null)
    }
  }));

  const byTypeAndName = new Map();
  for (const entity of entities) {
    const type = entity.type;
    const keys = [entity.name, entity.title, entity.id, entity.slug]
      .filter((value) => Boolean(value))
      .map((value) => normalizeEntityKey(value));
    for (const key of keys) {
      const mapKey = `${type}:${key}`;
      if (!byTypeAndName.has(mapKey)) {
        byTypeAndName.set(mapKey, []);
      }
      byTypeAndName.get(mapKey).push(entity);
    }
  }

  const edges = [];
  const unresolvedMentions = [];
  const seenEdgeKeys = new Set();

  function addMentionEdges(sourceEntity, mentionedNames, targetType, relationshipType, sourceDocument) {
    for (const mention of mentionedNames || []) {
      const key = normalizeEntityKey(mention);
      const candidates = byTypeAndName.get(`${targetType}:${key}`) || [];
      if (candidates.length === 0) {
        unresolvedMentions.push({
          from: `${sourceEntity.type}:${sourceEntity.id}`,
          targetType,
          mention,
          provenance: {
            sourceArtifact: 'generated/entity-index.json',
            sourceDocument: sourceDocument || null,
            extractor: 'canon-mention-match-v1'
          }
        });
        continue;
      }

      for (const targetEntity of candidates) {
        const edgeKey = `${sourceEntity.type}:${sourceEntity.id}->${targetEntity.type}:${targetEntity.id}:${relationshipType}`;
        if (seenEdgeKeys.has(edgeKey)) {
          continue;
        }
        seenEdgeKeys.add(edgeKey);

        edges.push({
          id: `EDGE-${String(edges.length + 1).padStart(6, '0')}`,
          from: `${sourceEntity.type}:${sourceEntity.id}`,
          to: `${targetEntity.type}:${targetEntity.id}`,
          relationshipType,
          mention,
          provenance: {
            sourceArtifact: 'generated/entity-index.json',
            sourceDocument: sourceDocument || null,
            extractor: 'canon-mention-match-v1'
          }
        });
      }
    }
  }

  for (const character of (entityIndex.byType && entityIndex.byType.characters) || []) {
    const mentions = character.canon && character.canon.mentions ? character.canon.mentions : null;
    const sourceDocument = character.canon ? character.canon.sourceDocument : null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(character, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(character, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
    addMentionEdges(character, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const relationship of (entityIndex.byType && entityIndex.byType.relationships) || []) {
    const mentions = relationship.mentions || null;
    const sourceDocument = relationship.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(relationship, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(relationship, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
    addMentionEdges(relationship, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const environment of (entityIndex.byType && entityIndex.byType.environments) || []) {
    const mentions = environment.mentions || null;
    const sourceDocument = environment.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(environment, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(environment, mentions.landmarks, 'landmark', 'mentions-landmark', sourceDocument);
  }

  for (const landmark of (entityIndex.byType && entityIndex.byType.landmarks) || []) {
    const mentions = landmark.mentions || null;
    const sourceDocument = landmark.sourceDocument || null;
    if (!mentions) {
      continue;
    }

    addMentionEdges(landmark, mentions.characters, 'character', 'mentions-character', sourceDocument);
    addMentionEdges(landmark, mentions.environments, 'environment', 'mentions-environment', sourceDocument);
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      unresolvedMentionCount: unresolvedMentions.length
    },
    nodes,
    edges,
    unresolvedMentions
  };
}

function writeEntityGraph(siteRoot, entityGraph) {
  const outputPath = path.join(siteRoot, 'generated', 'entity-graph.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(entityGraph, null, 2)}\n`, 'utf8');
  return outputPath;
}

function writeSearchIndex(siteRoot, searchIndex) {
  const outputPath = path.join(siteRoot, 'generated', 'search-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(searchIndex, null, 2)}\n`, 'utf8');
  return outputPath;
}

function getEntitiesForType(entityIndex, type) {
  const byType = (entityIndex && entityIndex.byType) || {};
  if (type === 'book') {
    return byType.books || [];
  }
  if (type === 'character') {
    return byType.characters || [];
  }
  if (type === 'relationship') {
    return byType.relationships || [];
  }
  if (type === 'environment') {
    return byType.environments || [];
  }
  if (type === 'landmark') {
    return byType.landmarks || [];
  }
  if (type === 'resource') {
    return byType.resources || [];
  }
  if (type === 'activity') {
    return byType.activities || [];
  }
  return [];
}

function getEntityByTypeAndId(entityIndex, type, id) {
  const collection = getEntitiesForType(entityIndex, type);
  const normalizedId = String(id || '').toLowerCase();
  return collection.find((entry) => String(entry && entry.id ? entry.id : '').toLowerCase() === normalizedId) || null;
}

function normalizeEntityLabel(value, fallback = '') {
  let label = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  if (!label) {
    return String(fallback || 'Entity');
  }

  label = label
    .replace(/^~\$+/, '')
    .replace(/^(?:\d+[a-z]?(?:\.\d+)?[.)]?\s+)+/i, '')
    .trim();

  const cardIndex = label.search(/\sCard\s/i);
  if (cardIndex > 0) {
    label = label.slice(0, cardIndex).trim();
  }

  const markerPatterns = [
    /\sLandmark Identity:/i,
    /\sEnvironment Identity:/i,
    /\sRelationship Function:/i,
    /\sStory Function:/i
  ];
  for (const pattern of markerPatterns) {
    const markerIndex = label.search(pattern);
    if (markerIndex > 0) {
      label = label.slice(0, markerIndex).trim();
    }
  }

  if (!label) {
    label = String(fallback || 'Entity');
  }

  if (label.length > 120) {
    label = `${label.slice(0, 117).trimEnd()}...`;
  }

  return label;
}

function renderUniversalEntityPage(entity, entityIndex, entityGraph, site, nav, config, banners) {
  const nodeId = `${entity.type}:${entity.id}`;
  const entityLabel = normalizeEntityLabel(entity.name || entity.title || entity.id, entity.id);
  const nodeMap = new Map(((entityGraph && entityGraph.nodes) || []).map((node) => [node.id, node]));
  const node = nodeMap.get(nodeId) || null;
  const edges = ((entityGraph && entityGraph.edges) || []).filter(
    (edge) => edge.from === nodeId || edge.to === nodeId
  );

  const identityRows = [
    `<p><strong>Entity Type:</strong> ${entity.type}</p>`,
    `<p><strong>Entity ID:</strong> ${entity.id}</p>`
  ];
  if (entity.series) {
    identityRows.push(`<p><strong>Series:</strong> ${entity.series}</p>`);
  }
  if (entity.sourceDocument) {
    identityRows.push(`<p><strong>Source Document:</strong> <code>${entity.sourceDocument}</code></p>`);
  }
  if (entity.legacyHref) {
    const legacyTargetPath = path.join(buildDir, entity.legacyHref);
    if (fs.existsSync(legacyTargetPath)) {
      identityRows.push(`<p><a class="button" href="../../${entity.legacyHref}">Open Legacy Character Page</a></p>`);
    }
  }

  const storyText = entity.canon && entity.canon.textExcerpt
    ? entity.canon.textExcerpt
    : entity.textExcerpt || entity.description || '';

  const connectionsHtml = edges.length === 0
    ? '<p>No typed connections are available yet for this entity.</p>'
    : `<ul>${edges.slice(0, 60).map((edge) => {
      const isOutgoing = edge.from === nodeId;
      const otherNodeId = isOutgoing ? edge.to : edge.from;
      const otherNode = nodeMap.get(otherNodeId);
      const label = otherNode
        ? `${normalizeEntityLabel(otherNode.name || otherNode.entityId, otherNode.entityId)} (${otherNode.entityType})`
        : otherNodeId;
      const href = otherNode && otherNode.href ? `../../${otherNode.href}` : '';
      const link = href ? `<a href="${href}">${label}</a>` : label;
      const sourceDoc = edge.provenance && edge.provenance.sourceDocument
        ? `<code>${edge.provenance.sourceDocument}</code>`
        : 'unknown source';
      return `<li>${isOutgoing ? 'From' : 'To'} ${link} via <strong>${edge.relationshipType}</strong> (${sourceDoc})</li>`;
    }).join('')}</ul>`;

  const resourceLinks = [];
  resourceLinks.push('<a class="button" href="../../map.html">Open the Map of Hawkins Hollow</a>');
  if (entity.type === 'book' && entity.purchaseLinks) {
    if (entity.purchaseLinks.paperback) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>`);
    }
    if (entity.purchaseLinks.hardcover) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>`);
    }
    if (entity.purchaseLinks.kindle) {
      resourceLinks.push(`<a class="button" href="${entity.purchaseLinks.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>`);
    }
  }
  if (entity.href) {
    resourceLinks.push(`<a class="button" href="../../${entity.href}">Open Primary Entity Destination</a>`);
  }
  if (resourceLinks.length === 0) {
    resourceLinks.push('<p>No direct resources are mapped for this entity yet.</p>');
  }

  const connectedCandidates = [];
  const seenConnectionIds = new Set();
  for (const edge of edges) {
    const otherNodeId = edge.from === nodeId ? edge.to : edge.from;
    if (!otherNodeId || seenConnectionIds.has(otherNodeId)) {
      continue;
    }
    seenConnectionIds.add(otherNodeId);
    const otherNode = nodeMap.get(otherNodeId);
    if (!otherNode) {
      continue;
    }
    connectedCandidates.push({
      id: otherNode.entityId,
      name: normalizeEntityLabel(otherNode.name || otherNode.entityId, otherNode.entityId),
      type: otherNode.entityType,
      entityPageHref: otherNode.href,
      excerpt: (getEntityByTypeAndId(entityIndex, otherNode.entityType, otherNode.entityId) || {}).textExcerpt || '',
      description: (getEntityByTypeAndId(entityIndex, otherNode.entityType, otherNode.entityId) || {}).description || '',
      coverImage: (getEntityByTypeAndId(entityIndex, otherNode.entityType, otherNode.entityId) || {}).coverImage || ''
    });
  }

  const continueExploring = connectedCandidates.length > 0
    ? connectedCandidates.slice(0, 8)
    : getEntitiesForType(entityIndex, entity.type)
      .filter((candidate) => candidate.id !== entity.id)
      .slice(0, 8);

  const isPlaceLikeEntity = entity.type === 'environment' || entity.type === 'landmark';
  const placeNeighborCandidates = [];
  if (isPlaceLikeEntity) {
    const seenNeighborIds = new Set();
    const addNeighbor = (candidate) => {
      if (!candidate || candidate.type !== 'character' || !candidate.id || seenNeighborIds.has(candidate.id)) {
        return;
      }
      seenNeighborIds.add(candidate.id);
      placeNeighborCandidates.push(candidate);
    };

    connectedCandidates.forEach(addNeighbor);

    const relationshipNodeIds = [];
    for (const edge of edges) {
      const otherNodeId = edge.from === nodeId ? edge.to : edge.from;
      const otherNode = nodeMap.get(otherNodeId);
      if (otherNode && otherNode.entityType === 'relationship') {
        relationshipNodeIds.push(otherNodeId);
      }
    }

    for (const relationshipNodeId of relationshipNodeIds) {
      for (const relationshipEdge of ((entityGraph && entityGraph.edges) || [])) {
        if (relationshipEdge.from !== relationshipNodeId && relationshipEdge.to !== relationshipNodeId) {
          continue;
        }
        const counterpartId = relationshipEdge.from === relationshipNodeId ? relationshipEdge.to : relationshipEdge.from;
        if (!counterpartId || counterpartId === nodeId) {
          continue;
        }
        const counterpartNode = nodeMap.get(counterpartId);
        if (!counterpartNode || counterpartNode.entityType !== 'character') {
          continue;
        }
        addNeighbor({
          id: counterpartNode.entityId,
          name: normalizeEntityLabel(counterpartNode.name || counterpartNode.entityId, counterpartNode.entityId),
          type: counterpartNode.entityType,
          entityPageHref: counterpartNode.href
        });
      }
    }
  }

  const primaryContinuation = (isPlaceLikeEntity && placeNeighborCandidates.length > 0
    ? placeNeighborCandidates[0]
    : null)
    || connectedCandidates.find((candidate) => candidate.type === 'book')
    || connectedCandidates.find((candidate) => candidate.type === 'character')
    || connectedCandidates.find((candidate) => candidate.type === 'environment' || candidate.type === 'landmark')
    || continueExploring[0] || null;

  const continuationHeading = isPlaceLikeEntity
    ? (placeNeighborCandidates.length > 0 ? 'Neighbors you might meet here' : 'Follow this place into the next part of the story')
    : 'Where would you like to wander next?';
  const continuationIntro = isPlaceLikeEntity
    ? (placeNeighborCandidates.length > 0
      ? 'These are neighbors who often bring this place to life.'
      : (primaryContinuation
        ? `This place feels most alive when you follow ${primaryContinuation.name}.`
        : 'This place opens naturally into the next story, person, or memory around Hawkins Hollow.'))
    : `People who explored ${entityLabel} also wandered through:`;
  const primaryContinuationButton = primaryContinuation && primaryContinuation.entityPageHref
    ? `<p><a class="button" href="../../${primaryContinuation.entityPageHref}">Continue with ${primaryContinuation.name}</a></p>`
    : '';

  const placeContinuationList = placeNeighborCandidates.length > 0
    ? placeNeighborCandidates.slice(0, 8)
    : continueExploring;

  const continueHtml = placeContinuationList.length === 0
    ? '<p>More connected entities are still being mapped. For now, choose another nearby path from the map or search.</p>'
    : `<ul>${placeContinuationList.map((candidate) => {
      const href = candidate.entityPageHref || candidate.href || '';
      if (!href) {
        return `<li>${candidate.name || candidate.title || candidate.id}</li>`;
      }
      return `<li><a href="../../${href}">${candidate.name || candidate.title || candidate.id}</a></li>`;
    }).join('')}</ul>`;

  const debugNodeProvenance = node && node.provenance
    ? `<ul>
        <li><strong>sourceDocument:</strong> ${node.provenance.sourceDocument || 'unknown'}</li>
        <li><strong>sourceDocuments:</strong> ${(node.provenance.sourceDocuments || []).join(', ') || 'none'}</li>
      </ul>`
    : '<p>No node provenance available.</p>';

  const debugEdges = edges.length === 0
    ? '<p>No graph edges for this entity yet.</p>'
    : `<ul>${edges.slice(0, 60).map((edge) => {
      const direction = edge.from === nodeId ? 'outgoing' : 'incoming';
      const counterpart = edge.from === nodeId ? edge.to : edge.from;
      return `<li>
        <strong>${edge.relationshipType}</strong> (${direction}) to ${counterpart}<br />
        mention: ${edge.mention || 'n/a'}<br />
        sourceArtifact: ${(edge.provenance && edge.provenance.sourceArtifact) || 'unknown'}<br />
        sourceDocument: ${(edge.provenance && edge.provenance.sourceDocument) || 'unknown'}<br />
        extractor: ${(edge.provenance && edge.provenance.extractor) || 'unknown'}
      </li>`;
    }).join('')}</ul>`;

  if (isPlaceLikeEntity) {
    const placeBanner = (banners && (banners.places || banners.map)) || {
      title: 'Meet the Places of Hawkins Hollow',
      subtitle: 'Every path in Hawkins Hollow leads to a place worth knowing.',
      bannerId: '021',
      image: 'assets/banners/021 Hawkins Hollow Places Ribbon.png',
      alt: 'Places ribbon welcoming visitors into the neighborhoods, paths, and gathering spots of Hawkins Hollow.'
    };
    const placeName = entityLabel;
    const placeArtwork = getPlaceArtworkPathByName(placeName, entity.type === 'landmark' ? 'Landmark' : 'Place');
    const rawPlaceStoryText = String(storyText || '');
    const storyFunctionMatch = rawPlaceStoryText.match(/Story Function:\s*([\s\S]*)/i);
    const placeStorySource = storyFunctionMatch && storyFunctionMatch[1]
      ? storyFunctionMatch[1]
      : rawPlaceStoryText.replace(/^.*?Environment Identity:\s*/i, '');
    const placeStoryLine = toWarmExcerpt(
      placeStorySource,
      `${placeName} is one of those welcoming corners where neighbors naturally slow down and spend a little more time together.`,
      240
    );

    const allNeighborCandidates = placeNeighborCandidates.length > 0
      ? placeNeighborCandidates
      : connectedCandidates.filter((candidate) => candidate.type === 'character');
    const previewNeighbors = allNeighborCandidates.slice(0, 4);
    const hasMoreNeighborsThanPreview = allNeighborCandidates.length > previewNeighbors.length;

    const storyCandidates = connectedCandidates.filter((candidate) => candidate.type === 'book');
    const previewStories = storyCandidates.slice(0, 3);

    const nearbyCandidates = connectedCandidates.filter(
      (candidate) => (candidate.type === 'environment' || candidate.type === 'landmark') && candidate.id !== entity.id
    );
    const nearbyFallback = getEntitiesForType(entityIndex, entity.type)
      .filter((candidate) => String(candidate.id || '') !== String(entity.id || ''))
      .slice(0, 8)
      .map((candidate) => ({
        id: candidate.id,
        name: normalizeEntityLabel(candidate.name || candidate.title || candidate.id, candidate.id),
        type: candidate.type,
        entityPageHref: candidate.entityPageHref || candidate.href || ''
      }));
    const allNearbyPlaces = nearbyCandidates.length > 0 ? nearbyCandidates : nearbyFallback;
    const previewNearby = allNearbyPlaces.slice(0, 4);
    const hasMoreNearbyThanPreview = allNearbyPlaces.length > previewNearby.length;
    const additionalNearbyPlaces = hasMoreNearbyThanPreview
      ? allNearbyPlaces.slice(previewNearby.length)
      : [];

    const neighborCards = previewNeighbors.length === 0
      ? '<p>More regular neighbors will appear here as this place keeps welcoming visitors.</p>'
      : `<div class="character-neighbor-list">${previewNeighbors.map((candidate) => {
        const name = normalizeEntityLabel(candidate.name || 'Neighbor', candidate.id);
        const firstName = name.split(' ')[0];
        const note = toWarmExcerpt(
          candidate.excerpt || candidate.description,
          `${firstName} is often part of what makes ${placeName} feel familiar.`,
          160
        );
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        return `<article class="character-neighbor-card">
          <p class="character-neighbor-tag">Regular neighbor</p>
          <h3>${href ? `<a href="${href}">${name}</a>` : name}</h3>
          <p>${note}</p>
        </article>`;
      }).join('')}</div>`;

    const storyCards = previewStories.length === 0
      ? '<p>Stories that pass through this place will appear here as the neighborhood grows.</p>'
      : `<div class="character-story-list">${previewStories.map((candidate) => {
        const storyTitle = normalizeEntityLabel(candidate.name || 'A Hawkins Hollow story', candidate.id);
        const storyNote = toWarmExcerpt(
          candidate.excerpt || candidate.description,
          `${storyTitle} passes through ${placeName} in a way that helps the neighborhood feel connected.`,
          160
        );
        const coverPath = String(candidate.coverImage || '').replace(/^\//, '');
        const media = coverPath
          ? `<img src="../../${coverPath}" alt="Cover image for ${storyTitle}" loading="lazy" width="110" height="150" />`
          : '<div class="character-story-thumb-placeholder" aria-hidden="true"></div>';
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        return `<article class="character-story-card">
          <div class="character-story-media">${media}</div>
          <div class="character-story-copy">
            <h3>${storyTitle}</h3>
            <p>${storyNote}</p>
            ${href ? `<p><a class="character-story-link" href="${href}">Read this story &rarr;</a></p>` : ''}
          </div>
        </article>`;
      }).join('')}</div>`;

    const nearbyCards = previewNearby.length === 0
      ? '<p>More nearby places will appear here as paths are mapped.</p>'
      : `<div class="character-story-list">${previewNearby.map((candidate) => {
        const nearbyName = normalizeEntityLabel(candidate.name || 'Another nearby place', candidate.id);
        const kind = candidate.type === 'landmark' ? 'Landmark' : 'Place';
        const nearbyImage = getPlaceArtworkPathByName(nearbyName, kind).replace(/^\//, '');
        const media = nearbyImage
          ? `<img src="../../${nearbyImage}" alt="${nearbyName}" loading="lazy" width="110" height="150" />`
          : '<div class="character-story-thumb-placeholder place-thumb" aria-hidden="true"></div>';
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        return `<article class="character-story-card">
          <div class="character-story-media">${media}</div>
          <div class="character-story-copy">
            <p class="character-neighbor-tag">${kind}</p>
            <h3>${href ? `<a href="${href}">${nearbyName}</a>` : nearbyName}</h3>
            <p>${nearbyName} is a natural next stop if you'd like to keep wandering from ${placeName}.</p>
          </div>
        </article>`;
      }).join('')}</div>`;

    const timeMatch = String(storyText || '').match(/\b(morning|afternoon|evening|sunset|dusk|night)\b/i);
    const seasonMatch = String(storyText || '').match(/\b(spring|summer|autumn|fall|winter)\b/i);
    const specialList = [
      `Why neighbors come: ${placeStoryLine}`,
      `What usually happens: ${allNeighborCandidates.length > 0 ? 'Conversation, listening, and small moments shared between familiar neighbors.' : 'Gentle pauses, observation, and room for stories to begin.'}`,
      `Time of day that feels nicest: ${timeMatch ? timeMatch[1] : 'The quieter parts of the day when families can slow down.'}`,
      `Seasonal feeling: ${seasonMatch ? seasonMatch[1] : 'Small seasonal shifts that keep this place familiar while still feeling alive.'}`,
      'Small traditions: Returning here to listen, read, and welcome someone else into the next part of the walk.'
    ];

    const fullNeighborList = allNeighborCandidates.length > 0
      ? `<ul>${allNeighborCandidates.map((candidate) => {
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        const label = normalizeEntityLabel(candidate.name || candidate.id, candidate.id);
        return `<li>${href ? `<a href="${href}">${label}</a>` : label}</li>`;
      }).join('')}</ul>`
      : '<p>More regular neighbors are still being mapped.</p>';

    const fullNearbyList = additionalNearbyPlaces.length > 0
      ? `<ul>${additionalNearbyPlaces.map((candidate) => {
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        const label = normalizeEntityLabel(candidate.name || candidate.id, candidate.id);
        return `<li>${href ? `<a href="${href}">${label}</a>` : label}</li>`;
      }).join('')}</ul>`
      : '<p>More nearby places are still being mapped.</p>';

    const placeHero = placeArtwork
      ? `<img class="character-hero-full" src="../../${placeArtwork.replace(/^\//, '')}" alt="${placeName}" width="640" height="640" />`
      : '';

    return renderLayout(
      placeName,
      `Spend a little time in ${placeName} and keep wandering through Hawkins Hollow one welcoming step at a time.`,
      `<section class="content-card" aria-labelledby="place-arrival">
        <p class="eyebrow">Meet the Places</p>
        ${placeHero}
        <h1 id="place-arrival">Spend a little time in ${placeName}</h1>
        <p>${placeStoryLine}</p>
        <p><strong>This visit should feel:</strong> Familiar, welcoming, and connected to the same neighborhood walk.</p>
        <p>
          <a class="button" href="../../map.html">Return to the map</a>
          <a class="button" href="../../community.html">Visit the community</a>
        </p>
      </section>

      <section class="content-card" aria-labelledby="place-neighbors">
        <h2 id="place-neighbors">Meet the neighbors you'll often find here</h2>
        ${neighborCards}
        ${hasMoreNeighborsThanPreview ? `<p class="section-continue"><a class="button" href="#place-all-neighbors">Find everyone who spends time at ${placeName} &rarr;</a></p>` : ''}
      </section>

      <section class="content-card" aria-labelledby="place-stories">
        <h2 id="place-stories">Stories that begin or pass through here</h2>
        ${storyCards}
      </section>

      <section class="content-card" aria-labelledby="place-nearby">
        <h2 id="place-nearby">Nearby places to wander next</h2>
        ${nearbyCards}
        ${hasMoreNearbyThanPreview ? '<p class="section-continue"><a class="button" href="#place-all-nearby">Explore more places nearby &rarr;</a></p>' : ''}
      </section>

      <section class="content-card" aria-labelledby="place-special">
        <h2 id="place-special">What makes this place special?</h2>
        <ul>${specialList.map((item) => `<li>${item}</li>`).join('')}</ul>
      </section>

      ${hasMoreNeighborsThanPreview ? `<section id="place-all-neighbors" class="content-card" aria-labelledby="place-all-neighbors-heading">
        <h2 id="place-all-neighbors-heading">Everyone who spends time at ${placeName}</h2>
        ${fullNeighborList}
      </section>` : ''}

      ${hasMoreNearbyThanPreview ? `<section id="place-all-nearby" class="content-card" aria-labelledby="place-all-nearby-heading">
        <h2 id="place-all-nearby-heading">More places nearby</h2>
        ${fullNearbyList}
      </section>` : ''}

      <aside id="entity-debug-panel" class="content-card entity-debug-panel" hidden>
        <h2>Developer Provenance Panel</h2>
        <p>This panel is shown because <code>?debug=true</code> is present.</p>
        <h3>Identity</h3>
        <p><strong>Node ID:</strong> ${nodeId}</p>
        <p><strong>Entity Path:</strong> ${(entity.entityPageHref || entity.href || 'n/a')}</p>

        <h3>Source Canon</h3>
        ${debugNodeProvenance}

        <h3>Graph Connections</h3>
        ${debugEdges}
      </aside>

      <script>
        (function () {
          var panel = document.getElementById('entity-debug-panel');
          if (!panel) {
            return;
          }
          var params = new URLSearchParams(window.location.search || '');
          if (String(params.get('debug') || '').toLowerCase() === 'true') {
            panel.hidden = false;
          }
        })();
      </script>`,
      site,
      nav,
      `${site.domain}/${entity.entityPageHref || entity.href || ''}`,
      config,
      placeBanner,
      '../../'
    );
  }

  if (entity.type === 'relationship') {
    const relationshipParticipants = connectedCandidates.filter((candidate) => candidate.type === 'character');
    const relationshipPlaces = connectedCandidates.filter(
      (candidate) => candidate.type === 'environment' || candidate.type === 'landmark'
    );
    const fallbackRelationshipPlaces = continueExploring.filter(
      (candidate) => candidate.type === 'environment' || candidate.type === 'landmark'
    );

    const primaryPerson = relationshipParticipants[0] || null;
    const secondaryPerson = relationshipParticipants[1] || null;
    const relationshipStorySourceMatch = String(storyText || '').match(/Relationship Function:\s*([\s\S]*)/i);
    const relationshipStorySource = relationshipStorySourceMatch && relationshipStorySourceMatch[1]
      ? relationshipStorySourceMatch[1]
      : String(storyText || '').replace(/^.*?Relationship Function:\s*/i, '');
    const relationshipStoryLine = toWarmExcerpt(
      relationshipStorySource,
      primaryPerson && secondaryPerson
        ? `${primaryPerson.name} and ${secondaryPerson.name} show how neighbors make room for each other in small, steady ways.`
        : `${entityLabel} is one of the shared connections that helps Hawkins Hollow feel welcoming and real.`,
      240
    );

    const participantCards = relationshipParticipants.length === 0
      ? '<p>Named neighbors for this connection will appear here as mapping expands.</p>'
      : `<div class="start-here-grid">${relationshipParticipants.slice(0, 6).map((candidate) => {
        const name = normalizeEntityLabel(candidate.name || 'Neighbor', candidate.id);
        const firstName = name.split(' ')[0];
        const note = toWarmExcerpt(
          candidate.excerpt || candidate.description,
          `${firstName} helps this connection stay warm, clear, and easy to step into.`,
          150
        );
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        return `<article class="start-here-item">
          <p class="eyebrow">Neighbor in this connection</p>
          <h3>${href ? `<a href="${href}">${name}</a>` : name}</h3>
          <p>${note}</p>
        </article>`;
      }).join('')}</div>`;

    const placeCandidates = relationshipPlaces.length > 0
      ? relationshipPlaces
      : fallbackRelationshipPlaces;
    const placeList = placeCandidates.length === 0
      ? '<p>Connected places are still being mapped for this relationship.</p>'
      : `<ul>${placeCandidates.slice(0, 8).map((candidate) => {
        const label = normalizeEntityLabel(candidate.name || candidate.id, candidate.id);
        const typeLabel = candidate.type === 'landmark' ? 'Landmark' : 'Place';
        const href = candidate.entityPageHref ? `../../${candidate.entityPageHref}` : '';
        return `<li>${href ? `<a href="${href}">${label}</a>` : label} (${typeLabel})</li>`;
      }).join('')}</ul>`;

    const relationshipNextLabel = primaryContinuation && primaryContinuation.name
      ? `Continue with ${primaryContinuation.name}`
      : 'Continue exploring Hawkins Hollow';
    const relationshipPrimaryButton = primaryContinuation && primaryContinuation.entityPageHref
      ? `<p><a class="button" href="../../${primaryContinuation.entityPageHref}">${relationshipNextLabel}</a></p>`
      : '<p><a class="button" href="../../map.html">Open the map</a></p>';

    return renderLayout(
      entityLabel,
      `Meet the shared connection in ${entityLabel} and choose a gentle next step through Hawkins Hollow.`,
      `<section class="content-card" aria-labelledby="relationship-arrival">
        <p class="eyebrow">Shared connection</p>
        <h1 id="relationship-arrival">Spend a moment with ${entityLabel}</h1>
        <p>${relationshipStoryLine}</p>
        <p><strong>Who this is for:</strong> Families and readers who want to understand how neighbors support one another in everyday moments.</p>
        <p><strong>Why this matters:</strong> This connection helps the wider story world feel steady, relational, and welcoming.</p>
        <p>
          <a class="button" href="../../characters.html">Meet the neighbors</a>
          <a class="button" href="../../map.html">Open the map</a>
          <a class="button" href="../../storybook-shelf.html">Read a story</a>
        </p>
      </section>

      <section class="content-card" aria-labelledby="relationship-neighbors">
        <h2 id="relationship-neighbors">Who you'll meet in this connection</h2>
        ${participantCards}
      </section>

      <section class="content-card" aria-labelledby="relationship-places">
        <h2 id="relationship-places">Where this connection often appears</h2>
        <p>Follow one nearby place to watch this relationship in context.</p>
        ${placeList}
      </section>

      <section class="content-card" aria-labelledby="relationship-next-step">
        <h2 id="relationship-next-step">Choose your next step</h2>
        <p>${continuationIntro}</p>
        ${relationshipPrimaryButton}
        <p>Or choose another path:</p>
        ${continueHtml}
      </section>

      <section class="content-card" aria-labelledby="developer-mode">
        <details>
          <summary id="developer-mode"><strong>Developer Mode:</strong> relationship metadata and provenance</summary>
          <section class="content-card" aria-labelledby="relationship-identity">
            <h3 id="relationship-identity">Identity</h3>
            ${identityRows.join('')}
          </section>

          <section class="content-card" aria-labelledby="relationship-canon">
            <h3 id="relationship-canon">Canonical excerpt</h3>
            <p>${storyText || 'Canonical relationship details will appear here as ingestion expands.'}</p>
          </section>

          <section class="content-card" aria-labelledby="relationship-connections">
            <h3 id="relationship-connections">Graph connections</h3>
            ${connectionsHtml}
          </section>
        </details>
      </section>

      <aside id="entity-debug-panel" class="content-card entity-debug-panel" hidden>
        <h2>Developer Provenance Panel</h2>
        <p>This panel is shown because <code>?debug=true</code> is present.</p>
        <h3>Identity</h3>
        <p><strong>Node ID:</strong> ${nodeId}</p>
        <p><strong>Entity Path:</strong> ${(entity.entityPageHref || entity.href || 'n/a')}</p>

        <h3>Source Canon</h3>
        ${debugNodeProvenance}

        <h3>Graph Connections</h3>
        ${debugEdges}

        <h3>Generated Page</h3>
        <p>Renderer: <code>renderUniversalEntityPage</code></p>
        <p>Graph source: <code>generated/entity-graph.json</code></p>
        <p>Entity source: <code>generated/entity-index.json</code></p>
      </aside>

      <script>
        (function () {
          var panel = document.getElementById('entity-debug-panel');
          if (!panel) {
            return;
          }
          var params = new URLSearchParams(window.location.search || '');
          if (String(params.get('debug') || '').toLowerCase() === 'true') {
            panel.hidden = false;
          }
        })();
      </script>`,
      site,
      nav,
      `${site.domain}/${entity.entityPageHref || entity.href || ''}`,
      config,
      null,
      '../../'
    );
  }

  return renderLayout(
    entityLabel,
    `Entity profile for ${entityLabel}`,
    `<section class="content-card">
      <h1>${entityLabel}</h1>
      ${identityRows.join('')}
    </section>

    <section class="content-card">
      <h2>Story</h2>
      <p>${storyText || 'Canonical story details will appear here as ingestion expands.'}</p>
    </section>

    <section class="content-card">
      <h2>Connections</h2>
      ${connectionsHtml}
    </section>

    <section class="content-card">
      <h2>Resources</h2>
      ${resourceLinks.join(' ')}
    </section>

    <section class="content-card">
      <h2>${continuationHeading}</h2>
      <p>${continuationIntro}</p>
      ${primaryContinuationButton}
      <p>${isPlaceLikeEntity ? (placeNeighborCandidates.length > 0 ? 'Or meet another neighbor from this place:' : 'Or choose another nearby path:') : 'Nearby paths:'}</p>
      ${continueHtml}
    </section>

    <aside id="entity-debug-panel" class="content-card entity-debug-panel" hidden>
      <h2>Developer Provenance Panel</h2>
      <p>This panel is shown because <code>?debug=true</code> is present.</p>
      <h3>Identity</h3>
      <p><strong>Node ID:</strong> ${nodeId}</p>
      <p><strong>Entity Path:</strong> ${(entity.entityPageHref || entity.href || 'n/a')}</p>

      <h3>Source Canon</h3>
      ${debugNodeProvenance}

      <h3>Graph Connections</h3>
      ${debugEdges}

      <h3>Generated Page</h3>
      <p>Renderer: <code>renderUniversalEntityPage</code></p>
      <p>Graph source: <code>generated/entity-graph.json</code></p>
      <p>Entity source: <code>generated/entity-index.json</code></p>
    </aside>

    <script>
      (function () {
        var panel = document.getElementById('entity-debug-panel');
        if (!panel) {
          return;
        }
        var params = new URLSearchParams(window.location.search || '');
        if (String(params.get('debug') || '').toLowerCase() === 'true') {
          panel.hidden = false;
        }
      })();
    </script>`,
    site,
    nav,
    `${site.domain}/${entity.entityPageHref || entity.href || ''}`,
    config,
    null,
    '../../'
  );
}

function renderSearchSection() {
  return `<section class="content-card" aria-labelledby="library-search">
      <h2 id="library-search">Search Hawkins Hollow</h2>
      <p>Search across books, characters, places, relationships, and activities from one shared memory.</p>
      <label for="library-search-input"><strong>Search by title, name, ID, series, ASIN, or keywords</strong></label>
      <input id="library-search-input" class="search-input" type="search" placeholder="Try: Lillian, Zy'ar, HH-B-0001" />
      <p class="search-hint">We found a few different paths to explore around Hawkins Hollow.</p>
      <div id="library-search-results" class="search-results" aria-live="polite"></div>
    </section>

    <script>
      (function () {
        const input = document.getElementById('library-search-input');
        const resultsEl = document.getElementById('library-search-results');
        if (!input || !resultsEl) {
          return;
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderMessage(message) {
          resultsEl.innerHTML = '<p>' + escapeHtml(message) + '</p>';
        }

        function getTypeLabel(type) {
          const labels = {
            book: '📚 Books',
            character: '👧 Characters',
            environment: '🌳 Places',
            landmark: '📍 Landmarks',
            relationship: '❤️ Relationships',
            activity: '🎁 Activities',
            resource: '🧰 Resources'
          };
          return labels[type] || ('🔎 ' + (type || 'Other'));
        }

        function groupRecordsByType(records) {
          return records.reduce(function (groups, item) {
            const record = item && item.record ? item.record : item;
            const key = (record.type || 'other').toLowerCase();
            if (!groups[key]) {
              groups[key] = [];
            }
            groups[key].push(item);
            return groups;
          }, {});
        }

        function getTypeSortRank(type) {
          const order = {
            book: 1,
            character: 2,
            environment: 3,
            landmark: 4,
            relationship: 5,
            activity: 6,
            resource: 7,
            other: 8
          };
          return order[type] || 99;
        }

        function toSearchableText(record) {
          return [
            record.type,
            record.id,
            record.title,
            record.series,
            record.asin,
            (record.keywords || []).join(' ')
          ]
            .join(' ')
            .toLowerCase();
        }

        function summarizeRecord(record, graphByNodeId, graphEdgesByNodeId) {
          const type = (record.type || '').toLowerCase();
          const nodeId = type && record.id ? (type + ':' + record.id) : '';
          const nodeEdges = nodeId && graphEdgesByNodeId[nodeId] ? graphEdgesByNodeId[nodeId] : [];
          const node = nodeId && graphByNodeId[nodeId] ? graphByNodeId[nodeId] : null;

          if (type === 'book') {
            return {
              kind: 'Book',
              summary: nodeEdges.length > 0
                ? ('Connected to ' + nodeEdges.length + ' entity relationship(s).')
                : 'Cataloged in Hawkins Hollow library index.'
            };
          }

          if (type === 'character') {
            const friendNames = nodeEdges
              .map(function (edge) {
                const otherId = edge.from === nodeId ? edge.to : edge.from;
                const other = graphByNodeId[otherId];
                return other && other.entityType === 'character' ? other.name : '';
              })
              .filter(Boolean)
              .slice(0, 3);
            const friendLine = friendNames.length > 0
              ? ('Friends and neighbors: ' + friendNames.join(', ') + (friendNames.length >= 3 ? '...' : '') + '.')
              : 'Character connections are growing as canon extraction expands.';
            return {
              kind: 'Character',
              summary: friendLine
            };
          }

          if (type === 'environment' || type === 'landmark') {
            const visitorNames = nodeEdges
              .filter(function (edge) { return edge.relationshipType === 'mentions-character'; })
              .map(function (edge) {
                const otherId = edge.from === nodeId ? edge.to : edge.from;
                const other = graphByNodeId[otherId];
                return other && other.entityType === 'character' ? other.name : '';
              })
              .filter(Boolean)
              .slice(0, 4);
            const visitorLine = visitorNames.length > 0
              ? ('Visited by ' + visitorNames.join(', ') + (visitorNames.length >= 4 ? '...' : '') + '.')
              : 'Place references are ready for more story links.';
            return {
              kind: type === 'environment' ? 'Place' : 'Landmark',
              summary: visitorLine
            };
          }

          if (type === 'relationship') {
            return {
              kind: 'Relationship',
              summary: nodeEdges.length > 0
                ? ('Maps to ' + nodeEdges.length + ' graph connection(s).')
                : 'Relationship indexed and ready for deeper linking.'
            };
          }

          if (type === 'activity') {
            return {
              kind: 'Activity',
              summary: 'Activity entries will grow as companion package extraction expands.'
            };
          }

          return {
            kind: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Entity',
            summary: node
              ? ('Connected to ' + nodeEdges.length + ' graph relationship(s).')
              : 'Indexed in Hawkins Hollow memory.'
          };
        }

        function renderResults(records, query) {
          if (!query) {
            renderMessage('Start typing to search the library index.');
            return;
          }

          if (records.length === 0) {
            renderMessage('No matches found for "' + query + '".');
            return;
          }

          const limitedRecords = records.slice(0, 60);
          const grouped = groupRecordsByType(limitedRecords);
          const groupKeys = Object.keys(grouped).sort(function (a, b) {
            const rankDiff = getTypeSortRank(a) - getTypeSortRank(b);
            if (rankDiff !== 0) {
              return rankDiff;
            }
            return a.localeCompare(b);
          });

          const groupsHtml = groupKeys.map(function (type) {
            const items = grouped[type].map(function (item) {
              const record = item.record || item;
              const details = item.details || { kind: record.type || 'Entity', summary: '' };
              const meta = [record.id, record.series].filter(Boolean).join(' | ');
              const href = record.href || '#';
              return '<article class="search-result-item">'
                + '<h4><a href="' + escapeHtml(href) + '">' + escapeHtml(record.title || record.id || 'Untitled') + '</a></h4>'
                + '<p class="search-result-kind">' + escapeHtml(details.kind || 'Entity') + '</p>'
                + (meta ? '<p>' + escapeHtml(meta) + '</p>' : '')
                + (record.asin ? '<p>ASIN: ' + escapeHtml(record.asin) + '</p>' : '')
                + (details.summary ? '<p class="search-result-summary">' + escapeHtml(details.summary) + '</p>' : '')
                + '</article>';
            }).join('');

            return '<section class="search-group">'
              + '<h3>' + escapeHtml(getTypeLabel(type)) + ' (' + grouped[type].length + ')</h3>'
              + items
              + '</section>';
          }).join('');

          resultsEl.innerHTML = '<p><strong>' + records.length + '</strong> result(s)</p>' + groupsHtml;
        }

        Promise.all([
          fetch('generated/search-index.json').then(function (response) { return response.json(); }),
          fetch('generated/entity-graph.json').then(function (response) { return response.json(); }).catch(function () { return { nodes: [], edges: [] }; })
        ])
          .then(function (payloads) {
            const payload = payloads[0] || { records: [] };
            const graph = payloads[1] || { nodes: [], edges: [] };
            const records = Array.isArray(payload.records) ? payload.records : [];
            const graphByNodeId = (graph.nodes || []).reduce(function (map, node) {
              map[node.id] = node;
              return map;
            }, {});
            const graphEdgesByNodeId = (graph.edges || []).reduce(function (map, edge) {
              if (!map[edge.from]) {
                map[edge.from] = [];
              }
              if (!map[edge.to]) {
                map[edge.to] = [];
              }
              map[edge.from].push(edge);
              map[edge.to].push(edge);
              return map;
            }, {});
            renderMessage('Start typing to search the library index.');
            input.addEventListener('input', function () {
              const query = input.value.trim().toLowerCase();
              const terms = query.split(/\s+/).filter(Boolean);
              const filtered = records.filter(function (record) {
                const searchable = toSearchableText(record);
                return terms.every(function (term) {
                  return searchable.indexOf(term) !== -1;
                });
              });
              renderResults(filtered.map(function (record) {
                const details = summarizeRecord(record, graphByNodeId, graphEdgesByNodeId);
                return {
                  record: record,
                  details: details
                };
              }), input.value.trim());
            });
          })
          .catch(function () {
            renderMessage('Search index could not be loaded.');
          });
      })();
    </script>`;
}

function buildAmazonLookup(amazonIndex) {
  const map = new Map();
  for (const record of (amazonIndex && amazonIndex.records) || []) {
    if (record && record.id) {
      map.set(record.id.toUpperCase(), record);
    }
  }
  return map;
}

function getSeriesBooksFromLibraryIndex(libraryIndex, seriesName) {
  return ((libraryIndex && libraryIndex.books) || [])
    .filter((book) => (book.series || '').toLowerCase() === seriesName.toLowerCase())
    .sort((a, b) => a.id.localeCompare(b.id));
}

function renderSeriesDoorwayFromLibraryIndex(libraryIndex, seriesName, audienceText, experienceText, reassuranceText, invitationLabel) {
  const books = getSeriesBooksFromLibraryIndex(libraryIndex, seriesName);
  const starter = books[0] || null;
  const starterLine = starter
    ? `<p><strong>Start with:</strong> <a href="${getBookPageHref(starter)}">${getBookPublicTitle(starter) || getCanonicalBookId(starter)}</a></p>`
    : '<p><strong>Start with:</strong> <a href="#library-search">Use search to find a story in this collection.</a></p>';
  const invitationTitle = invitationLabel || "When you're finished";
  const reassuranceLine = reassuranceText
    ? `<p><strong>${invitationTitle}:</strong> ${reassuranceText}</p>`
    : '';

  return `<p><strong>Who it is for:</strong> ${audienceText}</p>
    <p><strong>Experience:</strong> ${experienceText}</p>
    ${starterLine}
    ${reassuranceLine}`;
}

function renderSeriesCardsFromLibraryIndex(libraryIndex, seriesName, amazonLookup) {
  const books = getSeriesBooksFromLibraryIndex(libraryIndex, seriesName);

  if (books.length === 0) {
    return '<p class="status-label">No books discovered yet in this series.</p>';
  }

  return `<div class="card-grid">${books
    .map((book) => {
      const pdf = (book.files || []).find((file) => file.toLowerCase().endsWith('.pdf'));
      const fileCount = (book.files || []).length;
      const detailHref = getBookPageHref(book);
      const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
      const links = amazon && amazon.links ? amazon.links : {};
      const buttons = [
        links.paperback ? `<a class="button" href="${links.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>` : '',
        links.hardcover ? `<a class="button" href="${links.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>` : '',
        links.kindle ? `<a class="button" href="${links.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>` : ''
      ]
        .filter((value) => Boolean(value))
        .join(' ');
      const amazonLine = buttons || (amazon && amazon.url
        ? `<a href="${amazon.url}" target="_blank" rel="noopener noreferrer">View on Amazon</a>`
        : 'Retail purchase links are not available in this release.');
      const canonicalId = getCanonicalBookId(book);
        const publicTitle = getBookPublicTitle(book) || canonicalId;
      return `<article class="book-card">
          <h3>${publicTitle}</h3>
          <p><strong>Canonical ID:</strong> ${canonicalId}</p>
          <p><strong>Public Title:</strong> ${publicTitle}</p>
          <p><strong>Series:</strong> ${book.series || 'Unknown'}</p>
          <p><strong>Files Indexed:</strong> ${fileCount}</p>
          <p>${pdf ? 'PDF discovered in Library' : 'Reader PDF is not listed in the current Library index.'}</p>
          <p>${amazonLine}</p>
          <a class="button" href="${detailHref}">Open Book Details</a>
        </article>`;
    })
    .join('')}</div>`;
}

function renderIndexedBookDetailPage(book, site, nav, config, amazonLookup, experienceContext = {}) {
  const detailPath = getBookPageHref(book);
  const canonicalId = getCanonicalBookId(book);
  const normalizedBookForCopy = {
    ...book,
    slug: String(book && book.slug ? book.slug : canonicalId).toLowerCase(),
    title: getBookPublicTitle(book) || canonicalId,
    seriesSlug: resolveSeriesSlug(book)
  };
  const files = (book.files || []).sort();
  const previewFiles = files.slice(0, 20);
  const amazon = amazonLookup ? amazonLookup.get((book.id || '').toUpperCase()) : null;
  const bookModelByCanonicalId = experienceContext.bookModelByCanonicalId || new Map();
  const characterByCanonicalId = experienceContext.characterByCanonicalId || new Map();
  const environmentByCanonicalId = experienceContext.environmentByCanonicalId || new Map();
  const experienceBook = bookModelByCanonicalId.get(canonicalId.toUpperCase()) || null;
  const bannerBook = experienceBook || bookModelByCanonicalId.get(canonicalId.toUpperCase()) || book;
  const fileTypeSummary = ((book.fileTypes || [])
    .map((item) => `${item.extension.toUpperCase()}: ${item.count}`)
    .join(' | ')) || 'No file type data';

  const amazonBlock = amazon
    ? `<p><strong>Publication Status:</strong> ${amazon.status || 'Unknown'}</p>
      <p><strong>Publication Date:</strong> ${amazon.publicationDate || 'Unknown'}</p>
      <p><strong>Amazon Price:</strong> ${amazon.price || 'Unknown'}</p>
      <p><strong>Paperback ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.paperbackAsin) || 'Not provided'}</p>
      <p><strong>Hardcover ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.hardcoverAsin) || 'Not provided'}</p>
      <p><strong>Kindle ASIN:</strong> ${(amazon.identifiers && amazon.identifiers.kindleAsin) || 'Not provided'}</p>
      <p><strong>ISBN:</strong> ${(amazon.identifiers && amazon.identifiers.isbn) || 'Not provided'}</p>
      <p><strong>ISBN-10:</strong> ${(amazon.identifiers && amazon.identifiers.isbn10) || 'Not provided'}</p>
      <p><strong>ISBN-13:</strong> ${(amazon.identifiers && amazon.identifiers.isbn13) || 'Not provided'}</p>
      <p><strong>Series (Catalog):</strong> ${amazon.series || book.series || 'Unknown'}</p>
      <p>
        ${amazon.links && amazon.links.paperback ? `<a class="button" href="${amazon.links.paperback}" target="_blank" rel="noopener noreferrer">Buy Paperback</a>` : ''}
        ${amazon.links && amazon.links.hardcover ? `<a class="button" href="${amazon.links.hardcover}" target="_blank" rel="noopener noreferrer">Buy Hardcover</a>` : ''}
        ${amazon.links && amazon.links.kindle ? `<a class="button" href="${amazon.links.kindle}" target="_blank" rel="noopener noreferrer">Buy Kindle</a>` : ''}
      </p>
      ${amazon.url ? `<p><a href="${amazon.url}" target="_blank" rel="noopener noreferrer">Primary Amazon Link</a></p>` : ''}`
    : '<p><strong>Amazon Listing:</strong> No workbook match found for this book ID in this release.</p>';

  const fileList = previewFiles
    .map((file) => `<li><code>${file}</code></li>`)
    .join('');

  const isbnValues = amazon && amazon.identifiers
    ? [amazon.identifiers.isbn13, amazon.identifiers.isbn10, amazon.identifiers.isbn].filter((value) => Boolean(value))
    : [];
  const offers = [];
  if (amazon && amazon.links) {
    if (amazon.links.paperback) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.paperback,
        availability: mapStatusToAvailability(amazon.status),
        itemCondition: 'https://schema.org/NewCondition',
        category: 'Paperback',
        price: (amazon.price || '').replace(/[^0-9.]/g, '') || undefined,
        priceCurrency: amazon.price ? 'USD' : undefined
      });
    }
    if (amazon.links.hardcover) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.hardcover,
        availability: mapStatusToAvailability(amazon.status),
        itemCondition: 'https://schema.org/NewCondition',
        category: 'Hardcover'
      });
    }
    if (amazon.links.kindle) {
      offers.push({
        '@type': 'Offer',
        url: amazon.links.kindle,
        availability: mapStatusToAvailability(amazon.status),
        category: 'EBook'
      });
    }
  }

  const jsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: getBookPublicTitle(book) || getCanonicalBookId(book),
    identifier: getCanonicalBookId(book),
    url: `${site.domain}/${detailPath}`,
    inLanguage: 'en',
    bookEdition: amazon && amazon.edition ? amazon.edition : undefined,
    isbn: isbnValues.length > 0 ? isbnValues : undefined,
    isPartOf: book.series
      ? {
          '@type': 'CreativeWorkSeries',
          name: book.series
        }
      : undefined,
    offers: offers.length > 0 ? offers : undefined
  };
  const jsonLd = JSON.stringify(jsonLdObject, null, 2);

  const experienceCharacters = Array.isArray(experienceBook && experienceBook.characters)
    ? experienceBook.characters
    : [];
  const experienceEnvironments = Array.isArray(experienceBook && experienceBook.environments)
    ? experienceBook.environments
    : [];
  const resolvedCharacter = experienceCharacters
    .map((characterId) => characterByCanonicalId.get(String(characterId || '').toUpperCase()))
    .find((character) => Boolean(character)) || null;
  const resolvedEnvironment = experienceEnvironments
    .map((environmentId) => environmentByCanonicalId.get(String(environmentId || '').toUpperCase()))
    .find((environment) => Boolean(environment)) || null;
  const storyCharacters = resolveStoryCharactersForBook(experienceBook || book, characterByCanonicalId);
  const storyCharactersPageHref = storyCharacters.length > 0 ? `${toBookPageSlug(book)}-characters.html` : '';
  const rawSynopsisText = String((experienceBook && (experienceBook.summary || experienceBook.description)) || '').trim();
  const rawInvitationText = String((experienceBook && experienceBook.description) || '').trim();
  const synopsisText = isGenericStoryPlaceholder(rawSynopsisText) ? '' : rawSynopsisText;
  const invitationText = isGenericStoryPlaceholder(rawInvitationText) ? '' : rawInvitationText;
  const characterList = storyCharacters
    .map((character) => `<li><a href="../characters/${character.slug}.html">${character.name}</a></li>`)
    .join('');
  const storyCharacterSection = storyCharacters.length > 0
    ? `<p><strong>Characters you will meet in this story:</strong></p><ul>${characterList}</ul>`
    : '';
  const environmentList = experienceEnvironments
    .map((environmentId) => {
      const environment = environmentByCanonicalId.get(String(environmentId || '').toUpperCase());
      if (!environment) {
        return '';
      }
      return `<li><a href="../${getEntityPageHref('environment', environment.id, environment.name)}">${environment.name}</a></li>`;
    })
    .filter((value) => Boolean(value))
    .join('');

  const isSpencerExperiencePass = canonicalId.toUpperCase() === 'HH-B-0001';
  const experienceIntroCard = isSpencerExperiencePass
    ? `<section class="content-card" aria-labelledby="story-introduction">
      <h2 id="story-introduction">Welcome. Let us introduce you to Spencer.</h2>
      ${invitationText ? `<p><em>${invitationText}</em></p>` : ''}
      ${synopsisText ? `<p>${synopsisText}</p>` : ''}
      ${storyCharacterSection || '<p><strong>Characters you will meet in this story:</strong></p><ul><li>Spencer Field Mouse</li><li>Alice Mole</li></ul>'}
      <p><strong>You'll visit</strong></p>
      <ul>${environmentList || '<li>Story Stump</li><li>Pond Edge</li><li>Farmhouse Porch</li>'}</ul>
      <p><strong>Perfect for</strong></p>
      <p>Beginning readers who enjoy gentle adventures, kind friendships, and stories that celebrate curiosity.</p>
      <p><strong>Where to go next</strong></p>
      <p>Keep following the Storybooks path by meeting Spencer again, visiting a familiar place, or choosing another story.</p>
      <p>
        <a class="button" href="../storybook-shelf.html">Return to the Storybook Shelf</a>
        <a class="button" href="../characters/spencer-field-mouse.html">Meet Spencer</a>
        <a class="button" href="../${getEntityPageHref('environment', 'ENV-0028', 'Story Stump')}">Explore the Story Stump</a>
        <a class="button" href="../books.html">Browse more stories</a>
      </p>
    </section>`
    : '';

  const isStorybookLike = String(book && book.series || '').toLowerCase().includes('storybook') || String((book && book.seriesCode) || '').toUpperCase() === 'A';
  const continuationHeading = resolvedCharacter
    ? `Meet ${resolvedCharacter.name}`
    : resolvedEnvironment
      ? `Visit ${resolvedEnvironment.name}`
      : (isStorybookLike ? 'Continue the story' : 'Continue exploring');
  const continuationMessage = resolvedCharacter
    ? `This is the next place to turn when you want to know more about the curious heart of this story.`
    : resolvedEnvironment
      ? `This place helps the story feel more real, and it often opens the door to the next chapter of the adventure.`
      : 'This next step keeps the story feeling alive after the final page.';
  const seriesSlug = resolveSeriesSlug(normalizedBookForCopy);
  const seriesPageHref = seriesSlug ? `../${getSeriesPageHref(seriesSlug)}` : '../books.html';
  const seriesReturnLabel = seriesSlug === 'storybooks'
    ? 'Return to the Storybook Shelf'
    : `Return to ${book.series || 'this series'}`;
  const continuationPrimaryLink = `<a class="button" href="${seriesPageHref}">${seriesReturnLabel}</a>`;
  const continuationSecondaryLinks = `<a class="button" href="../map.html">Explore more of Hawkins Hollow</a>`;
  const continuationCard = `<section class="content-card" aria-labelledby="story-continue">
      <h2 id="story-continue">${continuationHeading}</h2>
      <p>${continuationMessage}</p>
      <p>${continuationPrimaryLink}</p>
      <p>${continuationSecondaryLinks ? `<strong>Also:</strong> ${continuationSecondaryLinks}</p>` : ''}
    </section>`;

  const generatedInvitation = getBookSpecificInvitation(normalizedBookForCopy, { mode: 'detail' });
  const pageDescription = isSpencerExperiencePass
    ? (invitationText || generatedInvitation)
    : (invitationText || generatedInvitation);

  const storyIntroLead = (invitationText || synopsisText || generatedInvitation).trim();
  const storyIntroBody = synopsisText || getBookDetailBody(normalizedBookForCopy);
  const storyGuidanceBlock = experienceBook ? renderStoryGuidanceBlock(experienceBook) : '';
  const isSpencerBook = String(getBookPublicTitle(book) || canonicalId).toLowerCase().includes('spencer');
  const primaryStoryCharacter = storyCharacters[0] || null;
  const primaryStoryCharacterFirstName = primaryStoryCharacter
    ? String(primaryStoryCharacter.name || '').split(' ')[0]
    : '';
  const storyActionLabel = primaryStoryCharacter
    ? (storyCharacters.length > 1
      ? `Meet this story's characters`
      : (primaryStoryCharacterFirstName ? `Meet ${primaryStoryCharacterFirstName}` : 'Meet this story\'s character'))
    : isSpencerBook
      ? 'Meet Spencer'
      : 'Meet the characters';
  const storyActionHref = primaryStoryCharacter
    ? `${storyCharactersPageHref || `../characters/${primaryStoryCharacter.slug}.html`}`
    : isSpencerBook
      ? '../characters/spencer-field-mouse.html'
      : '../characters.html';
  const amazonReadHref = (amazon && amazon.links && (amazon.links.paperback || amazon.links.hardcover || amazon.links.kindle))
    || (amazon && amazon.url)
    || seriesPageHref;
  const amazonReadAttrs = String(amazonReadHref).startsWith('http')
    ? ' target="_blank" rel="noopener noreferrer"'
    : '';
  const storyIntroCard = `<section class="content-card" aria-labelledby="story-intro-heading">
      <p class="eyebrow">Storybook</p>
      <h2 id="story-intro-heading">${getBookPublicTitle(book) || canonicalId}</h2>
      <p class="story-intro-lead"><em>${storyIntroLead}</em></p>
      <p>${storyIntroBody}</p>
      ${storyCharacterSection}
      ${storyGuidanceBlock}
      <p>
        <a class="button" href="${amazonReadHref}"${amazonReadAttrs}>Read this story</a>
        <a class="button" href="${storyActionHref}">${storyActionLabel}</a>
      </p>
    </section>`;

  return renderLayout(
    `${getBookPublicTitle(book) || canonicalId}`,
    pageDescription,
    `${experienceIntroCard}${storyIntroCard}${continuationCard}
    <script type="application/ld+json">${jsonLd}</script>`,
    site,
    nav,
    `${site.domain}/${detailPath}`,
    config,
    getBookCoverBanner(bannerBook),
    '../'
  );
}

function renderLayout(title, description, content, site, nav, canonicalUrl, config, banner, pathPrefix = '') {
  const devBanner = config.previewMode
    ? `<section class="dev-banner"><strong>${config.previewMessage}</strong><br />${config.previewSubmessage}</section>`
    : '';
  const bannerTitle = banner ? banner.title || title : title;
  const bannerSubtitle = banner ? banner.subtitle || '' : '';
  const bannerAlt = banner && banner.alt ? banner.alt : bannerTitle;
  const bannerIdAttr = banner && banner.bannerId ? ` data-banner-id="${banner.bannerId}"` : '';
  const bannerImage = banner && banner.image
    ? `<img class="page-banner-image" src="${pathPrefix}${banner.image}" alt="${bannerAlt}"${bannerIdAttr} />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} | ${site.siteName}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="stylesheet" href="${pathPrefix}styles.css" />
  </head>
  <body>
    ${devBanner}
    <header class="site-header">
      <div class="brand">${site.siteName}</div>
      <nav class="site-nav" aria-label="Primary navigation">
        ${nav.items.map((item) => `<a href="${pathPrefix}${item.href}">${item.label}</a>`).join('')}
      </nav>
    </header>

    <main class="page-shell">
      ${bannerTitle ? `<section class="page-banner">${bannerImage}<div class="page-banner-copy"><h1>${bannerTitle}</h1>${bannerSubtitle ? `<p>${bannerSubtitle}</p>` : ''}</div></section>` : ''}
      ${content}
    </main>

    <footer class="site-footer">
      <p>${site.footerText}</p>
    </footer>
  </body>
</html>`;
}

function renderLandingPage(page, site, nav, config, banner) {
  return renderLayout(
    page.title,
    site.tagline,
    `<section class="content-card" aria-labelledby="act-one">
      <p class="eyebrow">Act One</p>
      <h2 id="act-one">Welcome Home</h2>
      <section class="hero-card">
        <p class="eyebrow">Welcome to</p>
        <h1>${site.siteName}</h1>
        <p class="welcome-home-line">Look who's home!</p>
        <p>Hawkins Hollow is a neighborhood first and a catalog second. Visitors can meet people, explore places, and gather ideas for family reading before choosing a book. The goal is to help every child feel seen, calm, and curious from the first click.</p>
        <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
      </section>

      <section class="content-card seasonal-note" id="seasonal-note" aria-live="polite">
        <h3 id="seasonal-title">Welcome Home This Season</h3>
        <p id="seasonal-copy">The porch light is on, and Hawkins Hollow is ready for your next visit.</p>
      </section>

      <section class="content-card seasonal-feature" id="seasonal-feature" aria-labelledby="seasonal-feature-title">
        <h3 id="seasonal-feature-title">Grandpa's Thought for Today</h3>
        <div id="seasonal-feature-body"></div>
      </section>
    </section>

    <section class="content-card" aria-labelledby="act-two">
      <p class="eyebrow">Act Two</p>
      <h2 id="act-two">Where would you like to begin today?</h2>
      <p>Choose any path. You do not have to start in one place to belong here.</p>
      <p>Some visitors begin with a character they already love, while others start with a place, a family activity, or a seasonal moment. This section helps each person find a next step that matches their day.</p>
      <div class="start-anywhere-grid">
        <a class="start-anywhere-item" href="books.html" aria-label="Read a Story">
          <p class="start-anywhere-icon" aria-hidden="true">📚</p>
          <h3>Read a Story</h3>
          <p>Browse books, reading paths, and family-friendly story collections.</p>
        </a>

        <a class="start-anywhere-item" href="characters.html" aria-label="Meet a Character">
          <p class="start-anywhere-icon" aria-hidden="true">👧</p>
          <h3>Meet a Character</h3>
          <p>Get to know the friends and families who make Hawkins Hollow feel like home.</p>
        </a>

        <a class="start-anywhere-item" href="map.html" aria-label="Visit a Place">
          <p class="start-anywhere-icon" aria-hidden="true">🌳</p>
          <h3>Visit a Place</h3>
          <p>Explore the map and step into familiar places like Old Oak and the Reading Stump.</p>
        </a>

        <a class="start-anywhere-item" href="books.html" aria-label="Explore a Friendship">
          <p class="start-anywhere-icon" aria-hidden="true">❤️</p>
          <h3>Explore a Friendship</h3>
          <p>Use universal search to discover relationships and connected journeys.</p>
        </a>

        <a class="start-anywhere-item" href="resources.html" aria-label="Find a Family Activity">
          <p class="start-anywhere-icon" aria-hidden="true">🎁</p>
          <h3>Find a Family Activity</h3>
          <p>Find resources and shared activities that help stories grow into conversations.</p>
        </a>

        <a class="start-anywhere-item" href="community.html" aria-label="Celebrate a Season">
          <p class="start-anywhere-icon" aria-hidden="true">🎄</p>
          <h3>Celebrate a Season</h3>
          <p>Wander seasonal moments, gatherings, and neighborhood traditions.</p>
        </a>
      </div>
    </section>

    <section class="content-card" aria-labelledby="series-spotlight">
      <p class="eyebrow">Choose a shelf</p>
      <h2 id="series-spotlight">Choose the kind of experience you want today</h2>
      <p>Each series is a doorway into Hawkins Hollow. Choose one and begin there.</p>
      <p>These shelves are organized by reading moment, so bedtime stories, first-reader practice, and deeper family conversations each have a clear home.</p>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p>Gentle shared stories for children and grown-ups to read together.</p>
          <p><a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a></p>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p>Growing confidence, one story at a time.</p>
          <p><a class="button" href="first-readers.html">Explore First Readers</a></p>
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p>Longer stories for growing reading independence.</p>
          <p><a class="button" href="second-readers.html">Explore Second Readers</a></p>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p>Quiet stories to end the day with calm and reassurance.</p>
          <p><a class="button" href="bedtime-library.html">Enter the Bedtime Library</a></p>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p>Stories for difficult feelings, comfort, and connection.</p>
          <p><a class="button" href="tender-times.html">Explore Tender Times</a></p>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p>Stories that help families grow side by side.</p>
          <p><a class="button" href="growing-together.html">Explore Growing Together</a></p>
        </article>
      </div>
      <p><a href="books.html">See every series</a></p>
    </section>

    <section class="content-card" aria-labelledby="act-three">
      <p class="eyebrow">Featured Paths</p>
      <h2 id="act-three">If this is your first visit</h2>
      <p>Try one of these gentle pathways and see where your curiosity leads.</p>
      <p>Each path connects a person, a place, and a story so new visitors can understand how the world fits together.</p>
      <p id="todays-wander-copy"><strong>Something Grandpa noticed today:</strong> <span id="todays-wander-kind">Notice</span> - The orchard feels especially peaceful today.</p>
      <p id="todays-wander-invitation">If you feel like a short walk, the path starts there.</p>
      <p><a id="todays-wander-link" class="button" href="map.html">Take This Walk</a></p>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Meet Spencer</h3>
          <p><strong>Path:</strong> Meet Spencer -> Visit Old Oak -> Read Spencer's Sound Trail</p>
          <p><a class="button" href="characters/spencer-field-mouse.html">Begin with Spencer</a></p>
        </article>

        <article class="start-here-item">
          <h3>Looking for Bedtime?</h3>
          <p><strong>Path:</strong> Visit Bedtime Library -> Meet Grandma -> Read Together</p>
          <p><a class="button" href="bedtime-library.html">Begin with Bedtime Library</a></p>
        </article>

        <article class="start-here-item">
          <h3>Family Activity Path</h3>
          <p><strong>Path:</strong> Open Resources -> Pick an activity -> Continue with a related story</p>
          <p><a class="button" href="resources.html">Begin with Resources</a></p>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="act-four">
      <p class="eyebrow">Act Four</p>
      <h2 id="act-four">When you are ready to take a story home</h2>
      <p>Books matter in Hawkins Hollow, but they come after welcome, belonging, and discovery.</p>
      <p>If today's walk introduced a story your family loves, you can bring that title home and keep the conversation going tonight.</p>
      <p>The invitation is simple: explore first, connect deeply, and then choose the books that fit your family best.</p>
      <p>
        <a class="button" href="books.html">Browse Books</a>
        <a class="button" href="storybook-shelf.html">Open the Storybook Shelf</a>
      </p>
    </section>

    <script>
      (function () {
        var titleEl = document.getElementById('seasonal-title');
        var copyEl = document.getElementById('seasonal-copy');
        var featureBodyEl = document.getElementById('seasonal-feature-body');
        if (!titleEl || !copyEl) {
          return;
        }

        var params = new URLSearchParams(window.location.search || '');
        var override = String(params.get('season') || '').toLowerCase();
        var month = new Date().getMonth() + 1;

        function getWeekNumber(date) {
          var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
          var dayNum = d.getUTCDay() || 7;
          d.setUTCDate(d.getUTCDate() + 4 - dayNum);
          var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        }

        function pickSeason() {
          if (override === 'spring' || override === 'summer' || override === 'autumn' || override === 'winter') {
            return override;
          }
          if (month >= 3 && month <= 5) {
            return 'spring';
          }
          if (month >= 6 && month <= 8) {
            return 'summer';
          }
          if (month >= 9 && month <= 11) {
            return 'autumn';
          }
          return 'winter';
        }

        var season = pickSeason();
        var seasonCopy = {
          spring: {
            thoughts: [
              {
                title: 'From the porch this morning',
                copy: 'I noticed a few new flowers along the orchard path this morning. They seem to know spring has finally arrived.'
              },
              {
                title: 'A little note from Grandpa',
                copy: 'The creek has been running a little livelier this week. Feels like the whole Hollow is stretching awake.'
              },
              {
                title: 'From the gate today',
                copy: 'There is a new brightness on the garden rows lately. Makes a person want to take the long way home.'
              },
              {
                title: 'A quiet thought for today',
                copy: 'The mornings have been softer these past few days. Good weather for wandering and wondering.'
              }
            ],
            featureTitle: 'Visit a Place',
            featureHref: 'map.html',
            featureCopy: 'The paths are opening for the season. Start with a place and let the world grow from there.'
          },
          summer: {
            thoughts: [
              {
                title: 'From the porch this morning',
                copy: 'The shade under Old Oak has been mighty comfortable lately. It is a fine place to read together.'
              },
              {
                title: 'A little note from Grandpa',
                copy: 'The paths have been full of long shadows at supper time. Feels like everyone is in no hurry at all.'
              },
              {
                title: 'From the gate today',
                copy: 'I passed the garden fence and heard laughter clear across the lane. That is a good sound to keep around.'
              },
              {
                title: 'A quiet thought for today',
                copy: 'The evenings have been staying with us a little longer. Plenty of time for one more chapter.'
              }
            ],
            featureTitle: 'Read a Story',
            featureHref: 'books.html',
            featureCopy: 'Summer is a good time to slow down, settle in, and read together. A shared story can turn a long evening into a favorite family memory.'
          },
          autumn: {
            thoughts: [
              {
                title: 'From the porch this morning',
                copy: 'The leaves have started telling stories of their own. Sometimes the quiet walks are the best ones.'
              },
              {
                title: 'A little note from Grandpa',
                copy: 'The leaves have been taking their time this year. I rather like that.'
              },
              {
                title: 'From the gate today',
                copy: 'There is a crispness in the air that makes the long path feel friendlier somehow.'
              },
              {
                title: 'A quiet thought for today',
                copy: 'Some days call for a basket, a sweater, and a story read out loud before supper.'
              }
            ],
            featureTitle: 'Explore a Friendship',
            featureHref: 'books.html',
            featureCopy: 'This is a good season for listening closely and following the threads between friends. Stories about relationships feel especially meaningful when the days turn quieter.'
          },
          winter: {
            thoughts: [
              {
                title: 'From the porch this morning',
                copy: 'The kettle is warm, the porch light is on, and there always seems to be room for one more story.'
              },
              {
                title: 'A little note from Grandpa',
                copy: 'The porch has been a little quieter lately. Seems like good weather for one more story.'
              },
              {
                title: 'From the gate today',
                copy: 'There is a stillness over the lane this week that makes every kind word travel farther.'
              },
              {
                title: 'A quiet thought for today',
                copy: 'Cold evenings have a way of gathering folks close. Perfect time to read shoulder to shoulder.'
              }
            ],
            featureTitle: 'Find a Family Activity',
            featureHref: 'resources.html',
            featureCopy: 'Quiet days are perfect for shared activities, family time, and cozy discovery. A small activity and a gentle story can make home feel even warmer.'
          }
        };

        var selected = seasonCopy[season] || seasonCopy.winter;
        var thoughtList = selected.thoughts || [];
        var week = getWeekNumber(new Date());
        var thought = thoughtList.length > 0 ? thoughtList[week % thoughtList.length] : {
          title: 'From the porch today',
          copy: 'The porch light is on, and Hawkins Hollow is ready for your next visit.'
        };

        titleEl.textContent = thought.title;
        copyEl.textContent = thought.copy;
        document.body.classList.add('season-' + season);

        if (featureBodyEl) {
          featureBodyEl.innerHTML = '<p><strong><a href="' + selected.featureHref + '">' + selected.featureTitle + '</a></strong></p>'
            + '<p>' + selected.featureCopy + '</p>';
        }

        var wanderCopyEl = document.getElementById('todays-wander-copy');
        var wanderInvitationEl = document.getElementById('todays-wander-invitation');
        var wanderLinkEl = document.getElementById('todays-wander-link');
        var wanders = [
          {
            mode: 'Notice',
            observation: 'The orchard is especially peaceful this morning.',
            invitation: 'If you feel like a short walk, start there.',
            href: 'map.html',
            cta: 'Take This Walk'
          },
          {
            mode: 'Share',
            observation: 'Spencer has been waiting for another visitor.',
            invitation: 'If you are with someone today, say hello together and see where one friendship leads.',
            href: 'characters/spencer-field-mouse.html',
            cta: 'Visit Spencer'
          },
          {
            mode: 'Remember',
            observation: 'This always reminds me that quiet stories can settle a whole evening.',
            invitation: 'If tonight feels a little full, the Bedtime Library is a gentle place to land.',
            href: 'bedtime-library.html',
            cta: 'Begin Quietly'
          },
          {
            mode: 'Wonder',
            observation: 'The old bridge has been on my mind this morning.',
            invitation: 'I keep wondering how it sounds after a gentle rain. If you pass that way, listen for it.',
            href: 'map.html',
            cta: 'Start At The Bridge'
          }
        ];

        if (wanderCopyEl && wanderLinkEl && wanders.length > 0) {
          var wander = wanders[week % wanders.length];
          wanderCopyEl.innerHTML = '<strong>Something Grandpa noticed today:</strong> '
            + '<span id="todays-wander-kind">' + (wander.mode || 'Notice') + '</span> - '
            + wander.observation;
          if (wanderInvitationEl) {
            wanderInvitationEl.textContent = wander.invitation || '';
          }
          wanderLinkEl.setAttribute('href', wander.href);
          wanderLinkEl.textContent = wander.cta || 'Take This Walk';
        }
      })();
    </script>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderArticlePage(page, site, nav, config, banner, libraryIndex, amazonLookup) {
  if (page.slug === 'books') {
    return renderLayout(
      page.title,
      'Choose the kind of reading experience that feels right, then step into that series.',
      `<section class="content-card" aria-labelledby="books-introduction">
      <h2 id="books-introduction">Books</h2>
      <p>Hawkins Hollow stories are organized by reading experience. Begin with the shelf that fits your moment today.</p>
    </section>

    <section class="content-card" aria-labelledby="books-doorway">
      <h2 id="books-doorway">Where to begin</h2>
      <p>If this is your first visit, you do not need to choose everything at once. Pick one series and let the next step come naturally.</p>
      <p>
        <a class="button" href="storybook-shelf.html">Start with Storybooks</a>
        <a class="button" href="bedtime-library.html">Try Bedtime Library</a>
      </p>
    </section>

    <section class="content-card" aria-labelledby="books-series">
      <h2 id="books-series">Browse the Collections</h2>
      <div class="start-here-grid">
        <article class="start-here-item" id="series-storybooks">
          <h3>Storybooks</h3>
          <p><strong>Who it is for:</strong> Families who want shared read-aloud moments.</p>
          <p><strong>Experience:</strong> Gentle illustrated adventures that introduce Hawkins Hollow one memory at a time.</p>
          <a class="button" href="storybook-shelf.html">Explore Storybooks</a>
        </article>

        <article class="start-here-item" id="series-first-readers">
          <h3>First Readers</h3>
          <p><strong>Who it is for:</strong> Children beginning to read with a helper.</p>
          <p><strong>Experience:</strong> Short, approachable stories that build confidence one page at a time.</p>
          <a class="button" href="first-readers.html">Explore First Readers</a>
        </article>

        <article class="start-here-item" id="series-second-readers">
          <h3>Second Readers</h3>
          <p><strong>Who it is for:</strong> Growing readers ready for longer adventures.</p>
          <p><strong>Experience:</strong> Richer stories with deeper threads and warm companionship.</p>
          <a class="button" href="second-readers.html">Explore Second Readers</a>
        </article>

        <article class="start-here-item" id="series-basic-training">
          <h3>Basic Training</h3>
          <p><strong>Who it is for:</strong> Children practicing everyday skills with encouragement.</p>
          <p><strong>Experience:</strong> Story-based confidence for routines, habits, and readiness.</p>
          <a class="button" href="basic-training.html">Explore Basic Training</a>
        </article>

        <article class="start-here-item" id="series-bedtime-library">
          <h3>Bedtime Library</h3>
          <p><strong>Who it is for:</strong> Families winding down at the end of the day.</p>
          <p><strong>Experience:</strong> Quiet pacing and reassuring stories for bedtime moments.</p>
          <a class="button" href="bedtime-library.html">Enter the Bedtime Library</a>
        </article>

        <article class="start-here-item" id="series-growing-together">
          <h3>Growing Together</h3>
          <p><strong>Who it is for:</strong> Families exploring belonging, care, and cooperation.</p>
          <p><strong>Experience:</strong> Heart-forward stories about relationships that deepen over time.</p>
          <a class="button" href="growing-together.html">Explore Growing Together</a>
        </article>

        <article class="start-here-item" id="series-tender-times">
          <h3>Tender Times</h3>
          <p><strong>Who it is for:</strong> Children and caregivers moving through hard days.</p>
          <p><strong>Experience:</strong> Comforting stories designed for reassurance, connection, and hope.</p>
          <a class="button" href="tender-times.html">Explore Tender Times</a>
        </article>

        <article class="start-here-item" id="series-holiday-poems">
          <h3>Holiday Story Poems</h3>
          <p><strong>Who it is for:</strong> Families celebrating seasonal traditions together.</p>
          <p><strong>Experience:</strong> Festive poems and stories for shared celebration and reflection.</p>
          <a class="button" href="holiday-story-poems.html">Explore Holiday Story Poems</a>
        </article>

        <article class="start-here-item" id="series-hero-play-poems">
          <h3>Hero Play Poems</h3>
          <p><strong>Who it is for:</strong> Children who love imagination, courage, and pretend adventure.</p>
          <p><strong>Experience:</strong> Playful poems that encourage confidence and creative thinking.</p>
          <a class="button" href="hero-play-poems.html">Explore Hero Play Poems</a>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="books-closing">
      <h2 id="books-closing">Looking Ahead</h2>
      <p>Home introduces experiences. Series pages introduce books. Book pages invite you into each story.</p>
      <p>Choose a series, then choose a story.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  if (page.slug === 'start-here') {
    return renderLayout(
      page.title,
      'Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.',
      `<section class="content-card start-here-intro">
      <p>Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.</p>
      <p>These books are written to be shared—between children and the grown-ups who love them, between beginning readers and patient listeners, and between families looking for stories that feel warm, familiar, and safe.</p>
    </section>

    <section class="content-card start-here-series" aria-labelledby="choose-a-place-to-begin">
      <h2 id="choose-a-place-to-begin">Not sure where to begin?</h2>
      <p>Choose the experience that feels right today. You are not choosing a page. You are choosing a moment.</p>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p><strong>If you're reading with a young child:</strong> Begin with a shared illustrated story and settle in together.</p>
          <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p><strong>If your child is building reading confidence:</strong> Start with a short story that feels encouraging and familiar.</p>
          <a class="button" href="first-readers.html">Explore First Readers</a>
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p><strong>If your family wants a richer reading adventure:</strong> Choose a longer path with more details and discussion.</p>
          <a class="button" href="second-readers.html">Explore Second Readers</a>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p><strong>If you're looking for a bedtime story:</strong> Come this way for quiet pacing and reassuring endings.</p>
          <a class="button" href="bedtime-library.html">Enter the Bedtime Library</a>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p><strong>If your family wants encouragement:</strong> Follow stories about belonging, cooperation, and care.</p>
          <a class="button" href="growing-together.html">Explore Growing Together</a>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p><strong>If someone in your family needs comfort:</strong> Walk this path gently and at your own pace.</p>
          <a class="button" href="tender-times.html">Explore Tender Times</a>
        </article>

        <article class="start-here-item">
          <h3>Wander Freely</h3>
          <p><strong>If you simply want to explore:</strong> Start with a place, then follow what sounds interesting.</p>
          <a class="button" href="map.html">Open the Map</a>
        </article>
      </div>
    </section>

    <section class="content-card start-here-grownups" aria-labelledby="for-the-grown-ups">
      <h2 id="for-the-grown-ups">For the Grown-Ups</h2>
      <p>Hawkins Hollow books are written for children, but they are also made to support the adults reading beside them. Many books include gentle discussion prompts, family support pages, or small invitations to talk, listen, remember, and connect.</p>
      <p>There is no test at the end and no single correct way to use a Hawkins Hollow story. Read slowly. Pause when a child wants to pause. Return to a favorite page. Let the story become part of your family's own conversation.</p>
    </section>

    <section class="content-card start-here-closing" aria-labelledby="the-porch-light-is-on">
      <h2 id="the-porch-light-is-on">The Porch Light Is On</h2>
      <p>You do not have to explore everything at once. Begin with one story, one character, or one quiet moment that feels like a good fit. Hawkins Hollow will still be here when you come back.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  if (page.slug === 'map') {
    return renderLayout(
      page.title,
      'A story map of Hawkins Hollow where families can wander by place and discover connected stories.',
      `<section class="content-card" aria-labelledby="map-doorway">
      <h2 id="map-doorway">Unfold the Map and Wander</h2>
      <p><strong>Who this is for:</strong> Families who like to explore by place and follow curiosity one path at a time.</p>
      <p><strong>What you can experience:</strong> Orchards, landmarks, and hand-drawn-feeling corners where stories quietly begin.</p>
      <p><strong>Where to begin:</strong> <a href="#map-places">Open Places Around Hawkins Hollow and choose one stop</a></p>
    </section>

    <section class="content-card" aria-labelledby="map-intro">
      <h2 id="map-intro">Come Wander Hawkins Hollow</h2>
      <p>Every path leads somewhere special. Wander through orchards, barns, gardens, and quiet places where stories begin.</p>
      <p>Choose a place and begin there. Children often start with a location, then discover stories, characters, and friendships along the way.</p>
      <p><strong>Tip:</strong> Open any place and look for “Where would you like to wander next?” to keep exploring.</p>
    </section>

    <section class="content-card" aria-labelledby="map-places">
      <h2 id="map-places">Places Around Hawkins Hollow</h2>
      <p class="search-hint">Loading environments and landmarks from the Hawkins Hollow memory...</p>
      <div id="map-places-grid" class="map-grid" aria-live="polite"></div>
    </section>

    <script>
      (function () {
        var target = document.getElementById('map-places-grid');
        if (!target) {
          return;
        }

        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
        }

        function renderMessage(message) {
          target.innerHTML = '<p>' + escapeHtml(message) + '</p>';
        }

        fetch('generated/entity-index.json')
          .then(function (response) { return response.json(); })
          .then(function (payload) {
            var byType = payload && payload.byType ? payload.byType : {};
            var environments = Array.isArray(byType.environments) ? byType.environments : [];
            var landmarks = Array.isArray(byType.landmarks) ? byType.landmarks : [];
            var places = environments.concat(landmarks).sort(function (a, b) {
              return String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id));
            });

            if (places.length === 0) {
              renderMessage('No places are available yet.');
              return;
            }

            target.innerHTML = places.map(function (place) {
              var name = place.name || place.title || place.id || 'Unnamed Place';
              var href = place.entityPageHref || place.href || '#';
              var kind = place.type === 'environment' ? 'Place' : 'Landmark';
              return '<a class="map-place-card" href="' + escapeHtml(href) + '">'
                + '<p class="map-place-kind">' + escapeHtml(kind) + '</p>'
                + '<h3>' + escapeHtml(name) + '</h3>'
                + '<p>Open this location</p>'
                + '</a>';
            }).join('');
          })
          .catch(function () {
            renderMessage('The map could not be loaded right now.');
          });
      })();
    </script>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  return renderLayout(
    page.title,
    page.content,
    `<section class="content-card">
      <p>Grandpa is still setting the table for this part of the Hollow. The path is ready, and the welcome is waiting.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderCharactersPage(site, nav, charactersData, config, banner) {
  const cards = charactersData.characters
    .filter((character) => character.published !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
        (character) => `<a class="character-card" href="characters/${character.slug}.html" aria-label="Meet ${character.name}">
          <div class="character-card-media">
            <img class="character-hero-thumb" src="${character.heroImage.replace(/^\//, '')}" alt="${character.name}" width="320" height="320" loading="lazy" />
          </div>
          <div class="character-card-copy">
            <h3>${character.name}</h3>
            <p>${character.description}</p>
          </div>
        </a>`
    )
    .join('');

  return renderLayout(
    'Meet the Friends of Hawkins Hollow',
    'Every Hawkins Hollow story begins with someone worth knowing.',
    `<section class="content-card" aria-labelledby="characters-doorway">
      <h2 id="characters-doorway">Meet a Neighbor First</h2>
      <p><strong>Who this is for:</strong> Children and grown-ups looking for a familiar friend to begin with.</p>
      <p><strong>What you can experience:</strong> Distinct voices, everyday personalities, and relationships that make the Hollow feel lived in.</p>
      <p><strong>Where to begin:</strong> <a href="#characters-youll-meet">Choose one friend and spend a few minutes getting to know them</a></p>
    </section>

    <section class="content-card" aria-labelledby="characters-introduction">
      <h2 id="characters-introduction">Meet the Friends of Hawkins Hollow</h2>
      <p>Every Hawkins Hollow story begins with someone worth knowing.</p>
      <p>Some are adventurous. Some are quiet. Some ask questions. Some listen carefully. Some need encouragement. Some discover they can encourage someone else.</p>
      <p>Together they make Hawkins Hollow a place where every child can find someone who feels familiar.</p>
    </section>

    <section class="content-card" aria-labelledby="community-of-many-voices">
      <h2 id="community-of-many-voices">A Community of Many Voices</h2>
      <p>Children in Hawkins Hollow are different from one another in personality, interests, abilities, families, and experiences.</p>
      <p>Every character brings something valuable to the community, and every story reminds us that kindness, patience, courage, and belonging often grow through everyday moments.</p>
    </section>

    <section class="content-card" aria-labelledby="characters-youll-meet">
      <h2 id="characters-youll-meet">Characters You'll Meet</h2>
      <div class="character-grid">${cards}</div>
    </section>

    <section class="content-card" aria-labelledby="more-friends-are-waiting">
      <h2 id="more-friends-are-waiting">More Friends Are Waiting</h2>
      <p>Hawkins Hollow continues to grow with every new story.</p>
      <p>As additional books are published, more characters, families, and familiar places will find their home here.</p>
    </section>

    <section class="content-card" aria-labelledby="every-story-begins-with-someone">
      <h2 id="every-story-begins-with-someone">Every Story Begins with Someone</h2>
      <p>Whether you begin with a favorite character or discover someone new along the way, every Hawkins Hollow story offers another opportunity to listen, imagine, and grow together.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters.html`,
    config,
    banner
  );
}

// Experience templates transform content objects into visitor-centered journeys.
function renderCharacterExperiencePage(experience, site, nav, config, banner) {
  const character = experience.character;
  const profile = experience.profile;
  const characterName = String(character.name || character.slug || experience.canonicalId || 'This friend').trim();
  const characterFirstName = characterName.split(' ')[0];

  const relatedStoryCards = (experience.relatedStoriesPreview || experience.relatedStories || [])
    .map((story) => {
      const coverImage = story.coverImage
        ? `<img src="../${story.coverImage}" alt="Cover image for ${story.title}" loading="lazy" width="110" height="150" />`
        : '<div class="character-story-thumb-placeholder" aria-hidden="true"></div>';
      const description = story.description
        ? story.description
        : `${characterFirstName} is part of this gentle Hawkins Hollow story.`;
      const guidanceLine = getStoryGuidanceLine(story, 3);
      return `<article class="character-story-card">
        <div class="character-story-media">${coverImage}</div>
        <div class="character-story-copy">
          <h3>${story.title}</h3>
          <p>${description}</p>
          ${guidanceLine ? `<p class="story-metadata-line">${guidanceLine}</p>` : ''}
          <p><a class="character-story-link" href="../${story.href}">Read ${story.title} &rarr;</a></p>
        </div>
      </article>`;
    })
    .join('');

  const relatedPlacesCards = (experience.relatedPlacesPreview || experience.relatedPlaces || [])
    .map((place) => {
      const placeName = String(place && place.name ? place.name : 'A familiar place');
      const placeKind = String(place && place.kind ? place.kind : 'Place');
      const placeDescription = String(place && place.blurb ? place.blurb : `${characterFirstName} often slows down here and takes in what matters.`);
      const placeHref = place && place.href ? place.href : '../map.html';
      const placeImage = place && place.image ? String(place.image).replace(/^\//, '') : '';
      const mediaHtml = placeImage
        ? `<img src="../${placeImage}" alt="${placeName}" loading="lazy" width="110" height="150" />`
        : '<div class="character-story-thumb-placeholder place-thumb" aria-hidden="true"></div>';
      return `<article class="character-story-card">
        <div class="character-story-media">${mediaHtml}</div>
        <div class="character-story-copy">
          <p class="character-neighbor-tag">${placeKind}</p>
          <h3>${placeName}</h3>
          <p>${placeDescription}</p>
          <p><a class="character-story-link" href="${placeHref}">Visit ${placeName} &rarr;</a></p>
        </div>
      </article>`;
    })
    .join('');

  const relatedPeopleCards = (experience.relatedPeoplePreview || experience.relatedPeople || []).length > 0
    ? `<div class="character-neighbor-list">${(experience.relatedPeoplePreview || experience.relatedPeople || []).map((person) => {
      const neighborName = String(person && person.name ? person.name : 'Neighbor');
      const neighborFirstName = neighborName.split(' ')[0];
      const relationshipTag = person && person.relationshipTag ? person.relationshipTag : 'Neighbor to meet';
      const blurb = person && person.blurb
        ? person.blurb
        : `${neighborFirstName} is part of this friendly corner of Hawkins Hollow.`;
      const title = person && person.href
        ? `<h3><a href="${person.href}">${neighborName}</a></h3>`
        : `<h3>${neighborName}</h3>`;
      const visitLink = person && person.href
        ? `<p><a class="character-story-link" href="${person.href}">Visit ${neighborFirstName}'s page &rarr;</a></p>`
        : '';
      return `<article class="character-neighbor-card">
        <p class="character-neighbor-tag">${relationshipTag}</p>
        ${title}
        <p>${blurb}</p>
        ${visitLink}
      </article>`;
    }).join('')}</div>`
    : '<p>More friendships will appear here as the Hollow keeps growing.</p>';

  const relatedRelationshipCards = (experience.relatedRelationshipsPreview || []).length > 0
    ? `<div class="character-neighbor-list">${experience.relatedRelationshipsPreview.map((relationship) => {
      const relationshipName = String(relationship && relationship.name ? relationship.name : 'Neighborhood connection');
      const relationshipTag = String(relationship && relationship.relationshipTag ? relationship.relationshipTag : 'Shared connection');
      const relationshipDescription = String(relationship && relationship.blurb ? relationship.blurb : 'A meaningful connection in Hawkins Hollow.');
      const relationshipLink = relationship && relationship.href
        ? `<p><a class="character-story-link" href="${relationship.href}">Visit this connection &rarr;</a></p>`
        : '';
      return `<article class="character-neighbor-card">
        <p class="character-neighbor-tag">${relationshipTag}</p>
        <h3>${relationshipName}</h3>
        <p>${relationshipDescription}</p>
        ${relationshipLink}
      </article>`;
    }).join('')}</div>`
    : '';

  const relatedPlaceCards = relatedPlacesCards.length > 0
    ? `<div class="character-story-list">${relatedPlacesCards}</div>`
    : '<p>Favorite places will be added as new memories are shared.</p>';

  const hasStoryContinuation = (experience.relatedStoriesAll || []).length > 0;
  const hasPeopleContinuation = (experience.relatedPeopleAll || []).length > 0;
  const hasPlacesContinuation = (experience.relatedPlacesAll || []).length > 0;
  const hasRelationshipsContinuation = (experience.relatedRelationshipsAll || []).length > 0;

  const storyContinuationLink = hasStoryContinuation
    ? `<p class="section-continue"><a class="button" href="${character.slug}-stories.html">Find more stories with ${characterFirstName} &rarr;</a></p>`
    : '';
  const peopleContinuationLink = hasPeopleContinuation
    ? `<p class="section-continue"><a class="button" href="${character.slug}-people.html">Meet more of ${characterFirstName}'s friends &rarr;</a></p>`
    : '';
  const placesContinuationLink = hasPlacesContinuation
    ? `<p class="section-continue"><a class="button" href="${character.slug}-places.html">See where else ${characterFirstName} spends time &rarr;</a></p>`
    : '';
  const relationshipsContinuationLink = hasRelationshipsContinuation
    ? `<p class="section-continue"><a class="button" href="${character.slug}-relationships.html">Learn more about ${characterFirstName}'s connections &rarr;</a></p>`
    : '';

  const delightFact = `${characterFirstName} is one of the neighbors children often return to when they want a familiar friend.`;

  const warmDescription = experience.description
    ? experience.description
    : `${characterName} is part of the welcoming community that makes Hawkins Hollow feel like home.`;

  return renderLayout(
    character.name || characterName,
    warmDescription,
    `<section class="content-card" aria-labelledby="character-arrival">
      <img class="character-hero-full" src="../${experience.heroImage.replace(/^\//, '')}" alt="${character.name || characterName}" width="640" height="640" />
      <h1 id="character-arrival">${profile.arrivalHeading}</h1>
      <p>${profile.arrivalBody}</p>
      <p><strong>This visit should feel:</strong> ${experience.visitorFeeling}</p>
      <p><strong>Where to go next:</strong> Continue from the story you just read and choose the next place, person, or memory to follow.</p>
      <p>
        <a class="button" href="../books.html">Read another story</a>
        <a class="button" href="../characters.html">Meet more friends</a>
      </p>
    </section>

    <section class="content-card" aria-labelledby="character-together">
      <h2 id="character-together">${profile.storyHeading}</h2>
      <p>These are a few stories where you'll continue getting to know ${characterFirstName}.</p>
      <div class="character-story-list">${relatedStoryCards}</div>
      ${storyContinuationLink}
    </section>

    <section class="content-card" aria-labelledby="character-people">
      <h2 id="character-people">${profile.friendHeading}</h2>
      ${relatedPeopleCards}
      ${peopleContinuationLink}
    </section>

    <section class="content-card" aria-labelledby="character-wander">
      <h2 id="character-wander">${profile.placeHeading}</h2>
      ${relatedPlaceCards}
      ${placesContinuationLink}
    </section>

    ${relatedRelationshipCards ? `<section class="content-card" aria-labelledby="character-connections">
      <h2 id="character-connections">Connections around ${characterFirstName}</h2>
      <p>These are a few of the shared paths that help ${characterFirstName}'s world feel connected.</p>
      ${relatedRelationshipCards}
      ${relationshipsContinuationLink}
    </section>` : ''}

    <section class="content-card" aria-labelledby="character-discovery">
      <h2 id="character-discovery">${profile.discoveryHeading}</h2>
      <p>${profile.discoveryLine}</p>
      <p>${delightFact}</p>
    </section>

    <section class="content-card" aria-labelledby="character-next">
      <h2 id="character-next">${profile.nextHeading}</h2>
      <p>${profile.nextLine}</p>
      <p>
        <a class="button" href="../books.html">Read a story</a>
        <a class="button" href="../map.html">Visit a place</a>
        <a class="button" href="../community.html">Join the community</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters/${character.slug}.html`,
    config,
    banner,
    '../'
  );
}

function renderCharacterContinuationPage(experience, continuationType, site, nav, config, banner) {
  const character = experience.character;
  const profile = experience.profile;
  const characterName = String(character.name || character.slug || 'This friend').trim();
  const firstName = characterName.split(' ')[0];

  let pageTitle = '';
  let pageDescription = '';
  let sectionHeading = '';
  let introLine = '';
  let cardsHtml = '';

  if (continuationType === 'stories') {
    pageTitle = `Stories with ${characterName}`;
    pageDescription = `Settle in with ${characterName} and discover more stories from this part of Hawkins Hollow.`;
    sectionHeading = `Settle in with ${firstName}.`;
    introLine = `These stories help you keep walking through ${firstName}'s world one gentle page at a time.`;
    cardsHtml = (experience.relatedStoriesAll || []).map((story) => {
      const coverImage = story.coverImage
        ? `<img src="../${story.coverImage}" alt="Cover image for ${story.title}" loading="lazy" width="110" height="150" />`
        : '<div class="character-story-thumb-placeholder" aria-hidden="true"></div>';
      const description = story.description || `${firstName} is part of this gentle Hawkins Hollow story.`;
      const guidanceLine = getStoryGuidanceLine(story, 3);
      return `<article class="character-story-card">
        <div class="character-story-media">${coverImage}</div>
        <div class="character-story-copy">
          <h3>${story.title}</h3>
          <p>${description}</p>
          ${guidanceLine ? `<p class="story-metadata-line">${guidanceLine}</p>` : ''}
          <p><a class="character-story-link" href="../${story.href}">Read ${story.title} &rarr;</a></p>
        </div>
      </article>`;
    }).join('');
  } else if (continuationType === 'places') {
    pageTitle = `Walk with ${characterName}`;
    pageDescription = `Come walk with ${characterName} and visit places that help tell this neighbor's story.`;
    sectionHeading = `Come walk with ${firstName}.`;
    introLine = `These are some of the places that help tell ${firstName}'s story.`;
    cardsHtml = (experience.relatedPlacesAll || []).map((place) => {
      const placeName = String(place && place.name ? place.name : 'A familiar place');
      const placeKind = String(place && place.kind ? place.kind : 'Place');
      const placeDescription = String(place && place.blurb ? place.blurb : `${firstName} often slows down here and takes in what matters.`);
      const placeHref = place && place.href ? place.href : '../map.html';
      const placeImage = place && place.image ? String(place.image).replace(/^\//, '') : '';
      const mediaHtml = placeImage
        ? `<img src="../${placeImage}" alt="${placeName}" loading="lazy" width="110" height="150" />`
        : '<div class="character-story-thumb-placeholder place-thumb" aria-hidden="true"></div>';
      return `<article class="character-story-card">
        <div class="character-story-media">${mediaHtml}</div>
        <div class="character-story-copy">
          <p class="character-neighbor-tag">${placeKind}</p>
          <h3>${placeName}</h3>
          <p>${placeDescription}</p>
          <p><a class="character-story-link" href="${placeHref}">Visit ${placeName} &rarr;</a></p>
        </div>
      </article>`;
    }).join('');
  } else if (continuationType === 'people') {
    pageTitle = `Friends of ${characterName}`;
    pageDescription = `Spend a little more time with ${characterName} by meeting neighbors from this shared corner of Hawkins Hollow.`;
    sectionHeading = `Spend a little more time with ${firstName}.`;
    introLine = `These neighbors are part of the friendships that make ${firstName}'s world feel lived in.`;
    cardsHtml = (experience.relatedPeopleAll || []).map((person) => {
      const neighborName = String(person && person.name ? person.name : 'Neighbor');
      const neighborFirstName = neighborName.split(' ')[0];
      const relationshipTag = String(person && person.relationshipTag ? person.relationshipTag : 'Neighbor to meet');
      const blurb = String(person && person.blurb ? person.blurb : `${neighborFirstName} is part of this friendly corner of Hawkins Hollow.`);
      const title = person && person.href
        ? `<h3><a href="${person.href}">${neighborName}</a></h3>`
        : `<h3>${neighborName}</h3>`;
      const visitLink = person && person.href
        ? `<p><a class="character-story-link" href="${person.href}">Visit ${neighborFirstName}'s page &rarr;</a></p>`
        : '';
      return `<article class="character-neighbor-card">
        <p class="character-neighbor-tag">${relationshipTag}</p>
        ${title}
        <p>${blurb}</p>
        ${visitLink}
      </article>`;
    }).join('');
    cardsHtml = cardsHtml ? `<div class="character-neighbor-list">${cardsHtml}</div>` : '';
  } else {
    pageTitle = `Connections around ${characterName}`;
    pageDescription = `Shared relationship moments that help connect ${characterName}'s neighborhood.`;
    sectionHeading = `See how ${firstName}'s world connects.`;
    introLine = `These relationship pages show how neighbors, places, and shared moments gather around ${firstName}.`;
    cardsHtml = (experience.relatedRelationshipsAll || []).map((relationship) => {
      const relationshipName = String(relationship && relationship.name ? relationship.name : 'Neighborhood connection');
      const relationshipTag = String(relationship && relationship.relationshipTag ? relationship.relationshipTag : 'Shared connection');
      const relationshipDescription = String(relationship && relationship.blurb ? relationship.blurb : 'A meaningful connection in Hawkins Hollow.');
      const relationshipLink = relationship && relationship.href
        ? `<p><a class="character-story-link" href="${relationship.href}">Visit this connection &rarr;</a></p>`
        : '';
      return `<article class="character-neighbor-card">
        <p class="character-neighbor-tag">${relationshipTag}</p>
        <h3>${relationshipName}</h3>
        <p>${relationshipDescription}</p>
        ${relationshipLink}
      </article>`;
    }).join('');
    cardsHtml = cardsHtml ? `<div class="character-neighbor-list">${cardsHtml}</div>` : '';
  }

  const contentHtml = cardsHtml
    ? cardsHtml
    : '<p>More paths are being prepared as Hawkins Hollow keeps growing.</p>';

  const bridgeNeighbor = (experience.relatedPeopleAll || []).find(
    (person) => person && person.href && person.name
  ) || null;
  const bridgeNeighborName = bridgeNeighbor ? String(bridgeNeighbor.name) : '';
  const bridgeNeighborFirstName = bridgeNeighborName ? bridgeNeighborName.split(' ')[0] : '';

  let bridgeLine = '';
  if (bridgeNeighbor) {
    if (continuationType === 'places') {
      bridgeLine = `Many of these places are shared with ${bridgeNeighborFirstName}. If you'd like, come meet ${bridgeNeighborFirstName} next.`;
    } else if (continuationType === 'stories') {
      bridgeLine = `${firstName}'s adventures often begin with ${bridgeNeighborFirstName} nearby. You might enjoy spending a little time with ${bridgeNeighborFirstName}, too.`;
    } else if (continuationType === 'relationships') {
      bridgeLine = `Relationships become friendships in Hawkins Hollow. Here's someone ${firstName} sees often.`;
    } else {
      bridgeLine = `If you'd like to keep walking, ${bridgeNeighborFirstName} can show you another gentle corner of the neighborhood.`;
    }
  }

  const bridgeSection = bridgeNeighbor
    ? `<section class="content-card" aria-labelledby="continuation-bridge">
      <h2 id="continuation-bridge">Keep the walk going</h2>
      <p>${bridgeLine}</p>
      <p><a class="button" href="${bridgeNeighbor.href}">Continue with ${bridgeNeighborFirstName}</a></p>
    </section>`
    : '';

  return renderLayout(
    pageTitle,
    pageDescription,
    `<section class="content-card" aria-labelledby="continuation-arrival">
      <h1 id="continuation-arrival">${sectionHeading}</h1>
      <p>${introLine}</p>
      <p>You are still in ${firstName}'s part of Hawkins Hollow.</p>
      <p><strong>This visit should feel:</strong> ${experience.visitorFeeling}</p>
      <p>
        <a class="button" href="${character.slug}.html">Return to ${firstName}'s page</a>
        <a class="button" href="../characters.html">Meet more friends</a>
      </p>
    </section>

    <section class="content-card" aria-labelledby="continuation-list">
      <h2 id="continuation-list">More to explore with ${firstName}</h2>
      ${contentHtml}
    </section>

    ${bridgeSection}

    <section class="content-card" aria-labelledby="continuation-next">
      <h2 id="continuation-next">Where would you like to wander next?</h2>
      <p>${profile.nextLine}</p>
      <p>
        <a class="button" href="../books.html">Read a story</a>
        <a class="button" href="../map.html">Visit a place</a>
        <a class="button" href="../community.html">Join the community</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters/${character.slug}-${continuationType}.html`,
    config,
    banner,
    '../'
  );
}

function getStorybookCardInvitation(book) {
  const title = String(book && book.title ? book.title : '').trim();
  const invitationByTitle = {
    'Spencer’s First Friend': 'Meet Spencer and discover how a small friendship can begin.',
    'The Sharing Acorn': 'Follow a simple gift and the kindness it inspires.',
    "Alice's Underground Party": 'Step into a moonlit gathering and a merry little adventure.',
    'When Callen Said Sorry': 'Watch a hard moment soften into a thoughtful apology.'
  };

  return invitationByTitle[title] || getBookSpecificInvitation(book, { mode: 'card' });
}

function getStableTextIndex(value, length) {
  const text = String(value || 'book').trim();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  if (!Number.isFinite(length) || length <= 0) {
    return 0;
  }
  return Math.abs(hash) % length;
}

function getSeriesVoice(seriesSlug) {
  const voices = {
    storybooks: {
      moment: 'gentle shared reading moment',
      purpose: 'invites families to read aloud, talk together, and notice everyday kindness'
    },
    'first-readers': {
      moment: 'confidence-building first-reader adventure',
      purpose: 'helps early readers practice steadily while still feeling supported'
    },
    'second-readers': {
      moment: 'longer independent reading journey',
      purpose: 'gives growing readers more depth while keeping the world warm and accessible'
    },
    'basic-training': {
      moment: 'practical life-skill story',
      purpose: 'turns everyday routines into approachable steps that children can try'
    },
    'growing-together': {
      moment: 'relationship-centered family story',
      purpose: 'encourages belonging, cooperation, and care through shared moments'
    },
    'bedtime-library': {
      moment: 'calming bedtime story',
      purpose: 'helps children settle, feel safe, and end the day with reassurance'
    },
    'tender-times': {
      moment: 'comfort-focused story for hard days',
      purpose: 'offers gentle language for feelings and strengthens connection at home'
    },
    'holiday-story-poems': {
      moment: 'seasonal family poem-story',
      purpose: 'connects celebrations to gratitude, memory, and togetherness'
    },
    'hero-play-poems': {
      moment: 'imagination-forward play poem',
      purpose: 'encourages courage, creativity, and joyful pretend adventure'
    }
  };

  return voices[String(seriesSlug || '').toLowerCase()] || {
    moment: 'welcoming Hawkins Hollow story',
    purpose: 'opens a clear path into the people, places, and values of the neighborhood'
  };
}

function resolveSeriesSlug(book) {
  const explicitSlug = String(book && book.seriesSlug || '').trim().toLowerCase();
  if (explicitSlug) {
    return explicitSlug;
  }

  const seriesCode = String(book && book.seriesCode || '').trim().toUpperCase();
  const seriesCodeMap = {
    A: 'storybooks',
    B: 'first-readers',
    C: 'second-readers',
    D: 'basic-training',
    E: 'growing-together',
    F: 'bedtime-library',
    G: 'tender-times',
    H: 'holiday-story-poems',
    I: 'hero-play-poems'
  };
  if (seriesCodeMap[seriesCode]) {
    return seriesCodeMap[seriesCode];
  }

  const seriesLabel = String(book && book.series || '').toLowerCase();
  if (seriesLabel.includes('storybook')) return 'storybooks';
  if (seriesLabel.includes('first reader')) return 'first-readers';
  if (seriesLabel.includes('second reader')) return 'second-readers';
  if (seriesLabel.includes('basic training')) return 'basic-training';
  if (seriesLabel.includes('growing together')) return 'growing-together';
  if (seriesLabel.includes('bedtime')) return 'bedtime-library';
  if (seriesLabel.includes('tender')) return 'tender-times';
  if (seriesLabel.includes('holiday')) return 'holiday-story-poems';
  if (seriesLabel.includes('hero')) return 'hero-play-poems';
  return '';
}

function getBookSpecificInvitation(book, options = {}) {
  const title = String(book && (book.title || getCanonicalBookId(book)) || 'This story').trim();
  const existingDescription = String(book && book.description || '').trim();
  if (existingDescription) {
    return existingDescription;
  }

  const resolvedSeriesSlug = resolveSeriesSlug(book);
  const voice = getSeriesVoice(resolvedSeriesSlug);
  const key = `${String(book && book.slug || '')}|${title}|${resolvedSeriesSlug}`;
  const openerOptions = [
    `${title} offers a ${voice.moment} in Hawkins Hollow.`,
    `In ${title}, readers step into a ${voice.moment} shaped by the heart of Hawkins Hollow.`,
    `${title} welcomes readers with a ${voice.moment} that feels warm, familiar, and close to home.`
  ];
  const closerOptions = [
    `It ${voice.purpose}.`,
    `This story ${voice.purpose}.`,
    `Along the way, it ${voice.purpose}.`
  ];

  const opener = openerOptions[getStableTextIndex(`${key}|opener`, openerOptions.length)];
  const closer = closerOptions[getStableTextIndex(`${key}|closer`, closerOptions.length)];
  const full = `${opener} ${closer}`;

  return options.mode === 'detail'
    ? full
    : full;
}

function getBookDetailBody(book) {
  const title = String(book && (book.title || getCanonicalBookId(book)) || 'this story').trim();
  const options = [
    `Read ${title} with someone you love, then continue by meeting a character or visiting a place connected to the story.`,
    `${title} works best when readers pause, notice small moments, and carry the story into conversation afterward.`,
    `After ${title}, families can keep exploring Hawkins Hollow through related friends, places, and companion activities.`
  ];
  return options[getStableTextIndex(`${String(book && book.slug || title)}|detail-body`, options.length)];
}

function isGenericStoryPlaceholder(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) {
    return true;
  }

  const genericPhrases = [
    'a gentle story waiting to be read.',
    'a gentle storybook about discovering how even the smallest friendship can change a day.',
    'this story invites a child and a caring grown-up to settle in together and begin.',
    'a story invitation for '
  ];

  return genericPhrases.some((phrase) => value.includes(phrase));
}

const CANONICAL_STORY_FEELINGS = [
  'Lonely',
  'Nervous',
  'Curious',
  'Happy',
  'Frustrated',
  'Hopeful',
  'Proud',
  'Sad',
  'Confused',
  'Brave'
];

const CANONICAL_STORY_THEMES = [
  'Friendship',
  'Honesty',
  'Kindness',
  'Sharing',
  'Patience',
  'Courage',
  'Forgiveness',
  'Gratitude',
  'Belonging',
  'Listening'
];

const STORY_FEELING_ALIASES = {
  unsure: 'Confused',
  welcomed: 'Happy',
  joyful: 'Happy',
  worried: 'Nervous',
  regretful: 'Sad',
  relieved: 'Hopeful',
  excited: 'Happy',
  connected: 'Happy',
  calm: 'Hopeful',
  steady: 'Brave',
  loved: 'Happy',
  comforted: 'Hopeful'
};

const STORY_THEME_ALIASES = {
  inclusion: 'Belonging',
  repair: 'Forgiveness',
  perseverance: 'Courage',
  remembrance: 'Gratitude',
  family: 'Kindness',
  hope: 'Courage'
};

const STORY_FEELING_DISPLAY = {
  Lonely: 'Feeling left out',
  Nervous: 'Feeling nervous',
  Curious: 'Feeling curious',
  Happy: 'Feeling happy',
  Frustrated: 'Feeling frustrated',
  Hopeful: 'Feeling hopeful',
  Proud: 'Feeling proud',
  Sad: 'Feeling sad',
  Confused: 'Feeling unsure',
  Brave: 'Feeling brave'
};

function normalizeStoryGuidanceValue(value, type) {
  const label = String(value || '').trim();
  if (!label) {
    return '';
  }

  const rawKey = label.toLowerCase();
  const aliasMap = type === 'feelings' ? STORY_FEELING_ALIASES : STORY_THEME_ALIASES;
  const canonicalList = type === 'feelings' ? CANONICAL_STORY_FEELINGS : CANONICAL_STORY_THEMES;
  const canonicalValue = aliasMap[rawKey] || label;
  return canonicalList.includes(canonicalValue) ? canonicalValue : '';
}

function normalizeStoryGuidanceList(values, type) {
  if (!Array.isArray(values)) {
    return [];
  }

  const cleaned = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeStoryGuidanceValue(value, type);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(normalized);
  }
  return cleaned;
}

function getStoryGuidance(book) {
  return {
    feelings: normalizeStoryGuidanceList(book && book.feelings, 'feelings'),
    themes: normalizeStoryGuidanceList(book && book.themes, 'themes')
  };
}

function getStoryGuidanceLine(book, maxItems) {
  const guidance = getStoryGuidance(book);
  const limit = Number.isFinite(maxItems) ? maxItems : 3;
  const combined = [...guidance.feelings, ...guidance.themes].slice(0, limit);
  return combined.length > 0 ? combined.join(' &bull; ') : '';
}

function renderStoryGuidanceBlock(book) {
  const guidance = getStoryGuidance(book);
  const hasFeelings = guidance.feelings.length > 0;
  const hasThemes = guidance.themes.length > 0;

  if (!hasFeelings && !hasThemes) {
    return '';
  }

  const feelingsBlock = hasFeelings
    ? `<div class="story-guidance-group">
      <h3>Feelings you may recognize</h3>
      <p>${guidance.feelings.map((feeling) => STORY_FEELING_DISPLAY[feeling] || feeling).join(' &bull; ')}</p>
    </div>`
    : '';

  const themesBlock = hasThemes
    ? `<div class="story-guidance-group">
      <h3>Themes you'll find here</h3>
      <p>${guidance.themes.join(' &bull; ')}</p>
    </div>`
    : '';

  return `<section class="story-guidance" aria-label="This story gently explores">
    <p class="story-guidance-heading">This story gently explores</p>
    ${feelingsBlock}
    ${themesBlock}
  </section>`;
}

function getSeriesEditorial(series) {
  const editorial = series && series.editorial ? series.editorial : {};
  const rawDisplayOrder = String(editorial && editorial.displayOrder ? editorial.displayOrder : 'rotating').toLowerCase();
  const displayOrder = rawDisplayOrder === 'rotating' ? 'rotating' : 'rotating';
  const rawRotationFrequency = String(editorial && editorial.rotationFrequency ? editorial.rotationFrequency : 'daily').toLowerCase();
  const rotationFrequency = rawRotationFrequency === 'weekly' ? 'weekly' : 'daily';

  return {
    welcomeHeading: editorial && editorial.welcomeHeading ? editorial.welcomeHeading : 'A Good Place to Begin',
    welcomeText: editorial && editorial.welcomeText ? editorial.welcomeText : 'Choose a story that feels right for today and begin at your own pace.',
    audienceText: editorial && editorial.audienceText ? editorial.audienceText : 'Families and readers looking for a welcoming place to begin.',
    experienceText: editorial && editorial.experienceText ? editorial.experienceText : 'Stories designed to be shared, remembered, and revisited.',
    invitationLabel: editorial && editorial.invitationLabel ? editorial.invitationLabel : `Explore ${series && series.title ? series.title : 'this collection'}`,
    displayOrder,
    rotationFrequency
  };
}

function getSeriesPageHref(seriesSlug) {
  return String(seriesSlug || '').toLowerCase() === 'storybooks'
    ? 'storybook-shelf.html'
    : `${seriesSlug}.html`;
}

function getBooksForSeries(series, booksData) {
  const seriesSlug = series && series.slug ? series.slug : 'storybooks';

  return (booksData.books || [])
    .filter((book) => book.seriesSlug === seriesSlug)
    .sort((a, b) => {
      const aOrder = Number.isFinite(a && a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b && b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return String(a && a.title ? a.title : '').localeCompare(String(b && b.title ? b.title : ''));
    });
}

function buildSeriesPreviewCards(booksData, series) {
  const seriesBooks = getBooksForSeries(series, booksData);

  if (!seriesBooks.length) {
    return `<article class="book-card"><h3>More stories are on the way</h3><p class="placeholder">New stories in this collection will appear here as the shelf grows.</p></article>`;
  }

  const { welcomeHeading, welcomeText, displayOrder, rotationFrequency } = getSeriesEditorial(series);
  const cardsMarkup = `<div class="storybook-list" aria-label="Series story recommendations" data-display-order="${displayOrder}" data-rotation-frequency="${rotationFrequency}" data-series-slug="${series && series.slug ? series.slug : ''}">
        ${seriesBooks
          .map(
            (book) => `<article class="book-card storybook-card">
              <div class="storybook-card-media">
                <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" loading="lazy" />
              </div>
              <div class="storybook-card-copy">
                <h3 class="story-card-title">${book.title}</h3>
                <p class="story-card-invitation">${getStorybookCardInvitation(book)}</p>
                ${getStoryGuidanceLine(book, 3) ? `<p class="story-metadata-line">${getStoryGuidanceLine(book, 3)}</p>` : ''}
                <a class="button" href="${getBookPageHref(book)}">Read this story</a>
              </div>
            </article>`
          )
          .join('')}
      </div>`;

  return `<div class="storybook-editorial">
      <p class="eyebrow">${welcomeHeading}</p>
      <p class="story-card-invitation story-card-welcome">${welcomeText}</p>
    </div>
    ${cardsMarkup}`;
}

function renderSeriesPage(page, site, nav, seriesData, booksData, config, banner) {
  const series = seriesData.series.find((entry) => entry.slug === page.seriesSlug);
  const editorial = getSeriesEditorial(series);
  const seriesVoice = getSeriesVoice(series && series.slug);
  const collectionHeadingId = `${page.slug}-collection`;
  const audienceHeadingId = `${page.slug}-audience`;
  const shelfHeadingId = `${page.slug}-shelf`;
  const continueHeadingId = `${page.slug}-continue`;
  const invitationLabel = editorial.invitationLabel || `Explore ${series.title}`;
  const openingLead = series.description || `Welcome to ${series.title}, where each story opens a gentle path into Hawkins Hollow.`;
  const openingBody = `${series.title} is built as a ${seriesVoice.moment} that ${seriesVoice.purpose}.`;
  const audienceSupport = `If you are unsure where to begin, choose one story that fits today and let the next step unfold naturally.`;

  return renderLayout(
    series.title,
    series.description || `Welcome to ${series.title} in Hawkins Hollow.`,
    `<section class="content-card" aria-labelledby="${collectionHeadingId}">
      <h2 id="${collectionHeadingId}">${series.title}</h2>
      <p>${openingLead}</p>
      <p>${openingBody}</p>
      <p><a class="button" href="${getSeriesPageHref(series.slug)}">${invitationLabel}</a></p>
    </section>

    <section class="content-card" aria-labelledby="${audienceHeadingId}">
      <h2 id="${audienceHeadingId}">Who This Series Is For</h2>
      <p><strong>Who it is for:</strong> ${editorial.audienceText}</p>
      <p><strong>Experience:</strong> ${editorial.experienceText}</p>
      <p>${audienceSupport}</p>
    </section>

    <section class="content-card" aria-labelledby="${shelfHeadingId}">
      <h2 id="${shelfHeadingId}">Choose a Story</h2>
      <p>These stories can be read in any order. Begin with the one that feels right today.</p>
      <div class="storybook-shelf" aria-label="${series.title} stories to read in any order">
        ${buildSeriesPreviewCards(booksData, series)}
      </div>
      <script>
        (function () {
          function hashString(value) {
            var hash = 0;
            for (var i = 0; i < value.length; i += 1) {
              hash = ((hash << 5) - hash) + value.charCodeAt(i);
              hash |= 0;
            }
            return Math.abs(hash);
          }

          function getIsoWeek(date) {
            var d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
            var day = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - day);
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
          }

          function getRotationBucket(frequency) {
            var now = new Date();
            if (frequency === 'weekly') {
              return now.getUTCFullYear() + '-W' + String(getIsoWeek(now)).padStart(2, '0');
            }
            return now.getUTCFullYear()
              + '-' + String(now.getUTCMonth() + 1).padStart(2, '0')
              + '-' + String(now.getUTCDate()).padStart(2, '0');
          }

          var list = document.querySelector('.storybook-list[data-display-order]');
          if (!list) {
            return;
          }

          var displayOrder = String(list.getAttribute('data-display-order') || '').toLowerCase();
          if (displayOrder !== 'rotating') {
            return;
          }

          var cards = Array.prototype.slice.call(list.querySelectorAll('.storybook-card'));
          if (cards.length < 2) {
            return;
          }

          var seriesSlug = String(list.getAttribute('data-series-slug') || 'series');
          var rotationFrequency = String(list.getAttribute('data-rotation-frequency') || 'daily').toLowerCase();
          var bucket = getRotationBucket(rotationFrequency === 'weekly' ? 'weekly' : 'daily');
          var startIndex = hashString(seriesSlug + '|' + bucket) % cards.length;
          var rotatedCards = cards.slice(startIndex).concat(cards.slice(0, startIndex));
          rotatedCards.forEach(function (card) {
            list.appendChild(card);
          });
        })();
      </script>
    </section>

    <section class="content-card" aria-labelledby="${continueHeadingId}">
      <h2 id="${continueHeadingId}">Keep Exploring</h2>
      <p>After one story, meet a character, visit a place, or choose another shelf in Hawkins Hollow.</p>
      <p>
        <a class="button" href="characters.html">Meet the characters</a>
        <a class="button" href="map.html">Visit the map</a>
        <a class="button" href="books.html">Browse all series</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function buildRelatedStorybookCards(booksData, currentBookSlug) {
  const relatedBooks = (booksData.books || [])
    .filter((book) => book.seriesSlug === 'storybooks' && book.slug !== currentBookSlug)
    .slice(0, 3);

  if (!relatedBooks.length) {
    return '<p class="placeholder">More stories will appear here as the shelf grows.</p>';
  }

  return relatedBooks
    .map(
      (book) => `<article class="book-card">
        <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" loading="lazy" />
        <h3>${book.title}</h3>
        <p>${getBookSpecificInvitation(book, { mode: 'card' })}</p>
        <a class="button" href="${book.slug}.html">Read this story</a>
      </article>`
    )
    .join('');
}

function resolveStoryCharactersForBook(book, characterByCanonicalId = new Map()) {
  const declaredCharacterIds = Array.isArray(book && book.characters) ? book.characters : [];
  const resolvedCharacters = declaredCharacterIds
    .map((characterId) => {
      const normalizedId = String(characterId || '').trim();
      if (!normalizedId) {
        return null;
      }
      const directMatch = characterByCanonicalId.get(normalizedId.toUpperCase());
      if (directMatch) {
        return directMatch;
      }
      return Array.from(characterByCanonicalId.values()).find((character) => {
        return String(character.slug || '').toLowerCase() === normalizedId.toLowerCase()
          || String(character.name || '').toLowerCase() === normalizedId.toLowerCase();
      }) || null;
    })
    .filter((character) => Boolean(character));

  const uniqueResolvedCharacters = resolvedCharacters.filter((character, index, list) => {
    const key = String(character.identity && character.identity.canonicalId || character.slug || character.name || '').toUpperCase();
    return list.findIndex((entry) => String(entry.identity && entry.identity.canonicalId || entry.slug || entry.name || '').toUpperCase() === key) === index;
  });

  const titleLower = String(getBookPublicTitle(book) || getCanonicalBookId(book)).toLowerCase();
  const inferredCharacter = uniqueResolvedCharacters.length > 0
    ? null
    : Array.from(characterByCanonicalId.values()).find((character) => {
        const fullName = String(character && character.name || '').toLowerCase();
        const firstName = fullName.split(' ')[0];
        return Boolean(firstName) && titleLower.includes(firstName);
      }) || null;

  return inferredCharacter
    ? [inferredCharacter]
    : uniqueResolvedCharacters;
}

function renderStoryCharactersPage(book, storyCharacters, site, nav, config) {
  const bookTitle = getBookPublicTitle(book) || getCanonicalBookId(book);
  const bookHref = getBookPageHref(book);
  const characterCards = storyCharacters.map((character) => `<a class="character-card" href="../characters/${character.slug}.html" aria-label="Meet ${character.name}">
        <div class="character-card-media">
          <img class="character-hero-thumb" src="../${String(character.heroImage || '').replace(/^\//, '')}" alt="${character.name}" width="320" height="320" loading="lazy" />
        </div>
        <div class="character-card-copy">
          <h3>${character.name}</h3>
          <p>${character.description || ''}</p>
        </div>
      </a>`).join('');

  return renderLayout(
    `${bookTitle} Characters`,
    `Characters you will meet in ${bookTitle}`,
    `<section class="content-card" aria-labelledby="story-characters-heading">
      <h2 id="story-characters-heading">Characters you will meet in this story</h2>
      <p>These are the specific friends listed for this book in the story master.</p>
      <div class="character-grid">${characterCards}</div>
      <p><a class="button" href="${toBookPageSlug(book)}.html">Return to the book</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/books/${toBookPageSlug(book)}-characters.html`,
    config,
    null,
    '../'
  );
}

function renderBookDetailPage(page, site, nav, booksData, config, banner) {
  const book = booksData.books.find((entry) => entry.slug === page.bookSlug);
  const canonicalId = getCanonicalBookId(book);
  const publicTitle = getBookPublicTitle(book) || canonicalId;
  const isStorybook = book && book.seriesSlug === 'storybooks';
  const seriesLabel = isStorybook ? 'Storybook' : 'Book';
  const relatedCards = buildRelatedStorybookCards(booksData, book.slug);
  const storyGuidanceBlock = renderStoryGuidanceBlock(book);
  const storyCharacters = Array.isArray(book && book.characters) ? book.characters : [];
  const storyEnvironments = Array.isArray(book && book.environments) ? book.environments : [];
  const characterAnchor = storyCharacters.length > 0
    ? `<a class="button" href="characters/${String(storyCharacters[0]).toLowerCase() === 'hh-chr-0002' ? 'spencer-field-mouse.html' : 'characters.html'}">Meet the character</a>`
    : '';
  const environmentAnchor = storyEnvironments.length > 0
    ? `<a class="button" href="${storyEnvironments[0] === 'ENV-0028' ? 'entities/environment/env-0028-story-stump.html' : 'map.html'}">Visit the place</a>`
    : '';
  const primaryContinuation = characterAnchor || environmentAnchor
    ? `<p><strong>Continue with:</strong> ${characterAnchor && environmentAnchor ? `${characterAnchor} ${environmentAnchor}` : characterAnchor || environmentAnchor}</p>`
    : '';

  return renderLayout(
    publicTitle,
    canonicalId,
    `<section class="content-card">
      <p class="eyebrow">${seriesLabel}</p>
      <h2>${publicTitle}</h2>
      <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${publicTitle}" />
      <p>${getBookSpecificInvitation(book, { mode: 'detail' })}</p>
      ${storyGuidanceBlock}
      <p><strong>Series:</strong> ${book.seriesSlug || 'Hawkins Hollow'}</p>
      <p>
        ${isStorybook ? '<a class="button" href="storybook-shelf.html">Return to the Storybook Shelf</a>' : '<a class="button" href="books.html">Back to books</a>'}
        <a class="button" href="books.html">Browse the wider library</a>
      </p>
    </section>

    <section class="content-card" aria-labelledby="story-next-step">
      <h2 id="story-next-step">Choose your next step</h2>
      <p>${isStorybook ? 'A story like this often leads naturally to one of the people or places that made it feel real.' : 'Continue exploring the wider Hawkins Hollow library.'}</p>
      ${primaryContinuation}
      <p>
        <a class="button" href="${isStorybook ? 'storybook-shelf.html' : 'books.html'}">${isStorybook ? 'Return to the Storybook Shelf' : 'View the books page'}</a>
        <a class="button" href="books.html">Browse more stories</a>
      </p>
    </section>

    ${isStorybook ? `<section class="content-card" aria-labelledby="more-storybooks">
      <h2 id="more-storybooks">More stories in this world</h2>
      <div class="card-grid">${relatedCards}</div>
    </section>` : ''}`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function getCompanionResourceRegistryResources(companionResourceRegistry) {
  return Array.isArray(companionResourceRegistry && companionResourceRegistry.resources)
    ? companionResourceRegistry.resources
    : [];
}

function getCompanionResourceAudience(resource) {
  return String((resource && resource.structural && resource.structural.primaryAudience) || resource.primaryAudience || 'Shared');
}

function getCompanionResourceStatus(resource) {
  return String((resource && resource.structural && resource.structural.status) || resource.status || 'Draft');
}

function getCompanionResourceSecondaryAudiences(resource) {
  const secondary = (resource && resource.structural && resource.structural.secondaryAudiences) || resource.secondaryAudiences || [];
  return Array.isArray(secondary) ? secondary.filter(Boolean) : [];
}

function getCompanionResourceWorldSummary(resource) {
  const world = resource && resource.world ? resource.world : {};
  const summaryParts = [];
  const addPart = (label, values) => {
    if (!Array.isArray(values) || values.length === 0) {
      return;
    }

    summaryParts.push(`${label}: ${values.join(', ')}`);
  };

  addPart('Characters', world.characters);
  addPart('Places', world.places);
  addPart('Objects', world.objects);
  addPart('Related books', world.relatedBooks);

  return summaryParts;
}

function getCompanionResourceVisitorIntro(resource) {
  const audience = getCompanionResourceAudience(resource);

  if (audience === 'Child') {
    return 'Made for hands-on reading, noticing, and a little bit of play.';
  }

  if (audience === 'Parent/Family') {
    return 'Made for reading together, gentle prompts, and calm conversation.';
  }

  if (audience === 'Educator/Librarian') {
    return 'Made for planning, shared reading, and group-friendly support.';
  }

  return 'Made to help the story continue in a warm, practical way.';
}

function getCompanionResourceVisitorHeadline(resource) {
  const publicName = resource && resource.publicName ? resource.publicName : 'Companion resource';
  const audience = getCompanionResourceAudience(resource);

  if (publicName && /reading support/i.test(publicName)) {
    return 'Reading together builds confidence one page at a time.';
  }

  if (publicName && /family discussion guide/i.test(publicName)) {
    return 'A calm guide for the conversation that comes after the story.';
  }

  if (publicName && /educator notes/i.test(publicName)) {
    return 'A planning note for adults preparing to share the story with a group.';
  }

  if (audience === 'Child') {
    return 'A small activity that helps the story live on in a child’s hands.';
  }

  if (audience === 'Parent/Family') {
    return 'A gentle way to keep reading time connected to daily life.';
  }

  if (audience === 'Educator/Librarian') {
    return 'A practical support page for sharing the story with a group.';
  }

  return publicName;
}

function renderCompanionResourceVisitorCard(resource) {
  const audience = getCompanionResourceAudience(resource);
  const summary = (resource && resource.summary) || 'A warm companion resource that extends the story into daily life.';
  const resourceTitle = resource && resource.publicName ? resource.publicName : (resource && resource.title ? resource.title : 'Companion resource');
  const headline = getCompanionResourceVisitorHeadline(resource);

  return `<article class="start-here-item companion-resource-card">
    <p class="eyebrow">${escapeHtml(audience)}</p>
    <h3>${escapeHtml(resourceTitle)}</h3>
    <p><strong>${escapeHtml(headline)}</strong></p>
    <p>${escapeHtml(summary)}</p>
    <p>${escapeHtml(getCompanionResourceVisitorIntro(resource))}</p>
    <p>
      <a class="button" href="books/HH-A-0001-spencer-s-first-friend.html">Read the story</a>
      <a class="button" href="characters/spencer-field-mouse.html">Meet Spencer</a>
      <a class="button" href="map.html">Open the map</a>
      <a class="button" href="storybook-shelf.html">Continue your journey</a>
    </p>
  </article>`;
}

function renderCompanionResourceDeveloperCard(resource) {
  const structural = resource && resource.structural ? resource.structural : {};
  const worldSummary = getCompanionResourceWorldSummary(resource);
  const secondaryAudiences = getCompanionResourceSecondaryAudiences(resource);
  const sourceFile = resource && (resource.sourceFile || resource.filePath || '');
  const resourceId = resource && resource.resourceId ? resource.resourceId : 'Unknown resource';

  return `<article class="start-here-item companion-resource-registry-card">
    <p class="eyebrow">${escapeHtml(getCompanionResourceAudience(resource))}</p>
    <h3>${escapeHtml(resource.publicName || resource.title || resourceId)}</h3>
    <p><strong>Resource ID:</strong> ${escapeHtml(resourceId)}</p>
    <p><strong>Resource type:</strong> ${escapeHtml(structural.resourceType || resource.resourceType || 'Resource')}</p>
    <p><strong>Status:</strong> ${escapeHtml(getCompanionResourceStatus(resource))}</p>
    ${secondaryAudiences.length > 0 ? `<p><strong>Secondary audience:</strong> ${escapeHtml(secondaryAudiences.join(', '))}</p>` : ''}
    ${sourceFile ? `<p><strong>Source file:</strong> <code>${escapeHtml(sourceFile)}</code></p>` : ''}
    ${worldSummary.length > 0 ? `<p><strong>Shared connections:</strong> ${escapeHtml(worldSummary.join(' | '))}</p>` : ''}
  </article>`;
}

function renderCompanionResourceRegistryPage(companionResourceRegistry, site, nav, config, banner) {
  const resources = getCompanionResourceRegistryResources(companionResourceRegistry);
  const audiences = ['Child', 'Parent/Family', 'Educator/Librarian'];
  const groupedResources = audiences.map((audience) => ({
    audience,
    items: resources.filter((resource) => getCompanionResourceAudience(resource) === audience)
  }));
  const uniqueCharacters = [...new Set(resources.flatMap((resource) => ((resource && resource.world && resource.world.characters) || [])))];
  const uniquePlaces = [...new Set(resources.flatMap((resource) => ((resource && resource.world && resource.world.places) || [])))];
  const uniqueObjects = [...new Set(resources.flatMap((resource) => ((resource && resource.world && resource.world.objects) || [])))];
  const storyId = (companionResourceRegistry && companionResourceRegistry.referenceStory && companionResourceRegistry.referenceStory.id) || 'HH-A-0001';
  const storyTitle = (companionResourceRegistry && companionResourceRegistry.referenceStory && companionResourceRegistry.referenceStory.title) || "Spencer's First Friend";

  const audienceCards = groupedResources.map(({ audience, items }) => {
    const cardHtml = items.length > 0
      ? `<div class="start-here-grid">${items.map(renderCompanionResourceVisitorCard).join('')}</div>`
      : '<p>No resources have been assigned here yet.</p>';

    return `<section class="content-card" aria-labelledby="${escapeHtml(audience.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
      <h2 id="${escapeHtml(audience.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(audience)}</h2>
      <p>${escapeHtml(getCompanionResourceVisitorIntro({ structural: { primaryAudience: audience } }))}</p>
      ${cardHtml}
    </section>`;
  }).join('\n\n');

  const developerCards = groupedResources.map(({ audience, items }) => {
    const cardHtml = items.length > 0
      ? `<div class="start-here-grid">${items.map(renderCompanionResourceDeveloperCard).join('')}</div>`
      : '<p>No resources have been assigned here yet.</p>';

    return `<section class="content-card" aria-labelledby="registry-${escapeHtml(audience.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">
      <h3 id="registry-${escapeHtml(audience.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(audience)}</h3>
      ${cardHtml}
    </section>`;
  }).join('\n\n');

  return renderLayout(
    'Companion Resources',
    'Gentle story extensions for children, families, and educators in Hawkins Hollow.',
    `<section class="content-card" aria-labelledby="visitor-doorway">
      <h2 id="visitor-doorway">Choose a path that fits today</h2>
      <p>Every Hawkins Hollow story has gentle ways to keep the journey going.</p>
      <p>Whether you are reading together at home, sharing a story with a class, or looking for a quiet activity, choose the path that fits today.</p>
    </section>

    <section class="content-card" aria-labelledby="before-you-choose">
      <h2 id="before-you-choose">Before you choose</h2>
      <p>Pick the path that best fits this moment. Each one opens with a welcome, offers one gentle next step, and then helps you continue the story.</p>
      <p>
        <a class="button" href="#child">Children</a>
        <a class="button" href="#parent-family">Parents &amp; Families</a>
        <a class="button" href="#educator-librarian">Educators &amp; Librarians</a>
      </p>
    </section>

    ${audienceCards}

    <section class="content-card" aria-labelledby="registry-shared">
      <h2 id="registry-shared">Shared assets in Spencer's First Friend</h2>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Characters</h3>
          <p>${escapeHtml(uniqueCharacters.length > 0 ? uniqueCharacters.join(', ') : 'None yet')}</p>
        </article>
        <article class="start-here-item">
          <h3>Places</h3>
          <p>${escapeHtml(uniquePlaces.length > 0 ? uniquePlaces.join(', ') : 'None yet')}</p>
        </article>
        <article class="start-here-item">
          <h3>Objects</h3>
          <p>${escapeHtml(uniqueObjects.length > 0 ? uniqueObjects.join(', ') : 'None yet')}</p>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="developer-mode">
      <details>
        <summary id="developer-mode"><strong>Developer Mode:</strong> registry, metadata, and diagnostics</summary>
        <p>This is the authoritative registry view for maintainers. It keeps the system visible without putting it in front of visitors.</p>
        <p><strong>Approved story:</strong> ${escapeHtml(storyId)} ${escapeHtml(storyTitle)}</p>
        <p><strong>Registry counts:</strong> ${resources.length} resources across ${audiences.length} audience pathways.</p>
        <section class="content-card" aria-labelledby="registry-model">
          <h3 id="registry-model">What the registry stores</h3>
          <div class="start-here-grid">
            <article class="start-here-item">
              <h4>Structural relationships</h4>
              <p>Story, series, resource type, audience, file path, and status.</p>
            </article>
            <article class="start-here-item">
              <h4>World relationships</h4>
              <p>Characters, places, landmarks, objects, and related story connections.</p>
            </article>
            <article class="start-here-item">
              <h4>Shared assets</h4>
              <p>Characters, places, objects, and story links that keep every audience in the same world.</p>
            </article>
          </div>
        </section>

        ${developerCards}

        <section class="content-card" aria-labelledby="registry-next">
          <h3 id="registry-next">What happens next</h3>
          <p>When the registry is complete, page shells can consume this data without caring where the PDFs live or how they are named.</p>
          <p><a class="button" href="books.html">Back to Books</a> <a class="button" href="characters.html">Meet Characters</a> <a class="button" href="map.html">Open the Map</a></p>
        </section>
      </details>
    </section>`,
    site,
    nav,
    `${site.domain}/resources.html`,
    config,
    banner
  );
}

function renderUnderConstructionPage(page, site, nav, constructionData, config, banner) {
  if (page && page.slug === 'resources') {
    const registry = readJsonIfExists('data/companion-resource-registry.json');
    if (registry && Array.isArray(registry.resources)) {
      return renderCompanionResourceRegistryPage(registry, site, nav, config, banner);
    }

    return renderLayout(
      'Companion Resources',
      'Gentle prompts and next steps that help stories continue after the last page.',
      `<section class="content-card" aria-labelledby="resources-doorway">
        <h2 id="resources-doorway">Open the Family Drawer</h2>
        <p><strong>Who this is for:</strong> Families and caregivers who want practical, warm help after the story ends.</p>
        <p><strong>What you can experience:</strong> Useful prompts, shared activities, and ready-to-use ideas you can try right away.</p>
        <p><strong>Where to begin:</strong> <a href="#resources-paths">Choose one gentle next step that fits today</a></p>
      </section>

      <section class="content-card" aria-labelledby="resources-intro">
        <h2 id="resources-intro">Family Resources</h2>
        <p>Sometimes the best part of a story begins after the last page. These pathways help families keep the conversation going together.</p>
      </section>

      <section class="content-card" aria-labelledby="resources-paths">
        <h2 id="resources-paths">Choose a Gentle Next Step</h2>
        <div class="start-here-grid">
          <article class="start-here-item">
            <h3>Read Together</h3>
            <p>Begin with a story, then choose one small question to discuss after reading.</p>
            <a class="button" href="books.html">Browse Books</a>
          </article>

          <article class="start-here-item">
            <h3>Visit a Place</h3>
            <p>Explore the map and pick one place to notice together before bedtime.</p>
            <a class="button" href="map.html">Open the Map</a>
          </article>

          <article class="start-here-item">
            <h3>Meet a Friend</h3>
            <p>Choose a character and talk about one quality your family appreciates.</p>
            <a class="button" href="characters.html">Meet Characters</a>
          </article>

          <article class="start-here-item">
            <h3>Keep Exploring</h3>
            <p>Use search to follow a name, a place, or a feeling through Hawkins Hollow.</p>
            <a class="button" href="books.html#library-search">Open Search</a>
          </article>
        </div>
      </section>

      <section class="content-card" aria-labelledby="resources-next">
        <h2 id="resources-next">Where would you like to wander next?</h2>
        <p><a class="button" href="index.html">Return to Welcome Home</a></p>
      </section>`,
      site,
      nav,
      `${site.domain}/resources.html`,
      config,
      banner
    );
  }

  if (page && page.slug === 'community') {
    return renderLayout(
      'Community',
      'A place for shared moments, kind conversations, and neighborly discovery.',
      `<section class="content-card" aria-labelledby="community-doorway">
        <h2 id="community-doorway">Step Onto the Porch</h2>
        <p><strong>Who this is for:</strong> Visitors who want to feel connected through shared moments and neighborhood warmth.</p>
        <p><strong>What you can experience:</strong> Friendships, place-based wandering, and simple invitations to join in with others.</p>
        <p><strong>Where to begin:</strong> <a href="#community-paths">Choose one way to join in today</a></p>
      </section>

      <section class="content-card" aria-labelledby="community-intro">
        <h2 id="community-intro">Community in Hawkins Hollow</h2>
        <p>Hawkins Hollow grows through shared moments. Begin with one friendly path and see where it leads.</p>
      </section>

      <section class="content-card" aria-labelledby="community-paths">
        <h2 id="community-paths">Ways to Join In</h2>
        <div class="start-here-grid">
          <article class="start-here-item">
            <h3>Follow a Friendship</h3>
            <p>Search for two friends and discover how their stories connect.</p>
            <a class="button" href="books.html#library-search">Explore Friendships</a>
          </article>

          <article class="start-here-item">
            <h3>Wander Together</h3>
            <p>Pick a place from the map and let each family member notice one detail.</p>
            <a class="button" href="map.html">Visit a Place</a>
          </article>

          <article class="start-here-item">
            <h3>Meet Someone New</h3>
            <p>Spend a few minutes with a character your family has not met yet.</p>
            <a class="button" href="characters.html">Meet Characters</a>
          </article>

          <article class="start-here-item">
            <h3>Take a Story Home</h3>
            <p>When you find a story that feels right, save it for tonight's reading time.</p>
            <a class="button" href="books.html">Browse Books</a>
          </article>
        </div>
      </section>

      <section class="content-card" aria-labelledby="community-next">
        <h2 id="community-next">Keep the porch light on</h2>
        <p><a class="button" href="index.html">Return to Welcome Home</a></p>
      </section>`,
      site,
      nav,
      `${site.domain}/community.html`,
      config,
      banner
    );
  }

  return renderLayout(
    constructionData.title,
    constructionData.message,
    `<section class="hero-card">
      <p class="eyebrow">Under construction</p>
      <h1>${constructionData.title}</h1>
      <p>${constructionData.message}</p>
      <p>
        <a class="button" href="${constructionData.primaryLinkHref}">${constructionData.primaryLinkLabel}</a>
        <a class="button" href="${constructionData.secondaryLinkHref}">${constructionData.secondaryLinkLabel}</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}

function renderReferenceFallbackPage(page, issue, site, nav, constructionData, config, banner) {
  const isLegacy = page.status === 'legacy';
  const label = isLegacy ? 'Legacy route preserved' : 'Under construction';
  const message = isLegacy
    ? 'This historical route is preserved while its original source record is reconciled.'
    : constructionData.message;

  return renderLayout(
    page.title,
    message,
    `<section class="hero-card">
      <p class="eyebrow">${label}</p>
      <h1>${page.title}</h1>
      <p>${message}</p>
      <p><strong>Unresolved ${issue.type} reference:</strong> ${issue.slug}</p>
      <p><a class="button" href="index.html">Return Home</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function getReferenceIssue(page, seriesData, booksData) {
  if (page.template === 'series') {
    const exists = seriesData.series.some((entry) => entry.slug === page.seriesSlug);
    return exists ? null : { type: 'series', slug: page.seriesSlug };
  }

  if (page.template === 'book-detail') {
    const exists = booksData.books.some((entry) => entry.slug === page.bookSlug);
    return exists ? null : { type: 'book', slug: page.bookSlug };
  }

  if (page.status === 'legacy' && page.legacyReference) {
    return page.legacyReference;
  }

  return null;
}

function writePage(fileName, html, outputDir = buildDir) {
  const outputPath = path.join(outputDir, fileName);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');
}

function writePageToOutputs(fileName, html) {
  outputDirs.forEach((outputDir) => writePage(fileName, html, outputDir));
}

function copyStaticSiteAssets(outputDir) {
  fs.copyFileSync(path.join(root, 'styles.css'), path.join(outputDir, 'styles.css'));
  if (fs.existsSync(path.join(root, 'assets'))) {
    copyDir(path.join(root, 'assets'), path.join(outputDir, 'assets'));
  }
  if (fs.existsSync(path.join(root, 'generated'))) {
    copyDir(path.join(root, 'generated'), path.join(outputDir, 'generated'));
  }
  ensureDir(path.join(outputDir, 'images'));
  if (!fs.existsSync(path.join(outputDir, 'images', 'placeholder-banner.jpg'))) {
    fs.writeFileSync(path.join(outputDir, 'images', 'placeholder-banner.jpg'), 'placeholder-banner');
  }
  if (!fs.existsSync(path.join(outputDir, 'images', 'placeholder-cover.jpg'))) {
    fs.writeFileSync(path.join(outputDir, 'images', 'placeholder-cover.jpg'), 'placeholder-cover');
  }
}

function buildSite() {
  const libraryArtifacts = writeLibraryArtifacts(root);
  const amazonArtifacts = writeAmazonKdpArtifact(root);
  console.log(
    `Library index updated: ${libraryArtifacts.summary.fileCount} files, ${libraryArtifacts.summary.indexedBooks} book records.`
  );
  if (amazonArtifacts.summary.missingWorkbook) {
    console.log('Amazon workbook not found. Skipping Amazon KDP index generation.');
  } else {
    console.log(
      `Amazon index updated: ${amazonArtifacts.summary.recordCount} records, ${amazonArtifacts.summary.liveCount} live listings.`
    );
  }

  const site = readJson('data/site.json');
  const nav = readJson('data/navigation.json');
  const pages = readJson('data/pages.json').pages;
  const seriesData = readJson('data/series.json');
  const booksData = readJson('data/books.json');
  const charactersData = readJson('data/characters.json');
  const constructionData = readJson('data/under-construction.json');
  const config = readJson('data/site-config.json');
  const banners = readJson('data/banners.json');
  const authorityRegistry = loadCanonicalAuthorityRegistry();
  const updatedSourceProjection = writeLegacySourceRegistryProjection(authorityRegistry);
  if (updatedSourceProjection) {
    console.log('Updated deprecated source registry projection from canonical-authority-registry.json.');
  }
  const libraryScan = readJson('generated/library-scan.json');
  const rawLibraryIndex = readJson('generated/library-index.json');
  const hasLibraryBooks = Boolean(rawLibraryIndex && Array.isArray(rawLibraryIndex.books) && rawLibraryIndex.books.length > 0);
  const manifestLibraryIndex = readLibraryIndexFromManifest(root);
  const libraryIndex = hasLibraryBooks
    ? rawLibraryIndex
    : (manifestLibraryIndex || synthesizeLibraryIndexFromBooksData(booksData, seriesData));
  if (!hasLibraryBooks) {
    if (manifestLibraryIndex) {
      console.log(`Library folder unavailable in build environment. Using generated manifest fallback (${libraryIndex.summary.indexedBooks} records).`);
    } else {
      console.log(`Library folder unavailable in build environment. Using synthesized index from data/books.json (${libraryIndex.summary.indexedBooks} records).`);
    }
  }
  const amazonIndex = amazonArtifacts.summary.missingWorkbook
    ? { records: [] }
    : readJson('generated/amazon-index.json');
  const amazonLookup = buildAmazonLookup(amazonIndex);
  const mergedBookIndex = createMergedBookIndex(libraryIndex, amazonLookup);
  const mergedBookIndexPath = writeMergedBookIndex(root, mergedBookIndex);
  const relationshipsData = readJson('data/relationships.json');
  const environmentsData = readJson('data/environments.json');
  const landmarksData = readJson('data/landmarks.json');
  const resourcesData = readJson('data/resources.json');
  const characterCanonArtifacts = writeCharacterCanonArtifact(root, charactersData, libraryScan);
  const characterCanonIndex = readJson('generated/character-canon-index.json');
  const worldCanonArtifacts = writeWorldCanonArtifacts(root, charactersData, libraryScan);
  const worldCanonIndex = readJson('generated/world-canon-index.json');
  const fallbackWorldCanonIndex = readJsonIfExists('data/world-canon-fallback.json');
  const entityIndex = createEntityIndex(
    mergedBookIndex,
    charactersData,
    characterCanonIndex,
    worldCanonIndex,
    fallbackWorldCanonIndex,
    relationshipsData,
    environmentsData,
    landmarksData,
    resourcesData,
    libraryScan,
    authorityRegistry
  );
  const entityIndexPath = writeEntityIndex(root, entityIndex);
  const entityGraph = createEntityGraph(entityIndex);
  const entityGraphPath = writeEntityGraph(root, entityGraph);
  const searchIndex = createSearchIndexFromEntityIndex(entityIndex);
  const searchIndexPath = writeSearchIndex(root, searchIndex);
  console.log(`Search index updated: ${searchIndex.summary.totalRecords} records.`);
  console.log(
    `Merged book index updated: ${mergedBookIndex.summary.recordCount} records (${mergedBookIndex.summary.withAmazonDataCount} with Amazon data).`
  );
  console.log(
    `Character canon index updated: ${characterCanonArtifacts.summary.recordCount} records (${characterCanonArtifacts.summary.withSourceDocumentCount} with source documents).`
  );
  console.log(
    `World canon index updated: ${worldCanonArtifacts.summary.totalRecords} records (relationships ${worldCanonArtifacts.summary.relationships}, environments ${worldCanonArtifacts.summary.environments}, landmarks ${worldCanonArtifacts.summary.landmarks}).`
  );
  console.log(`Entity index updated: ${entityIndex.summary.totalEntities} entities.`);
  if (entityIndex.canonicalAuthoritySelection) {
    const relationshipAuthority = entityIndex.canonicalAuthoritySelection.relationships;
    const environmentAuthority = entityIndex.canonicalAuthoritySelection.environments;
    console.log(
      `Canonical authority selection: relationships -> ${relationshipAuthority.authority} via ${relationshipAuthority.source}; environments -> ${environmentAuthority.authority} via ${environmentAuthority.source}.`
    );
  }
  console.log(
    `Entity graph updated: ${entityGraph.summary.nodeCount} nodes, ${entityGraph.summary.edgeCount} edges (${entityGraph.summary.unresolvedMentionCount} unresolved mentions).`
  );

  const pageDefinitions = pages.map((page) => ({ ...page }));
  const existingSlugs = new Set(pageDefinitions.map((page) => page.slug));
  for (const item of nav.items) {
    const slug = item.href.replace(/\.html$/, '');
    if (!existingSlugs.has(slug)) {
      pageDefinitions.push({
        slug,
        title: item.label,
        template: 'under-construction'
      });
      existingSlugs.add(slug);
    }
  }

  const pageReferenceIssues = new Map();
  for (const page of pageDefinitions) {
    const issue = getReferenceIssue(page, seriesData, booksData);
    if (issue) {
      const fallbackAction = page.status === 'legacy' ? 'legacy' : 'under-construction';
      console.warn(
        `[recovery warning] page "${page.slug}": missing ${issue.type} reference "${issue.slug}"; fallback action: ${fallbackAction}`
      );
      pageReferenceIssues.set(page.slug, issue);
    }
  }

  outputDirs.forEach((outputDir) => resetDir(outputDir));
  outputDirs.forEach((outputDir) => copyStaticSiteAssets(outputDir));

  for (const page of pageDefinitions) {
    const banner = getBannerForPage(page, banners);
    const referenceIssue = pageReferenceIssues.get(page.slug);
    let html = '';
    if (referenceIssue) {
      html = renderReferenceFallbackPage(page, referenceIssue, site, nav, constructionData, config, banner);
    } else if (page.slug === 'index') {
      html = renderLandingPage(page, site, nav, config, banner);
    } else if (page.slug === 'characters') {
      html = renderCharactersPage(site, nav, charactersData, config, banner);
    } else if (page.template === 'article') {
      html = renderArticlePage(page, site, nav, config, banner, libraryIndex, amazonLookup);
    } else if (page.template === 'series') {
      html = renderSeriesPage(page, site, nav, seriesData, booksData, config, banner);
    } else if (page.template === 'book-detail') {
      html = renderBookDetailPage(page, site, nav, booksData, config, banner);
    } else {
      html = renderUnderConstructionPage(page, site, nav, constructionData, config, banner);
    }

    writePageToOutputs(page.slug === 'index' ? 'index.html' : `${page.slug}.html`, html);
  }

  const featuredCharacters = charactersData.characters
    .filter((character) => character.published !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const characterExperienceBanner = (banners && (banners.characters || banners['meet-the-family'])) || null;
  for (const character of featuredCharacters) {
    const experienceAsset = resolveCharacterExperienceAsset(character, charactersData, booksData, entityIndex);
    writePageToOutputs(
      path.join('characters', `${character.slug}.html`),
      renderCharacterExperiencePage(experienceAsset, site, nav, config, characterExperienceBanner)
    );
    writePageToOutputs(
      path.join('characters', `${character.slug}-stories.html`),
      renderCharacterContinuationPage(experienceAsset, 'stories', site, nav, config, characterExperienceBanner)
    );
    writePageToOutputs(
      path.join('characters', `${character.slug}-places.html`),
      renderCharacterContinuationPage(experienceAsset, 'places', site, nav, config, characterExperienceBanner)
    );
    writePageToOutputs(
      path.join('characters', `${character.slug}-people.html`),
      renderCharacterContinuationPage(experienceAsset, 'people', site, nav, config, characterExperienceBanner)
    );
    writePageToOutputs(
      path.join('characters', `${character.slug}-relationships.html`),
      renderCharacterContinuationPage(experienceAsset, 'relationships', site, nav, config, characterExperienceBanner)
    );
  }

  const indexedBooks = (libraryIndex.books || []).slice().sort((a, b) => a.id.localeCompare(b.id));
  const bookModelByCanonicalId = new Map(
    (booksData.books || [])
      .map((modelBook) => [getCanonicalBookId(modelBook).toUpperCase(), modelBook])
      .filter((entry) => Boolean(entry[0]))
  );
  const characterByCanonicalId = new Map(
    (charactersData.characters || [])
      .map((character) => [String(((character.identity && character.identity.canonicalId) || '').trim()).toUpperCase(), character])
      .filter((entry) => Boolean(entry[0]))
  );
  const environmentByCanonicalId = new Map(
    (((worldCanonIndex && worldCanonIndex.byType && worldCanonIndex.byType.environments) || []))
      .map((environment) => [String(environment.id || '').trim().toUpperCase(), environment])
      .filter((entry) => Boolean(entry[0]))
  );
  for (const book of indexedBooks) {
    const storyBook = bookModelByCanonicalId.get((book.id || '').toUpperCase()) || null;
    const storyCharacters = resolveStoryCharactersForBook(storyBook || book, characterByCanonicalId);
    writePageToOutputs(
      getBookPageHref(book),
      renderIndexedBookDetailPage(book, site, nav, config, amazonLookup, {
        bookModelByCanonicalId,
        characterByCanonicalId,
        environmentByCanonicalId
      })
    );
    if (storyCharacters.length > 0) {
      writePageToOutputs(
        getBookCharactersPageHref(book),
        renderStoryCharactersPage(storyBook || book, storyCharacters, site, nav, config)
      );
    }
  }

  const allEntities = (entityIndex.entities || []).slice().sort((a, b) => {
    if (a.type === b.type) {
      return String(a.name || a.title || a.id).localeCompare(String(b.name || b.title || b.id));
    }
    return String(a.type).localeCompare(String(b.type));
  });
  for (const entity of allEntities) {
    const pagePath = entity.entityPageHref || getEntityPageHref(entity.type, entity.id, entity.name || entity.title || '');
    writePageToOutputs(pagePath, renderUniversalEntityPage(entity, entityIndex, entityGraph, site, nav, config, banners));
  }

  console.log(`Generated ${indexedBooks.length} indexed book detail pages.`);
  console.log(`Generated ${allEntities.length} universal entity pages.`);
  console.log(`Copied search index to build output from ${path.relative(root, searchIndexPath)}.`);
  console.log(`Merged book index saved to ${path.relative(root, mergedBookIndexPath)}.`);
  console.log(`Entity index saved to ${path.relative(root, entityIndexPath)}.`);
  console.log(`Entity graph saved to ${path.relative(root, entityGraphPath)}.`);

  console.log('Generated recovery site in build-recovery/');
}

buildSite();
