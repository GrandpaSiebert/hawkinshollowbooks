const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  parseYouTubeVideoId,
  readFreebieYoutubeRouting,
  validateMappings
} = require('../scripts/freebie-routing-import');
const { isIgnoredLibraryFile } = require('../scripts/library-scanner');
const { createFreebieDiscoveryRecords, createFreebieSearchIndexRecord } = require('../scripts/freebie-discovery');

const root = path.join(__dirname, '..');
const outputs = ['build', 'build-recovery'];

function sourceMappings() {
  return readFreebieYoutubeRouting(path.join(root, 'data', 'freebie-youtube-routing.json'));
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      const nextEvent = { type, target: this, ...event };
      for (const listener of listeners.get(type) || []) listener(nextEvent);
      if (type === 'cancel' && !nextEvent.defaultPrevented && typeof this.close === 'function') {
        this.close();
      }
    }
  };
}

test('checked-in source has the approved minimal 250 canonical mappings', () => {
  const mappings = sourceMappings();
  assert.equal(mappings.length, 250);
  assert.equal(mappings.filter((entry) => entry.canonicalId.startsWith('HH-S-')).length, 125);
  assert.equal(mappings.filter((entry) => entry.canonicalId.startsWith('HH-R-')).length, 125);
  assert.equal(new Set(mappings.map((entry) => entry.canonicalId)).size, 250);
  assert.equal(new Set(mappings.map((entry) => entry.videoId)).size, 250);
  for (const mapping of mappings) {
    assert.deepEqual(Object.keys(mapping), ['canonicalId', 'videoId']);
    assert.match(mapping.videoId, /^[A-Za-z0-9_-]{11}$/);
  }
});

test('authoring importer accepts supported YouTube URL forms and rejects unsafe or unsupported URLs', () => {
  const id = 'd7q89XPwOXw';
  for (const url of [
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=share`,
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/embed/${id}`,
    `https://music.youtube.com/shorts/${id}`
  ]) {
    assert.equal(parseYouTubeVideoId(url), id);
  }
  for (const url of [
    `http://youtu.be/${id}`,
    `https://youtube.evil.example/watch?v=${id}`,
    `https://youtube.com.evil.example/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&v=${id}`,
    `https://youtube.com/playlist?list=${id}`,
    `javascript:alert(1)`,
    `https://youtu.be/${id}/extra`,
    `https://user:pass@youtube.com/watch?v=${id}`
  ]) {
    assert.throws(() => parseYouTubeVideoId(url), /Invalid|Unsupported YouTube URL/);
  }
});

test('routing validation rejects duplicate canonical IDs, duplicate videos, and malformed IDs', () => {
  assert.throws(() => validateMappings([
    { canonicalId: 'HH-S-0001', videoId: 'd7q89XPwOXw' },
    { canonicalId: 'HH-S-0001', videoId: 'KZJDtYgswkE' }
  ]), /Duplicate canonical ID/);
  assert.throws(() => validateMappings([
    { canonicalId: 'HH-S-0001', videoId: 'd7q89XPwOXw' },
    { canonicalId: 'HH-R-0001', videoId: 'd7q89XPwOXw' }
  ]), /Duplicate YouTube video ID/);
  assert.throws(() => validateMappings([
    { canonicalId: 'HH-S-0001', videoId: 'not-an-id' }
  ]), /Invalid YouTube video ID/);
});

test('routing stays usable without a workbook and workbook files are excluded from Library canon', () => {
  assert.equal(sourceMappings().length, 250);
  assert.equal(isIgnoredLibraryFile('Hawkins Hollow Website to YouTube Routing Master.xlsx'), true);
  assert.equal(isIgnoredLibraryFile('Hawkins Hollow Website to YouTube Routing Master (version 1).xlsb.xlsx'), true);
  assert.equal(isIgnoredLibraryFile('HH-S-0001 — Song.docx'), false);
  const libraryScan = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'library-scan.json'), 'utf8'));
  assert.equal(
    libraryScan.files.some((file) => /Hawkins Hollow Website to YouTube Routing Master/i.test(file.name)),
    false
  );
});

test('missing or invalid future video routes produce no search playback destination', () => {
  const record = {
    canonicalId: 'HH-S-0025',
    contentType: 'song',
    title: 'Weather-Ribbon Welcome',
    infoFields: [],
    illustrationPublished: false
  };
  const noRoute = createFreebieDiscoveryRecords([record], [], {}, () => 'songs/test.html');
  assert.equal(noRoute[0].youtubeVideoId, '');
  assert.equal(noRoute[0].youtubeUrl, '');

  const invalidRoute = createFreebieDiscoveryRecords(
    [record],
    [],
    {},
    () => 'songs/test.html',
    new Map([[record.canonicalId, { videoId: 'https://evil.example/video' }]])
  );
  assert.equal(invalidRoute[0].youtubeVideoId, '');
  assert.equal(createFreebieSearchIndexRecord(invalidRoute[0]).youtubeUrl, '');
});

