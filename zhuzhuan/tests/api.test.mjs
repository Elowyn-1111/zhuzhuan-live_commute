import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync('schema.sql','utf8')); sql.exec(readFileSync('seed.sql','utf8'));
  const DB = { prepare(query) {
    let values=[]; const stmt=sql.prepare(query);
    return { bind(...args) { values=args; return this; }, async first() { return stmt.get(...values) || null; }, async all() { return {results:stmt.all(...values)}; }, async run() { return {meta:stmt.run(...values)}; } };
  } };
  const objects=new Map();
  const MEDIA={ async put(key, stream, metadata) { objects.set(key,{bytes:await new Response(stream).arrayBuffer(),...metadata}); }, async delete(key) { objects.delete(key); }, async get(key) { const item=objects.get(key); return item && {...item,body:item.bytes,writeHttpMetadata(headers){headers.set('content-type',item.httpMetadata.contentType);}}; } };
  const env={DB,MEDIA,MEDIA_ENABLED:'true',APP_ORIGIN:'https://trial.example',ADMIN_EMAILS:'admin@example.com'};
  async function call(path, options={}) {
    const {cookie,origin='https://trial.example',body,method='GET'}=options;
    const headers={origin,'cf-connecting-ip':'127.0.0.1'};
    if(cookie) headers.cookie=cookie;
    if(body && !(body instanceof FormData)) headers['content-type']='application/json';
    return onRequest({env,params:{path:path.split('?')[0].split('/')},request:new Request(`https://trial.example/api/${path}`,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined})});
  }
  return {sql,env,call,objects};
}
async function register(call,email) {
  const response=await call('auth/register',{method:'POST',body:{email,password:'trial-password-2026',displayName:'测试'}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  return response.headers.get('set-cookie').split(';')[0];
}
function image() {
  const form=new FormData();
  form.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],'test.png',{type:'image/png'}));
  return form;
}

test('two accounts: sessions, notes, favorites, reviews and isolation',async()=>{
  const {call}=setup();
  const a=await register(call,'a@example.com'), b=await register(call,'b@example.com');
  const created=await call('notes',{method:'POST',cookie:a,body:{region:'建邺区',line:'2号线',layout:'两室',rent:3000,title:'测试房源演示',contact:'test-contact'}});
  assert.equal(created.status,201); const noteId=(await created.json()).id;
  const listed=await (await call('notes')).json(); assert.equal(listed.notes.length,1); assert.equal(listed.notes[0].contact,undefined);
  assert.equal((await call('favorites',{method:'POST',cookie:a,body:{itemType:'notes',itemId:noteId}})).status,201);
  assert.equal((await (await call('favorites',{cookie:a})).json()).favorites.length,1);
  assert.equal((await (await call('favorites',{cookie:b})).json()).favorites.length,0);
  const communities=await (await call('communities')).json(); const id=communities.communities[0].id;
  assert.equal((await call(`communities/${id}/reviews`,{method:'POST',cookie:b,body:{rating:4,body:'测试评价'}})).status,201);
  assert.equal((await (await call(`communities/${id}/reviews`)).json()).reviews.length,1);
  assert.equal((await call('admin/media',{cookie:a})).status,403);
  assert.equal((await call('notes',{method:'POST',cookie:a,origin:'https://evil.example',body:{}})).status,403);
  assert.equal((await call('auth/login',{method:'POST',body:{email:'a@example.com',password:'wrong-password'}})).status,401);
  assert.equal((await call('auth/logout',{method:'POST',cookie:a})).status,200);
  assert.equal((await call('me',{cookie:a})).status,401);
});

test('media: disabled, auth, invalid format, atomic capacity and administrator cleanup',async()=>{
  const {call,env,sql,objects}=setup();
  env.MEDIA_ENABLED='false'; assert.equal((await call('media',{method:'POST',body:image()})).status,503);
  env.MEDIA_ENABLED='true'; assert.equal((await call('media',{method:'POST',body:image()})).status,401);
  const admin=await register(call,'admin@example.com'), user=await register(call,'user@example.com');
  sql.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run('admin@example.com');
  const bad=new FormData(); bad.set('file',new File(['not png'],'fake.png',{type:'image/png'}));
  assert.equal((await call('media',{method:'POST',cookie:admin,body:bad})).status,422);
  env.MEDIA_MAX_TOTAL_BYTES='12';
  const responses=await Promise.all([call('media',{method:'POST',cookie:admin,body:image()}),call('media',{method:'POST',cookie:user,body:image()})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,429]);
  const key=(await responses.find(r=>r.status===201).json()).imageKey;
  assert.equal(sql.prepare('SELECT bytes FROM media_storage').get().bytes,12);
  env.MEDIA_READS_PER_MONTH='1'; assert.equal((await call('media/'+key)).status,200); assert.equal((await call('media/'+key)).status,429);
  env.MEDIA_ENABLED='false'; assert.equal((await call('media/'+key)).status,503);
  assert.equal((await call('admin/media/'+key,{method:'DELETE',cookie:user})).status,403);
  assert.equal((await call('admin/media/'+key,{method:'DELETE',cookie:admin})).status,200);
  assert.equal(objects.size,0); assert.equal(sql.prepare('SELECT bytes FROM media_storage').get().bytes,0);
});

