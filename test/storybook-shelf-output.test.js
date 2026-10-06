const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');

before(() => {
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'generate-site.js')], {
    cwd: repoRoot,
    env: { ...process.env, HH_SITEMAP_DEPLOYMENT_DATE: process.env.HH_SITEMAP_DEPLOYMENT_DATE || '2026-10-05' },
    stdio: 'pipe'
  });
});

test('generator publishes the Storybook Shelf experience into the preview build output', () => {
  const outputPath = path.join(repoRoot, 'build', 'storybook-shelf.html');
  assert.ok(fs.existsSync(outputPath), 'expected preview build output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /More stories are on the way/);
  assert.doesNotMatch(html, /href="books\/HH-A-0001-spencer-s-first-friend\.html"/);
  assert.match(html, /storybook-list/);
  assert.match(html, /If you are unsure where to begin, choose one story that fits today and let the next step unfold naturally\./);
  assert.doesNotMatch(html, /Today's story/);
  assert.doesNotMatch(html, /Canonical ID/);
  assert.doesNotMatch(html, /Public Title/);
});

test('generator presents the story page as an invitation into the story', () => {
  const outputPath = path.join(repoRoot, 'build', 'books', 'HH-A-0001-spencer-s-first-friend.html');
  assert.ok(fs.existsSync(outputPath), 'expected story page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Meet this story's characters/);
  assert.match(html, /href="HH-A-0001-spencer-s-first-friend-characters\.html"/);
  assert.doesNotMatch(html, /Library Record/);
});

test('generator publishes books page as a series doorway without operational metadata', () => {
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
  const outputPath = path.join(repoRoot, 'build', 'first-readers.html');
  assert.ok(fs.existsSync(outputPath), 'expected first readers page output to exist');

  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /Who This Series Is For/);
  assert.match(html, /Choose a Story/);
  assert.match(html, /More stories are on the way/);
  assert.doesNotMatch(html, /Read this story/);
  assert.match(html, /Browse all series/);
  assert.doesNotMatch(html, /data-display-order="rotating"/);
  assert.doesNotMatch(html, /Canonical ID/);
  assert.doesNotMatch(html, /Public Title/);
});
