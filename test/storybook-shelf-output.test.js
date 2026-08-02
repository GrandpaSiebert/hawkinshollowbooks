const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');

test('generator publishes the Storybook Shelf experience into the preview build output', () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    stdio: 'inherit'
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
    stdio: 'inherit'
  });

  const outputPath = path.join(repoRoot, 'build', 'books', 'HH-A-0001-spencer-s-first-friend.html');
  assert.ok(fs.existsSync(outputPath), 'expected story page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Read this story/);
  assert.match(html, /Meet Spencer/);
  assert.doesNotMatch(html, /Meet Spencer Field Mouse/);
  assert.doesNotMatch(html, /Library Record/);
});
