const AdmZip = require('adm-zip');

const FIELD_SCHEMAS = [
  { key: 'storyId', labels: ['Story ID'], shape: 'scalar', tier: 1 },
  { key: 'series', labels: ['Series'], shape: 'scalar', tier: 1 },
  { key: 'seriesUnderUmbrella', labels: ['Series under umbrella'], shape: 'scalar', tier: 1 },
  { key: 'mode', labels: ['Mode'], shape: 'scalar', tier: 1 },
  { key: 'title', labels: ['Title'], shape: 'scalar', tier: 1 },
  { key: 'subtitle', labels: ['Subtitle'], shape: 'scalar', tier: 1 },
  { key: 'mainCharacters', labels: ['Main Characters', 'Visible Cast', 'Cast of Characters'], shape: 'list', tier: 1, resolutionType: 'character' },
  { key: 'featuredCharacters', labels: ['Featured Characters'], shape: 'list', tier: 1, resolutionType: 'character' },
  { key: 'settingSpot', labels: ['Setting Spot', 'Setting'], shape: 'scalar', tier: 1 },
  { key: 'featuredEnvironment', labels: ['Featured Environment'], shape: 'scalar', tier: 1, resolutionType: 'environment' },
  { key: 'themeSkill', labels: ['Theme/Skill', 'Theme Skill'], shape: 'scalar', tier: 1 },
  { key: 'problemTrigger', labels: ['Problem Trigger'], shape: 'scalar', tier: 1 },
  { key: 'endingFeeling', labels: ['Ending Feeling'], shape: 'scalar', tier: 1 },
  { key: 'keyRepeatPhrase', labels: ['Key Repeat Phrase'], shape: 'scalar', tier: 1 },
  { key: 'weather', labels: ['Weather'], shape: 'scalar', tier: 1 },
  { key: 'shortDescription', labels: ['Short Description'], shape: 'scalar', tier: 1 },
  { key: 'longDescription', labels: ['Long Description'], shape: 'scalar', tier: 1 },
  { key: 'websiteDescription', labels: ['Website Description'], shape: 'scalar', tier: 1 },
  { key: 'ageRange', labels: ['Age Range'], shape: 'scalar', tier: 1 },
  { key: 'gradeRange', labels: ['Grade Range'], shape: 'scalar', tier: 1 },
  { key: 'readingAge', labels: ['Reading Age'], shape: 'scalar', tier: 1 },
  { key: 'themes', labels: ['Themes', 'Website Themes'], shape: 'list', tier: 1 },
  { key: 'tool', labels: ['Good Feeling Tool', 'SEL Tool', 'Good Feeling Tools Used in This Story'], sectionLabels: ['Good Feeling Tools Used in This Story'], shape: 'scalar', tier: 2 },
  { key: 'toolSteps', labels: ['Step 1', 'Step 2', 'Step 3'], shape: 'steps', tier: 2, sections: ['Story Info', 'Good Feeling Tools used in this story'] },
  { key: 'lifeLesson', labels: ['Life Lesson'], shape: 'scalar', tier: 2 },
  { key: 'activities', labels: ['Activity', 'Activities', 'Website Activities', 'Welcome Activity'], shape: 'block', tier: 2 },
  { key: 'downloads', labels: ['Downloads'], shape: 'list', tier: 2 },
  { key: 'characterDependencies', labels: ['Uses Character Canon', 'Character Canon Dependencies'], shape: 'list', tier: 3, resolutionType: 'character' },
  { key: 'relationshipDependencies', labels: ['Uses Relationship Canon', 'Relationship Canon Dependencies'], shape: 'list', tier: 3, resolutionType: 'relationship' },
  { key: 'environmentDependencies', labels: ['Uses Environment Canon', 'Environment Canon Dependencies'], shape: 'list', tier: 3, resolutionType: 'environment' },
  { key: 'landmarkDependencies', labels: ['Uses Landmark Canon', 'Landmark Canon Dependencies'], shape: 'list', tier: 3, resolutionType: 'landmark' },
  { key: 'crossReferenceCharacters', labels: ['Characters'], shape: 'list', tier: 4, resolutionType: 'character', sections: ['Cross-Reference Index'] },
  { key: 'crossReferenceRelationships', labels: ['Relationships'], shape: 'list', tier: 4, resolutionType: 'relationship', sections: ['Cross-Reference Index'] },
  { key: 'crossReferenceEnvironments', labels: ['Environments'], shape: 'list', tier: 4, resolutionType: 'environment', sections: ['Cross-Reference Index'] },
  { key: 'crossReferenceLandmarks', labels: ['Landmarks'], shape: 'list', tier: 4, resolutionType: 'landmark', sections: ['Cross-Reference Index'] },
  { key: 'relatedStories', labels: ['Related Stories'], shape: 'list', tier: 4 }
];

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/:$/, '').toLowerCase();
}

