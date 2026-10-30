const http=require('http'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'), output=path.join(root,'build-recovery');
const manifest=require('../data/page-themes.json');
function createPreviewHandler(options={}) {
 const siteRoot=options.root||root, siteOutput=options.output||output, themes=options.manifest||manifest;
 return function serve(req,res){
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  let file, mime;
  if(pathname.startsWith('/audio/')){
    const id=pathname.slice(7).replace(/\.mp3$/,'');const track=themes.recordings.find(t=>t.id===id&&t.classification!=='unresolved');
    if(!track){res.writeHead(404);res.end();return;}file=path.join(siteRoot,track.sourcePath);mime='audio/mpeg';
  }else{
    file=path.resolve(siteOutput,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(siteOutput+path.sep)){res.writeHead(403);res.end();return;}
    mime=({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
  }
  let stat;try{stat=fs.statSync(file);if(!stat.isFile())throw Error();}catch{res.writeHead(404);res.end();return;}
  const headers={'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'no-store'};let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;status=206;}
  headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD')res.end();else fs.createReadStream(file,{start,end}).pipe(res);
 }; }
const serve=createPreviewHandler();
if(require.main===module)http.createServer(serve).listen(8094,'127.0.0.1',()=>console.log('Candidate only: http://127.0.0.1:8094'));
module.exports={serve,createPreviewHandler};
