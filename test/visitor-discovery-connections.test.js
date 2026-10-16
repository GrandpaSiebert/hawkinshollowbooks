const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublicDiscoveryIndex } = require('../scripts/public-discovery-index');
const { renderDiscoveryHub, renderCompleteBookshelf, renderKeepExploring } = require('../scripts/visitor-discovery');
test('explicit book and freebie associations survive legacy character IDs in both directions', () => {
 const searches = [{type:'character',id:'Gpa',title:'Grandpa',href:'characters/grandpa.html'}, {type:'book',id:'HH-A-0001',title:'A Story',href:'books/a-story.html'}, {type:'song',id:'HH-S-0001',title:'A Song',href:'kids-songs/a-song.html'}, {type:'environment',id:'ENV-0001',title:'Barn',href:'entities/environment/barn.html'}];
 const entities = {entities:[{type:'character',id:'Gpa',identity:{canonicalId:'CHAR-0001'},slug:'grandpa',entityPageHref:'entities/character/grandpa.html',legacyHref:'characters/grandpa.html',description:'A patient friend.',heroImage:'/grandpa.png'},{type:'environment',id:'ENV-0001',entityPageHref:'entities/environment/barn.html'}]};
 const graph = {edges:[{from:'character:Gpa',to:'environment:ENV-0001'}]};
 const freebies = [{contentType:'song',canonicalId:'HH-S-0001',participants:[{canonicalId:'CHAR-0001'}],canonicalLocations:[{type:'environment',id:'ENV-0001'}]}];
 const result = createPublicDiscoveryIndex(searches,entities,graph,freebies,[{canonicalCharacterId:'CHAR-0001',books:[{bookId:'HH-A-0001'}]}],new Map([['HH-A-0001',['Belonging — an existing source explanation']]]),new Map([['HH-A-0001',{summary:'An approved description.',feelings:['Hopeful'],series:'Storybooks',readingGuidance:'Read together'}]]));
 const [character,book,song,place] = result.records;
 assert.equal(character.summary,'A patient friend.'); assert.equal(character.image,'/grandpa.png');
 assert.ok(character.related.some(item => item.href === book.href)); assert.ok(book.related.some(item => item.href === character.href));
 assert.ok(character.related.some(item => item.href === song.href)); assert.ok(song.related.some(item => item.href === character.href));
 assert.ok(place.related.some(item => item.href === character.href)); assert.ok(place.related.some(item => item.href === song.href));
 assert.deepEqual(book.tags,[{kind:'interest',label:'Belonging'},{kind:'feeling',label:'Hopeful'}]);
 assert.equal(book.readingGuidance,'Read together');
 const hub=renderDiscoveryHub(result); assert.match(hub,/characters.html/); assert.match(hub,/discovery-feeling/); assert.match(hub,/discoveryBrowser/);
 const shelf=renderCompleteBookshelf(result); assert.match(shelf,/All 1 available books/); assert.match(shelf,/An approved description/);
 assert.ok(renderKeepExploring(result,book.href,'../').includes('../characters/grandpa.html'));
});
test('similar themes never fabricate a relationship', () => {
 const result=createPublicDiscoveryIndex([{type:'book',id:'B1',title:'One',href:'one.html',theme:'Kindness'},{type:'book',id:'B2',title:'Two',href:'two.html',theme:'Kindness'}],{entities:[]},{edges:[]},[]);
 assert.ok(result.records.every(record => record.related.length === 0));
});


test('plain source age ranges keep every book collection discoverable', () => {
 const {matchesDiscovery,orderDiscoveryRecords}=require('../scripts/visitor-discovery');
 const series=['Storybooks','First Readers','Second Readers','Growing Together','Bedtime Library','Tender Times','Holiday Story Poems','Basic Training','Hero Play Poems'];
 const search=series.map((name,i)=>({type:'book',id:'B'+i,title:name,href:'book-'+i+'.html'}));
 const metadata=new Map(series.map((name,i)=>['B'+i,{series:name,readingGuidance:i<2?'Ages 4–8; shared reading':'4–8'}]));
 const result=createPublicDiscoveryIndex(search,{entities:[]},{edges:[]},[],[],new Map(),metadata);
 assert.ok(result.records.every(record=>record.tags.some(tag=>tag.kind==='age'&&tag.label==='Ages 4–8')));
 assert.equal(result.records.filter(record=>matchesDiscovery(record,{facets:{age:'Ages 4–8'}})).length,9);
 assert.equal(result.records.filter(record=>matchesDiscovery(record,{series:'Second Readers',facets:{age:'Ages 4–8'}})).length,1);
 assert.equal(result.records.filter(record=>matchesDiscovery(record,{facets:{feeling:'Hopeful'}})).length,0,'missing feeling labels are never invented');
 const books=series.flatMap((name,i)=>Array.from({length:3},(_,j)=>({type:'book',series:name,id:i+'-'+j})));
 assert.equal(new Set(orderDiscoveryRecords(books).slice(0,9).map(record=>record.series)).size,9,'first results represent every collection');
});


test('discovery separates missing metadata from confirmed matches and explicit mismatches', () => {
 const {classifyDiscovery,discoveryFacetValues,orderDiscoveryRecords}=require('../scripts/visitor-discovery');
 const choices={facets:{feeling:'Hopeful',age:'Age 6'}};
 const known={type:'book',series:'Storybooks',tags:[{kind:'feeling',label:'Hopeful'},{kind:'age',label:'Ages 3–7'}]};
 assert.equal(classifyDiscovery(known,choices),'match');
 assert.equal(classifyDiscovery({...known,tags:[{kind:'age',label:'Ages 4–8'}]},choices),'unclassified');
 assert.equal(classifyDiscovery({...known,tags:[{kind:'feeling',label:'Sad'},{kind:'age',label:'Ages 3–7'}]},choices),'excluded');
 assert.equal(classifyDiscovery({...known,tags:[{kind:'age',label:'Ages 8–12'}]},choices),'excluded');
 assert.equal(classifyDiscovery({type:'rhyme',tags:[]},choices),'unclassified');
 assert.equal(classifyDiscovery({type:'character',tags:[]},choices),'unclassified');
 assert.equal(classifyDiscovery({type:'rhyme',tags:[]},{...choices,type:'book'}),'excluded');
 assert.equal(classifyDiscovery(known,{...choices,series:'First Readers'}),'excluded');
 assert.equal(classifyDiscovery(known,{facets:{feeling:'Hopeful'}},'feeling'),'match');
 const facets=Array.from({length:85},(_,i)=>({kind:'interest',label:'Interest '+i}));
 assert.equal(discoveryFacetValues(facets,'interest').length,85,'uncommon labels are never capped out');
 assert.deepEqual(discoveryFacetValues([{kind:'age',label:'Ages 4–8'},{kind:'age',label:'Ages 6–9'}],'age'),['Age 4','Age 5','Age 6','Age 7','Age 8','Age 9']);
 assert.ok(orderDiscoveryRecords([known,{type:'rhyme',tags:[]}]).length===2);
});
