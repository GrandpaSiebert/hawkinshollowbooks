const fs = require('fs');
const path = require('path');

const relationshipDir = path.join(__dirname, '..', 'build', 'entities', 'relationship');

if (!fs.existsSync(relationshipDir)) {
  console.error('Relationship output directory not found:', relationshipDir);
  process.exit(1);
}

const files = fs.readdirSync(relationshipDir).filter((file) => file.endsWith('.html')).sort();
if (files.length === 0) {
  console.error('No relationship pages found in build/entities/relationship.');
  process.exit(1);
}

const leakageRegex = /(Relationship Sheet|Relationship Function:|mentions-character|sourceDocument|extractor:|canonical excerpt)/i;

function evaluate(html) {
  const hasWelcome = html.includes('id="relationship-arrival"');
  const hasWhyMatters = html.includes('<strong>Why this matters:</strong>');
  const hasRelationshipExplained = html.includes('id="relationship-neighbors"') && html.includes('id="relationship-places"');
  const hasNextPath = html.includes('id="relationship-next-step"');
  const hasOrientation = html.includes('href="../../characters.html"')
    && html.includes('href="../../map.html"')
    && html.includes('href="../../storybook-shelf.html"');

  const developerModeIndex = html.indexOf('id="developer-mode"');
  const entityTypeIndex = html.indexOf('<strong>Entity Type:</strong>');
  const metadataDeferred = developerModeIndex >= 0 && entityTypeIndex > developerModeIndex;

  const visitorPrefix = developerModeIndex > 0 ? html.slice(0, developerModeIndex) : html;
  const visitorLeakageFree = !leakageRegex.test(visitorPrefix);

  return {
    welcome: hasWelcome,
    whyMatters: hasWhyMatters,
    relationshipExplained: hasRelationshipExplained,
    nextPath: hasNextPath,
    orientation: hasOrientation,
    metadataDeferred,
    visitorLeakageFree
  };
}

const rows = files.map((file) => {
  const html = fs.readFileSync(path.join(relationshipDir, file), 'utf8');
  const checks = evaluate(html);
  const failedChecks = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    file,
    pass: failedChecks.length === 0,
    failedChecks
  };
});

const passed = rows.filter((row) => row.pass).length;
const failed = rows.length - passed;

console.log('RELATIONSHIP COMPLIANCE AUDIT');
console.log('Total pages:', rows.length);
console.log('Passed:', passed);
console.log('Failed:', failed);
console.log('');

if (failed > 0) {
  console.log('FAILURES');
  for (const row of rows.filter((r) => !r.pass)) {
    console.log(`- ${row.file}: ${row.failedChecks.join(', ')}`);
  }
} else {
  console.log('FAILURES');
  console.log('None');
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    pages: rows.length,
    passed,
    failed
  },
  rows
};

const reportDir = path.join(__dirname, '..', 'generated', 'validation');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'relationship-compliance-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('');
console.log('Report written:', reportPath);
