const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const parse5=require('parse5');
const manifest=require('../data/page-themes.json');
const {validateManifest,validateDestinations,selectTracks,renderThemeSection}=require('../scripts/page-themes');
const {designation,inspectMp3}=require('../scripts/page-theme-inventory');
const {createPlan,classifyRemote,publish}=require('../scripts/publish-page-themes');
const {createPreviewHandler}=require('../scripts/preview-page-themes');
const {elements,attr,text}=require('../scripts/audit-image-alt');
const root=path.join(__dirname,'..');
const clone=x=>JSON.parse(JSON.stringify(x));
const first=manifest.recordings.find(t=>t.primary);
const previewBase='http://127.0.0.1:8094/audio';

test('all recordings retain a canonical page association and their explicit designation',()=>{
  assert.equal(manifest.recordings.length,274);
  assert.equal(new Set(manifest.recordings.map(t=>t.id)).size,274);
  assert.equal(new Set(manifest.recordings.map(t=>t.page)).size,137);
  assert.deepEqual(['confirmed-primary','confirmed-alternate','unresolved'].map(c=>manifest.recordings.filter(t=>t.classification===c).length),[137,128,9]);
  for(const track of manifest.recordings){assert.equal(track.classification,designation(track.originalFilename));assert.ok(track.sourcePath.startsWith('Library/Theme Songs/'));assert.equal(path.posix.basename(track.sourcePath),track.originalFilename);assert.ok(!track.sourcePath.includes('\\'));assert.ok(track.durationSeconds>0);}
  assert.equal(validateManifest(manifest),true);
  assert.equal(validateDestinations(manifest,require('../generated/entity-index.json'),require('../generated/public-discovery-index.json')),true);
});
test('case-sensitive routes, canonical identities, Primary flags and deterministic keys fail closed',()=>{
  for(const change of [t=>t.page=t.page.toLowerCase(),t=>t.canonicalId='HH-A-9999']){
    const m=clone(manifest);change(m.recordings[0]);assert.throws(()=>validateDestinations(m,require('../generated/entity-index.json'),require('../generated/public-discovery-index.json')),/canonical routing/);
  }
  for(const change of [m=>m.recordings.push(m.recordings[0]),m=>m.recordings[0].primary=!m.recordings[0].primary,m=>m.recordings[0].publicUrl='https://example.com/a.mp3',m=>m.recordings[0].durationSeconds=0]){
    const m=clone(manifest);change(m);assert.throws(()=>validateManifest(m));
  }
});
test('unmarked and misspelled names are unresolved rather than silently promoted or rejected as unapproved',()=>{
  for(const name of ['Theme.mp3','Theme (1).mp3','Theme Altermate.mp3'])assert.equal(designation(name),'unresolved');
  assert.equal(designation('Theme SongPrimary.mp3'),'confirmed-primary');
  assert.equal(designation('Theme Alternative.mp3'),'confirmed-alternate');
  for(const t of manifest.recordings.filter(r=>r.classification==='unresolved')){
    assert.ok(manifest.recordings.some(p=>p.page===t.page&&p.primary));
    assert.ok(!selectTracks(t.page,{previewBase}).some(p=>p.id===t.id));
  }
});
test('production requires verified matching delivery receipts and never promotes a missing Primary',()=>{
  assert.equal(selectTracks(first.page,{publication:{records:[]}}).length,0);
  const tracks=manifest.recordings.filter(t=>t.page===first.page&&t.classification!=='unresolved');
  const receipts=tracks.map(t=>({id:t.id,status:'verified',ownerApproved:true,sha256:t.sha256,objectKey:t.objectKey,publicUrl:t.publicUrl,sizeBytes:t.sizeBytes,rangeVerified:true}));
  const selected=selectTracks(first.page,{publication:{records:receipts}});assert.equal(selected.length,tracks.length);assert.equal(selected[0].primary,true);
  assert.equal(selectTracks(first.page,{publication:{records:receipts.filter(r=>r.id!==first.id)}}).length,0);
  for(const key of ['ownerApproved','sha256','objectKey','publicUrl','sizeBytes','rangeVerified']){const copy=clone(receipts);copy.find(r=>r.id===first.id)[key]=null;assert.equal(selectTracks(first.page,{publication:{records:copy}}).length,0);}
  assert.throws(()=>selectTracks(first.page,{previewBase:'https://example.com/audio'}));
});
test('native players have individual names, normal transport controls, and no autoplay, looping or downloads',()=>{
  for(const page of new Set(manifest.recordings.map(t=>t.page))){
    const html=renderThemeSection(page,{previewBase});const doc=parse5.parseFragment(html);const audio=elements(doc,'audio');
    assert.equal(audio.length,selectTracks(page,{previewBase}).length);
    for(const player of audio){assert.notEqual(attr(player,'controls'),undefined);assert.equal(attr(player,'preload'),'none');assert.equal(attr(player,'autoplay'),undefined);assert.equal(attr(player,'loop'),undefined);
      assert.ok(elements(doc,'h3').some(h=>(attr(player,'aria-labelledby')||'').split(' ').includes(attr(h,'id'))&&text(h).trim()));
      assert.ok(elements(doc,'p').some(p=>attr(p,'id')===attr(player,'aria-describedby')&&attr(p,'role')==='status'));
      assert.equal(attr(elements(player,'source')[0],'type'),'audio/mpeg');}
    assert.equal(elements(doc,'iframe').length,0);assert.equal(elements(doc,'a').length,1);
    assert.match(attr(elements(doc,'a')[0],'href'), /theme-songs\.html$/);
    assert.equal(elements(doc,'button').length,audio.length);
  }
  assert.equal(renderThemeSection('nursery-rhymes.html',{previewBase}),'');
  assert.equal(renderThemeSection(first.page,{publication:{records:[]}}),'');
});
test('upload plan preserves all confirmed associations, deduplicates objects, and refuses conflicting objects or absent approval',async()=>{
  const plan=createPlan(manifest);assert.equal(plan.tracks.length,265);assert.equal(plan.withheld.length,9);assert.equal(new Set(plan.objects.map(a=>a.key)).size,plan.objects.length);
  const asset=plan.objects[0];assert.equal(classifyRemote(asset,null),'new-object');
  assert.equal(classifyRemote(asset,{Metadata:{sha256:asset.sha256},ContentLength:asset.sizeBytes,ContentType:'audio/mpeg'}),'reuse-verified-identical');
  assert.throws(()=>classifyRemote(asset,{Metadata:{sha256:'wrong'},ContentLength:asset.sizeBytes,ContentType:'audio/mpeg'}),/no overwrite/);
  let writes=0;await assert.rejects(()=>publish(plan,{send:()=>{writes++;}},{}),/owner-approved/);assert.equal(writes,0);
});
test('local preview supports accurate byte-range seeking and withholds unresolved audio',async()=>{
  const fixture=fs.mkdtempSync(path.join(require('os').tmpdir(),'hh-theme-range-'));
  const data=Buffer.alloc(4096,42);fs.writeFileSync(path.join(fixture,'fixture.mp3'),data);
  const sample={...first,sourcePath:'fixture.mp3',sizeBytes:data.length};
  const unresolved={...sample,id:'unresolved-fixture',classification:'unresolved'};
  const server=http.createServer(createPreviewHandler({root:fixture,manifest:{recordings:[sample,unresolved]}}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(`${base}/audio/${first.id}.mp3`,{headers:{Range:'bytes=1000-2023'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('content-range'),`bytes 1000-2023/${sample.sizeBytes}`);
    const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,data.subarray(1000,2024));
    assert.equal((await fetch(`${base}/audio/${unresolved.id}.mp3`)).status,404);
    const invalid=await fetch(`${base}/audio/${first.id}.mp3`,{headers:{Range:'bytes=9999999999-'}});assert.equal(invalid.status,416);
  }finally{await new Promise(resolve=>server.close(resolve));fs.unlinkSync(path.join(fixture,'fixture.mp3'));fs.rmdirSync(fixture);}
});
test('duration inspection rejects invalid and truncated recordings',()=>{
  assert.throws(()=>inspectMp3(Buffer.from('not an MP3')));
  assert.throws(()=>inspectMp3(Buffer.from([255,251,144,0])));
  const frames=Array.from({length:10},()=>{const frame=Buffer.alloc(417);frame.writeUInt32BE(0xfffb9000);return frame;});
  assert.equal(inspectMp3(Buffer.concat(frames)).durationSeconds,Math.round(10*1152/44100*1000)/1000);
});
test('regenerated candidate places only its associated confirmed recordings on each destination',()=>{
  for(const page of new Set(manifest.recordings.map(t=>t.page))){
    const doc=parse5.parse(fs.readFileSync(path.join(root,'build-recovery',page),'utf8'));
    const audio=elements(doc,'audio'),expected=selectTracks(page,{previewBase:process.env.HH_THEME_SONG_PREVIEW_BASE||''});assert.equal(audio.length,expected.length,page);
    for(let i=0;i<audio.length;i++)assert.equal(attr(elements(audio[i],'source')[0],'src'),expected[i].audioUrl);
  }
});
