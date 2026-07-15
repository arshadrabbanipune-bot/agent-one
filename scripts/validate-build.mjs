import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';

const required=[
  'index.html','app.js','api/home.js','api/assistant.js','api/auth/google.js','api/auth/google/callback.js',
  'api/auth/notion.js','api/auth/notion/callback.js','api/auth/me.js','api/notion/map.js','vercel.json'
];
for(const file of required)await access(new URL(`../${file}`,import.meta.url));
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
assert.match(html,/\/app\.js/);
assert.equal(vercel.rewrites.some(route=>route.source==='/'&&route.destination==='/api/home'),true);
assert.equal(vercel.functions['api/**/*.js'].maxDuration,60);
console.log(`Vercel build contract valid (${required.length} required files).`);
