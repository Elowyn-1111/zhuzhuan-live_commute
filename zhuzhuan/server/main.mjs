import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { onRequest as api } from '../functions/api/[[path]].js';
import { onRequest as maps } from '../functions/_AMapService/[[path]].js';
const root=resolve(import.meta.dirname,'..');
const production=process.env.NODE_ENV==='production';
const env={...process.env};
if(!production && existsSync(resolve(root,'.dev.vars'))) for(const line of readFileSync(resolve(root,'.dev.vars'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_0-9]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const port=Number(env.PORT||8788), host=env.HOST||'127.0.0.1';
env.APP_ORIGIN ||= `http://localhost:${port}`;
if(production && !/^https:\/\/[^/]+$/.test(env.APP_ORIGIN))throw Error('Production APP_ORIGIN must be HTTPS');
const data=resolve(env.DATA_DIR||resolve(root,'.local-data'));
await mkdir(data,{recursive:true,mode:0o700});
const fresh=!existsSync(resolve(data,'site.sqlite'));
const sql=new DatabaseSync(resolve(data,'site.sqlite'));
sql.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
sql.exec(await readFile(resolve(root,'schema.sql'),'utf8'));
if(!sql.prepare('PRAGMA table_info(notes)').all().some(column=>column.name==='city'))sql.exec("ALTER TABLE notes ADD COLUMN city TEXT NOT NULL DEFAULT '上海'");
if(fresh && (!production||env.SEED_DEMO==='true'))sql.exec(await readFile(resolve(root,'seed.sql'),'utf8'));
env.DB={prepare(query){const stmt=sql.prepare(query);let values=[];return{bind(...v){values=v;return this;},async first(){return stmt.get(...values)||null;},async all(){return{results:stmt.all(...values)};},async run(){const r=stmt.run(...values);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};}};
function mediaPath(key){if(!/^[a-zA-Z0-9_./-]+$/.test(key)||key.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid media key');return resolve(data,'media',key);}
env.MEDIA={async put(key,body,meta){const path=mediaPath(key);await mkdir(dirname(path),{recursive:true});const bytes=Buffer.from(await new Response(body).arrayBuffer());const tmp=path+'.tmp-'+crypto.randomUUID();await writeFile(tmp,bytes,{mode:0o600});await rename(tmp,path);await writeFile(path+'.json',JSON.stringify(meta),{mode:0o600});},async get(key){try{const path=mediaPath(key),meta=JSON.parse(await readFile(path+'.json','utf8'));return{...meta,body:await readFile(path),writeHttpMetadata(headers){headers.set('content-type',meta.httpMetadata.contentType);}};}catch(e){if(e.code==='ENOENT')return null;throw e;}},async delete(key){for(const path of [mediaPath(key),mediaPath(key)+'.json'])try{await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}}};
const metroCities=JSON.parse(await readFile(resolve(root,'server/metro-cities.json'),'utf8'));
const metroCache=new Map([['3100',JSON.parse(await readFile(resolve(root,'server/metro-shanghai.json'),'utf8'))]]);
async function metroResponse(url){
 if(url.pathname==='/api/metro/cities')return Response.json({cities:metroCities},{headers:{'cache-control':'public,max-age=3600'}});
 const city=metroCities.find(x=>x.adcode===url.searchParams.get('city'));if(!city)return Response.json({error:'请选择高德地铁城市列表中的城市。'},{status:422});
 if(!metroCache.has(city.adcode)){const response=await fetch(`https://webapi.amap.com/subway/data/${city.adcode}_drw_${city.spell}.json`,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Metro upstream unavailable');const text=await response.text();if(text.length>3000000)throw Error('Metro payload too large');const raw=JSON.parse(text);if(!Array.isArray(raw.l))throw Error('Invalid metro network');metroCache.set(city.adcode,raw);}
 return Response.json({city,network:metroCache.get(city.adcode)},{headers:{'cache-control':'public,max-age=3600'}});
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const allowed=new Set(['index.html','404.html','styles.css','organic.css','app.js','arrival.js','data.js','minimal.css','metro.js']);
const server=http.createServer(async(req,res)=>{try{
 const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
 headers.set('cf-connecting-ip',env.TRUST_PROXY==='true'&&loopback?(req.headers['x-real-ip']||req.socket.remoteAddress):req.socket.remoteAddress||'unknown');
 const origin=new URL(env.APP_ORIGIN);
 const validHost=production?origin.host: new Set([`localhost:${port}`,`127.0.0.1:${port}`]).has(req.headers.host);
 if(production ? req.headers.host!==validHost : !validHost){res.writeHead(400);res.end('Invalid host');return;}
 const url=new URL(req.url,origin);
 let response;
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/_AMapService/')){
   if(Number(req.headers['content-length']||0)>6*1024*1024){res.writeHead(413);res.end();return;}
   let body;if(!['GET','HEAD'].includes(req.method)){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}body=Buffer.concat(chunks);}
   const prefix=url.pathname.startsWith('/api/')?'/api/':'/_AMapService/';
   const request=new Request(url,{method:req.method,headers,body});
   if(url.pathname.startsWith('/api/metro/') && ['GET','HEAD'].includes(req.method))response=await metroResponse(url);
   else response=await(prefix==='/api/'?api:maps)({request,env,params:{path:url.pathname.slice(prefix.length).split('/')}});
 }else{
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(!['GET','HEAD'].includes(req.method))response=new Response('Method not allowed',{status:405});
   else if(!allowed.has(file))response=new Response('Not found',{status:404});
   else response=new Response(await readFile(resolve(root,'public',file)),{headers:{'content-type':types[file.slice(file.lastIndexOf('.'))],'cache-control':'no-cache'}});
 }
 response.headers.set('x-content-type-options','nosniff');response.headers.set('x-frame-options','DENY');response.headers.set('referrer-policy','strict-origin-when-cross-origin');
 const out=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies;
 res.writeHead(response.status,out);if(req.method==='HEAD'||!response.body)res.end();else Readable.fromWeb(response.body).pipe(res);
 }catch(e){console.error('Request failed:',e.name);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'服务暂时不可用，请稍后重试。'}));}});
server.listen(port,host,()=>console.log(`住住安: ${env.APP_ORIGIN} (SQLite, local disk images)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{sql.close();process.exit(0);}));
