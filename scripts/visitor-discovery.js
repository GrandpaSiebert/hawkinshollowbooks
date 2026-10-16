const escape = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const asset = (url, prefix = '') => /^https?:/.test(url || '') ? url : prefix + String(url || '').replace(/^\//, '');
function card(record, prefix = '') {
  return '<article class="discovery-card">' + (record.image ? '<a tabindex="-1" aria-hidden="true" href="' + escape(prefix + record.href) + '"><img src="' + escape(asset(record.image, prefix)) + '" alt="" loading="lazy" width="240" height="180"></a>' : '') + '<div><p class="eyebrow">' + escape(record.series || record.type) + '</p><h3><a href="' + escape(prefix + record.href) + '">' + escape(record.title) + '</a></h3>' + (record.summary ? '<p>' + escape(record.summary) + '</p>' : '') + (record.readingGuidance ? '<p class="discovery-guidance"><strong>Reading together:</strong> ' + escape(record.readingGuidance) + '</p>' : '') + '</div></article>';
}
function matchesDiscovery(record, choices, omitKind = '') {
  return classifyDiscovery(record,choices,omitKind) === 'match';
}
function discoveryFacetValues(facets, kind) {
  const labels = new Set();
  for (const tag of facets || []) {
    if (tag.kind !== kind) continue;
    if (kind !== 'age') { labels.add(tag.label); continue; }
    const range = String(tag.label).replace(/^Newborn/,'0').match(/^(?:Ages?\s+)?(\d+)[–-](\d+)$/);
    if (range) for (let age=Number(range[1]); age<=Number(range[2]) && age<=120; age++) labels.add(age===0?'Under 1':'Age '+age);
  }
  return [...labels].sort((a,b)=>kind==='age' ? (a==='Under 1'?0:Number(a.slice(4)))-(b==='Under 1'?0:Number(b.slice(4))) : a.localeCompare(b));
}
function classifyDiscovery(record, choices, omitKind = '') {
  const needle = String(choices.query || '').trim().toLowerCase();
  if ((choices.type && record.type !== choices.type) || (choices.series && record.series !== choices.series)
    || (needle && ![record.title,record.summary,record.series,...(record.tags || []).map(tag=>tag.label)].join(' ').toLowerCase().includes(needle))) return 'excluded';
  let missing = false;
  for (const [kind,value] of Object.entries(choices.facets || {})) {
    if (!value || kind === omitKind) continue;
    const labels = (record.tags || []).filter(tag=>tag.kind === kind);
    if (!labels.length) missing = true;
    else if (!labels.some(tag=>{
      if (tag.label === value) return true;
      if (kind !== 'age') return false;
      const age = value === 'Under 1' ? 0 : /^Age \d+$/.test(value) ? Number(value.slice(4)) : NaN;
      const range = String(tag.label).replace(/^Newborn/,'0').match(/^(?:Ages?\s+)?(\d+)[–-](\d+)$/);
      return range && age >= Number(range[1]) && age <= Number(range[2]);
    })) return 'excluded';
  }
  return missing ? 'unclassified' : 'match';
}
function orderDiscoveryRecords(records) {
  const interleave = groups => { const ordered = []; for (let row = 0; groups.some(group => row < group.length); row++) for (const group of groups) if (group[row]) ordered.push(group[row]); return ordered; };
  const collections = new Map(); const types = new Map();
  for (const record of records) {
    const map = record.type === 'book' ? collections : types;
    const key = record.type === 'book' ? record.series : record.type;
    const bucket = map.get(key) || []; bucket.push(record); map.set(key,bucket);
  }
  return interleave([interleave([...collections.values()]), ...types.values()]);
}
function discoveryBrowser(orderDiscoveryRecords, classifyDiscovery, discoveryFacetValues) {
  const form = document.getElementById('discovery-controls');
  const results = document.getElementById('discovery-results');
  const status = document.getElementById('discovery-status');
  if (!form || !results) return;
  form.addEventListener('submit', event => event.preventDefault());
  fetch('generated/public-discovery-index.json').then(response => { if (!response.ok) throw Error('Unavailable'); return response.json(); }).then(index => {
    form.hidden = false; let limit = 12; let unknownLimit = 12;
    const orderedRecords = orderDiscoveryRecords(index.records);
    const more = document.getElementById('discovery-more');
    const unknownSection = document.getElementById('discovery-unclassified');
    const unknownResults = document.getElementById('discovery-unclassified-results');
    const unknownStatus = document.getElementById('discovery-unclassified-status');
    const unknownMore = document.getElementById('discovery-unclassified-more');
    const query = document.getElementById('discovery-filter');
    const type = document.getElementById('discovery-type');
    const series = document.getElementById('discovery-series');
    [...new Set(index.records.filter(record => record.type === 'book').map(record => record.series).filter(Boolean))].sort().forEach(label => { const option = document.createElement('option'); option.value = label; option.textContent = label; series.appendChild(option); });
    const selects = ['interest','feeling','activity','age'].map(kind => {
      const select = document.getElementById('discovery-' + kind);
      select.parentElement.hidden = !(index.facets || []).some(facet=>facet.kind === kind); return [kind, select];
    });
    function render() {
      const choices = {query:query.value, type:type.value, series:series.value, facets:Object.fromEntries(selects.map(([kind,select]) => [kind,select.value]))};
      const matches = orderedRecords.filter(record => classifyDiscovery(record, choices) === 'match');
      const unknown = orderedRecords.filter(record => classifyDiscovery(record, choices) === 'unclassified');
      for (const [kind, select] of selects) {
        const candidates = orderedRecords.filter(record => classifyDiscovery(record, choices, kind) !== 'excluded');
        const counts = new Map();
        for (const record of candidates) for (const label of discoveryFacetValues(record.tags,kind)) counts.set(label,(counts.get(label) || 0)+1);
        const current = select.value;
        const values = discoveryFacetValues(index.facets,kind).map(label=>[label,counts.get(label) || 0]);
        if (current && !values.some(([label]) => label === current)) values.push([current,counts.get(current) || 0]);
        const any = document.createElement('option'); any.value = ''; any.textContent = values.length ? 'Any' : 'No labeled matches'; select.replaceChildren(any);
        for (const [label,count] of values) { const option = document.createElement('option'); option.value = label; option.textContent = label + ' (' + count + ' labeled)'; select.appendChild(option); }
        select.value = current;

      }
      function appendCard(record, target, missingDetails = false) {
        const article = document.createElement('article'); article.className = 'discovery-card';
        if (record.image) { const image = document.createElement('img'); image.src = /^https?:/.test(record.image) ? record.image : record.image.replace(/^\//, ''); image.alt = ''; image.loading = 'lazy'; image.width = 240; image.height = 180; article.appendChild(image); }
        const copy = document.createElement('div'); const heading = document.createElement('h3'); const link = document.createElement('a'); link.href = record.href; link.textContent = record.title; heading.appendChild(link); copy.appendChild(heading);
        const label = document.createElement('p'); label.className = 'eyebrow'; label.textContent = record.series || record.type; copy.prepend(label);
        if (record.summary) { const summary = document.createElement('p'); summary.textContent = record.summary; copy.appendChild(summary); }
        if (record.readingGuidance) { const guidance = document.createElement('p'); guidance.textContent = 'Reading together: ' + record.readingGuidance; copy.appendChild(guidance); }
        if (missingDetails) { const note = document.createElement('p'); note.className = 'discovery-guidance'; const kinds=Object.entries(choices.facets).filter(([kind,value])=>value && !(record.tags || []).some(tag=>tag.kind===kind)).map(([kind])=>({interest:'interest',feeling:'feeling',activity:'activity',age:'age guidance'}[kind])); note.textContent='Not yet recorded: ' + kinds.join(', ') + '. This is not a confirmed match.'; copy.appendChild(note); }
        article.appendChild(copy); target.appendChild(article);
      }
      results.replaceChildren(); matches.slice(0,limit).forEach(record=>appendCard(record,results));
      unknownResults.replaceChildren(); unknown.slice(0,unknownLimit).forEach(record=>appendCard(record,unknownResults,true));
      unknownSection.hidden = unknown.length === 0;
      if (!matches.length && unknown.length) unknownSection.open = true;
      unknownSection.querySelector('summary').textContent = 'More to explore — ' + unknown.length + ' assets with details not yet recorded';
      unknownStatus.textContent = 'Showing ' + Math.min(unknownLimit,unknown.length) + ' of ' + unknown.length + ' assets with details not yet recorded.';
      unknownMore.hidden = unknownLimit >= unknown.length;
      status.textContent = matches.length ? 'Showing ' + Math.min(limit, matches.length) + ' of ' + matches.length + ' confirmed matches.' : 'No confirmed matches for these choices.';
      more.hidden = matches.length <= limit;
    }
    type.addEventListener('change', () => { if (type.value && type.value !== 'book') series.value = ''; });
    series.addEventListener('change', () => { if (series.value) type.value = 'book'; });
    form.addEventListener('input', () => { limit = 12; unknownLimit = 12; render(); });
    form.addEventListener('change', () => { limit = 12; render(); });
    form.addEventListener('reset', () => setTimeout(() => { limit = 12; render(); }, 0));
    more.addEventListener('click', () => { limit += 12; render(); });
    unknownMore.addEventListener('click', () => { unknownLimit += 12; render(); }); render();
  }).catch(() => { status.textContent = 'Choose an illustrated doorway above to keep exploring.'; });
}
function renderDiscoveryHub(index) {
  if (!index) return '';
  const doors = [['character','Meet a Character','characters.html','Find a familiar friend.'],['environment','Visit a Place','map.html','Follow a path through the Hollow.'],['book','Explore Books','books.html','Find your next shared story.'],['song','Sing a Song','kids-songs.html','Bring a little music to the day.'],['rhyme','Share a Nursery Rhyme','nursery-rhymes.html','Enjoy words and rhythm together.'],['landmark','Explore a Landmark','map.html','Discover a place to remember.']];
  const doorCards = doors.map(([type,title,href,summary]) => { const sample = index.records.find(record => record.type === type && record.image); return card({type:'',title,href,summary,image:sample && sample.image || ''}); }).join('');
  const used = new Set();
  const interests = (index.facets || []).filter(facet => facet.kind === 'interest').sort((a,b) => b.count-a.count).slice(0,4).map(facet => {
    const choices = index.records.filter(record => !used.has(record.href) && record.tags.some(tag => tag.kind === 'interest' && tag.label === facet.label)).slice(0,2);
    choices.forEach(record => used.add(record.href));
    return '<details class="discovery-interest-choice"><summary>Explore ' + escape(facet.label) + '</summary><ul>' + choices.map(record => '<li><a href="' + escape(record.href) + '">' + escape(record.title) + '</a></li>').join('') + '</ul></details>';
  }).join('');
  return '<section class="content-card discovery-welcome" aria-labelledby="where-shall-we-go"><p class="eyebrow">A little adventure starts here</p><h2 id="where-shall-we-go">Where Shall We Go Today?</h2><p>One story, one friend, one song, or one place. Choose what catches your eye and see where it leads.</p><p>The paths below are ready to explore without using a filter.</p><div class="discovery-grid discovery-doorways">' + doorCards + '</div><p><a href="themes.html">Explore all themes</a> &middot; <a href="resources.html">Find family resources</a></p></section>' +
    '<section class="content-card" aria-labelledby="what-sounds-good"><h2 id="what-sounds-good">What Sounds Good Right Now?</h2><p>Follow an interest, explore a feeling named in a story, or choose a reading or activity path. Choose what interests you. Confirmed matches appear first. Assets missing a selected detail remain available under More to explore; missing details do not mean a story is unsuitable.</p>' + interests + '<form id="discovery-controls" hidden class="discovery-controls"><label>Show matching paths<input id="discovery-filter" type="search" placeholder="A name, place, story, or idea"></label><label>Kind of adventure<select id="discovery-type"><option value="">All kinds</option>' + ['book','character','environment','landmark','song','rhyme','relationship'].map(type => '<option value="' + type + '">' + type[0].toUpperCase() + type.slice(1) + '</option>').join('') + '</select></label><label>Book collection<select id="discovery-series"><option value="">Every collection</option></select></label>' + [['interest','Interests'],['feeling','Feelings in the stories'],['activity','Skills and activities'],['age',"Child's age"]].map(([kind,label]) => '<label>' + label + '<select id="discovery-' + kind + '"><option value="">Any</option></select></label>').join('') + '<button type="reset">Clear choices</button></form><p id="discovery-status" role="status"></p><div id="discovery-results" class="discovery-grid"></div><button id="discovery-more" type="button" hidden>Show more matches</button><details id="discovery-unclassified" hidden class="discovery-more-to-explore"><summary>More to explore — details not yet recorded</summary><p>These assets fit your type, collection, and search choices, but lack one or more selected labels. Explore them without treating them as confirmed matches.</p><p id="discovery-unclassified-status" role="status"></p><div id="discovery-unclassified-results" class="discovery-grid"></div><button id="discovery-unclassified-more" type="button" hidden>Show more assets</button></details><noscript><p>Open an interest above or choose any illustrated doorway to browse the full collection.</p></noscript></section><script>(' + discoveryBrowser.toString() + ')(' + orderDiscoveryRecords.toString() + ',' + classifyDiscovery.toString() + ',' + discoveryFacetValues.toString() + ');</script>';
}
function shelfBrowser() {
  const form = document.getElementById('bookshelf-controls'); if (!form) return; form.hidden = false;
  form.addEventListener('submit', event => event.preventDefault());
  const cards = Array.from(document.querySelectorAll('[data-shelf-series]'));
  function update() { const series = document.getElementById('bookshelf-series').value; const query = document.getElementById('bookshelf-query').value.trim().toLowerCase(); let count = 0; cards.forEach(card => { card.hidden = Boolean((series && card.dataset.shelfSeries !== series) || (query && !card.textContent.toLowerCase().includes(query))); if (!card.hidden) count++; }); document.getElementById('bookshelf-status').textContent = count + ' of ' + cards.length + ' books'; }
  form.addEventListener('input',update); form.addEventListener('reset',() => setTimeout(update,0)); update();
}
function renderCompleteBookshelf(index) {
  const books = (index && index.records || []).filter(record => record.type === 'book');
  const series = [...new Set(books.map(book => book.series).filter(Boolean))].sort();
  return '<section class="content-card" aria-labelledby="complete-bookshelf"><h2 id="complete-bookshelf">The Complete Bookshelf</h2><p>All ' + books.length + ' available books, gathered in one place. Open a book to read more, meet its characters, and find purchase options.</p><form id="bookshelf-controls" class="discovery-controls" hidden><label>Choose a collection<select id="bookshelf-series"><option value="">Every collection</option>' + series.map(label => '<option>' + escape(label) + '</option>').join('') + '</select></label><label>Find a book<input id="bookshelf-query" type="search" placeholder="Title or idea"></label><button type="reset">Show all books</button></form><p id="bookshelf-status" role="status">' + books.length + ' books</p><div class="discovery-grid">' + books.map(book => '<div data-shelf-series="' + escape(book.series) + '">' + card(book) + '</div>').join('') + '</div></section><script>(' + shelfBrowser.toString() + ')();</script>';
}
function renderKeepExploring(index, href, prefix = '') {
  const record = (index && index.records || []).find(item => item.href === href);
  const related = record && record.related || [];
  const selected = []; const types = new Set();
  for (const item of related) { if (!types.has(item.type)) { selected.push(item); types.add(item.type); } }
  for (const item of related) { if (selected.length >= 4) break; if (!selected.includes(item)) selected.push(item); }
  return '<section class="content-card" aria-labelledby="connected-paths"><h2 id="connected-paths">Keep Exploring</h2>' + (selected.length ? '<p>Follow another connection from this visit.</p><ul>' + selected.slice(0,4).map(item => '<li><a href="' + escape(prefix + item.href) + '">' + escape(item.title) + '</a> <span class="eyebrow">' + escape(item.type) + '</span></li>').join('') + '</ul>' : '') + '<p><a class="button" href="' + prefix + 'start-here.html#where-shall-we-go">Where Shall We Go Today? &rarr;</a></p></section>';
}
module.exports = { renderDiscoveryHub, renderCompleteBookshelf, renderKeepExploring, matchesDiscovery, orderDiscoveryRecords, classifyDiscovery, discoveryFacetValues };