test('map config exposes only JS key and REST quota fails closed',async()=>{
  const {call,env}=setup(); Object.assign(env,{AMAP_JS_KEY:'browser-key',AMAP_SECURITY_JS_CODE:'private-code',AMAP_REST_KEY:'private-rest'});
  const response=await call('map/config'); const text=await response.text();
  assert(text.includes('browser-key')); assert(!text.includes('private-code')); assert(!text.includes('private-rest'));
  env.AMAP_DAILY_REQUEST_LIMIT='0'; assert.equal((await call('map/geocode?address=Nanjing')).status,429);
  const r=await onRequest({env,params:{path:['map','geocode']},request:new Request('https://trial.example/api/map/geocode?address=Nanjing')});
  assert.equal(r.status,429);
});

test('JS SDK proxy: allow official styles root, remove injected credentials and reject cross-site',async()=>{
  const {onRequest:proxy}=await import('../functions/_AMapService/[[path]].js');
  const {env}=setup(); Object.assign(env,{AMAP_JS_KEY:'js-key',AMAP_SECURITY_JS_CODE:'server-code'});
  const original=globalThis.fetch;
  let upstream;
  globalThis.fetch=async url=>{upstream=new URL(url);return new Response('{}',{headers:{'content-type':'application/json'}});};
  try {
    const request=new Request('https://trial.example/_AMapService/v4/map/styles?key=injected&jscode=injected',{headers:{origin:'https://trial.example'}});
    assert.equal((await proxy({request,env,params:{path:['v4','map','styles']}})).status,200);
    assert.equal(upstream.hostname,'webapi.amap.com');
    assert.equal(upstream.searchParams.get('key'),'js-key');
    assert.equal(upstream.searchParams.get('jscode'),'server-code');
    assert.equal((await proxy({request:new Request('https://trial.example/_AMapService/v3/place/around',{headers:{origin:'https://evil.example'}}),env,params:{path:['v3','place','around']}})).status,403);
    assert.equal((await proxy({request,env,params:{path:['v3','arbitrary']}})).status,400);
  } finally {globalThis.fetch=original;}
});

test('guest publication: no account details, durable ownership, IP quota and origin rejection',async()=>{
 const {call,sql}=setup();
 assert.equal((await call('notes',{method:'POST',body:{}})).status,401);
 const response=await call('auth/guest',{method:'POST',body:{}});assert.equal(response.status,200);
 const identity=await response.json();assert.equal(identity.user.role,'guest');assert.equal(identity.user.email,null);assert.equal(identity.isAdmin,false);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const fields={region:'静安区',line:'2号线',layout:'一室',rent:3200,title:'访客测试房源',contact:'local-test-contact'};
 const published=await call('notes',{method:'POST',cookie,body:fields});assert.equal(published.status,201);
 const note=(await published.json()).id;assert.equal(sql.prepare('SELECT user_id FROM notes WHERE id=?').get(note).user_id,identity.user.id);
 assert.equal((await call('auth/guest',{method:'POST',cookie,body:{}})).headers.get('set-cookie'),null);
 assert.equal((await call('admin/users',{cookie})).status,403);
 assert.equal((await call('auth/guest',{method:'POST',origin:'https://evil.example',body:{}})).status,403);
 for(let i=0;i<2;i++)assert.equal((await call('notes',{method:'POST',cookie,body:fields})).status,201);
 const other=await call('auth/guest',{method:'POST',body:{}}),second=other.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('notes',{method:'POST',cookie:second,body:fields})).status,429);
});

test('community discovery: pagination, actual coordinates, unknown rent and no restoration of hidden POIs',async()=>{
 const {call,env,sql}=setup();env.AMAP_REST_KEY='test-rest-key';
 const previous=globalThis.fetch;let captured;
 globalThis.fetch=async(url)=>{captured=new URL(url);return Response.json({status:'1',count:'27',pois:[{id:'B_TEST_COMMUNITY',name:'真实坐标测试小区',location:'121.44,31.22',pname:'上海市',cityname:'上海市',adname:'静安区',address:'测试地址',distance:'300'}]});};
 try{const result=await call('discover/communities?location=121.44,31.22&page=2');assert.equal(result.status,200);const body=await result.json();assert.equal(captured.searchParams.get('page'),'2');assert.equal(captured.searchParams.get('types'),'120302');assert.equal(body.communities[0].price,null);assert.equal(body.communities[0].area,null);assert.equal(body.communities[0].lng,121.44);
 sql.prepare("UPDATE communities SET status='hidden' WHERE id=?").run('amap_B_TEST_COMMUNITY');
 assert.equal((await (await call('discover/communities?location=121.44,31.22')).json()).communities.length,0);
 assert.equal((await call('discover/communities?location=invalid')).status,422);
 }finally{globalThis.fetch=previous;}
});