function getParagraphs(docxPath) {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) {
    throw new Error('word/document.xml is missing');
  }
  const xml = entry.getData().toString('utf8');
  return Array.from(xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g))
    .flatMap((match) => {
      const paragraphXml = match[1].replace(/<w:(?:br|cr|tab)(?:\s[^>]*)?\s*\/>|<\/w:tc>|<\/w:r>/g, '\n');
      const text = decodeXmlEntities(paragraphXml.replace(/<[^>]+>/g, ''));
      return text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => Boolean(line));
    });
}

function isSectionHeading(paragraph) {
  const value = String(paragraph || '').replace(/^\d+\.\s+/, '');
  return /^[A-Z][A-Za-z0-9/&' -]{2,80}:?$/.test(value)
    && !value.includes(':')
    && value.length <= 80;
}

function splitList(value) {
  return String(value || '')
    .split(/\s*[;|]\s*|\s*,\s*/)
    .map((item) => item.replace(/^[-*•]\s*/, '').trim())
    .filter((item) => Boolean(item));
}

function extractStoryMaster(docxPath, sourceDocument) {
  const paragraphs = getParagraphs(docxPath);
  const labelMap = new Map();
  const sectionValueMap = new Map();
  for (const schema of FIELD_SCHEMAS) {
    for (const label of schema.labels) {
      labelMap.set(normalizeLabel(label), schema);
    }
    for (const label of schema.sectionLabels || []) {
      sectionValueMap.set(normalizeLabel(label), schema);
    }
  }

  const fields = {};
  const unknownLabels = [];
  let currentSection = '';
  let pendingSectionValue = null;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (isSectionHeading(paragraph)) {
      currentSection = paragraph.replace(/^\d+\.\s+/, '').replace(/:$/, '');
      pendingSectionValue = sectionValueMap.get(normalizeLabel(currentSection)) || null;
      continue;
    }
    const match = /^([^:]{2,80}):\s*(.*)$/.exec(paragraph);
    if (!match) {
      if (pendingSectionValue && !fields[pendingSectionValue.key]) {
        fields[pendingSectionValue.key] = {
          value: paragraph,
          sourceDocument,
          sourceSection: currentSection,
          sourceLabel: currentSection,
          extractionMethod: 'exact-section-value-v1',
          authorityClass: 'Story Master',
          tier: pendingSectionValue.tier,
          resolutionType: pendingSectionValue.resolutionType || null
        };
      }
      pendingSectionValue = null;
      continue;
    }
    pendingSectionValue = null;
    const label = match[1].trim();
    const schema = labelMap.get(normalizeLabel(label));
    if (!schema || (schema.sections && !schema.sections.includes(currentSection))) {
      unknownLabels.push({ sourceSection: currentSection || null, sourceLabel: label });
      continue;
    }
    let rawValue = match[2].trim();
    if (!rawValue) {
      const lines = [];
      for (let next = index + 1; next < paragraphs.length; next += 1) {
        if (isSectionHeading(paragraphs[next]) || /^([^:]{2,80}):\s*/.test(paragraphs[next])) {
          break;
        }
        lines.push(paragraphs[next]);
      }
      rawValue = lines.join(schema.shape === 'block' ? '\n' : ' ');
    }
    if (!rawValue) {
      continue;
    }
    const value = schema.shape === 'list' ? splitList(rawValue) : rawValue;
    const record = {
      value,
      sourceDocument,
      sourceSection: currentSection || null,
      sourceLabel: label,
      extractionMethod: schema.shape === 'block' ? 'exact-labeled-block-v1' : 'exact-labeled-v1',
      authorityClass: 'Story Master',
      tier: schema.tier,
      resolutionType: schema.resolutionType || null
    };
    if (schema.shape === 'steps') {
      if (!fields[schema.key]) {
        fields[schema.key] = { ...record, value: [] };
      }
      fields[schema.key].value.push({ label, value: rawValue, sourceDocument, sourceSection: currentSection || null });
    } else if (!fields[schema.key]) {
      fields[schema.key] = record;
    } else if (JSON.stringify(fields[schema.key].value) !== JSON.stringify(value)) {
      fields[schema.key].resolutionStatus = 'conflict';
    }
  }
  return { paragraphs, fields, unknownLabels };
}

module.exports = { FIELD_SCHEMAS, extractStoryMaster, normalizeLabel };