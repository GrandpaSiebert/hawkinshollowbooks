const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resources = JSON.parse(fs.readFileSync(path.join(root, 'data', 'companion-resource-registry.json'), 'utf8')).resources || [];
const books = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'merged-book-index.json'), 'utf8')).records || [];
const page = fs.readFileSync(path.join(root, 'build-recovery', 'resources.html'), 'utf8');
const routeById = new Map(books.filter((book) => book && book.id && book.pageHref).map((book) => [String(book.id).toUpperCase(), book.pageHref]));
const cards = Array.from(page.matchAll(/<article class="start-here-item companion-resource-card"([\s\S]*?)<\/article>/g)).map((match) => match[0]);
const failures = [];
let withStoryId = 0;
let linked = 0;
let withheldAbsent = 0;
let withheldUnresolved = 0;

for (const resource of resources) {
  const storyId = String(resource && resource.structural && resource.structural.storyId || '').trim().toUpperCase();
  const card = cards.find((markup) => markup.includes(`data-companion-resource-id="${resource.resourceId}"`));
  if (!card) {
    failures.push(`card missing: ${resource.resourceId}`);
    continue;
  }
  if (!storyId) {
    withheldAbsent += 1;
    if (card.includes('Read the Story')) failures.push(`unassociated resource linked: ${resource.resourceId}`);
    continue;
  }
  withStoryId += 1;
  const route = routeById.get(storyId);
  if (!route) {
    withheldUnresolved += 1;
    if (card.includes('Read the Story')) failures.push(`unresolved story linked: ${resource.resourceId}`);
    continue;
  }
  linked += 1;
  if (!card.includes(`href="${route}">Read the Story</a>`)) failures.push(`incorrect return link: ${resource.resourceId}`);
  if (!fs.existsSync(path.join(root, 'build-recovery', route))) failures.push(`missing return destination: ${resource.resourceId}`);
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Resource book return validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ resources: resources.length, withStoryId, linked, withheldAbsent, withheldUnresolved, missingDestinations: 0, duplicateReturnLinks: 0 }, null, 2));
}