import assert from 'node:assert/strict';
import googleStart from '../api/auth/google.js';
import { appUrl } from '../api/_auth.js';

process.env.AUTH_SECRET = 'oauth-start-test-secret';

const request = { headers: { host: 'arshad-os-oauth-arshad8.vercel.app' } };

process.env.APP_URL = 'AUTH_SECRET';
assert.equal(appUrl(request), '');

process.env.APP_URL = 'https://arshad-os-oauth-arshad8.vercel.app/not-a-callback';
assert.equal(appUrl(request), 'https://arshad-os-oauth-arshad8.vercel.app');

process.env.APP_URL = 'https://arshad-os-oauth-arshad8.vercel.app';
let location = '';
const headers = new Map();
const response = {
  getHeader(name) { return headers.get(name); },
  setHeader(name, value) { headers.set(name, value); },
  writeHead(status, values) { assert.equal(status, 302); location = values.Location; },
  end() {}
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify({external:{google:true}}),{status:200,headers:{'content-type':'application/json'}});
await googleStart(request, response);
globalThis.fetch=originalFetch;
const redirect = new URL(location);
assert.equal(redirect.origin, 'https://uzzdaqbowqdarnjynmuj.supabase.co');
assert.equal(redirect.pathname, '/auth/v1/authorize');
assert.equal(redirect.searchParams.get('provider'), 'google');
assert.equal(new URL(redirect.searchParams.get('redirect_to')).origin, 'https://arshad-os-oauth-arshad8.vercel.app');
assert.equal(new URL(redirect.searchParams.get('redirect_to')).pathname, '/api/auth/google/callback');
assert.ok(redirect.searchParams.get('code_challenge'));
assert.equal(redirect.searchParams.get('code_challenge_method'), 's256');
assert.equal(redirect.searchParams.get('apikey'), null);
assert.match(String(headers.get('Set-Cookie')), /aos_google_pkce=/);

let disabledLocation='';
const disabledResponse={...response,writeHead(status,values){assert.equal(status,303);disabledLocation=values.Location;}};
globalThis.fetch=async()=>new Response(JSON.stringify({external:{google:false}}),{status:200,headers:{'content-type':'application/json'}});
await googleStart(request,disabledResponse);
globalThis.fetch=originalFetch;
assert.equal(disabledLocation,'/?auth_error=google_not_configured');

console.log('Supabase Google OAuth start route fixture passed');
