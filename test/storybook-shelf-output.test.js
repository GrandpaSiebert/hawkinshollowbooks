const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');

test('generator publishes the Storybook Shelf experience into the preview build output', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const outputPath = path.join(repoRoot, 'build', 'storybook-shelf.html');
  assert.ok(fs.existsSync(outputPath), 'expected preview build output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Spencer’s First Friend/);
  assert.match(html, /Read this story/);
  assert.match(html, /storybook-list/);
  assert.match(html, /If this is your first visit to Hawkins Hollow, this story is a gentle place to begin\./);
  assert.doesNotMatch(html, /Today's story/);
  assert.doesNotMatch(html, /Canonical ID/);
  assert.doesNotMatch(html, /Public Title/);
});

test('generator presents the story page as an invitation into the story', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const outputPath = path.join(repoRoot, 'build', 'books', 'HH-A-0001-spencer-s-first-friend.html');
  assert.ok(fs.existsSync(outputPath), 'expected story page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Read this story/);
  assert.match(html, /Meet Spencer/);
  assert.doesNotMatch(html, /Meet Spencer Field Mouse/);
  assert.doesNotMatch(html, /Library Record/);
});

test('generator publishes books page as a series doorway without operational metadata', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const outputPath = path.join(repoRoot, 'build', 'books.html');
  assert.ok(fs.existsSync(outputPath), 'expected books page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Browse the Collections/);
  assert.match(html, /href="first-readers.html"/);
  assert.match(html, /href="bedtime-library.html"/);
  assert.match(html, /Home introduces experiences\. Series pages introduce books\. Book pages invite you into each story\./);
  assert.doesNotMatch(html, /Canonical ID/);
  assert.doesNotMatch(html, /Files Indexed/);
  assert.doesNotMatch(html, /Reader PDF/);
  assert.doesNotMatch(html, /Auto-generated from the Library index/);
});

test('generator publishes first readers page using shared series invitation structure', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const outputPath = path.join(repoRoot, 'build', 'first-readers.html');
  assert.ok(fs.existsSync(outputPath), 'expected first readers page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Who This Series Is For/);
  assert.match(html, /Choose a Story/);
  assert.match(html, /Read this story/);
  assert.match(html, /Browse all series/);
  assert.match(html, /data-display-order="rotating"/);
  assert.match(html, /data-rotation-frequency="daily"/);
  assert.match(html, /function getRotationBucket\(frequency\)/);
  assert.doesNotMatch(html, /Canonical ID/);
  assert.doesNotMatch(html, /Public Title/);
});
