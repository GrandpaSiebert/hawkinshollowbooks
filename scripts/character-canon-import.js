const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

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

function toCanonicalCode(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCharacterDocument(characterCode, docs) {
  const code = toCanonicalCode(characterCode);
  if (!code) {
    return null;
  }

  for (const doc of docs) {
    const fileName = path.basename(doc.path).toLowerCase();
    if (fileName.startsWith(`${code} `) || fileName.startsWith(`${code}-`)) {
      return doc;
    }
  }

  return null;
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

function writeCharacterCanonArtifact(siteRoot, charactersData, libraryScan, outputDir = path.join(siteRoot, 'generated')) {
  const files = (libraryScan && libraryScan.files) || [];
  const characterDocs = files.filter((file) => file.category === 'Characters' && file.extension === 'docx');
  const environmentNames = files
    .filter((file) => file.category === 'Environments')
    .map((file) => path.basename(file.path).replace(/\s+Visual Canon\.docx$/i, ''));
  const landmarkNames = files
    .filter((file) => file.category === 'Landmarks')
    .map((file) => path.basename(file.path).replace(/\s+Visual Canon\.docx$/i, ''));

  const allCharacterNames = ((charactersData && charactersData.characters) || []).map((c) => c.name);
  const records = ((charactersData && charactersData.characters) || []).map((character) => {
    const doc = resolveCharacterDocument(character.code || character.slug, characterDocs);
    const absoluteDocPath = doc ? path.join(siteRoot, 'Library', doc.path.split('/').join(path.sep)) : null;
    const rawText = absoluteDocPath && fs.existsSync(absoluteDocPath) ? extractDocxRawText(absoluteDocPath) : '';
    const excerpt = rawText.slice(0, 1600);

    return {
      id: character.code || character.slug,
      slug: character.slug,
      name: character.name,
      role: character.role || '',
      sourceDocument: doc ? doc.path : null,
      sourceDocumentSizeBytes: doc ? doc.sizeBytes : null,
      sourceDocumentLastModifiedUtc: doc ? doc.lastModifiedUtc : null,
      textExcerpt: excerpt,
      mentions: {
        characters: detectMentions(excerpt, allCharacterNames).filter((name) => name !== character.name),
        environments: detectMentions(excerpt, environmentNames),
        landmarks: detectMentions(excerpt, landmarkNames)
      }
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    source: {
      charactersFile: 'data/characters.json',
      libraryScanFile: 'generated/library-scan.json'
    },
    summary: {
      recordCount: records.length,
      withSourceDocumentCount: records.filter((record) => Boolean(record.sourceDocument)).length
    },
    records
  };

  ensureDir(outputDir);
  const outputPath = path.join(outputDir, 'character-canon-index.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  return {
    outputPath,
    summary: output.summary
  };
}

module.exports = {
  writeCharacterCanonArtifact
};
