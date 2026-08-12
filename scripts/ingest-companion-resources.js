const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const registryPath = path.join(root, 'data', 'companion-resource-registry.json');
const booksPath = path.join(root, 'data', 'books.json');
const libraryRoot = path.join(root, 'Library');
const targetRoot = path.join(libraryRoot, 'Books', 'HH-A Storybooks', 'HH-A-0001-0010');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function toSlugUpper(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function toTitleWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word)) {
        return word;
      }
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(' ')
    .trim();
}

function inferAudienceAndType(fileStem) {
  const lower = fileStem.toLowerCase();

  if (lower.includes('educator') || lower.includes('librarian')) {
    return {
      audience: 'Educator/Librarian',
      secondaryAudiences: [],
      resourceType: 'Educator Notes'
    };
  }

  if (lower.includes('family guide') || lower.includes('family-discussion-guide') || lower.includes('discussion guide')) {
    return {
      audience: 'Parent/Family',
      secondaryAudiences: [],
      resourceType: 'Family Discussion Guide'
    };
  }

  if (lower.includes('reading support')) {
    return {
      audience: 'Parent/Family',
      secondaryAudiences: [],
      resourceType: 'Reading Support'
    };
  }

  const typeMap = {
    COLOR: 'Coloring Page',
    DISCUSS: 'Discussion Cards',
    MATCH: 'Matching Activity',
    OBJECT: 'Object Sorting Page',
    RECOG: 'Recognition Set',
    SCAV: 'Scavenger Hunt',
    SEQ: 'Sequence Activity',
    SEQUENCE: 'Sequence Activity',
    VOCAB: 'Vocabulary Cards',
    RETELL: 'Retell Activity',
    SAFE: 'Safety Activity',
    TOOL: 'Tool Activity',
    WAIT: 'Waiting Activity',
    CHOICE: 'Choice Activity',
    COMM: 'Communication Activity',
    MAP: 'Map Activity',
    REFLECT: 'Reflection Activity',
    SORT: 'Sorting Activity',
    LANGUAGE: 'Language Activity',
    PATH: 'Path Activity',
    NOTICE: 'Noticing Activity',
    ACCESSIBLE: 'Accessibility Activity',
    HELPER: 'Helper Activity',
    ONE: 'One-Step Activity',
    TEAMPLAN3: 'Team Plan Activity',
    CHECK: 'Check-in Activity',
    TOGETHER: 'Together Activity',
    CHARACTER: 'Character Activity'
  };

  const actMatch = fileStem.match(/-ACT-([A-Z0-9]+)/i);
  const code = actMatch ? String(actMatch[1]).toUpperCase() : '';

  return {
    audience: 'Child',
    secondaryAudiences: ['Parent/Family'],
    resourceType: typeMap[code] || 'Activity Resource'
  };
}

function inferPublicName(storyId, fileStem) {
  const normalized = String(fileStem || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(new RegExp(`^${storyId}[-\s]*`, 'i'), '')
    .replace(/-V\d+(-WORKING)?$/i, '')
    .replace(/-WORKING$/i, '')
    .replace(/^-+/, '')
    .trim();

  if (!normalized) {
    return `${storyId} Companion Resource`;
  }

  const pretty = normalized
    .replace(/\bACT-?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/-/g, ' ')
    .trim();

  return toTitleWords(pretty);
}

function collectPdfFiles(dirPath) {
  const output = [];
  const entries = fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }) : [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectPdfFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.pdf$/i.test(entry.name) && !/generator\s*prompt/i.test(entry.name)) {
      output.push(fullPath);
    }
  }

  return output;
}

