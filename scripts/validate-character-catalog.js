const fs = require('fs');
const path = require('path');

function validateCharacterCatalog(data) {
  if (!Array.isArray(data?.characters)) return ['Character directory must contain a characters array.'];
  return data.characters
    .filter((character) => character.published !== false)
    .filter((character) => typeof character.description !== 'string' || !character.description.trim())
    .map((character) => `Published character "${character.name || character.slug || '(unnamed)'}" needs a catalog description.`);
}

if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'characters.json'), 'utf8'));
  const errors = validateCharacterCatalog(data);
  if (errors.length) {
    errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log(`Character catalog validation passed: ${data.characters.filter((character) => character.published !== false).length} published characters have descriptions.`);
  }
}

module.exports = { validateCharacterCatalog };
