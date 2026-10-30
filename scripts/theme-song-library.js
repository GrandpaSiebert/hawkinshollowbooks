const manifest=require('../data/page-themes.json');
const {selectTracks}=require('./page-themes');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function shuffleTracks(tracks,random=Math.random){const queue=tracks.slice();for(let i=queue.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}return queue;}
function libraryBrowser(tracks,shuffleTracks){
  const audio=document.getElementById('theme-library-audio'),title=document.getElementById('theme-current-title');
  const status=document.getElementById('theme-library-status'),next=document.getElementById('theme-library-next');
  const pause=document.getElementById('theme-library-pause'),stop=document.getElementById('theme-library-stop');
  let queue=[],position=-1,stopped=false;
  function sync(){pause.textContent=audio.paused?'Resume theme':'Pause theme';pause.setAttribute('aria-pressed',String(!audio.paused));}
  pause.addEventListener('click',()=>{if(audio.paused)audio.play().catch(()=>{status.textContent='This recording is unavailable right now.';});else audio.pause();});
  stop.addEventListener('click',()=>{stopped=true;queue=[];position=-1;audio.pause();audio.currentTime=0;next.disabled=true;pause.disabled=true;stop.disabled=true;status.textContent='Stopped. Choose a theme or start another random playlist.';});
  function play(track){
    stopped=false;
    title.textContent=track.title+' — '+track.pageTitle+(track.primary?' (Primary theme)':' (Additional theme)');
    audio.hidden=false;audio.src=track.audioUrl;status.textContent='Ready to play '+track.title+'.';
    audio.play().catch(()=>{status.textContent='This recording is unavailable right now. Choose another theme or try again.';});
    next.disabled=position+1>=queue.length;pause.disabled=false;stop.disabled=false;
  }
  document.querySelectorAll('[data-theme-id]').forEach(button=>button.addEventListener('click',()=>{
    queue=[];position=-1;play(tracks.find(track=>track.id===button.dataset.themeId));
  }));
  document.getElementById('theme-library-random').addEventListener('click',()=>{queue=shuffleTracks(tracks);position=0;if(queue.length)play(queue[0]);});
  function advance(){if(position+1<queue.length){position++;play(queue[position]);}else{next.disabled=true;status.textContent='Playlist finished. Choose a theme or start another random playlist.';}}
  next.addEventListener('click',advance);audio.addEventListener('ended',advance);
  audio.addEventListener('error',()=>{status.textContent='This recording is unavailable right now. Choose another theme or try again.';});
  audio.addEventListener('play',()=>{sync();status.textContent='Playing '+title.textContent;});
  audio.addEventListener('pause',()=>{sync();if(!audio.ended&&!stopped)status.textContent='Paused '+title.textContent;});
  const search=document.getElementById('theme-library-search'),category=document.getElementById('theme-library-category');
  function filter(){const query=search.value.trim().toLowerCase();let count=0;document.querySelectorAll('[data-theme-row]').forEach(row=>{row.hidden=Boolean(category.value&&row.dataset.category!==category.value||query&&!row.textContent.toLowerCase().includes(query));if(!row.hidden)count++;});document.getElementById('theme-library-count').textContent=count+' themes available.';}
  search.addEventListener('input',filter);category.addEventListener('change',filter);
}
function libraryTracks(options={}){return [...new Set(manifest.recordings.map(t=>t.page))].flatMap(page=>selectTracks(page,options));}
function renderThemeLibrary(options={}){
  const tracks=libraryTracks(options);
  if(!tracks.length)return '<section class="content-card"><h1>Theme Songs</h1><h2>Music for your visit</h2><p>Theme songs will appear here when their recordings are ready.</p></section>';
  const publicTracks=tracks.map(({id,title,pageTitle,category,primary,audioUrl,page})=>({id,title,pageTitle,category,primary,audioUrl,page}));
  return `<section class="content-card theme-library"><h1>Theme Songs</h1><h2>Music for your visit</h2><p>Choose a full theme, or enjoy a random playlist as you explore Hawkins Hollow. Each song belongs to the page linked beside it.</p><div class="theme-library-player"><h3 id="theme-current-title">Choose a theme to begin</h3><button class="button" type="button" id="theme-library-random">Play a random playlist</button> <button class="button" type="button" id="theme-library-next" disabled>Skip to next theme</button> <button class="button" type="button" id="theme-library-pause" disabled aria-pressed="false">Pause theme</button> <button class="button" type="button" id="theme-library-stop" disabled>Stop</button><audio id="theme-library-audio" hidden controls preload="none" aria-labelledby="theme-current-title" aria-describedby="theme-library-status"></audio><p id="theme-library-status" role="status">Choose a theme, or start a random playlist.</p></div><div class="theme-library-filters"><label>Find a theme <input id="theme-library-search" type="search" /></label><label>Kind of page <select id="theme-library-category"><option value="">All page types</option>${['book','character','relationship','environment','landmark'].map(c=>`<option value="${c}">${c[0].toUpperCase()+c.slice(1)}</option>`).join('')}</select></label></div><p id="theme-library-count" role="status">${tracks.length} themes available.</p><ul class="theme-library-list">`+publicTracks.map(track=>`<li data-theme-row data-category="${track.category}"><button type="button" class="button" data-theme-id="${track.id}" aria-label="Play ${escape(track.title)} for ${escape(track.pageTitle)} (${track.primary?'Primary':'Additional'} theme)">Play ${escape(track.title)}</button><span>${track.primary?'Primary theme':'Additional theme'} · ${escape(track.category)}</span><a href="${escape(track.page)}">Visit ${escape(track.pageTitle)}</a></li>`).join('')+`</ul><noscript><p>Open a linked page to use its theme player without JavaScript.</p></noscript></section><script>(${libraryBrowser.toString()})(${JSON.stringify(publicTracks).replace(/</g,()=>String.fromCharCode(92)+'u003c')},${shuffleTracks.toString()});</script>`;
}
module.exports={shuffleTracks,libraryBrowser,libraryTracks,renderThemeLibrary};
