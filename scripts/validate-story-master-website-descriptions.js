const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');
const site = JSON.parse(fs.readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const storyMasterIndex = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-index.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-presentation-report.json'), 'utf8'));
const sitemap = fs.readFileSync(path.join(buildDir, 'sitemap.xml'), 'utf8');
const failures = [];

for (const selection of report.selections || []) {
  const record = (storyMasterIndex.records || []).find((entry) => entry.discoveryId === selection.discoveryId);
  const field = record && record.fields && record.fields.websiteDescription;
  const pageName = fs.readdirSync(path.join(buildDir, 'books')).find((name) => (
    name === `${selection.discoveryId}.html` || name.startsWith(`${selection.discoveryId}-`)
  ) && !name.endsWith('-characters.html'));
  if (!field || !pageName) {
    failures.push(`${selection.discoveryId}: projection field or page is missing`);
    continue;
  }
  const page = fs.readFileSync(path.join(buildDir, 'books', pageName), 'utf8');
  const canonicalUrl = `${String(site.domain || '').replace(/\/$/, '')}/books/${pageName}`;
  const lead = page.match(/<p class="story-intro-lead"><em>([\s\S]*?)<\/em><\/p>/);
  if (!lead || lead[1] !== field.value) failures.push(`${selection.discoveryId}: lead does not equal projected Website Description`);
  if (!page.includes(`<link rel="canonical" href="${canonicalUrl}" />`)) failures.push(`${selection.discoveryId}: canonical URL changed`);
  if (!page.includes(`"url": "${canonicalUrl}"`)) failures.push(`${selection.discoveryId}: JSON-LD URL changed`);
  if (!sitemap.includes(`<loc>${canonicalUrl}</loc>`)) failures.push(`${selection.discoveryId}: sitemap route is missing`);
  if (!selection.sourceDocument || selection.sourceSection !== 'Website Information' || selection.sourceLabel !== 'Website Description' || !selection.extractionMethod || !selection.selectionReason) failures.push(`${selection.discoveryId}: provenance is incomplete`);
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Story Master Website Description validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Story Master Website Description validation passed: ${(report.selections || []).length} selected pages retain exact projected leads, routes, metadata, sitemap entries, and provenance.`);
}