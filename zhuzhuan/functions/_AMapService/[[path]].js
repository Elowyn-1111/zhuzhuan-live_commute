function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function isRateLimited(request, env) {
  if (!env.DB) return true;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = `amap-proxy:${encodeBase64Url(digest)}`;
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / 60);
  await env.DB.prepare('INSERT INTO api_rate_limits (key, bucket, hits, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(key, bucket) DO UPDATE SET hits = hits + 1, created_at = excluded.created_at').bind(key, bucket, now).run();
  const row = await env.DB.prepare('SELECT hits FROM api_rate_limits WHERE key = ? AND bucket = ?').bind(key, bucket).first();
  return Number(row?.hits || 0) > 300;
}

async function readLimitedResponse(response, maxBytes) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') return jsonError('Method not allowed.', 405);
  if (!env.DB || !env.AMAP_JS_KEY || !env.AMAP_SECURITY_JS_CODE) return jsonError('Map service is not configured.', 503);
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (origin !== new URL(request.url).origin || env.APP_ORIGIN && origin !== new URL(env.APP_ORIGIN).origin) return jsonError('Origin is not allowed.', 403);
    } catch { return jsonError('Origin is not allowed.', 403); }
  } else if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return jsonError('Origin is not allowed.', 403);
  }

  const pathParts = Array.isArray(params.path) ? params.path : [params.path];
  const path = pathParts.filter(Boolean).join('/');
  const allowed = /^v3\/(geocode\/geo|place\/around|direction\/(transit\/integrated|walking|bicycling))$/.test(path)
    || /^v4\/map\/styles(?:\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?)?$/.test(path);
  if (!allowed || path.includes('..')) return jsonError('Invalid map service path.');

  const incoming = new URL(request.url);
  if (incoming.search.length > 4096 || [...incoming.searchParams].length > 32) return jsonError('Map request is too large.', 413);
  const day = new Date().toISOString().slice(0, 10);
  const limit = Number(env.AMAP_DAILY_REQUEST_LIMIT || 500);
  const usage = Number.isSafeInteger(limit) && limit > 0 ? await env.DB.prepare('INSERT INTO service_usage(scope, period, hits) VALUES (?, ?, 1) ON CONFLICT(scope, period) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits').bind('amap-js', day, limit).first() : null;
  if (!usage) return jsonError('Daily map quota exhausted.', 429);
  if (await isRateLimited(request, env)) return jsonError('Map service rate limit exceeded.', 429);

  const upstreamHost = path.startsWith('v4/map/styles') ? 'https://webapi.amap.com' : 'https://restapi.amap.com';
  const target = new URL(`/${path}`, upstreamHost);
  for (const [key, value] of incoming.searchParams) {
    if (key.toLowerCase() !== 'jscode' && key.toLowerCase() !== 'key' && value.length <= 1000) target.searchParams.append(key, value);
  }
  target.searchParams.set('key', env.AMAP_JS_KEY);
  target.searchParams.set('jscode', env.AMAP_SECURITY_JS_CODE);

  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json, image/*, */*' } });
    const body = await readLimitedResponse(upstream, 2 * 1024 * 1024);
    if (!body) return jsonError('Map provider response is too large.', 502);
    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'private, max-age=30');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('x-frame-options', 'DENY');
    headers.set('referrer-policy', 'no-referrer');
    headers.delete('set-cookie');
    return new Response(body, { status: upstream.status, headers });
  } catch {
    return jsonError('Map provider is temporarily unavailable.', 502);
  }
}
