const fs = require('fs');
const path = require('path');
const { imageAlt } = require('./image-alt-text');
const { renderThemeSection } = require('./page-themes');
const root = path.join(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Delivery receipts remain the authority. Provisional alternates and other pages' music never qualify.
function renderCommunityTheme(options = {}) {
  const manifest = options.manifest || read('data/page-themes.json');
  const primaryOnly = { ...manifest, recordings: manifest.recordings.filter(track =>
    track.page === 'community.html' && track.primary && track.classification === 'confirmed-primary'
    && track.title === 'Come See the Hollow') };
  const html = renderThemeSection('community.html', { ...options, previewBase: '', manifest: primaryOnly });
  if (!html) return '';
  return html.replace('</audio>', '</audio><button type="button" class="button community-theme-stop" aria-controls="theme-audio-0">Stop Come See the Hollow</button>')
    .replace('</section>', `<script>(${communityStopBrowser.toString()})();</script></section>`);
}
function communityStopBrowser() {
  const section = document.currentScript.parentElement;
  section.querySelector('.community-theme-stop').addEventListener('click', () => {
    const audio = section.querySelector('audio');
    audio.pause();
    if (audio.readyState > 0) audio.currentTime = 0;
  });
}

function renderCommunityContent() {
  const characters = read('data/characters.json').characters;
  const discovery = read('generated/public-discovery-index.json').records;
  const series = read('data/series.json').series;
  const published = read('generated/merged-book-index.json').records;
  const illustrations = read('data/homepage-illustrations.json').illustrations;
  function place(id) {
    const record = discovery.find(r => r.id === id && r.type === 'environment');
    if (!record?.image || !record.href) throw Error(`Community place lacks approved image or route: ${id}`);
    return record;
  }
  function picture(source, label, kind = 'place', className = '', approvedAlt) {
    const available = /^https:/.test(source)
      ? read('generated/freebie-title-art-publication.json').records.some(r => r.url === source && r.status === 'verified')
      : fs.existsSync(path.join(root, source.replace(/^\//, ''))) || fs.existsSync(path.join(root, 'build-recovery', source.replace(/^\//, '')));
    if (!available) throw Error(`Missing approved Community illustration: ${source}`);
    return `<img class="${className}" src="${escape(source)}" alt="${approvedAlt ? escape(approvedAlt) : imageAlt(kind, label, source)}" loading="lazy" decoding="async" />`;
  }
  const hero = place('ENV-0032');
  const neighbors = ['spencer-field-mouse', 'aleea-caracara', 'austin-turtle'].map(slug => {
    const c = characters.find(c => c.slug === slug && c.published);
    if (!c?.description) throw Error(`Community character lacks canonical introduction: ${slug}`);
    const thumb = `assets/character-thumbnails/${c.code.toLowerCase()}.webp`;
    return `<article class="community-card">${picture(thumb, c.name, 'portrait', 'community-portrait')}<h3><a href="characters/${escape(c.slug)}.html">${escape(c.name)}</a></h3><p>${escape(c.description)}</p></article>`;
  }).join('');
  const seriesCards = [...series].sort((a, b) => a.sortOrder - b.sortOrder).filter(s => published.some(b => b.series === s.title)).map(s => {
    const route = s.slug === 'storybooks' ? 'storybook-shelf.html' : `${s.slug}.html`;
    return `<article class="community-card"><h3><a href="${route}">${escape(s.title)}</a></h3><p>${escape(s.presentationAuthority.shortDescription)}</p></article>`;
  }).join('');
  const places = ['ENV-0008', 'ENV-0007', 'ENV-0009', 'ENV-0004'].map(id => {
    const p = place(id);
    return `<article class="community-card">${picture(p.image, p.title, 'place', 'community-place-image')}<h3><a href="${escape(p.href)}">${escape(p.title)}</a></h3></article>`;
  }).join('');
  function resourceImage(key) {
    const asset = illustrations.find(i => i.key === key);
    if (!asset) throw Error(`Missing approved free-resource illustration: ${key}`);
    return picture(asset.image, asset.alt, 'title', 'community-resource-image', asset.alt);
  }
  return `<style>
.page-shell:has(.community-page) { max-width:1100px; }
.community-page { overflow-wrap:anywhere; }
.community-page h1 { color:var(--accent); font-size:clamp(1.9rem,4vw,2.65rem); line-height:1.2; margin:.3rem 0 1rem; }
.community-page h2 { font-size:1.6rem; line-height:1.3; }
.community-page h3 { line-height:1.4; margin:.65rem 0; }
.community-page .community-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr)); gap:1rem; margin:1.2rem 0; }
.community-page .community-pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; margin:1.2rem 0; }
.community-page .community-card { min-width:0; padding:1.1rem; border:1px solid var(--border); border-radius:10px; background:var(--surface); }
.community-page .community-card p { margin-bottom:.35rem; }
.community-page .community-card a:not(.button) { color:#526b43; text-underline-offset:.2em; }
.community-page .community-intro-layout { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:1.5rem; align-items:center; }
.community-page .community-intro-layout figure { margin:0; }
.community-page .community-intro-layout img { display:block; width:100%; height:auto; max-height:290px; object-fit:contain; }
.community-page figcaption { font-size:.9rem; margin-top:.5rem; text-align:center; }
.community-page .community-portrait { display:block; height:155px; width:100%; object-fit:contain; }
.community-page .community-place-image { display:block; height:155px; width:100%; object-fit:contain; }
.community-page .community-resource-image { display:block; height:145px; width:100%; object-fit:contain; }
.community-page .community-jump-links { display:flex; flex-wrap:wrap; list-style:none; gap:.65rem; margin:1.2rem 0 0; padding:0; }
.community-page .community-jump-links a { display:block; padding:.55rem .8rem; border:1px solid var(--border); border-radius:24px; color:#23313f; background:#f7efe8; text-underline-offset:.2em; }
.community-page :is(a,button):focus-visible, body:has(.community-page) .site-nav a:focus-visible, body:has(.community-page) .page-theme :is(a,button):focus-visible { outline:3px solid #526b43; outline-offset:4px; }
.community-page .community-note { padding:1rem; border-left:4px solid var(--accent-2); background:#f7efe8; }
.community-page .community-closing { background:#f0eadc; }
.community-page .button { display:inline-block; margin:.25rem .25rem .25rem 0; }
@media(max-width:900px) {
  body:has(.community-page) .site-header { flex-direction:column; align-items:flex-start; gap:.75rem; }
  body:has(.community-page) .site-nav { display:flex; flex-wrap:wrap; gap:.5rem .9rem; }
  body:has(.community-page) .site-nav a { margin-left:0; }
}
@media(max-width:640px) { .community-page .community-pair,.community-page .community-intro-layout { grid-template-columns:minmax(0,1fr); } .community-page .content-card { padding:1.1rem; } }
</style>
<div class="community-page">
<section class="content-card" aria-labelledby="community-doorway">
  <div class="community-intro-layout"><div><p class="eyebrow">One connected neighborhood</p><h1 id="community-doorway">Step Onto the Porch</h1>
  <p>There is more than one way to feel at home in Hawkins Hollow. A character, a story, a familiar place, or a free song can be the beginning of your visit.</p>
  <p>Children and grown-ups bring their own questions, interests, and ways of joining in. Parents, grandparents, caregivers, and educators are welcome to explore alongside them.</p>
  <p>Friendship, family, learning, nature, and ordinary discoveries connect this world. You do not have to do everything, or do it the same way as someone else, to belong.</p></div>
  <figure>${picture(hero.image, hero.title)}<figcaption>${escape(hero.title)} — one familiar place to begin.</figcaption></figure></div>
  <nav aria-label="Explore the community"><ul class="community-jump-links"><li><a href="#community-neighbors">Meet the neighbors</a></li><li><a href="#community-stories">Find a story series</a></li><li><a href="#community-places">Explore a place</a></li><li><a href="#community-free">Enjoy something free</a></li></ul></nav>
</section>
<section class="content-card" aria-labelledby="community-neighbors"><p class="eyebrow">Many voices, room for each</p><h2 id="community-neighbors">Meet the Neighbors</h2>
  <p>Some neighbors ask questions. Some need a little time before answering. Some notice a detail that others have missed. Different strengths, needs, abilities, and communication styles all have a place here.</p>
  <p>These are three introductions, not the whole neighborhood. Follow a friend’s page to discover their stories, places, and connections.</p>
  <div class="community-grid">${neighbors}</div><p><a class="button" href="characters.html">Meet all the neighbors</a></p>
</section>
<section class="content-card" aria-labelledby="community-stories"><p class="eyebrow">Different shelves, the same Hollow</p><h2 id="community-stories">Stories That Bring Us Together</h2>
  <p>Friendship, feelings, communication, family, and belonging take different shapes as children grow. The published collections offer shared reading, early independence, everyday skills, discovery, compassionate support, and seasonal traditions.</p>
  <p>Choose a series to learn about its books and associated resources. Book pages introduce the stories; they do not provide the complete books to read online.</p>
  <div class="community-grid">${seriesCards}</div><p><a class="button" href="books.html">Browse the complete bookshelf</a></p>
</section>
<section class="content-card" aria-labelledby="community-places"><p class="eyebrow">A world worth noticing</p><h2 id="community-places">Explore the Places Around Hawkins Hollow</h2>
  <p>A porch, a path, an orchard, or a creek crossing can offer a different way into the Hollow. Familiar places give visitors somewhere to return, with something new to notice each time.</p>
  <p>Explore these established settings, then follow their own connections. There is no required route and no need to hurry.</p>
  <div class="community-pair">${places}</div><p><a class="button" href="map.html">Open the map of Hawkins Hollow</a></p>
</section>
<section class="content-card" aria-labelledby="community-free"><p class="eyebrow">Free to enjoy, always</p><h2 id="community-free">Free Songs, Nursery Rhymes, and Family Resources</h2>
  <p>Hawkins Hollow’s children’s songs and nursery rhymes are free for families to enjoy. They will remain free, without a subscription, registration, or payment to access them.</p>
  <div class="community-pair"><article class="community-card">${resourceImage('resource-songs')}<h3>Make a little room for a song</h3><p>Browse the words of the children’s songs. Listen where a recording is available, or share the words together.</p><a class="button" href="kids-songs.html">Explore the free children’s songs</a></article>
  <article class="community-card">${resourceImage('resource-rhymes')}<h3>Share a rhyme, at your own pace</h3><p>Find a nursery rhyme to read aloud, repeat, or enjoy quietly. The rhyme text is available even when there is no recording.</p><a class="button" href="nursery-rhymes.html">Explore the free nursery rhymes</a></article></div>
  <p>For children, families, and educators, the <a href="resources.html">Companion Resources catalog</a> brings together story-related activities and reading support. Check each listing for what is available; some resource details are still being prepared. Designated free resources remain free.</p>
  <p class="community-note">The free songs and nursery rhymes are separate from published books. Book pages provide information about each title and its associated resources.</p>
</section>
<section class="content-card" aria-labelledby="community-paths"><p class="eyebrow">A small beginning is enough</p><h2 id="community-paths">Different Ways to Participate</h2>
  <div class="community-grid"><article class="community-card"><h3>Meet someone new</h3><p>Choose one neighbor and notice a quality you appreciate.</p><a href="characters.html">Find a character to meet</a></article>
  <article class="community-card"><h3>Follow a friendship</h3><p>Meet Brandon Rabbit and Austin Turtle through their shared connection.</p><a href="entities/relationship/rel-0006-brandon-rabbit-austin-turtle.html">Explore Brandon and Austin’s connection</a></article>
  <article class="community-card"><h3>Wander together</h3><p>Choose a place from the map and let each person notice one detail.</p><a href="map.html">Choose a place to explore</a></article>
  <article class="community-card"><h3>Share a free song or rhyme</h3><p>Listen where recordings are available, join in, or share the words aloud.</p><a href="kids-songs.html">Find a free song</a> · <a href="nursery-rhymes.html">Find a free rhyme</a></article>
  <article class="community-card"><h3>Discover a new kind of story</h3><p>Find a series that fits today’s interests, questions, or reading moment.</p><a href="start-here.html#where-shall-we-go">Choose a discovery path</a></article>
  <article class="community-card"><h3>Take a quiet moment together</h3><p>Learn about a bedtime story to share at home. A quiet visit counts, too.</p><a href="bedtime-library.html">Learn about the Bedtime Library books</a></article></div>
</section>
<section class="content-card" aria-labelledby="community-caring"><p class="eyebrow">Room to be yourself</p><h2 id="community-caring">A Community Built on Caring</h2>
  <p>Helping a neighbor can begin with listening before assuming what they need. Children can contribute in meaningful ways, and support can leave room for their own choices.</p>
  <p>Friendship does not ask everyone to be the same. Different abilities and ways of communicating deserve respect. Difficult feelings can have room without being hurried toward a happy answer.</p>
  <p>Through family relationships, shared discoveries, and ordinary experiences, the Hollow makes space for trying, asking, resting, and trying again. Not every problem has an easy solution; sometimes being alongside someone matters.</p>
</section>
<section class="content-card community-closing" aria-labelledby="community-next"><h2 id="community-next">Keep the Porch Light On</h2>
  <p>You can follow one connection today and leave another for tomorrow. Bring a question, share a small discovery, or return to a familiar friend. There is room for another visit.</p>
  <p><a class="button" href="start-here.html#where-shall-we-go">Find your next little adventure</a><a class="button" href="theme-songs.html">Choose some music for your visit</a><a class="button" href="index.html">Return to Welcome Home</a></p>
</section>
</div>`;
}
module.exports = { renderCommunityContent, renderCommunityTheme, communityStopBrowser };
