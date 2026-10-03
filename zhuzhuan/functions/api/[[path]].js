const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY = 12_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const REPORT_REASONS = new Set(['虚假房源', '联系方式违规', '疑似诈骗', '重复发布', '其他']);
const FAVORITE_TYPES = new Set(['stations', 'communities', 'notes']);
const DEMO_STATIONS = [{"id": "jingan", "name": "静安寺", "line": "2号线 · 7号线 · 14号线", "lines": ["2号线", "7号线", "14号线"], "lng": 121.446533, "lat": 31.223231, "minutes": 8, "transfers": 0, "x": 18, "y": 25, "source": "demo"}, {"id": "nanjing-west", "name": "南京西路", "line": "2号线 · 12号线 · 13号线", "lines": ["2号线", "12号线", "13号线"], "lng": 121.459971, "lat": 31.229853, "minutes": 12, "transfers": 0, "x": 24, "y": 38, "source": "demo"}, {"id": "peoples-square", "name": "人民广场", "line": "1号线 · 2号线 · 8号线", "lines": ["1号线", "2号线", "8号线"], "lng": 121.475108, "lat": 31.232687, "minutes": 16, "transfers": 0, "x": 30, "y": 51, "source": "demo"}, {"id": "jiangsu", "name": "江苏路", "line": "2号线 · 11号线", "lines": ["2号线", "11号线"], "lng": 121.430635, "lat": 31.220408, "minutes": 19, "transfers": 0, "x": 36, "y": 64, "source": "demo"}, {"id": "zhongshan", "name": "中山公园", "line": "2号线 · 3号线 · 4号线", "lines": ["2号线", "3号线", "4号线"], "lng": 121.415773, "lat": 31.217948, "minutes": 24, "transfers": 0, "x": 42, "y": 77, "source": "demo"}, {"id": "changshu", "name": "常熟路", "line": "1号线 · 7号线", "lines": ["1号线", "7号线"], "lng": 121.449141, "lat": 31.213524, "minutes": 18, "transfers": 0, "x": 48, "y": 35, "source": "demo"}, {"id": "xujiahui", "name": "徐家汇", "line": "1号线 · 9号线 · 11号线", "lines": ["1号线", "9号线", "11号线"], "lng": 121.437, "lat": 31.195, "minutes": 27, "transfers": 1, "x": 54, "y": 48, "source": "demo"}, {"id": "hanzhong", "name": "汉中路", "line": "1号线 · 12号线 · 13号线", "lines": ["1号线", "12号线", "13号线"], "lng": 121.458699, "lat": 31.241883, "minutes": 26, "transfers": 1, "x": 60, "y": 61, "source": "demo"}, {"id": "zhenping", "name": "镇坪路", "line": "3号线 · 4号线 · 7号线", "lines": ["3号线", "4号线", "7号线"], "lng": 121.429779, "lat": 31.246369, "minutes": 29, "transfers": 0, "x": 66, "y": 74, "source": "demo"}, {"id": "century", "name": "世纪大道", "line": "2号线 · 4号线 · 6号线 · 9号线", "lines": ["2号线", "4号线", "6号线", "9号线"], "lng": 121.527213, "lat": 31.228682, "minutes": 36, "transfers": 1, "x": 72, "y": 32, "source": "demo"}, {"id": "caohejing", "name": "漕河泾开发区", "line": "9号线", "lines": ["9号线"], "lng": 121.3975, "lat": 31.176, "minutes": 42, "transfers": 1, "x": 78, "y": 45, "source": "demo"}];

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  Object.entries(extraHeaders).forEach(([key, value]) => headers.set(key, value));
  return new Response(JSON.stringify(data), { status, headers });
}

function error(message, status = 400) { return json({ error: message }, status); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function safeText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function email(value) { return safeText(value, 160).toLowerCase(); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function isPhone(value) { return /^\+?[0-9][0-9\s-]{6,19}$/.test(value); }
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function unb64(value) { const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return Uint8Array.from(atob(normalized), char => char.charCodeAt(0)); }
async function digestText(value) { return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }

async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
async function hashPassword(password) { const salt = b64(crypto.getRandomValues(new Uint8Array(16))); return `pbkdf2$100000$${salt}$${await derivePassword(password, salt)}`; }
async function verifyPassword(password, encoded) {
  const [algorithm, iterations, salt, hash] = String(encoded).split('$');
  if (algorithm !== 'pbkdf2' || iterations !== '100000' || !salt || !hash) return false;
  const actual = await derivePassword(password, salt);
  if (actual.length !== hash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ hash.charCodeAt(index);
  return difference === 0;
}

function cookie(name, value, maxAge, request) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}
function sessionFrom(request) { return request.headers.get('cookie')?.match(/(?:^|;\s*)zz_session=([^;]+)/)?.[1] || ''; }

async function currentUser(request, env) {
  const token = sessionFrom(request);
  if (!token || !env.DB) return null;
  return env.DB.prepare("SELECT u.id, u.email, u.phone, u.display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > datetime('now') AND u.suspended_at IS NULL").bind(await digestText(token)).first();
}

function adminAllowed(user, env) { return Boolean(user && user.role === 'admin'); }

function sameOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    if (origin !== new URL(request.url).origin) return false;
    return !env.APP_ORIGIN || origin === new URL(env.APP_ORIGIN).origin;
  } catch { return false; }
}

