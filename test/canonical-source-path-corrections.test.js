const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {Readable}=require('stream');
const {restoreLibraryCanon}=require('../scripts/restore-library-canon');
const corrections=require('../data/canonical-source-path-corrections.json');
test('reviewed source filename correction retains REL-0009 and pins the authoritative object',()=>{
 const registry=require('../data/entity-id-registry.json'),record=corrections[0];
 assert.equal(corrections.length,1);assert.equal(record.key,'Relationships/G[a-Ali Visual Canon.docx');
 assert.equal(record.sourcePath,'Relationships/Gpa-Ali Visual Canon.docx');
 assert.equal(registry.entries['relationship:'+record.sourcePath].id,'REL-0009');
 assert.equal(registry.entries['relationship:'+record.key],undefined);
 assert.equal(record.sha256,'bed588ed31947ecae82f89e41cb7044925ac428a6ade591ef1e28c518e914ca9');assert.equal(record.sizeBytes,9191046);
});
test('runner restores identical canonical bytes under the corrected filename and fails on altered or missing bytes',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hh-canon-path-'));
 try{
  const bytes=Buffer.from('unchanged authoritative relationship document'),record={...corrections[0],sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length};
  let body=bytes;const calls=[];
  const r2Client={async send(command){const type=command.constructor.name;calls.push(type);
   if(type==='ListObjectsV2Command')return {Contents:[{Key:record.key}]};
   assert.equal(type,'GetObjectCommand','source restoration must remain read-only');
   if(command.input.Key==='manifest/manifest.json')return {Body:Readable.from([Buffer.from('{"records":[]}')])};
   assert.equal(command.input.Key,record.key,'keep the existing authoritative R2 key');
   if(!body)throw Error('NoSuchKey');return {Body:Readable.from([body])};
  }};
  const options={destination:path.join(temp,'Library'),r2Only:true,r2Client,credentials:{configured:false},sourcePathCorrections:[record]};
  await restoreLibraryCanon(options);
  const restored=path.join(options.destination,record.sourcePath);
  assert.deepEqual(fs.readFileSync(restored),bytes);
  assert.equal(fs.existsSync(path.join(options.destination,record.key)),false);
  body=Buffer.from(bytes);body[0]^=1;
  await assert.rejects(restoreLibraryCanon(options),/size or SHA-256 does not match/);
  assert.deepEqual(fs.readFileSync(restored),bytes);
  body=null;await assert.rejects(restoreLibraryCanon(options),/NoSuchKey/);
  assert.deepEqual(fs.readFileSync(restored),bytes);
  assert.ok(calls.every(type=>['GetObjectCommand','ListObjectsV2Command'].includes(type)));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
