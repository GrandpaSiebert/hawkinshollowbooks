const manifest = require('../data/page-themes.json');
const publication = require('../data/page-theme-publication.json');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const { URL } = require('url');
const BASE = 'https://library.hawkinshollowbooks.com';

function validateManifest(input) {
  if (input.schemaVersion !== 1 || !Array.isArray(input.recordings)) throw Error('Invalid page theme manifest');
  const ids = new Set(), primaries = new Map(), owners = new Map();
  for (const track of input.recordings) {
    if (!track.id || ids.has(track.id)) throw Error('Duplicate or absent theme recording ID'); ids.add(track.id);
    if (!['confirmed-primary','confirmed-alternate','unresolved'].includes(track.classification)) throw Error('Invalid theme designation');
    if (track.primary !== (track.classification === 'confirmed-primary')) throw Error('Primary designation disagreement');
    if (!/^[a-f0-9]{64}$/.test(track.sha256) || track.objectKey !== `themes/full/${track.sha256}.mp3`
      || track.publicUrl !== `${BASE}/${track.objectKey}`) throw Error('Invalid content-addressed MP3 URL');
    if (!(track.sizeBytes > 0) || !(track.durationSeconds > 0) || !track.title?.trim()) throw Error('Invalid audio metadata');
    if (!track.canonicalId || !track.page || !/^(?:books|characters|entities\/(?:relationship|environment|landmark))\/[A-Za-z0-9+_-]+\.html$/.test(track.page)) throw Error('Invalid canonical theme destination');
    const owner = `${track.category}:${track.canonicalId}`;
    if (owners.has(owner) && owners.get(owner) !== track.page) throw Error('Owner assigned to multiple theme destinations'); owners.set(owner,track.page);
    if (track.primary) primaries.set(owner,(primaries.get(owner)||0)+1);
  }
  for (const owner of owners.keys()) if (primaries.get(owner) !== 1) throw Error('Each theme page must retain exactly one explicitly confirmed Primary');
  return true;
}

function selectTracks(page, options = {}) {
  const input = options.manifest || manifest, receipts = options.publication || publication;
  const preview = options.previewBase || '';
  if (preview && !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/audio$/.test(preview)) throw Error('Preview audio must use the isolated local server');
  const verified = new Map((receipts.records || []).map(r=>[r.id,r]));
  let tracks = input.recordings.filter(track=>track.page===page && track.classification !== 'unresolved');
  if (!preview) tracks = tracks.filter(track=>{
    const receipt = verified.get(track.id);
    return receipt?.status === 'verified' && receipt.ownerApproved === true && receipt.sha256 === track.sha256 && receipt.objectKey === track.objectKey
      && receipt.publicUrl === track.publicUrl && receipt.sizeBytes === track.sizeBytes && receipt.rangeVerified === true;
  });
  // A missing Primary must never promote an alternate into its place.
  if (!tracks.some(track=>track.primary)) return [];
  return tracks.sort((a,b)=>Number(b.primary)-Number(a.primary)||a.id.localeCompare(b.id)).map(track=>({...track,
    audioUrl:preview ? `${preview}/${encodeURIComponent(track.id)}.mp3` : track.publicUrl}));
}

function validateDestinations(input, entityIndex, discovery) {
  for (const track of input.recordings) {
    let destination;
    if (track.category === 'character') destination = (entityIndex.byType.characters || []).find(r=>r.identity?.canonicalId === track.canonicalId)?.legacyHref;
    else if (track.category === 'book') destination = discovery.records.find(r=>r.type === 'book' && r.id === track.canonicalId)?.href;
    else destination = (entityIndex.entities || []).find(r=>r.type === track.category && r.id === track.canonicalId)?.entityPageHref;
    if (!destination || destination !== track.page) throw Error(`Theme destination disagrees with canonical routing: ${track.id}`);
  }
  return true;
}

function themePlayerBrowser() {
  const section=document.currentScript.parentElement;
  section.querySelectorAll('audio').forEach(audio=>{
    const status=document.getElementById(audio.getAttribute('aria-describedby'));
    const button=section.querySelector('[aria-controls="'+audio.id+'"]');
    const sync=()=>{button.textContent=audio.paused?'Play theme song':'Pause theme song';button.setAttribute('aria-pressed',String(!audio.paused));};
    button.addEventListener('click',()=>{if(audio.paused)audio.play().catch(()=>{status.hidden=false;});else audio.pause();});
    audio.addEventListener('play',()=>{section.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause();});sync();});
    for(const event of ['pause','ended'])audio.addEventListener(event,sync);
    const unavailable=()=>{status.hidden=false;sync();};
    audio.addEventListener('error',unavailable);
    audio.querySelectorAll('source').forEach(source=>source.addEventListener('error',unavailable));
    audio.addEventListener('loadedmetadata',()=>{status.hidden=true;});
  });
}

function renderThemeSection(page, options = {}) {
  const tracks = selectTracks(page, options);
  if (!tracks.length) return '';
  return `<section class="content-card page-theme" aria-labelledby="page-theme-heading"><h2 id="page-theme-heading">Theme song</h2><p>Enjoy this page’s music while you explore.</p>` + tracks.map((track,index)=>`<div class="page-theme-track${track.primary?' page-theme-primary':''}"><h3 id="page-theme-title-${index}">${escape(track.title)}</h3><p id="page-theme-version-${index}">${track.primary?'Primary theme':'Additional theme'}</p><button type="button" class="button theme-play" aria-controls="theme-audio-${index}" aria-pressed="false" aria-label="Play or pause ${escape(track.title)} (${track.primary?'Primary theme':'Additional theme'})">Play theme song</button><audio id="theme-audio-${index}" controls preload="none" aria-labelledby="page-theme-title-${index} page-theme-version-${index}" aria-describedby="page-theme-status-${index}"><source src="${escape(track.audioUrl)}" type="audio/mpeg" />Your browser does not support audio playback.</audio><p id="page-theme-status-${index}" class="page-theme-status" role="status" hidden>This recording is unavailable right now. You can continue exploring the page.</p></div>`).join('') + `<p><a href="${'../'.repeat(page.split('/').length-1)}theme-songs.html">Explore all theme songs</a></p><script>(${themePlayerBrowser.toString()})();</script></section>`;
}
validateManifest(manifest);
module.exports = { validateManifest, validateDestinations, selectTracks, renderThemeSection, themePlayerBrowser };