function main() {
  if (!fs.existsSync(registryPath)) {
    throw new Error('Missing registry file: data/companion-resource-registry.json');
  }
  if (!fs.existsSync(booksPath)) {
    throw new Error('Missing books file: data/books.json');
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const booksData = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
  const books = Array.isArray(booksData && booksData.books) ? booksData.books : [];

  const bookById = new Map(
    books
      .map((book) => [String(((book.identity && book.identity.canonicalId) || book.canonicalId || '')).toUpperCase(), book])
      .filter((entry) => Boolean(entry[0]))
  );

  const existingResources = Array.isArray(registry.resources) ? registry.resources : [];
  const existingBySource = new Set(existingResources.map((resource) => normalizePath(resource.sourceFile || resource.filePath).toLowerCase()));
  const existingById = new Set(existingResources.map((resource) => String(resource.resourceId || '').toUpperCase()));

  const storyFolders = fs.existsSync(targetRoot)
    ? fs.readdirSync(targetRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];

  const newResources = [];

  for (const folder of storyFolders) {
    const storyIdMatch = folder.name.match(/^(HH-A-\d{4})\b/i);
    if (!storyIdMatch) {
      continue;
    }

    const storyId = storyIdMatch[1].toUpperCase();
    const numericPart = Number(storyId.slice(-4));
    if (!Number.isFinite(numericPart) || numericPart < 1 || numericPart > 10) {
      continue;
    }

    const book = bookById.get(storyId);
    const storyTitle = String(book && book.title ? book.title : folder.name.replace(/^HH-A-\d{4}\s*/i, '')).trim();
    const companionDir = path.join(targetRoot, folder.name, 'Companion Resources');
    const pdfFiles = collectPdfFiles(companionDir);

    for (const pdfPath of pdfFiles) {
      const relativeLibraryPath = normalizePath(path.relative(libraryRoot, pdfPath));
      const sourceFile = relativeLibraryPath;
      const normalizedSourceFile = sourceFile.toLowerCase();
      if (existingBySource.has(normalizedSourceFile)) {
        continue;
      }

      const fileStem = path.basename(pdfPath, path.extname(pdfPath));
      const resourceIdCandidate = toSlugUpper(fileStem);
      let resourceId = resourceIdCandidate;
      let suffix = 2;
      while (existingById.has(resourceId) || newResources.some((resource) => resource.resourceId === resourceId)) {
        resourceId = `${resourceIdCandidate}-${suffix}`;
        suffix += 1;
      }

      const typeInfo = inferAudienceAndType(fileStem);
      const publicName = inferPublicName(storyId, fileStem);
      const status = /working/i.test(fileStem) ? 'Working' : 'Review';

      newResources.push({
        resourceId,
        publicName,
        sourceFile,
        summary: `${publicName} companion resource for ${storyTitle}.`,
        structural: {
          storyId,
          storyTitle,
          series: 'Storybooks',
          resourceType: typeInfo.resourceType,
          primaryAudience: typeInfo.audience,
          secondaryAudiences: typeInfo.secondaryAudiences,
          status
        },
        world: {
          characters: [],
          places: [],
          landmarks: [],
          objects: [],
          relatedStories: [storyId],
          relatedBooks: [storyTitle]
        }
      });
    }
  }

  const merged = existingResources.concat(newResources);
  merged.sort((a, b) => {
    const aStory = String((a.structural && a.structural.storyId) || '');
    const bStory = String((b.structural && b.structural.storyId) || '');
    if (aStory !== bStory) {
      return aStory.localeCompare(bStory);
    }
    return String(a.publicName || a.resourceId || '').localeCompare(String(b.publicName || b.resourceId || ''));
  });

  registry.resources = merged;
  registry.generatedAt = new Date().toISOString();

  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  const counts = merged.reduce((acc, resource) => {
    const storyId = String((resource.structural && resource.structural.storyId) || 'UNKNOWN').toUpperCase();
    acc[storyId] = (acc[storyId] || 0) + 1;
    return acc;
  }, {});

  console.log(`Companion resource registry updated: +${newResources.length} new resources.`);
  console.log(JSON.stringify(counts, null, 2));
}

main();
