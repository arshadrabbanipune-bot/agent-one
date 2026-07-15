import assert from 'node:assert/strict';
import { createSession, session, startOAuthState } from '../api/_auth.js';
import handler from '../api/auth/notion/callback.js';

process.env.AUTH_SECRET = 'notion-callback-test-secret';
process.env.APP_URL = 'https://arshad-os-oauth-arshad8.vercel.app';
process.env.NOTION_CLIENT_ID = 'notion-client-id';
process.env.NOTION_CLIENT_SECRET = 'notion-client-secret';

const response = () => {
  const headers = new Map();
  return {
    statusCode: 200,
    getHeader: name => headers.get(name),
    setHeader(name, value) { headers.set(name, value); },
    writeHead(status, values = {}) { this.statusCode = status; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
    end(value = '') { this.body = value; }
  };
};
const cookieValue = (header, name) => (Array.isArray(header) ? header : [header]).map(String).find(value => value.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1);

const stateResponse = response();
const oauthState = startOAuthState(stateResponse, 'notion');
const stateCookie = cookieValue(stateResponse.getHeader('Set-Cookie'), 'aos_oauth_state');
const signedIn = createSession({ id: 'student-1', email: 'student@example.com' }, null);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.notion.com/v1/oauth/token');
  assert.match(options.headers.authorization, /^Basic /);
  assert.deepEqual(JSON.parse(options.body), {
    grant_type: 'authorization_code',
    code: 'notion-code',
    redirect_uri: 'https://arshad-os-oauth-arshad8.vercel.app/api/auth/notion/callback'
  });
  return { ok: true, json: async () => ({ access_token: 'notion-access-token', workspace_name: 'Student workspace', workspace_id: 'workspace-1' }) };
};

const res = response();
await handler({
  url: `/api/auth/notion/callback?state=${encodeURIComponent(oauthState)}&code=notion-code`,
  headers: { cookie: `aos_session=${encodeURIComponent(signedIn)}; aos_oauth_state=${stateCookie}` }
}, res);
globalThis.fetch = originalFetch;

assert.equal(res.statusCode, 302);
assert.equal(res.getHeader('Location'), '/?notion_connected=1');
const cookie = cookieValue(res.getHeader('Set-Cookie'), 'aos_session');
assert.ok(cookie);
const finalSession = decodeURIComponent(cookie);
assert.doesNotMatch(finalSession, /notion-access-token/);
assert.deepEqual(session({ headers: { cookie: `aos_session=${cookie}` } }), {
  user: { id: 'student-1', email: 'student@example.com' },
  notion: { token: 'notion-access-token', workspace: 'Student workspace', workspaceId: 'workspace-1' },
  exp: session({ headers: { cookie: `aos_session=${cookie}` } }).exp
});
console.log('Notion OAuth callback fixture passed');
