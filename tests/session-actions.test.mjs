import assert from 'node:assert/strict';
import { createSession, verify } from '../api/_auth.js';
import logout from '../api/auth/logout.js';
import disconnect from '../api/auth/notion/disconnect.js';

process.env.AUTH_SECRET = 'session-action-test-secret';

const response = () => {
  const headers = new Map();
  return {
    statusCode: 200,
    body: '',
    getHeader: name => headers.get(name),
    setHeader(name, value) { headers.set(name, value); },
    writeHead(status, values = {}) { this.statusCode = status; for (const [name, value] of Object.entries(values)) this.setHeader(name, value); },
    end(value = '') { this.body = value; }
  };
};

const activeSession = createSession(
  { id: 'user-1', email: 'student@example.com' },
  { token: 'notion-token', workspace: 'Student workspace' }
);
assert.doesNotMatch(activeSession, /notion-token/);

let res = response();
logout({ method: 'POST', headers: {} }, res);
assert.equal(res.statusCode, 200);
assert.deepEqual(JSON.parse(res.body), { ok: true });
assert.match(String(res.getHeader('Set-Cookie')), /aos_session=;/);

res = response();
await disconnect({ method: 'POST', headers: { cookie: `aos_session=${encodeURIComponent(activeSession)}` } }, res);
assert.equal(res.statusCode, 200);
assert.deepEqual(JSON.parse(res.body), { ok: true });
const disconnectCookie = String(res.getHeader('Set-Cookie')).split(';')[0].split('=')[1];
const updated = verify(decodeURIComponent(disconnectCookie));
assert.deepEqual(updated.user, { id: 'user-1', email: 'student@example.com' });
assert.equal(updated.notion, null);

console.log('session action route fixtures passed');
