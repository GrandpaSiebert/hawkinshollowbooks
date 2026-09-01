const fs = require('fs');
const path = require('path');
const { FIELD_SCHEMAS, extractStoryMaster, normalizeLabel } = require('./story-master-extractor');

const root = path.join(__dirname, '..');
const sampleIds = ['HH-A-0005', 'HH-A-0001', 'HH-B-0001', 'HH-C-0001', 'HH-C+-0001', 'HH-D-0001', 'HH-E-0001'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function buildLookup(records) {
  const map = new Map();
  for (const record of records || []) {
    for (const [value, resolutionStatus] of [[record.name, 'exact'], [record.title, 'exact'], [record.id, 'resolved-alias'], [record.slug, 'resolved-alias']]) {
      const key = normalizeLabel(value);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push({ record, resolutionStatus });
      map.set(key, list);
    }
  }
  return map;
}

function resolveValues(field, lookups) {
  if (!field || !field.value || !Array.isArray(field.value) || !field.resolutionType) return field;
  const lookup = lookups[field.resolutionType];
  field.resolutions = field.value.map((rawValue) => {
    const candidates = lookup ? lookup.get(normalizeLabel(rawValue)) || [] : [];
    if (candidates.length === 1) return { rawValue, normalizedLookupValue: normalizeLabel(rawValue), canonicalId: candidates[0].record.id, resolutionStatus: candidates[0].resolutionStatus };
    if (candidates.length > 1) return { rawValue, normalizedLookupValue: normalizeLabel(rawValue), canonicalId: null, resolutionStatus: 'ambiguous' };
    return { rawValue, normalizedLookupValue: normalizeLabel(rawValue), canonicalId: null, resolutionStatus: 'unresolved' };
  });
  field.resolutionStatus = field.resolutions.every((entry) => entry.resolutionStatus === 'exact') ? 'exact' : 'unresolved';
  return field;
}

function compareBookModel(fields, model) {
  const comparisons = [];
  const modelValues = {
    title: model && model.title,
    shortDescription: model && model.description,
    longDescription: model && model.summary,
    mainCharacters: model && model.characters,
    themes: model && model.themes,
    endingFeeling: model && model.feelings
  };
  for (const [field, bookValue] of Object.entries(modelValues)) {
    const storyValue = fields[field] && fields[field].value;
    const hasStoryValue = Array.isArray(storyValue) ? storyValue.length > 0 : Boolean(storyValue);
    const hasBookValue = Array.isArray(bookValue) ? bookValue.length > 0 : Boolean(bookValue);
    const same = JSON.stringify(storyValue) === JSON.stringify(bookValue);
    comparisons.push({ field, status: hasStoryValue && hasBookValue ? (same ? 'MATCH' : 'CONFLICT') : hasStoryValue ? 'STORY-MASTER-ONLY' : hasBookValue ? 'BOOK-MODEL-ONLY' : 'NOT-COMPARABLE', storyMasterValue: storyValue || null, bookModelValue: bookValue || null });
  }
  return comparisons;
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function createReport(scope, libraryBookCount, accessibleDocxCount) {
  return {
    scope,
    libraryBookCount,
    accessibleDocxCount,
    filesScanned: 0,
    recognizedStoryMasters: 0,
    libraryBooksWithStoryMaster: 0,
    libraryBooksWithoutStoryMaster: [],
    parseFailures: [],
    duplicateIds: [],
    idMismatches: [],
    identityValidation: [],
    unresolvedReferences: [],
    fieldCoverage: {},
    coverageBySeries: {},
    missingFieldClassification: {},
    unknownLabels: [],
    templateClusters: {},
    resolutionTotals: {
      character: { raw: 0, exact: 0, resolvedAlias: 0, unresolved: 0, ambiguous: 0, conflict: 0 },
      relationship: { raw: 0, exact: 0, resolvedAlias: 0, unresolved: 0, ambiguous: 0, conflict: 0 },
      environment: { raw: 0, exact: 0, resolvedAlias: 0, unresolved: 0, ambiguous: 0, conflict: 0 },
      landmark: { raw: 0, exact: 0, resolvedAlias: 0, unresolved: 0, ambiguous: 0, conflict: 0 }
    },
    unresolvedReferenceClusters: [],
    bookModelComparisonTotals: { MATCH: 0, 'STORY-MASTER-ONLY': 0, 'BOOK-MODEL-ONLY': 0, CONFLICT: 0, 'NOT-COMPARABLE': 0 },
    bookModelConflicts: [],
    storyMastersWithBookModel: 0,
    storyMastersWithoutBookModel: 0,
    bookModelRecordsWithoutStoryMaster: [],
    websiteInformationCoverage: {},
    descriptionRecovery: { allThree: 0, two: 0, one: 0, none: 0 },
    worldConnectionRecovery: {}
  };
}

function addRecordToReport(report, record, libraryBook, hasBookModel) {
  const series = String((libraryBook && libraryBook.series) || 'Unknown');
  const seriesCoverage = report.coverageBySeries[series] || { records: 0, fields: {} };
  seriesCoverage.records += 1;
  report.coverageBySeries[series] = seriesCoverage;
  const fieldKeys = Object.keys(record.fields).sort();
  const signature = fieldKeys.join('|');
  const cluster = report.templateClusters[signature] || { count: 0, series: {}, fields: fieldKeys };
  cluster.count += 1;
  increment(cluster.series, series);
  report.templateClusters[signature] = cluster;
  if (hasBookModel) report.storyMastersWithBookModel += 1;
  else report.storyMastersWithoutBookModel += 1;

  for (const schema of FIELD_SCHEMAS) {
    if (record.fields[schema.key]) {
      increment(report.fieldCoverage, schema.key);
      increment(seriesCoverage.fields, schema.key);
    } else {
      increment(report.missingFieldClassification, `${schema.key}:FIELD_ABSENT`);
    }
  }
  for (const label of record.unknownLabels) {
    const entry = report.unknownLabels.find((candidate) => candidate.sourceSection === (label.sourceSection || null) && candidate.sourceLabel === label.sourceLabel)
      || { sourceSection: label.sourceSection || null, sourceLabel: label.sourceLabel, occurrences: 0, series: {} };
    if (!report.unknownLabels.includes(entry)) report.unknownLabels.push(entry);
    entry.occurrences += 1;
    increment(entry.series, series);
  }
  for (const [key, field] of Object.entries(record.fields)) {
    for (const resolution of field.resolutions || []) {
      const totals = report.resolutionTotals[field.resolutionType];
      if (!totals) continue;
      totals.raw += 1;
      if (resolution.resolutionStatus === 'exact') totals.exact += 1;
      else if (resolution.resolutionStatus === 'resolved-alias') totals.resolvedAlias += 1;
      else if (resolution.resolutionStatus === 'ambiguous') totals.ambiguous += 1;
      else totals.unresolved += 1;
      if (resolution.resolutionStatus !== 'exact' && resolution.resolutionStatus !== 'resolved-alias') {
        const unresolved = report.unresolvedReferenceClusters.find((candidate) => candidate.entityType === field.resolutionType && candidate.rawValue === resolution.rawValue)
          || { entityType: field.resolutionType, rawValue: resolution.rawValue, occurrences: 0, storyMasterIds: [], series: {} };
        if (!report.unresolvedReferenceClusters.includes(unresolved)) report.unresolvedReferenceClusters.push(unresolved);
        unresolved.occurrences += 1;
        if (!unresolved.storyMasterIds.includes(record.id)) unresolved.storyMasterIds.push(record.id);
        increment(unresolved.series, series);
        report.unresolvedReferences.push({ id: record.id, field: key, ...resolution, provenance: { sourceDocument: record.sourceDocument, sourceSection: field.sourceSection, sourceLabel: field.sourceLabel } });
      }
    }
  }
  for (const comparison of record.bookModelComparison) {
    increment(report.bookModelComparisonTotals, comparison.status);
    if (comparison.status === 'CONFLICT') report.bookModelConflicts.push({ id: record.id, ...comparison, provenance: record.fields[comparison.field] || null });
  }
  const websiteFields = ['websiteDescription', 'featuredCharacters', 'featuredEnvironment', 'readingAge', 'themes', 'relatedStories', 'downloads', 'activities'];
  for (const field of websiteFields) if (record.fields[field]) increment(report.websiteInformationCoverage, field);
  const descriptionCount = ['shortDescription', 'longDescription', 'websiteDescription'].filter((field) => record.fields[field]).length;
  increment(report.descriptionRecovery, descriptionCount === 3 ? 'allThree' : descriptionCount === 2 ? 'two' : descriptionCount === 1 ? 'one' : 'none');
  for (const field of ['characterDependencies', 'relationshipDependencies', 'environmentDependencies', 'landmarkDependencies']) {
    const entries = (record.fields[field] && record.fields[field].resolutions) || [];
    const summary = report.worldConnectionRecovery[field] || { declaredBooks: 0, raw: 0, graphReady: 0, blockedByResolution: 0 };
    if (entries.length > 0) summary.declaredBooks += 1;
    for (const entry of entries) {
      summary.raw += 1;
      if (entry.resolutionStatus === 'exact' || entry.resolutionStatus === 'resolved-alias') summary.graphReady += 1;
      else summary.blockedByResolution += 1;
    }
    report.worldConnectionRecovery[field] = summary;
  }
}

function project(ids, scope, dryRun) {
  const libraryIndex = readJson('generated/library-index.json');
  const booksData = readJson('data/books.json').books || [];
  const charactersData = readJson('data/characters.json').characters || [];
  const entityIndex = readJson('generated/entity-index.json');
  const libraryBooks = libraryIndex.books || [];
  const modelById = new Map(booksData.map((book) => [String(book.identity && book.identity.canonicalId || '').toUpperCase(), book]));
  const libraryById = new Map(libraryBooks.map((book) => [String(book.id || '').toUpperCase(), book]));
  const accessibleDocxCount = libraryBooks.flatMap((book) => book.files || []).filter((file) => /\.docx$/i.test(file) && fs.existsSync(path.join(root, 'Library', ...file.split('/')))).length;
  const lookups = {
    character: buildLookup(charactersData.map((character) => ({ ...character, id: String(character.identity && character.identity.canonicalId || character.id || character.code || '') }))),
    relationship: buildLookup(entityIndex.byType.relationships),
    environment: buildLookup(entityIndex.byType.environments),
    landmark: buildLookup(entityIndex.byType.landmarks)
  };
  const report = createReport(scope, libraryBooks.length, accessibleDocxCount);
  const records = [];
  const sourceOwners = new Map();
  const candidateIds = ids || libraryBooks.map((book) => String(book.id || '').toUpperCase());
  for (const id of candidateIds) {
    const libraryBook = libraryById.get(id);
    const sourceDocument = libraryBook && (libraryBook.files || []).find((file) => /story master\.docx$/i.test(file));
    if (!sourceDocument) {
      if (libraryBook) report.libraryBooksWithoutStoryMaster.push(id);
      continue;
    }
    report.filesScanned += 1;
    const absolutePath = path.join(root, 'Library', ...sourceDocument.split('/'));
    if (!fs.existsSync(absolutePath)) {
      report.parseFailures.push({ id, sourceDocument, message: 'Story Master file is inaccessible.' });
      continue;
    }
    try {
      const extraction = extractStoryMaster(absolutePath, sourceDocument);
      report.recognizedStoryMasters += 1;
      report.libraryBooksWithStoryMaster += 1;
      Object.values(extraction.fields).forEach((field) => resolveValues(field, lookups));
      const documentDeclaredId = extraction.fields.storyId ? String(extraction.fields.storyId.value || '').toUpperCase() : '';
      const owner = documentDeclaredId ? sourceOwners.get(documentDeclaredId) : null;
      let identityStatus = 'MATCH';
      if (!documentDeclaredId) identityStatus = 'DOCUMENT-ID-ABSENT';
      else if (owner) identityStatus = 'DUPLICATE-DOCUMENT-ID';
      else if (documentDeclaredId !== id) identityStatus = 'MISMATCH';
      if (identityStatus === 'MISMATCH') report.idMismatches.push({ discoveryId: id, documentDeclaredId, sourceDocument });
      if (identityStatus === 'DUPLICATE-DOCUMENT-ID') report.duplicateIds.push({ id: documentDeclaredId, sourceDocuments: [owner, sourceDocument] });
      if (documentDeclaredId && !owner) sourceOwners.set(documentDeclaredId, sourceDocument);
      report.identityValidation.push({ discoveryId: id, documentDeclaredId: documentDeclaredId || null, status: identityStatus, sourceDocument });
      const record = { id, discoveryId: id, documentDeclaredId: documentDeclaredId || null, identityStatus, sourceDocument, fields: extraction.fields, unknownLabels: extraction.unknownLabels, bookModelComparison: compareBookModel(extraction.fields, modelById.get(id) || null) };
      addRecordToReport(report, record, libraryBook, Boolean(modelById.get(id)));
      records.push(record);
    } catch (error) {
      report.parseFailures.push({ id, sourceDocument, message: error.message });
    }
  }
  for (const bookId of modelById.keys()) if (!sourceOwners.has(bookId)) report.bookModelRecordsWithoutStoryMaster.push(bookId);
  const index = { generatedBy: 'scripts/project-story-masters.js', extractionSchemaVersion: 1, scope, records };
  const output = { generatedBy: 'scripts/project-story-masters.js', extractionSchemaVersion: 1, scope, schemas: FIELD_SCHEMAS, report };
  if (!dryRun) {
    fs.writeFileSync(path.join(root, 'generated', 'story-master-index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(root, 'generated', 'story-master-extraction-report.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  return report;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fullCorpus = process.argv.includes('--all');
  const determinismCheck = process.argv.includes('--determinism-check');
  if (determinismCheck) {
    const indexPath = path.join(root, 'generated', 'story-master-index.json');
    const before = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
    require('child_process').execFileSync(process.execPath, [__filename, ...(fullCorpus ? ['--all'] : [])], { stdio: 'inherit' });
    const after = fs.readFileSync(indexPath, 'utf8');
    if (before !== after) {
      throw new Error('Story Master projection output was not deterministic.');
    }
    console.log('Story Master projection determinism check passed.');
    return;
  }
  const report = project(fullCorpus ? null : sampleIds, fullCorpus ? 'full-corpus' : 'sample', dryRun);
  console.log(`Story Master projection ${dryRun ? 'dry run' : 'completed'}: ${report.recognizedStoryMasters}/${report.filesScanned} recognized, ${report.unresolvedReferences.length} unresolved references, ${report.parseFailures.length} parse failures.`);
}

if (require.main === module) {
  main();
}

module.exports = { project };