import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await import('./check.mjs');
const config = await readFile('wrangler.toml','utf8');
assert(/database_id\s*=\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/i.test(config), 'Fill the production D1 database_id first.');
const origin = config.match(/APP_ORIGIN\s*=\s*"([^"\n]+)"/)?.[1];
assert(origin && new URL(origin).protocol === 'https:', 'Set APP_ORIGIN to the actual HTTPS public origin in [vars].');
assert(/ADMIN_EMAILS\s*=\s*"[^"\n]+@[^"\n]+"/.test(config), 'Set the administrator email before publishing.');
console.log('Deployment configuration passed. Confirm AMAP secrets in Cloudflare before deployment.');
