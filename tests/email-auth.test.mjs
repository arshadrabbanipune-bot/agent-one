import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import signup from '../api/auth/signup.js';
import signin from '../api/auth/signin.js';

process.env.AUTH_SECRET = 'email-auth-test-secret';

const request = (body) => {
  const req = new EventEmitter();
  req.method = 'POST';
  queueMicrotask(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
};
const response = () => {
  const headers = new Map();
  return { statusCode: 200, body: '', getHeader: (name) => headers.get(name), setHeader: (name, value) => headers.set(name, value), end(value) { this.body = value; }, headers };
};

const originalFetch = globalThis.fetch;
let received = [];
globalThis.fetch = async (url, options) => {
  received.push({ url, options });
  if (String(url).includes('/signup')) return { ok: true, status: 200, json: async () => ({ user: { id: 'signup-user' } }) };
  return { ok: true, status: 200, json: async () => ({ access_token: 'token', user: { id: 'signin-user', email: 'person@example.com' } }) };
};

let res = response();
await signup(request({ email: 'Person@Example.com', password: 'correct-password', age: 24, gender: 'prefer_not_to_say' }), res);
assert.equal(res.statusCode, 200);
assert.equal(JSON.parse(res.body).needsEmailConfirmation, true);
assert.deepEqual(JSON.parse(received[0].options.body).data, { age: 24, gender: 'prefer_not_to_say' });

res = response();
await signin(request({ email: 'person@example.com', password: 'correct-password' }), res);
assert.equal(res.statusCode, 200);
assert.match(String(res.headers.get('Set-Cookie')), /aos_session=/);

// Vercel may make the parsed request body available before the handler runs.
// This verifies that production path does not wait for an already-consumed stream.
res = response();
await signin({ method: 'POST', body: { email: 'person@example.com', password: 'correct-password' } }, res);
assert.equal(res.statusCode, 200);
assert.match(String(res.headers.get('Set-Cookie')), /aos_session=/);

globalThis.fetch = originalFetch;
console.log('email auth route fixtures passed');
