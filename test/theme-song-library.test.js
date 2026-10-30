const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs'),path=require('path'),parse5=require('parse5');
const {libraryTracks,renderThemeLibrary,shuffleTracks,libraryBrowser}=require('../scripts/theme-song-library');
const {themePlayerBrowser}=require('../scripts/page-themes');
const {elements,attr}=require('../scripts/audit-image-alt');
const options={previewBase:'http://127.0.0.1:8094/audio'};
test('library contains all confirmed recordings, preserves associations and excludes unresolved tracks only',()=>{
  const list=libraryTracks(options);assert.equal(list.length,265);assert.equal(new Set(list.map(t=>t.id)).size,265);assert.ok(list.every(t=>t.classification!=='unresolved'&&t.page));assert.equal(libraryTracks({publication:{records:[]}}).length,0);
  const doc=parse5.parseFragment(renderThemeLibrary(options));assert.equal(elements(doc,'audio').length,1);assert.equal(attr(elements(doc,'audio')[0],'src'),undefined);assert.equal(attr(elements(doc,'audio')[0],'autoplay'),undefined);assert.equal(attr(elements(doc,'audio')[0],'loop'),undefined);assert.equal(attr(elements(doc,'audio')[0],'preload'),'none');
  assert.equal(elements(parse5.parseFragment(renderThemeLibrary({publication:{records:[]}})),'audio').length,0,'unverified production recordings must not emit a player');
  assert.equal(elements(doc,'button').filter(n=>attr(n,'data-theme-id')).length,265);assert.equal(elements(doc,'a').length,265);
  for(const id of ['theme-library-random','theme-library-next','theme-library-pause','theme-library-stop'])assert.ok(elements(doc,'button').some(button=>attr(button,'id')===id));
});
test('shuffle is a permutation without repeats and does not change Primary status or original order',()=>{
  const tracks=libraryTracks(options),before=JSON.stringify(tracks);const queue=shuffleTracks(tracks,()=>0);
  assert.equal(queue.length,tracks.length);assert.deepEqual(queue.map(t=>t.id).sort(),tracks.map(t=>t.id).sort());assert.equal(JSON.stringify(tracks),before);
});
class Node {constructor(){this.events={};this.textContent='';this.value='';this.dataset={};this.paused=true;this.playCalls=0;}addEventListener(e,fn){this.events[e]=fn;}setAttribute(k,v){this[k]=v;}emit(e){this.events[e]?.();}play(){this.paused=false;this.playCalls++;this.emit('play');return Promise.resolve();}pause(){this.paused=true;this.emit('pause');}}
test('random playlist starts only on request, advances once through its queue, and stops without looping',()=>{
  const ids=Object.fromEntries(['theme-library-audio','theme-current-title','theme-library-status','theme-library-next','theme-library-random','theme-library-search','theme-library-category','theme-library-count','theme-library-pause','theme-library-stop'].map(id=>[id,new Node()]));
  const tracks=libraryTracks(options).slice(0,3),buttons=tracks.map(t=>Object.assign(new Node(),{dataset:{themeId:t.id}}));
  const document={getElementById:id=>ids[id],querySelectorAll:selector=>selector==='[data-theme-id]'?buttons:[]};
  vm.runInNewContext(`(${libraryBrowser.toString()})(tracks,shuffle)`,{document,tracks,shuffle:array=>array.slice().reverse()});
  const audio=ids['theme-library-audio'];assert.equal(audio.playCalls,0);ids['theme-library-random'].emit('click');assert.equal(audio.src,tracks[2].audioUrl);audio.emit('ended');assert.equal(audio.src,tracks[1].audioUrl);audio.emit('ended');assert.equal(audio.src,tracks[0].audioUrl);audio.emit('ended');assert.equal(audio.playCalls,3);assert.equal(ids['theme-library-next'].disabled,true);assert.match(ids['theme-library-status'].textContent,/finished/);
  buttons[1].emit('click');assert.equal(audio.src,tracks[1].audioUrl);assert.equal(ids['theme-library-next'].disabled,true);
  ids['theme-library-pause'].emit('click');assert.equal(audio.paused,true);ids['theme-library-pause'].emit('click');assert.equal(audio.paused,false);ids['theme-library-stop'].emit('click');assert.equal(audio.paused,true);assert.equal(audio.currentTime,0);assert.equal(ids['theme-library-next'].disabled,true);
  audio.emit('pause');assert.match(ids['theme-library-status'].textContent,/^Stopped\./,'a delayed browser pause event must preserve the Stop confirmation');
  audio.emit('error');assert.match(ids['theme-library-status'].textContent,/unavailable/);
});
test('page play button operates only its own audio and displays resource errors',()=>{
  const audio=new Node(),source=new Node(),button=new Node(),status=new Node();status.hidden=true;audio.id='theme-audio-0';audio.getAttribute=()=> 'status';audio.querySelectorAll=()=>[source];
  const section={querySelectorAll:()=>[audio],querySelector:()=>button};const document={currentScript:{parentElement:section},getElementById:()=>status};
  vm.runInNewContext(`(${themePlayerBrowser.toString()})();`,{document});assert.equal(audio.playCalls,0);button.emit('click');assert.equal(audio.playCalls,1);assert.equal(button.textContent,'Pause theme song');button.emit('click');assert.equal(audio.paused,true);assert.equal(button.textContent,'Play theme song');source.emit('error');assert.equal(status.hidden,false);audio.emit('loadedmetadata');assert.equal(status.hidden,true);
});
test('starting another page theme pauses the previously active recording',()=>{
  const audios=[new Node(),new Node()],buttons=[new Node(),new Node()],statuses=[new Node(),new Node()];
  audios.forEach((audio,index)=>{audio.id=`theme-audio-${index}`;audio.getAttribute=()=>`status-${index}`;audio.querySelectorAll=()=>[];});
  const section={querySelectorAll:()=>audios,querySelector:selector=>buttons[audios.findIndex(audio=>selector.includes(audio.id))]};
  const document={currentScript:{parentElement:section},getElementById:id=>statuses[Number(id.slice(-1))]};
  vm.runInNewContext(`(${themePlayerBrowser.toString()})();`,{document});
  buttons[0].emit('click');assert.equal(audios[0].paused,false);
  buttons[1].emit('click');assert.equal(audios[0].paused,true);assert.equal(audios[1].paused,false);
});
test('generated theme library is discoverable without replacing the existing discovery themes page',()=>{
  const root=path.join(__dirname,'../build-recovery');assert.ok(fs.existsSync(path.join(root,'themes.html')));const html=fs.readFileSync(path.join(root,'theme-songs.html'),'utf8');const doc=parse5.parse(html);
  assert.equal(elements(doc,'h1').length,1);
  assert.ok(elements(doc,'img').some(img=>attr(img,'class')==='page-banner-image'));
  const eligible=libraryTracks({previewBase:process.env.HH_THEME_SONG_PREVIEW_BASE||''});
  assert.equal(elements(doc,'button').filter(button=>attr(button,'data-theme-id')).length,eligible.length);
  if(eligible.length){
    assert.ok(elements(doc,'button').some(b=>attr(b,'id')==='theme-library-random'));
    assert.notEqual(attr(elements(doc,'audio')[0],'hidden'),undefined);
    assert.ok(elements(doc,'button').some(b=>attr(b,'id')==='theme-library-pause'));
    assert.ok(elements(doc,'button').some(b=>attr(b,'id')==='theme-library-stop'));
  }else{
    assert.equal(elements(doc,'audio').length,0);
    assert.match(html,/Theme songs will appear here when their recordings are ready/);
  }
  assert.ok(elements(doc,'link').some(n=>attr(n,'rel')==='canonical'&&attr(n,'href')==='https://hawkinshollowbooks.com/theme-songs.html'));
  assert.match(fs.readFileSync(path.join(root,'sitemap.xml'),'utf8'),/theme-songs\.html/);
});
