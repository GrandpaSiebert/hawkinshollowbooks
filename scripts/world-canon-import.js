const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  REGISTRY_RELATIVE_PATH,
  loadRegistry,
  resolveIds,
  serializeRegistry,
  writeIfChanged
} = require('./entity-id-registry');

const LANDMARK_MENTION_SUPPRESSIONS = new Set([
  'Environments/Farmhouse Exterior Visual Canon.docx'
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractDocxRawText(docxPath) {
  try {
    const zip = new AdmZip(docxPath);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) {
      return '';
    }

    const xml = entry.getData().toString('utf8');
    const matches = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    if (matches.length === 0) {
      return '';
    }

    return decodeXmlEntities(matches.map((m) => m[1]).join(' '))
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeDisplayName(value) {
  return String(value || '')
    .replace(/^#+\s*/, '')
    .replace(/^~\$+/, '')
    .replace(/^[a-z]\s*\.\s*(?:\d+\s*)+/i, '')
    .replace(/^(?:\d+[a-z]?(?:\.\d+)?[.)]?\s+)+/i, '')
    .replace(/\s+[-\u2014]\s+(?:Environment|Landmark|Relationship)\s+Card$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkippableCanonFile(file) {
  const name = String(file && file.path ? path.basename(file.path) : '').toLowerCase();
  return name.startsWith('~$');
}

function detectMentions(text, values) {
  const lower = String(text || '').toLowerCase();
  const mentions = [];
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name) {
      continue;
    }

    if (lower.includes(name.toLowerCase())) {
      mentions.push(name);
    }
  }

  return mentions;
}

function toDisplayNameFromPath(filePath) {
  return sanitizeDisplayName(
    path.basename(filePath).replace(/\s+Visual Canon\.docx$/i, '').trim()
  );
}

function toDisplayNameFromText(rawText, fallbackName) {
  const text = String(rawText || '');
  if (!text) {
    return fallbackName;
  }

  const compactText = text.replace(/\s+/g, ' ').trim();
  const headingPatterns = [
    /^(?:\d+[a-z]?(?:\.\d+)?[.)]?\s+)*(.*?)\s+[\u2014-]\s+(?:Environment|Landmark|Relationship)\s+Card\b/i,
    /^(?:\d+[a-z]?(?:\.\d+)?[.)]?\s+)*(.*?)\s+(?:Environment|Landmark|Relationship)\s+Card\b/i,
    /^\s*(?:\d+[a-z]?(?:\.\d+)?[.)]?\s+)*(.*?)\s+[\u2014-]/i
  ];

  let headingName = '';
  for (const pattern of headingPatterns) {
    const match = pattern.exec(compactText);
    if (match && match[1]) {
      headingName = sanitizeDisplayName(match[1]);
      if (headingName) {
        break;
      }
    }
  }

  // Some canon docs begin with a generic heading like
  // "Environment Visual Canon — Hawkins Hollow Farmhouse Exterior".
  // Prefer the specific place name portion when present.
  if (!headingName || /^environment visual canon$/i.test(headingName)) {
    const genericCanonMatch = /environment\s+visual\s+canon\s+[\u2014-]\s+(?:hawkins\s+hollow\s+)?(.+?)\s+environment\s+name\b/i.exec(compactText);
    if (genericCanonMatch && genericCanonMatch[1]) {
      const canonicalName = sanitizeDisplayName(genericCanonMatch[1]);
      if (canonicalName) {
        headingName = canonicalName;
      }
    }
  }

  return headingName.length > 1 ? headingName : fallbackName;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractCanonRecords(type, files, siteRoot, mentionLookups, idsByPath) {
  return files
    .filter((file) => file.extension === 'docx')
    .filter((file) => !isSkippableCanonFile(file))
    .map((file) => {
      const absoluteDocPath = path.join(siteRoot, 'Library', file.path.split('/').join(path.sep));
      const rawText = fs.existsSync(absoluteDocPath) ? extractDocxRawText(absoluteDocPath) : '';
      const fallbackName = toDisplayNameFromPath(file.path);
      const name = toDisplayNameFromText(rawText, fallbackName);
      const id = idsByPath[file.path];

      return {
        type,
        id,
        slug: toSlug(name),
        name,
        sourceDocument: file.path,
        sourceDocumentSizeBytes: file.sizeBytes,
        sourceDocumentLastModifiedUtc: file.lastModifiedUtc,
        textExcerpt: rawText.slice(0, 1800),
        mentions: {
          characters: detectMentions(rawText, mentionLookups.characters),
          environments: detectMentions(rawText, mentionLookups.environments),
          landmarks: LANDMARK_MENTION_SUPPRESSIONS.has(file.path)
            ? []
            : detectMentions(rawText, mentionLookups.landmarks)
        }
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function writeWorldCanonArtifacts(siteRoot, charactersData, libraryScan, outputDir = path.join(siteRoot, 'generated')) {
  ensureDir(outputDir);

  const worldCanonPath = path.join(outputDir, 'world-canon-index.json');
  const relationshipsPath = path.join(outputDir, 'relationship-canon-index.json');
  const environmentsPath = path.join(outputDir, 'environment-canon-index.json');
  const landmarksPath = path.join(outputDir, 'landmark-canon-index.json');

  if (libraryScan && libraryScan.missingLibrary) {
    const existingWorldCanonIndex = readJsonIfExists(worldCanonPath);
    if (existingWorldCanonIndex && existingWorldCanonIndex.byType) {
      const generatedAt = new Date().toISOString();
      const relationshipRecords = (existingWorldCanonIndex.byType.relationships || []).slice();
      const environmentRecords = (existingWorldCanonIndex.byType.environments || []).slice();
      const landmarkRecords = (existingWorldCanonIndex.byType.landmarks || []).slice();
      const preservedWorldCanonIndex = {
        ...existingWorldCanonIndex,
        generatedAt,
        source: {
          charactersFile: 'data/characters.json',
          libraryScanFile: 'generated/library-scan.json'
        },
        summary: {
          relationships: relationshipRecords.length,
          environments: environmentRecords.length,
          landmarks: landmarkRecords.length,
          totalRecords: relationshipRecords.length + environmentRecords.length + landmarkRecords.length
        },
        byType: {
          relationships: relationshipRecords,
          environments: environmentRecords,
          landmarks: landmarkRecords
        }
      };

      fs.writeFileSync(worldCanonPath, `${JSON.stringify(preservedWorldCanonIndex, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        relationshipsPath,
        `${JSON.stringify({ generatedAt, records: relationshipRecords }, null, 2)}\n`,
        'utf8'
      );
      fs.writeFileSync(
        environmentsPath,
        `${JSON.stringify({ generatedAt, records: environmentRecords }, null, 2)}\n`,
        'utf8'
      );
      fs.writeFileSync(
        landmarksPath,
        `${JSON.stringify({ generatedAt, records: landmarkRecords }, null, 2)}\n`,
        'utf8'
      );

      return {
        worldCanonPath,
        relationshipsPath,
        environmentsPath,
        landmarksPath,
        registryPath: path.join(outputDir, 'entity-id-registry.json'),
        summary: preservedWorldCanonIndex.summary
      };
    }
  }

  const registryPath = path.join(outputDir, 'entity-id-registry.json');
  const authoritativeRegistryPath = path.join(siteRoot, REGISTRY_RELATIVE_PATH);

  const files = (libraryScan && libraryScan.files) || [];
  const canonSources = (category) => files
    .filter((file) => file.category === category && file.extension === 'docx' && !isSkippableCanonFile(file))
    .map((file) => file.path);
  const resolution = resolveIds(loadRegistry(authoritativeRegistryPath), {
    relationship: canonSources('Relationships'),
    environment: canonSources('Environments'),
    landmark: canonSources('Landmarks')
  }, { allowNewAllocations: process.env.HH_ENTITY_ID_STRICT !== '1' });
  const ids = resolution.ids;
  const characterNames = ((charactersData && charactersData.characters) || []).map((character) => character.name);
  const environmentNames = files
    .filter((file) => file.category === 'Environments')
    .filter((file) => !isSkippableCanonFile(file))
    .map((file) => toDisplayNameFromPath(file.path));
  const landmarkNames = files
    .filter((file) => file.category === 'Landmarks')
    .filter((file) => !isSkippableCanonFile(file))
    .map((file) => toDisplayNameFromPath(file.path));

  const mentionLookups = {
    characters: characterNames,
    environments: environmentNames,
    landmarks: landmarkNames
  };

  const relationshipRecords = extractCanonRecords(
    'relationship',
    files.filter((file) => file.category === 'Relationships'),
    siteRoot,
    mentionLookups,
    ids.relationship
  );
  const environmentRecords = extractCanonRecords(
    'environment',
    files.filter((file) => file.category === 'Environments'),
    siteRoot,
    mentionLookups,
    ids.environment
  );
  const landmarkRecords = extractCanonRecords(
    'landmark',
    files.filter((file) => file.category === 'Landmarks'),
    siteRoot,
    mentionLookups,
    ids.landmark
  );

  if (resolution.allocated.length) {
    writeIfChanged(authoritativeRegistryPath, serializeRegistry(resolution.registry));
    for (const entry of resolution.allocated) {
      console.warn(`New canonical ID ${entry.id} allocated for ${entry.sourcePath}; commit ${REGISTRY_RELATIVE_PATH}.`);
    }
  }
  writeIfChanged(registryPath, serializeRegistry(resolution.registry));

  const worldCanonIndex = {
    generatedAt: new Date().toISOString(),
    source: {
      charactersFile: 'data/characters.json',
      libraryScanFile: 'generated/library-scan.json'
    },
    summary: {
      relationships: relationshipRecords.length,
      environments: environmentRecords.length,
      landmarks: landmarkRecords.length,
      totalRecords: relationshipRecords.length + environmentRecords.length + landmarkRecords.length
    },
    byType: {
      relationships: relationshipRecords,
      environments: environmentRecords,
      landmarks: landmarkRecords
    }
  };

  fs.writeFileSync(worldCanonPath, `${JSON.stringify(worldCanonIndex, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    relationshipsPath,
    `${JSON.stringify({ generatedAt: worldCanonIndex.generatedAt, records: relationshipRecords }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    environmentsPath,
    `${JSON.stringify({ generatedAt: worldCanonIndex.generatedAt, records: environmentRecords }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    landmarksPath,
    `${JSON.stringify({ generatedAt: worldCanonIndex.generatedAt, records: landmarkRecords }, null, 2)}\n`,
    'utf8'
  );

  return {
    worldCanonPath,
    relationshipsPath,
    environmentsPath,
    landmarksPath,
    registryPath,
    summary: worldCanonIndex.summary
  };
}

function writeRelationshipCanonArtifact(siteRoot, charactersData, libraryScan, outputDir = path.join(siteRoot, 'generated')) {
  const result = writeWorldCanonArtifacts(siteRoot, charactersData, libraryScan, outputDir);
  const payload = JSON.parse(fs.readFileSync(result.relationshipsPath, 'utf8'));
  return {
    outputPath: result.relationshipsPath,
    registryPath: result.registryPath,
    summary: {
      recordCount: (payload.records || []).length
    }
  };
}

function writeEnvironmentCanonArtifact(siteRoot, charactersData, libraryScan, outputDir = path.join(siteRoot, 'generated')) {
  const result = writeWorldCanonArtifacts(siteRoot, charactersData, libraryScan, outputDir);
  const payload = JSON.parse(fs.readFileSync(result.environmentsPath, 'utf8'));
  return {
    outputPath: result.environmentsPath,
    registryPath: result.registryPath,
    summary: {
      recordCount: (payload.records || []).length
    }
  };
}

function writeLandmarkCanonArtifact(siteRoot, charactersData, libraryScan, outputDir = path.join(siteRoot, 'generated')) {
  const result = writeWorldCanonArtifacts(siteRoot, charactersData, libraryScan, outputDir);
  const payload = JSON.parse(fs.readFileSync(result.landmarksPath, 'utf8'));
  return {
    outputPath: result.landmarksPath,
    registryPath: result.registryPath,
    summary: {
      recordCount: (payload.records || []).length
    }
  };
}

module.exports = {
  writeWorldCanonArtifacts,
  writeRelationshipCanonArtifact,
  writeEnvironmentCanonArtifact,
  writeLandmarkCanonArtifact
};
