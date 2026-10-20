import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.zip':'application/zip','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
    if(!(await stat(file)).isFile())throw new Error('Not a file');
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||4180),'127.0.0.1',()=>console.log('JSON Harbor ready: http://127.0.0.1:'+server.address().port));
