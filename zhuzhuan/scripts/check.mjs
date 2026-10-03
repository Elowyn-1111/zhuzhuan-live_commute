import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const allowed = new Set(['index.html','404.html','app.js','data.js','styles.css','organic.css','minimal.css','metro.js','arrival.js','_headers','_routes.json']);
for (const name of await readdir('public')) assert(allowed.has(name), `Unexpected public asset: ${name}`);
for (const file of ['public/app.js','public/arrival.js','public/metro.js','server/main.mjs','public/data.js','functions/api/[[path]].js','functions/_AMapService/[[path]].js']) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
assert(!(await readFile('public/app.js','utf8')).includes('DATA.notes.unshift'));
console.log('Public asset allowlist and JavaScript syntax passed.');
