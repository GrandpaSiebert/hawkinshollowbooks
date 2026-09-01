const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const id = 'HH-A-0005';
const route = 'books/HH-A-0005-the-new-animals-in-the-hollow.html';
const canonicalUrl = `https://hawkinshollowbooks.com/${route}`;
const expectedDescription = 'Kaydence and Asher Chipmunk are new to Hawkins Hollow, and the first hello feels big. With the Welcome Plan 3, the friends learn to offer a soft hello, give space, and help with practical steps until the Hollow begins to feel warm, safe, and welcoming.';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const page = read(path.join('build-recovery', route));
const sitemap = read('build-recovery/sitemap.xml');
const report = JSON.parse(read('generated/story-master-presentation-report.json'));
const lead = page.match(/<p class="story-intro-lead"><em>([\s\S]*?)<\/em><\/p>/);
const selection = Array.isArray(report.selections) ? report.selections[0] : null;
const failures = [];

if (!lead || lead[1] !== expectedDescription) failures.push('story intro lead does not equal the selected Website Description');
if (!page.includes(`<link rel="canonical" href="${canonicalUrl}" />`)) failures.push('canonical URL changed');
if (!page.includes(`"url": "${canonicalUrl}"`)) failures.push('JSON-LD URL changed');
if (!sitemap.includes(`<loc>${canonicalUrl}</loc>`)) failures.push('sitemap route is missing');
if (!page.includes('href="../resources.html?story=HH-A-0005"') || !page.includes('href="../resources.html"')) failures.push('resource links changed');
if (!selection || !report.selections.some((entry) => entry.discoveryId === id && entry.field === 'websiteDescription')) failures.push('presentation report does not contain the HH-A-0005 Website Description selection');
if (!selection || selection.sourceSection !== 'Website Information' || selection.sourceLabel !== 'Website Description' || !selection.sourceDocument || !selection.extractionMethod || !selection.selectionReason) failures.push('presentation provenance is incomplete');

const bookDir = path.join(root, 'build-recovery', 'books');
const descriptionPageCount = fs.readdirSync(bookDir)
  .filter((name) => name.endsWith('.html'))
  .filter((name) => fs.readFileSync(path.join(bookDir, name), 'utf8').includes(expectedDescription))
  .length;
if (descriptionPageCount !== 1) failures.push(`pilot description appears on ${descriptionPageCount} book pages instead of one`);

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Story Master pilot validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Story Master pilot validation passed: HH-A-0005 Website Description selection retains its route, metadata, sitemap, resources, and provenance.');
}