test('generated pages have lazy, correctly mapped accessible controls and keep routing private', () => {
  const mappings = sourceMappings();
  const routing = new Map(mappings.map((entry) => [entry.canonicalId, entry.videoId]));
  for (const output of outputs) {
    const outputRoot = path.join(root, output);
    let controls = 0;
    for (const type of ['song', 'rhyme']) {
      const records = JSON.parse(fs.readFileSync(path.join(root, 'generated', 'search-index.json'), 'utf8'))
        .records.filter((record) => record.type === type);
      assert.equal(records.length, 500);
      for (const record of records) {
        const videoId = routing.get(record.id);
        const detailPath = path.join(outputRoot, ...record.href.split('/'));
        const html = fs.readFileSync(detailPath, 'utf8');
        if (videoId) {
          assert.match(html, new RegExp(`data-video-id="${videoId}"`));
          assert.match(html, /<dialog class="freebie-player-dialog" aria-labelledby="freebie-player-heading" aria-modal="true"/);
          assert.match(html, /aria-haspopup="dialog"/);
          assert.doesNotMatch(html, /<iframe\b/i);
          assert.doesNotMatch(html, /<a[^>]+href="https:\/\/youtu\.be\//i);
          assert.match(html, new RegExp(type === 'song' ? '>Play Song<' : '>Watch Rhyme<'));
          controls += 1;
        } else {
          assert.doesNotMatch(html, /class="button freebie-video-launch"/);
        }
      }
    }
    assert.equal(controls, 250);
    assert.equal(fs.existsSync(path.join(outputRoot, 'generated', 'freebie-routing-index.json')), false);
    assert.equal(fs.existsSync(path.join(outputRoot, 'data', 'freebie-youtube-routing.json')), false);
    const names = fs.readdirSync(outputRoot, { recursive: true });
    assert.equal(names.some((name) => /Routing Master.*\.xlsx$/i.test(name)), false);
  }
});

test('player activates only on button press and close destroys the iframe and restores focus', () => {
  const html = fs.readFileSync(
    path.join(root, 'build-recovery', 'songs', 'HH-S-0001-singable-hollow-welcome.html'),
    'utf8'
  );
  const playerScript = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), (match) => match[1])
    .find((script) => script.includes("document.querySelector('.freebie-player-dialog')"));
  assert.ok(playerScript, 'generated detail page contains the shared player behavior');

  const button = Object.assign(fakeEventTarget(), {
    attributes: { 'data-video-id': 'd7q89XPwOXw', 'data-video-title': 'Singable Hollow Welcome' },
    focused: false,
    getAttribute(name) { return this.attributes[name] || ''; },
    focus() { this.focused = true; }
  });
  const closeButton = { focused: false, focus() { this.focused = true; } };
  const frame = { children: [], replaceChildren(...children) { this.children = children; } };
  const dialog = Object.assign(fakeEventTarget(), {
    open: false,
    showModal() { this.open = true; },
    close() {
      this.open = false;
      this.dispatch('close');
    }
  });
  const document = Object.assign(fakeEventTarget(), {
    querySelector(selector) {
      return {
        '.freebie-player-dialog': dialog,
        '.freebie-player-frame': frame,
        '.freebie-player-close': closeButton
      }[selector] || null;
    },
    querySelectorAll(selector) {
      return selector === '.freebie-video-launch' ? [button] : [];
    },
    createElement(name) {
      assert.equal(name, 'iframe');
      return {};
    }
  });
  vm.runInNewContext(playerScript, { document });
  assert.equal(frame.children.length, 0);
  button.dispatch('click');
  assert.equal(dialog.open, true);
  assert.equal(closeButton.focused, true);
  assert.equal(frame.children[0].src, 'https://www.youtube-nocookie.com/embed/d7q89XPwOXw?autoplay=1');
  assert.equal(frame.children[0].allow, 'encrypted-media; picture-in-picture; fullscreen');
  document.dispatch('keydown', { key: 'Escape', preventDefault() { this.defaultPrevented = true; } });
  assert.equal(frame.children.length, 0);
  assert.equal(button.focused, true);

  button.focused = false;
  button.dispatch('click');
  dialog.dispatch('click', { target: dialog });
  assert.equal(dialog.open, false);
  assert.equal(frame.children.length, 0);
  assert.equal(button.focused, true);
});
