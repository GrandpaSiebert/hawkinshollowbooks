const fs = require('fs');
const path = require('path');
const {
  assertOutsideProtectedPaths,
  calculateManifestSha256
} = require('./release-snapshot');
const { verifyCandidateDirectory } = require('./prepare-release-snapshot');

const repositoryRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    repositoryRoot,
    libraryRoot: '',
    archiveRoot: '',
    candidate: ''
  };
  const fields = new Map([
    ['--repository-root', 'repositoryRoot'],
    ['--library-root', 'libraryRoot'],
    ['--archive-root', 'archiveRoot'],
    ['--candidate', 'candidate']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const field = fields.get(argv[index]);
    if (!field || !argv[index + 1]) throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    options[field] = path.resolve(argv[index + 1]);
    index += 1;
  }
  options.libraryRoot ||= path.join(options.repositoryRoot, 'Library');
  if (!options.archiveRoot || !options.candidate) {
    throw new Error('--archive-root and --candidate are required.');
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  assertOutsideProtectedPaths(options.candidate, [
    options.repositoryRoot,
    options.libraryRoot,
    options.archiveRoot
  ]);
  const manifest = await verifyCandidateDirectory(options.candidate, undefined, options.repositoryRoot);
  const manifestSha256 = calculateManifestSha256(manifest);
  console.log(`Snapshot verified: ${manifest.snapshotId}; manifest SHA-256: ${manifestSha256}; payloads: ${manifest.payloads.length}; KDP Live books: ${manifest.liveBookIds.length}.`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Snapshot verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
