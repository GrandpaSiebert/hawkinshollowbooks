const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildManifest } = require('./build-manifest');
const { verifyManifest } = require('./verify-library');

const root = path.join(__dirname, '..');
const libraryRoot = path.join(root, 'Library');
const statePath = path.join(root, 'generated', 'manifest', 'publish-state.json');

function parseArgs(argv) {
  const args = {
    dryRun: true,
    baseUrl: process.env.LIBRARY_BASE_URL || 'https://library.hawkinshollowbooks.com',
    output: path.join(root, 'generated', 'manifest', 'manifest.json')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.dryRun = false;
    } else if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--base-url' && argv[i + 1]) {
      args.baseUrl = String(argv[i + 1]).trim();
      i += 1;
    } else if (token === '--output' && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function ensurePosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function collectLibraryFiles() {
  if (!fs.existsSync(libraryRoot)) {
    throw new Error(`Library folder not found at ${libraryRoot}`);
  }

  const files = [];
  const stack = [libraryRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        const relative = ensurePosix(path.relative(libraryRoot, fullPath));
        const top = relative.split('/')[0] || 'uncategorized';
        files.push({
          relative,
          category: top.toLowerCase(),
          sizeBytes: fs.statSync(fullPath).size,
          sha256: hashFile(fullPath)
        });
      }
    }
  }

  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function readPreviousState() {
  if (!fs.existsSync(statePath)) {
    return { files: [] };
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function buildLookup(files) {
  const map = new Map();
  for (const file of files || []) {
    map.set(file.relative, file);
  }
  return map;
}

function diffFiles(previous, current) {
  const previousMap = buildLookup(previous.files || []);
  const currentMap = buildLookup(current.files || []);

  const added = [];
  const changed = [];
  const unchanged = [];
  const deleted = [];

  for (const [relative, nextFile] of currentMap.entries()) {
    const oldFile = previousMap.get(relative);
    if (!oldFile) {
      added.push(nextFile);
      continue;
    }

    if (oldFile.sha256 !== nextFile.sha256 || oldFile.sizeBytes !== nextFile.sizeBytes) {
      changed.push(nextFile);
    } else {
      unchanged.push(nextFile);
    }
  }

  for (const [relative, oldFile] of previousMap.entries()) {
    if (!currentMap.has(relative)) {
      deleted.push(oldFile);
    }
  }

  return { added, changed, unchanged, deleted };
}

function countByCategory(files) {
  const counts = {};
  for (const file of files) {
    counts[file.category] = (counts[file.category] || 0) + 1;
  }
  return counts;
}

function countNewBooks(manifest, changedSet) {
  let count = 0;
  for (const record of manifest.records || []) {
    const touches = (record.assets || []).some((asset) => {
      return changedSet.has(String(asset.sourcePath || ''));
    });
    if (touches) {
      count += 1;
    }
  }
  return count;
}

function run(options = {}) {
  const now = new Date().toISOString();
  const currentFiles = collectLibraryFiles();
  const previousState = readPreviousState();
  const currentState = {
    generatedAt: now,
    files: currentFiles
  };

  const diff = diffFiles(previousState, currentState);
  const changedUnion = diff.added.concat(diff.changed);
  const changedSet = new Set(changedUnion.map((entry) => entry.relative));

  const { manifest, outputPath } = buildManifest({
    baseUrl: options.baseUrl,
    output: options.output,
    quiet: true
  });
  verifyManifest(outputPath, path.join(root, 'manifest.schema.json'));

  const newBookCount = countNewBooks(manifest, changedSet);
  const categoryCounts = countByCategory(changedUnion);

  console.log('Publish Library');
  console.log(`- Mode: ${options.dryRun ? 'dry-run' : 'apply'}`);
  console.log(`- Changed files: ${diff.added.length + diff.changed.length}`);
  console.log(`- New files: ${diff.added.length}`);
  console.log(`- Updated files: ${diff.changed.length}`);
  console.log(`- Deleted files: ${diff.deleted.length}`);
  console.log(`- Unchanged files: ${diff.unchanged.length}`);
  console.log(`- New or updated books touched: ${newBookCount}`);
  console.log(`- Updated manifest: ${path.relative(root, outputPath)}`);

  const interesting = ['books', 'illustrations', 'covers', 'characters', 'resources', 'companion packs'];
  for (const key of interesting) {
    if (categoryCounts[key]) {
      console.log(`  - ${key}: ${categoryCounts[key]} changed`);
    }
  }

  if (options.dryRun) {
    console.log('Dry run complete. No state was written and no upload was attempted.');
    return;
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(currentState, null, 2)}\n`, 'utf8');

  console.log(`State written: ${path.relative(root, statePath)}`);
  console.log('Upload step not executed in this script yet.');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  run(args);
}

module.exports = {
  run,
  parseArgs
};
