const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const parse5 = require('parse5');
const {elements, attr, text} = require('../scripts/audit-image-alt');
const approved = require('./fixtures/approved-freebie-duplicate-corrections.json');
const root = path.join(__dirname, '..');
const digest = lines => crypto.createHash('sha256').update(JSON.stringify(lines)).digest('hex');
const normalize = value => value.replace(/\s+/g, ' ').trim();
const lineText = node => node.tagName === 'br' ? '\n' : node.nodeName === '#text' ? node.value : (node.childNodes || []).map(lineText).join('');

for (const fixture of approved) {
  test(`${fixture.id} retains the complete owner-approved text exactly once in source and generated output`, () => {
    const records = JSON.parse(fs.readFileSync(path.join(root, 'generated/freebie-index.json'), 'utf8')).records;
    const record = records.find(r => r.canonicalId === fixture.id);
    assert.ok(record);
    const xml = new AdmZip(path.join(root, 'Library', record.sourceDocument)).readAsText('word/document.xml');
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map(m => text(parse5.parseFragment(m[1]
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''))).split('\n').map(normalize).filter(Boolean)).filter(p => p.length);
    const headings = paragraphs.map((p, i) => p.length === 1 && p[0] === record.lyricHeading ? i : -1).filter(i => i >= 0);
    assert.equal(headings.length, 1, 'the approved final-text heading occurs once');
    for (const [heading, count] of Object.entries(fixture.preservedHeadingCounts)) {
      assert.equal(paragraphs.filter(p => p.length === 1 && p[0] === heading).length, count,
        `unrelated ${heading} sections remain intact`);
    }
    const section = [];
    for (let i = headings[0] + 1; i < paragraphs.length; i++) {
      if (paragraphs[i].length === 1 && /^(First Aloud and Natural-Language Pass|Pre-Visual World-State Ledger|Optional Action and Caregiver Cues|Performance and Participation Cues|Performance Cues)$/.test(paragraphs[i][0])) break;
      section.push(...paragraphs[i]);
    }
    if (section[0] === record.title) section.shift();
    assert.equal(section.length, fixture.lineCount);
    assert.equal(digest(section), fixture.orderedLinesSha256, 'every approved lyric line, refrain and stanza label retains its order');
    const discovery = JSON.parse(fs.readFileSync(path.join(root, 'generated/public-discovery-index.json'), 'utf8')).records.find(r => r.id === fixture.id);
    const doc = parse5.parse(fs.readFileSync(path.join(root, 'build-recovery', discovery.href), 'utf8'));
    const container = elements(doc, 'div').filter(n => (attr(n, 'class') || '').split(/\s+/).includes('freebie-text'));
    assert.equal(container.length, 1);
    const lines = elements(container[0], 'p').flatMap(p => lineText(p).split('\n').map(normalize).filter(Boolean));
    assert.equal(lines.length, fixture.lineCount);
    assert.equal(digest(lines), fixture.orderedLinesSha256);
    assert.ok(elements(doc, 'link').some(n => attr(n, 'rel') === 'canonical' && attr(n, 'href') === `https://hawkinshollowbooks.com/${discovery.href}`));
  });
}
