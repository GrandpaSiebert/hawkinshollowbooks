const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Sum actual MPEG Layer III frame durations, including variable bitrate files.
function inspectMp3(bytes) {
  let offset = 0, seconds = 0, frames = 0;
  if (bytes.subarray(0, 3).toString() === 'ID3') {
    if ([6, 7, 8, 9].some(i => bytes[i] & 128)) throw Error('Invalid ID3 length');
    offset = 10 + (bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9]);
    if (bytes[3] === 4 && (bytes[5] & 16)) offset += 10;
  }
  while (offset + 4 <= bytes.length) {
    if (bytes.subarray(offset, offset + 3).toString() === 'TAG' || bytes.subarray(offset, offset + 8).toString() === 'APETAGEX') break;
    const word = bytes.readUInt32BE(offset);
    if ((word >>> 21) !== 2047) {
      if (bytes.subarray(offset).every(value => value === 0)) break;
      throw Error(`Invalid MPEG frame at byte ${offset}`);
    }
    const version = (word >>> 19) & 3, layer = (word >>> 17) & 3;
    const rateIndex = (word >>> 10) & 3, bitrateIndex = (word >>> 12) & 15;
    if (version === 1 || layer !== 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) throw Error('Unsupported MPEG Layer III header');
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrateIndex];
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + ((word >>> 9) & 1);
    if (offset + length > bytes.length) throw Error('Truncated MPEG frame');
    seconds += (version === 3 ? 1152 : 576) / rate;
    offset += length; frames++;
  }
  if (!frames || seconds <= 0) throw Error('No playable MPEG frames');
  return { durationSeconds: Math.round(seconds * 1000) / 1000, frames, format: 'MP3 / MPEG Layer III' };
}

function designation(filename) {
  if (/Primary\.mp3$/i.test(filename)) return 'confirmed-primary';
  if (/(?:Alternate|Alternative)\.mp3$/i.test(filename)) return 'confirmed-alternate';
  return 'unresolved';
}

function createInventory() {
  const index = read('generated/entity-index.json');
  const discovery = read('generated/public-discovery-index.json');
  const characters = read('data/characters.json').characters;
  const types = { Books: 'book', Characters: 'character', Relationships: 'relationship', Environments: 'environment', Landsmarks: 'landmark' };
  const explicitAliases = {
    character: { 'grandpa siebert': 'HH-CHR-0009', 'bentley baby crow': 'HH-CHR-0008', 'farmer hawkins pop pop': 'HH-CHR-0024' },
    relationship: { 'aydin aleea caracara': 'REL-0002', 'mimi hawkins farmer hawkins pop pop': 'REL-0019' }
  };
  const candidates = {
    book: discovery.records.filter(item => item.type === 'book').map(item => ({ id: item.id, name: item.title, href: item.href })),
    character: characters.filter(item => item.published !== false).map(item => ({ id: item.identity.canonicalId, name: item.name, href: `characters/${item.slug}.html` })),
    relationship: index.byType.relationships.map(item => ({ ...item, href: item.entityPageHref })),
    environment: index.byType.environments.map(item => ({ ...item, href: item.entityPageHref })),
    landmark: index.byType.landmarks.map(item => ({ ...item, href: item.entityPageHref }))
  };
  const recordings = [], supportingFiles = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) { visit(absolute); continue; }
      const sourcePath = path.relative(root, absolute).replace(/\\/g, '/');
      if (!/\.mp3$/i.test(item.name)) { supportingFiles.push({ sourcePath, status: 'supporting-file-not-an-audio-release', sizeBytes: fs.statSync(absolute).size }); continue; }
      const category = types[sourcePath.split('/')[2]];
      const base = item.name.replace(/\.mp3$/i, '');
      const clean = base.replace(/\s*\(\d+\)$/, '').replace(/\s*(?:Primary|Alternate|Alternative|Altermate)$/i, '')
        .replace(/\s*[-_=]?\s*(?:Book|Story|Character|Relationship|Environment|Landmark)\s+Theme(?:\s+Song){0,2}$/i, '').trim();
      const parts = clean.split(/\s+[-=]\s*|\s*=\s*/);
      const subject = parts[0].replace(/\s*_$/, '').trim();
      const canonicalId = category === 'book' ? base.match(/\bHH-[A-Z+]+-\d{4}\b/)?.[0] : explicitAliases[category]?.[normalize(subject)];
      const matched = candidates[category]?.filter(record => canonicalId ? record.id === canonicalId : [record.name, path.basename(record.sourceDocument || '').replace(/ Visual Canon\.docx$/i, '')].some(name => normalize(name) === normalize(subject))) || [];
      const entity = matched.length === 1 ? matched[0] : null;
      const bytes = fs.readFileSync(absolute), sha256 = hash(bytes);
      const issues = entity ? [] : ['No unique authoritative page association'];
      let media = {}; try { media = inspectMp3(bytes); } catch (error) { issues.push(error.message); }
      const classification = designation(item.name);
      if (classification === 'unresolved') issues.push('No explicit Primary/Alternate recording designation; owner review required');
      const key = `themes/full/${sha256}.mp3`;
      recordings.push({ id: `theme-${entity?.id || 'unmapped'}-${sha256}`.toLowerCase(), originalFilename: item.name, sourcePath,
        title: category === 'book' || !parts[1] ? `${entity?.name || subject} — Theme Song` : parts.slice(1).join(' - '), category,
        canonicalId: entity?.id || '', page: entity?.href || '', pageTitle: entity?.name || subject,
        mappingEvidence: entity ? { canonicalName: entity.name, sourceDocument: entity.sourceDocument || null, matchedSubject: subject, explicitAlias: Boolean(canonicalId && category !== 'book') } : null,
        classification, primary: classification === 'confirmed-primary', designationEvidence: classification === 'unresolved' ? 'Supporting Word documents reviewed separately; no recording-specific designation found' : `Explicit ${classification === 'confirmed-primary' ? 'Primary' : 'Alternate/Alternative'} suffix in original filename`,
        approvalStatus: 'awaiting-owner-release-approval', sizeBytes: bytes.length, sha256, ...media,
        objectKey: key, publicUrl: `https://library.hawkinshollowbooks.com/${key}`, uploadStatus: 'not-uploaded-by-this-release', integrationStatus: 'candidate-only', issues });
    }
  }
  visit(path.join(root, 'Library/Theme Songs'));
  recordings.sort((a,b) => a.sourcePath.localeCompare(b.sourcePath, 'en'));
  return { schemaVersion: 1, sourceFolder: 'Library/Theme Songs', bucket: 'hawkins-hollow-library', baseUrl: 'https://library.hawkinshollowbooks.com', recordings, supportingFiles };
}

if (require.main === module) {
  const inventory = createInventory();
  const dest = path.join(root, 'data/page-themes.json');
  fs.writeFileSync(dest, JSON.stringify(inventory, null, 2) + '\n');
  console.log(JSON.stringify({ recordings: inventory.recordings.length, supportingFiles: inventory.supportingFiles.length,
    classifications: Object.fromEntries(['confirmed-primary','confirmed-alternate','unresolved'].map(value => [value,inventory.recordings.filter(r=>r.classification===value).length])),
    mappingIssues: inventory.recordings.filter(r=>!r.page).map(r=>r.sourcePath), invalidAudio: inventory.recordings.filter(r=>!r.durationSeconds).map(r=>({file:r.sourcePath,issues:r.issues})) }, null, 2));
}
module.exports = { createInventory, inspectMp3, designation, normalize };
