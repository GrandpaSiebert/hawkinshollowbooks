const path = require('path');
const { writeLibraryArtifacts } = require('./library-scanner');

function run() {
  const root = path.join(__dirname, '..');
  const result = writeLibraryArtifacts(root);

  console.log('Library scan complete.');
  console.log(`- Files indexed: ${result.summary.fileCount}`);
  console.log(`- Folders indexed: ${result.summary.folderCount}`);
  console.log(`- Book records indexed: ${result.summary.indexedBooks}`);
  console.log(`- Scan output: ${path.relative(root, result.scanPath)}`);
  console.log(`- Index output: ${path.relative(root, result.indexPath)}`);
}

run();
