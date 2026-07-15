import { readFileSync } from 'node:fs';

// The project keeps its current client application at the repository root.
// Explicitly serve that file so a stale public/ directory cannot replace the
// signed-in Notion experience with an empty static deployment.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

export default function handler(req, res) {
  const asset=new URL(req.url||'/', 'https://local.invalid').searchParams.get('asset');
  if(asset==='app'){
    res.setHeader('content-type','application/javascript; charset=utf-8');
    res.setHeader('cache-control','public, max-age=0, must-revalidate');
    res.statusCode=200;
    return res.end(client);
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.statusCode = 200;
  res.end(html);
}
