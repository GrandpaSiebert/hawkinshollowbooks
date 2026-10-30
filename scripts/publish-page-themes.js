const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Credentials, createR2Client, getRemoteHead, cacheControlForAsset } = require('./publish-library');
const { validateManifest } = require('./page-themes');
const root = path.join(__dirname, '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

function createPlan(manifest) {
  validateManifest(manifest);
  const tracks = manifest.recordings.filter(r=>r.classification !== 'unresolved');
  const objects = new Map();
  for (const track of tracks) {
    const asset = objects.get(track.objectKey) || { key: track.objectKey, sha256: track.sha256, sizeBytes: track.sizeBytes,
      sourcePath: track.sourcePath, publicUrl: track.publicUrl, contentType: 'audio/mpeg', role: 'theme-audio', trackIds: [] };
    asset.trackIds.push(track.id); objects.set(track.objectKey,asset);
  }
  return { schemaVersion: 1, bucket: 'hawkins-hollow-library', approval: 'not-authorized',
    manifestSha256: sha(JSON.stringify(manifest)), tracks: tracks.map(r=>r.id), withheld: manifest.recordings.filter(r=>r.classification === 'unresolved').map(r=>r.id),
    objects: [...objects.values()].map(a=>({...a,cacheControl:cacheControlForAsset(a),contentDisposition:'inline',action:'pending-read-only-preflight'})) };
}
function verifyLocal(asset) {
  const source = path.resolve(root, asset.sourcePath);
  const allowed = path.join(root, 'Library', 'Theme Songs') + path.sep;
  if (!source.startsWith(allowed)) throw Error('Audio source escapes the theme folder');
  const bytes = fs.readFileSync(source);
  if (bytes.length !== asset.sizeBytes || sha(bytes) !== asset.sha256) throw Error(`Audio changed since inventory: ${asset.sourcePath}`);
  return bytes;
}
function classifyRemote(asset, head) {
  if (!head) return 'new-object';
  if (head.Metadata?.sha256 === asset.sha256 && Number(head.ContentLength) === asset.sizeBytes && head.ContentType === 'audio/mpeg') return 'reuse-verified-identical';
  throw Error(`Existing R2 object conflicts; no overwrite permitted: ${asset.key}`);
}
async function verifyDelivery(asset, fetcher = fetch) {
  const response = await fetcher(asset.publicUrl, { headers: { Range:'bytes=0-1023' }, redirect:'error' });
  if (response.status !== 206 || !/^audio\/mpeg(?:;|$)/i.test(response.headers.get('content-type')||'')
    || response.headers.get('content-range') !== `bytes 0-1023/${asset.sizeBytes}`) {
    await response.body?.cancel(); throw Error(`Public MP3 byte-range verification failed: ${asset.key} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = verifyLocal(asset).subarray(0,1024);
  if (!bytes.equals(local)) throw Error(`Public audio bytes differ: ${asset.key}`);
  return true;
}
async function preflight(plan, client) {
  for (const asset of plan.objects) {
    verifyLocal(asset);
    asset.action = classifyRemote(asset, await getRemoteHead(client, plan.bucket, asset.key));
  }
  return plan;
}
async function publish(plan, client, approval) {
  if (approval?.manifestSha256 !== plan.manifestSha256 || approval?.productionWritesApproved !== true
    || JSON.stringify([...approval.trackIds].sort()) !== JSON.stringify([...plan.tracks].sort())) throw Error('Explicit matching owner-approved release list required');
  await preflight(plan,client);
  for (const asset of plan.objects) {
    if (asset.action === 'new-object') {
      await client.send(new PutObjectCommand({ Bucket:plan.bucket, Key:asset.key, Body:verifyLocal(asset), IfNoneMatch:'*',
        ContentType:asset.contentType,ContentDisposition:'inline',CacheControl:asset.cacheControl,Metadata:{sha256:asset.sha256} }));
    }
    if (classifyRemote(asset,await getRemoteHead(client,plan.bucket,asset.key)) !== 'reuse-verified-identical') throw Error('Uploaded audio verification failed');
    await verifyDelivery(asset);
  }
  return { schemaVersion:1, records:plan.objects.flatMap(asset=>asset.trackIds.map(id=>({ id,status:'verified',ownerApproved:true,sha256:asset.sha256,
    sizeBytes:asset.sizeBytes,objectKey:asset.key,publicUrl:asset.publicUrl,rangeVerified:true }))) };
}
async function main() {
  const args=process.argv.slice(2),manifest=require('../data/page-themes.json'),plan=createPlan(manifest);
  if (args.some(a=>!['--preflight','--apply','--approval'].includes(a)) && !args.includes('--approval')) throw Error('Unknown argument');
  const credentials=getR2Credentials({bucket:plan.bucket});
  if (args.includes('--preflight') || args.includes('--apply')) {
    if(!credentials.hasCredentials)throw Error('Existing R2 credentials are required');
    const client=createR2Client(credentials);
    if(args.includes('--apply')){
      const file=args[args.indexOf('--approval')+1];if(!args.includes('--approval')||!file)throw Error('--apply requires an explicit owner-approved list');
      const receipt=await publish(plan,client,JSON.parse(fs.readFileSync(file,'utf8')));
      fs.writeFileSync(path.join(root,'data/page-theme-publication.json'),JSON.stringify(receipt,null,2)+'\n');
    } else await preflight(plan,client);
  }
  fs.mkdirSync(path.join(root,'generated/theme-release'),{recursive:true});
  fs.writeFileSync(path.join(root,'generated/theme-release/upload-plan.json'),JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({objects:plan.objects.length,tracks:plan.tracks.length,withheld:plan.withheld.length,bytes:plan.objects.reduce((s,a)=>s+a.sizeBytes,0),actions:plan.objects.reduce((s,a)=>(s[a.action]=(s[a.action]||0)+1,s),{}),productionWrites:args.includes('--apply')},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={createPlan,verifyLocal,classifyRemote,verifyDelivery,preflight,publish};
