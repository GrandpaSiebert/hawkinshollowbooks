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
