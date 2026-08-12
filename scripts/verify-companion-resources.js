const fs = require('fs');

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

const registry = JSON.parse(fs.readFileSync('data/companion-resource-registry.json', 'utf8'));
const resources = Array.isArray(registry.resources) ? registry.resources : [];
const byStory = {};
for (const resource of resources) {
  const structural = resource && resource.structural ? resource.structural : {};
  const storyId = String(structural.storyId || 'UNKNOWN').toUpperCase();
  byStory[storyId] = (byStory[storyId] || 0) + 1;
}

const html = fs.readFileSync('build-recovery/resources.html', 'utf8');
const summary = {
  storyOptions: countMatches(html, /<option value="HH-A-\d{4}">/g),
  resourceLinks: countMatches(html, /href="https:\/\/library\.hawkinshollowbooks\.com[^"]+"/g),
  resourceCards: countMatches(html, /data-companion-resource-card/g),
  oldButtonsPresent: {
    readStory: html.includes('Read the story'),
    meetCharacters: html.includes('Meet the characters'),
    openMap: html.includes('Open the map'),
    continueJourney: html.includes('Continue your journey')
  }
};

console.log(JSON.stringify({ byStory, summary }, null, 2));
