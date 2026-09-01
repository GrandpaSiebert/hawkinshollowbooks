const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'story-master-theme-book-index.json'), 'utf8')).records || [];
const directory = fs.readFileSync(path.join(root, 'build-recovery', 'themes.html'), 'utf8');
const failures = [];
let associations = 0;
if (!directory.includes('id="theme-search"') || !directory.includes('data-theme-entry') || !directory.includes('filterDirectory')) failures.push('theme directory text filter is missing');
for (const entry of index) {
  const key = String(entry.theme || '').trim().toLowerCase();
  const href = `themes.html?theme=${encodeURIComponent(key)}`;
  if (!directory.includes(`href="${href}"`)) failures.push(`directory missing theme: ${entry.theme}`);
  const uniqueBooks = new Set((entry.books || []).map((book) => book.bookHref));
  if (uniqueBooks.size !== (entry.books || []).length) failures.push(`duplicate association: ${entry.theme}`);
  associations += uniqueBooks.size;
  for (const book of entry.books || []) {
    if (!fs.existsSync(path.join(root, 'build-recovery', book.bookHref))) failures.push(`missing destination: ${entry.theme} -> ${book.bookHref}`);
  }
}
if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Theme book trail validation failed: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ themes: index.length, associations, directoryThemes: index.length }, null, 2));
}