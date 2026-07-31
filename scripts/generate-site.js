#!/usr/bin/env node
// generate-site.js — copies src/ into build-recovery/ for GitHub Pages deployment.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DEST = path.join(ROOT, 'build-recovery');
const CNAME = 'hawkinshollowbooks.com';

// Recursively copy a directory.
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean and recreate output directory.
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

// Copy site source files.
copyDir(SRC, DEST);

// GitHub Pages markers (also added by the workflow step, but belt-and-suspenders).
fs.writeFileSync(path.join(DEST, '.nojekyll'), '');
fs.writeFileSync(path.join(DEST, 'CNAME'), `${CNAME}\n`);

console.log(`Site built → ${path.relative(ROOT, DEST)}/`);