async function readBody(request, maxBytes = MAX_BODY) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('请求内容过大');
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('请求格式必须为 JSON');
  const bytes = await readLimitedBody(request, maxBytes);
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求内容不是有效 JSON');
    return body;
  } catch { throw new Error('请求内容不是有效 JSON'); }
}

async function readLimitedBody(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('请求内容过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function rateLimit(request, env, scope, limit, windowSeconds = 60) {
  if (!env.DB) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${scope}:${await digestText(ip)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO api_rate_limits (key, bucket, hits, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(key, bucket) DO UPDATE SET hits = hits + 1, created_at = excluded.created_at').bind(key, bucket, now).run();
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM api_rate_limits WHERE created_at > 0 AND created_at < ?').bind(now - 90 * 86400).run();
  const row = await env.DB.prepare('SELECT hits FROM api_rate_limits WHERE key = ? AND bucket = ?').bind(key, bucket).first();
  return Number(row?.hits || 0) > limit;
}

function dbRequired(env) { return env.DB ? null : error('数据库服务尚未配置。', 503); }

async function handleAuth(path, request, env) {
  if (!['auth/register', 'auth/login', 'auth/logout', 'auth/guest'].includes(path)) return null;
  if (!env.DB) return dbRequired(env);
  if (path === 'auth/guest' && request.method === 'POST') {
    const existing = await currentUser(request, env);
    if (existing) return json({ user: existing, isAdmin: adminAllowed(existing, env) });
    if (await rateLimit(request, env, 'guest-session', 10, 3600)) return error('操作过于频繁，请稍后再试。', 429);
    const userId = id('guest');
    await env.DB.prepare("INSERT INTO users (id, password_hash, display_name, role) VALUES (?, ?, ?, ?)").bind(userId, 'guest-no-password', '访客', 'guest').run();
    return createSession(userId, request, env);
  }
  if (path === 'auth/logout' && request.method === 'POST') {
    const token = sessionFrom(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await digestText(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('zz_session', '', 0, request) });
  }
  if (!['auth/register', 'auth/login'].includes(path) || request.method !== 'POST') return error('请求方法不支持。', 405);
  if (await rateLimit(request, env, path, 8, 300)) return error('操作过于频繁，请稍后再试。', 429);
  const body = await readBody(request);
  const rawAccount = safeText(body.email || body.phone, 160);
  const password = String(body.password || '');
  if (password.length < 8 || password.length > 128) return error('密码长度须为 8 到 128 位。', 422);
  const normalized = isEmail(rawAccount) ? email(rawAccount) : rawAccount.replace(/[\s-]/g, '');
  if ((!isEmail(normalized) && !isPhone(normalized)) || !rawAccount) return error('请输入有效邮箱或手机号。', 422);
  const column = isEmail(normalized) ? 'email' : 'phone';
  if (path === 'auth/register') {
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE ${column} = ?`).bind(normalized).first();
    if (exists) return error('该账号已注册。', 409);
    const userId = id('usr');
    await env.DB.prepare(`INSERT INTO users (id, ${column}, password_hash, display_name) VALUES (?, ?, ?, ?)`).bind(userId, normalized, await hashPassword(password), safeText(body.displayName, 40) || '住住安用户').run();
    return createSession(userId, request, env);
  }
  const user = await env.DB.prepare(`SELECT id, password_hash FROM users WHERE ${column} = ? AND suspended_at IS NULL`).bind(normalized).first();
  if (!user || !(await verifyPassword(password, user.password_hash))) return error('邮箱、手机号或密码不正确。', 401);
  return createSession(user.id, request, env);
}

async function createSession(userId, request, env) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(await digestText(token), userId).run();
  const user = await env.DB.prepare('SELECT id, email, phone, display_name, role FROM users WHERE id = ?').bind(userId).first();
  return json({ user, isAdmin: adminAllowed(user, env) }, 200, { 'set-cookie': cookie('zz_session', token, 60 * 60 * 24 * 30, request) });
}

function maskContact(value) {
  const text = String(value || '');
  if (text.length <= 4) return '已隐藏';
  return `${text.slice(0, 3)}${'•'.repeat(Math.min(6, Math.max(3, text.length - 5)))}${text.slice(-2)}`;
}

async function handleNotes(path, request, env) {
  if (!path.startsWith('notes')) return null;
  if (!env.DB) return dbRequired(env);
  const user = await currentUser(request, env);
  if (path === 'notes' && request.method === 'GET') {
    const url = new URL(request.url); const filters = []; const values = [];
    for (const field of ['city', 'region', 'line', 'layout']) {
      const value = safeText(url.searchParams.get(field), 40);
      if (value && !['全部区域', '全部地铁线', '全部户型'].includes(value)) { filters.push(`${field} = ?`); values.push(value); }
    }
    const maxRent = Number(url.searchParams.get('maxRent') || 0);
    if (maxRent > 0 && Number.isFinite(maxRent)) { filters.push('rent <= ?'); values.push(Math.min(maxRent, 1_000_000)); }
    const where = `status = 'visible'${filters.length ? ` AND ${filters.join(' AND ')}` : ''}`;
    const result = await env.DB.prepare(`SELECT id, region, line, layout, rent, title, detail, contact, image_key, created_at FROM notes WHERE ${where} ORDER BY created_at DESC LIMIT 100`).bind(...values).all();
    const base = new URL(request.url).origin;
    const notes = (result.results || []).map(({ contact, image_key, ...note }) => ({ ...note, contact_hint: maskContact(contact), imageUrl: image_key ? `${base}/api/media/${image_key}` : null }));
    return json({ source: 'user', notes });
  }
  if (path === 'notes' && request.method === 'POST') {
    if (!user) return error('请重新连接网站后发布便利贴。', 401);
    if (await rateLimit(request, env, 'note-ip', 3, 3600) || await rateLimit(request, env, `note:${user.id}`, 3, 3600)) return error('发布过于频繁，请稍后再试。', 429);
    const body = await readBody(request);
    const fields = { city: safeText(body.city, 20) || '上海', region: safeText(body.region, 40), line: safeText(body.line, 40), layout: safeText(body.layout, 40), rent: Number(body.rent), title: safeText(body.title, 80), detail: safeText(body.detail, 800), contact: safeText(body.contact, 120) };
    if (!fields.region || !fields.line || !fields.layout || !Number.isInteger(fields.rent) || fields.rent < 0 || fields.rent > 1_000_000 || !fields.title || !fields.contact) return error('请完整填写有效的便利贴信息。', 422);
    if (/(诈骗|转账|押金)/.test(fields.title) && fields.title.length < 12) return error('标题需要提供更多房源信息。', 422);
    const imageKey = safeText(body.imageKey, 180);
    if (imageKey && (env.MEDIA_ENABLED !== 'true' || !env.MEDIA || !imageKey.startsWith(`${user.id}/`))) return error('图片附件无效。', 422);
    if (imageKey) {
      const image = await env.DB.prepare("SELECT key FROM media_objects WHERE key = ? AND owner_id = ? AND state = 'ready'").bind(imageKey, user.id).first();
      if (!image) return error('图片附件不存在或无权使用。', 422);
    }
    const noteId = id('note');
    await env.DB.prepare('INSERT INTO notes (id, user_id, city, region, line, layout, rent, title, detail, contact, image_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(noteId, user.id, fields.city, fields.region, fields.line, fields.layout, fields.rent, fields.title, fields.detail, fields.contact, imageKey || null).run();
    return json({ ok: true, id: noteId }, 201);
  }
  const contactMatch = path.match(/^notes\/([^/]+)\/contact$/);
  if (contactMatch && request.method === 'GET') {
    if (await rateLimit(request, env, 'note-contact', 20, 3600)) return error('查看联系方式过于频繁，请稍后再试。', 429);
    const note = await env.DB.prepare("SELECT id, contact FROM notes WHERE id = ? AND status = 'visible'").bind(contactMatch[1]).first();
    if (!note) return error('便利贴不存在。', 404);
    await env.DB.prepare('INSERT INTO contact_views (id, note_id, viewer_id) VALUES (?, ?, ?)').bind(id('view'), note.id, user?.id || null).run();
    return json({ contact: note.contact });
  }
  const match = path.match(/^notes\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const note = await env.DB.prepare("SELECT id, region, line, layout, rent, title, detail, image_key, created_at FROM notes WHERE id = ? AND status = 'visible'").bind(match[1]).first();
    if (!note) return error('便利贴不存在。', 404);
    const { image_key, ...fields } = note;
    return json({ note: { ...fields, imageUrl: image_key ? `${new URL(request.url).origin}/api/media/${image_key}` : null } });
  }
  return error('便利贴接口不存在。', 404);
}

function communityFromRow(row) {
  return { id: row.id, name: row.name, price: row.price, layout: row.layout, area: row.area, station: row.station, walk: row.walk_minutes, cycle: row.cycle_minutes, lng: row.lng, lat: row.lat, reviews: row.review_score, score: row.summary, size: row.size || 1, source: row.source };
}

async function handleDiscovery(path, request, env) {
  if (path !== 'discover/communities') return null;
  if (request.method !== 'GET') return error('请求方法不支持。',405);
  if (!env.DB) return dbRequired(env);
  const incoming=new URL(request.url),location=validCoordinate(incoming.searchParams.get('location'));
  if(!location) return error('站点坐标无效。',422);
  const target=new URL('/api/map/around', incoming.origin);
  target.searchParams.set('location',location);target.searchParams.set('radius',String(Math.min(5000,Math.max(100,Number(incoming.searchParams.get('radius'))||2000))));target.searchParams.set('types','120302');target.searchParams.set('offset','25');target.searchParams.set('page',incoming.searchParams.get('page')||'1');
  const response=await handleMap('map/around',new Request(target,request),env);
  if(!response.ok)return response;
  const payload=await response.json();if(payload.status!=='1')return error(payload.info||'高德小区查询失败。',502);
  const communities=[];
  for(const poi of payload.pois||[]){
    const coordinate=validCoordinate(poi.location);if(!coordinate||!poi.id||!poi.name)continue;
    const [lng,lat]=coordinate.split(',').map(Number),communityId='amap_'+safeText(poi.id,80),address=[poi.pname,poi.cityname,poi.adname,typeof poi.address==='string'?poi.address:''].filter(Boolean).join('');
    const summary=JSON.stringify({address,amapId:poi.id,type:poi.type,adcode:poi.adcode,updatedAt:new Date().toISOString()});
    await env.DB.prepare("INSERT INTO communities(id,name,summary,lng,lat,source) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary,lng=excluded.lng,lat=excluded.lat,source=excluded.source").bind(communityId,safeText(poi.name,100),summary,lng,lat,'amap').run();
    const row=await env.DB.prepare("SELECT * FROM communities WHERE id=? AND status='visible'").bind(communityId).first();
    if(row)communities.push({...communityFromRow(row),address,amapId:poi.id,distance:Number(poi.distance)||null,layout:'',price:null,area:null,walk:null,cycle:null});
  }
  return json({source:'amap',count:Number(payload.count)||0,page:Number(target.searchParams.get('page')),fetchedCount:(payload.pois||[]).length,communities});
}

async function handleCommunities(path, request, env) {
  if (!/^communities(?:\/|$)/.test(path)) return null;
  if (!['GET', 'POST'].includes(request.method)) return error('请求方法不支持。', 405);
  if (!env.DB) return dbRequired(env);
  const match = path.match(/^communities(?:\/([^/]+)(?:\/(pois|reviews))?)?$/);
  if (!match) return error('小区接口不存在。', 404);
  const communityId = match[1];
  if (!communityId) {
    const result = await env.DB.prepare("SELECT c.*, s.name AS station FROM communities c LEFT JOIN stations s ON s.id = c.station_id WHERE c.status = 'visible' ORDER BY c.name LIMIT 500").all();
    return json({ source: 'd1', communities: (result.results || []).map(communityFromRow) }, 200, { 'cache-control': 'public, max-age=60' });
  }
  const row = await env.DB.prepare("SELECT c.*, s.name AS station FROM communities c LEFT JOIN stations s ON s.id = c.station_id WHERE c.id = ? AND c.status = 'visible'").bind(communityId).first();
  if (!row) return error('小区不存在。', 404);
  if (match[2] === 'pois') {
    if (request.method !== 'GET') return error('请求方法不支持。', 405);
    if (!row.lng || !row.lat) return json({ source: 'none', pois: [] });
    return handleMap('map/around', new Request(`${new URL(request.url).origin}/api/map/around?location=${row.lng},${row.lat}&radius=1500&offset=25&types=060400|060100|090100|141200|110101&page=${new URL(request.url).searchParams.get('page') || '1'}`, request), env);
  }
  if (match[2] === 'reviews') {
    if (request.method === 'POST') {
      const user = await currentUser(request, env);
      if (!user) return error('请先登录后评价。', 401);
      if (await rateLimit(request, env, `review:${user.id}`, 5, 86400)) return error('评价提交过于频繁，请稍后再试。', 429);
      const body = await readBody(request); const rating = Number(body.rating); const text = safeText(body.body, 1000);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !text) return error('请填写 1 到 5 星评分和评价内容。', 422);
      await env.DB.prepare('INSERT INTO community_reviews (id, community_id, user_id, rating, body) VALUES (?, ?, ?, ?, ?)').bind(id('review'), communityId, user.id, rating, text).run();
      return json({ ok: true }, 201);
    }
    if (request.method !== 'GET') return error('请求方法不支持。', 405);
    const reviews = await env.DB.prepare("SELECT rating, body, source, created_at FROM community_reviews WHERE community_id = ? AND status = 'visible' ORDER BY created_at DESC LIMIT 50").bind(communityId).all();
    return json({ source: 'user', communityId, reviews: reviews.results || [] });
  }
  return json({ source: row.source, community: communityFromRow(row) });
}

async function handleDirectory(path, request, env) {
  if (path !== 'stations' || request.method !== 'GET') return null;
  if (!env.DB) return dbRequired(env);
  const result = await env.DB.prepare('SELECT id, name, line, lines_json, minutes, transfers, lng, lat, source FROM stations ORDER BY name LIMIT 500').all();
  const stations = (result.results || []).map(row => {
    let lines = [];
    try { lines = JSON.parse(row.lines_json || '[]'); } catch { lines = []; }
    return { ...row, lines: Array.isArray(lines) ? lines : [] };
  });
  return json({ source: 'd1', stations }, 200, { 'cache-control': 'public, max-age=60' });
}

async function handleUser(path, request, env) {
  if (path === 'me' && request.method === 'GET') {
    const user = await currentUser(request, env);
    return user ? json({ user, isAdmin: adminAllowed(user, env) }, 200) : error('未登录。', 401);
  }
  if (path === 'feedback' && request.method === 'POST') {
    if (!env.DB) return dbRequired(env);
    const user = await currentUser(request, env);
    if (await rateLimit(request, env, `feedback:${user?.id || 'anonymous'}`, 5, 3600)) return error('提交过于频繁，请稍后再试。', 429);
    const body = await readBody(request); const text = safeText(body.body, 1000);
    if (!text) return error('建议内容不能为空。', 422);
    await env.DB.prepare('INSERT INTO feedback (id, user_id, body) VALUES (?, ?, ?)').bind(id('feedback'), user?.id || null, text).run();
    return json({ ok: true }, 201);
  }
  if (path === 'reports' && request.method === 'POST') {
    if (!env.DB) return dbRequired(env);
    const user = await currentUser(request, env);
    if (await rateLimit(request, env, `report:${user?.id || 'anonymous'}`, 8, 3600)) return error('举报提交过于频繁，请稍后再试。', 429);
    const body = await readBody(request); const type = safeText(body.targetType, 30); const target = safeText(body.targetId, 100); const reason = safeText(body.reason, 80);
    if (!['note', 'community'].includes(type) || !/^[\w-]{1,100}$/.test(target) || !REPORT_REASONS.has(reason)) return error('举报对象或原因无效。', 422);
    const table = type === 'note' ? 'notes' : 'communities';
    const exists = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(target).first();
    if (!exists) return error('举报对象不存在。', 404);
    await env.DB.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?, ?)').bind(id('report'), user?.id || null, type, target, reason, safeText(body.detail, 500)).run();
    return json({ ok: true }, 201);
  }
  return null;
}

async function handleFavorites(path, request, env) {
  if (!path.startsWith('favorites')) return null;
  if (!env.DB) return dbRequired(env);
  const user = await currentUser(request, env);
  if (!user) return error('请先登录。', 401);
  if (path === 'favorites' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT item_type, item_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all();
    return json({ favorites: result.results || [] });
  }
  if (path === 'favorites' && request.method === 'POST') {
    const body = await readBody(request); const type = safeText(body.itemType, 30); const item = safeText(body.itemId, 100);
    if (!FAVORITE_TYPES.has(type) || !/^[\w-]{1,100}$/.test(item)) return error('收藏目标无效。', 422);
    const table = type === 'stations' ? 'stations' : type === 'communities' ? 'communities' : 'notes';
    const exists = type === 'notes'
      ? await env.DB.prepare("SELECT id FROM notes WHERE id = ? AND status = 'visible'").bind(item).first()
      : await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(item).first();
    if (!exists) return error('收藏目标不存在。', 404);
    await env.DB.prepare('INSERT OR IGNORE INTO favorites (user_id, item_type, item_id) VALUES (?, ?, ?)').bind(user.id, type, item).run();
    return json({ ok: true }, 201);
  }
  const match = path.match(/^favorites\/([^/]+)\/([^/]+)$/);
  if (match && request.method === 'DELETE') {
    let type; let item;
    try { type = decodeURIComponent(match[1]); item = decodeURIComponent(match[2]); } catch { return error('收藏目标无效。', 400); }
    if (!FAVORITE_TYPES.has(type)) return error('收藏目标无效。', 422);
    await env.DB.prepare('DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?').bind(user.id, type, item).run();
    return json({ ok: true });
  }
  return error('收藏接口不存在。', 404);
}

async function handleAdmin(path, request, env) {
  if (!path.startsWith('admin/')) return null;
  const user = await currentUser(request, env);
  if (!adminAllowed(user, env)) return error('需要管理员权限。', 403);
  if (!env.DB) return dbRequired(env);
  
  if (path === 'admin/media' && request.method === 'GET') {
    const objects = await env.DB.prepare('SELECT key, owner_id, size, state, created_at FROM media_objects ORDER BY created_at DESC LIMIT 100').all();
    const storage = await env.DB.prepare('SELECT bytes FROM media_storage WHERE id = 1').first();
    const usage = await env.DB.prepare('SELECT scope, period, hits FROM service_usage WHERE period >= ? ORDER BY scope').bind(new Date().toISOString().slice(0, 7)).all();
    return json({ objects: objects.results || [], bytes: storage?.bytes || 0, enabled: env.MEDIA_ENABLED === 'true', usage: usage.results || [] });
  }
  if (path.startsWith('admin/media/') && request.method === 'DELETE') {
    const key = path.slice('admin/media/'.length);
    if (!/^[\w-]{1,100}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) return error('图片编号无效。', 422);
    if (!env.MEDIA) return error('图片存储尚未配置。', 503);
    await releaseMedia(env, key);
    await env.DB.prepare('UPDATE notes SET image_key = NULL WHERE image_key = ?').bind(key).run();
    return json({ ok: true });
  }

  if (path === 'admin/reports' && request.method === 'GET') {
    const result = await env.DB.prepare("SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.detail, r.status, r.created_at, CASE WHEN r.target_type = 'note' THEN n.status ELSE c.status END AS target_status FROM reports r LEFT JOIN notes n ON r.target_type = 'note' AND n.id = r.target_id LEFT JOIN communities c ON r.target_type = 'community' AND c.id = r.target_id ORDER BY r.created_at DESC LIMIT 200").all();
    return json({ reports: result.results || [] });
  }
  if (path === 'admin/users' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT id, display_name, email, phone, suspended_at, created_at FROM users ORDER BY created_at DESC LIMIT 200').all();
    return json({ users: result.results || [] });
  }
  const noteMatch = path.match(/^admin\/notes\/([^/]+)\/(hide|restore)$/);
  if (noteMatch && request.method === 'POST') {
    const status = noteMatch[2] === 'hide' ? 'hidden' : 'visible';
    await env.DB.prepare('UPDATE notes SET status = ? WHERE id = ?').bind(status, noteMatch[1]).run();
    await env.DB.prepare('INSERT INTO admin_actions (id, admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?, ?)').bind(id('action'), user.id, noteMatch[2], 'note', noteMatch[1]).run();
    return json({ ok: true, status });
  }
  const communityMatch = path.match(/^admin\/communities\/([^/]+)\/(hide|restore)$/);
  if (communityMatch && request.method === 'POST') {
    const status = communityMatch[2] === 'hide' ? 'hidden' : 'visible';
    await env.DB.prepare('UPDATE communities SET status = ? WHERE id = ?').bind(status, communityMatch[1]).run();
    await env.DB.prepare('INSERT INTO admin_actions (id, admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?, ?)').bind(id('action'), user.id, communityMatch[2], 'community', communityMatch[1]).run();
    return json({ ok: true, status });
  }
  const userMatch = path.match(/^admin\/users\/([^/]+)\/(suspend|restore)$/);
  if (userMatch && request.method === 'POST') {
    if (userMatch[1] === user.id) return error('不能冻结当前管理员账户。', 422);
    const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userMatch[1]).first();
    if (!target) return error('用户不存在。', 404);
    if (target.role === 'admin') return error('不能通过此处修改管理员账户。', 403);
    const suspendedAt = userMatch[2] === 'suspend' ? new Date().toISOString() : null;
    await env.DB.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').bind(suspendedAt, userMatch[1]).run();
    if (userMatch[2] === 'suspend') await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userMatch[1]).run();
    await env.DB.prepare('INSERT INTO admin_actions (id, admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?, ?)').bind(id('action'), user.id, userMatch[2], 'user', userMatch[1]).run();
    return json({ ok: true });
  }
  return error('管理员接口不存在。', 404);
}

function validCoordinate(value) {
  const match = String(value || '').match(/^(-?\d{1,3}(?:\.\d{1,6})?),\s*(-?\d{1,2}(?:\.\d{1,6})?)$/);
  if (!match) return null;
  const lng = Number(match[1]); const lat = Number(match[2]);
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90 ? `${lng},${lat}` : null;
}

async function handleMap(path, request, env) {
  if (path === 'map/config' && request.method === 'GET') {
    const enabled = Boolean(env.DB && env.AMAP_JS_KEY && env.AMAP_SECURITY_JS_CODE);
    return json({ key: enabled ? env.AMAP_JS_KEY : null, enabled, routesEnabled: Boolean(env.AMAP_REST_KEY), mediaEnabled: env.MEDIA_ENABLED === 'true' && Boolean(env.MEDIA && env.DB) }, 200, { 'cache-control': 'no-store' });
  }
  const endpoints = {
    'map/search': { path: 'place/text', required: ['keywords', 'city'] },
    'map/geocode': { path: 'geocode/geo', required: ['address'] },
    'map/around': { path: 'place/around', required: ['location'] },
    'map/route': { path: 'direction/transit/integrated', required: ['origin', 'destination'] },
    'map/walking': { path: 'direction/walking', required: ['origin', 'destination'] },
    'map/bicycling': { path: 'v4/direction/bicycling', required: ['origin', 'destination'] }
  };
  const endpoint = endpoints[path];
  if (!endpoint || request.method !== 'GET') return error('地图接口不存在。', 404);
  if (!env.AMAP_REST_KEY) return error('地图 Web 服务尚未配置。', 503);
  if (!env.DB || await rateLimit(request, env, `map:${path}`, 60, 60)) return error('地图请求暂不可用或过于频繁。', env.DB ? 429 : 503);
  const incoming = new URL(request.url); const target = new URL(`https://restapi.amap.com/${endpoint.path.startsWith('v4/') ? endpoint.path : `v3/${endpoint.path}`}`);
  for (const name of endpoint.required) {
    const value = safeText(incoming.searchParams.get(name), name === 'address' ? 160 : 80);
    if (!value) return error(`缺少参数：${name}`, 422);
    if (['origin', 'destination', 'location'].includes(name) && !validCoordinate(value)) return error(`参数 ${name} 坐标无效。`, 422);
    target.searchParams.set(name, value);
  }
  if (path === 'map/search') { target.searchParams.set('citylimit', 'true'); target.searchParams.set('offset', '25'); target.searchParams.set('page', String(Math.min(20, Math.max(1, Number(incoming.searchParams.get('page')) || 1)))); }
  if (path === 'map/around') {
    const radius = Number(incoming.searchParams.get('radius') || 1500);
    if (!Number.isInteger(radius) || radius < 100 || radius > 5000) return error('周边查询半径须为 100 到 5000 米。', 422);
    target.searchParams.set('radius', String(radius));
    target.searchParams.set('offset', String(Math.min(25, Math.max(1, Number(incoming.searchParams.get('offset')) || 20))));
    target.searchParams.set('page', String(Math.min(20, Math.max(1, Number(incoming.searchParams.get('page')) || 1))));
    target.searchParams.set('extensions', 'all');
    const keywords = safeText(incoming.searchParams.get('keywords'), 60);
    if (keywords) target.searchParams.set('keywords', keywords);
    const types = safeText(incoming.searchParams.get('types'), 120);
    if (types && /^[0-9|]+$/.test(types)) target.searchParams.set('types', types);
  }
  if (path === 'map/geocode') {
    const city = safeText(incoming.searchParams.get('city'), 40);
    if (city) target.searchParams.set('city', city);
  }
  if (path === 'map/route') {
    const city = safeText(incoming.searchParams.get('city'), 40) || '上海';
    target.searchParams.set('city', city); target.searchParams.set('cityd', city); target.searchParams.set('strategy', '5');
  }
  target.searchParams.set('key', env.AMAP_REST_KEY);
  if (!await consumeUsage(env, 'amap-rest', new Date().toISOString().slice(0, 10), setting(env, 'AMAP_DAILY_REQUEST_LIMIT', 500))) return error('今日地图查询额度已用完。', 429);
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    const bytes = await readLimitedBody(response, 1_000_000);
    const text = new TextDecoder().decode(bytes);
    if (text.length > 1_000_000) return error('地图服务返回内容过大。', 502);
    return new Response(text, { status: response.status, headers: { ...JSON_HEADERS, 'cache-control': 'private, max-age=30', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
  } catch {
    return error('地图服务暂时不可用，请稍后再试。', 502);
  }
}


function setting(env, name, fallback) {
  const n = Number(env[name] ?? fallback);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}
async function consumeUsage(env, scope, period, limit) {
  if (!env.DB || limit < 1) return false;
  const row = await env.DB.prepare('INSERT INTO service_usage(scope, period, hits) VALUES (?, ?, 1) ON CONFLICT(scope, period) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits').bind(scope, period, limit).first();
  return Boolean(row);
}
async function releaseMedia(env, key) {
  // R2 deletion is idempotent. Keep the reservation if storage deletion fails.
  await env.MEDIA.delete(key);
  await env.DB.prepare('DELETE FROM media_objects WHERE key = ?').bind(key).run();
}

async function handleMedia(path, request, env) {
  if (path !== 'media' && !path.startsWith('media/')) return null;
  if (env.MEDIA_ENABLED !== 'true') return error('图片服务暂未开放或已达到预算限制。', 503);
  if (!env.MEDIA || !env.DB) return error('图片存储尚未配置。', 503);
  const key = path === 'media' ? '' : path.slice('media/'.length);
  if (key === '' && request.method === 'POST') {
    const user = await currentUser(request, env);
    if (!user) return error('请先登录后上传图片。', 401);
    if (!await consumeUsage(env, `upload:${user.id}`, new Date().toISOString().slice(0, 10), setting(env, 'MEDIA_UPLOADS_PER_USER_DAY', 3))) return error('图片上传次数已达上限。', 429);
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES + 32_000) return error('图片不能大于 5 MB。', 413);
    let form;
    try {
      const body = await readLimitedBody(request, MAX_IMAGE_BYTES + 32_000);
      form = await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData();
    } catch (cause) {
      const oversized = cause instanceof Error && cause.message === '请求内容过大';
      return error(oversized ? cause.message : '上传内容无效。', oversized ? 413 : 400);
    }
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_IMAGE_BYTES) return error('请选择 5 MB 以内的图片。', 422);
    const extension = IMAGE_TYPES.get(file.type);
    if (!extension) return error('仅支持 JPG、PNG 或 WebP 图片。', 422);
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const valid = extension === 'jpg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : extension === 'png'
        ? bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!valid) return error('图片文件内容与格式不符。', 422);
    const objectKey = `${user.id}/${crypto.randomUUID()}.${extension}`;
    if (!await consumeUsage(env, 'media-write', new Date().toISOString().slice(0, 7), setting(env, 'MEDIA_WRITES_PER_MONTH', 10000))) return error('本月图片上传额度已用完。', 429);
    const reservation = await env.DB.prepare("INSERT INTO media_objects(key, owner_id, size) SELECT ?, ?, ? WHERE (SELECT bytes FROM media_storage WHERE id = 1) + ? <= ? RETURNING key").bind(objectKey, user.id, file.size, file.size, setting(env, 'MEDIA_MAX_TOTAL_BYTES', 1073741824)).first();
    if (!reservation) return error('图片存储额度已用完。', 429);
    try {
      await env.MEDIA.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { ownerId: user.id } });
      await env.DB.prepare("UPDATE media_objects SET state = 'ready' WHERE key = ?").bind(objectKey).run();
    } catch (cause) { await releaseMedia(env, objectKey); throw cause; }
    return json({ imageKey: objectKey, imageUrl: `${new URL(request.url).origin}/api/media/${objectKey}` }, 201);
  }
  if (!/^[\w-]{1,100}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) || request.method !== 'GET') return error('图片不存在。', 404);
  if (await rateLimit(request, env, 'media-read', 120, 60)) return error('图片读取过于频繁。', 429);
  if (!await consumeUsage(env, 'media-read', new Date().toISOString().slice(0, 7), setting(env, 'MEDIA_READS_PER_MONTH', 100000))) return error('本月图片读取额度已用完。', 429);
  const registered = await env.DB.prepare("SELECT key FROM media_objects WHERE key = ? AND state = 'ready'").bind(key).first();
  if (!registered) return error('图片不存在。', 404);
  const object = await env.MEDIA.get(key);
  if (!object || !IMAGE_TYPES.has(object.httpMetadata?.contentType)) return error('图片不存在。', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('content-security-policy', "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
  if (request.method === 'OPTIONS') return error('不支持跨域预检请求。', 405);
  if (!sameOrigin(request, env)) return error('请求来源不受允许。', 403);
  try {
    const handlers = [handleAuth, handleDiscovery, handleAdmin, handleCommunities, handleDirectory, handleNotes, handleFavorites, handleUser, handleMedia];
    for (const handler of handlers) { const response = await handler(path, request, env); if (response) return response; }
    if (path.startsWith('map/')) return await handleMap(path, request, env);
    return error('接口不存在。', 404);
  } catch (cause) {
    console.error('api_error', { path, message: cause instanceof Error ? cause.message : 'unknown' });
    const inputError = cause instanceof Error && ['请求内容过大', '请求格式必须为 JSON', '请求内容不是有效 JSON'].includes(cause.message);
    return error(inputError ? cause.message : '服务器暂时无法处理请求。', inputError ? cause.message === '请求内容过大' ? 413 : 400 : 500);
  }
}
