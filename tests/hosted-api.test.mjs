import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostedHandler } from '../lib/hosted-api.mjs';
import { config } from '../netlify/functions/api.mjs';

const origin = 'https://teilen.example';
const password = 'test-only-password-not-a-real-secret';
const input = { document: '20123456786', consent: true };
const req = (path, { data, cookie, method = data === undefined ? 'GET' : 'POST', headers = {} } = {}) => new Request(origin + '/api/' + path, {
  method, headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
  ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
});
function fixture(options = {}) {
  let calls = 0;
  const handler = createHostedHandler({ getPassword: () => password, client: { products: async () => ({ products: [] }), lookup: async cuit => { calls++; return { cuit, sources: {} }; } }, ...options });
  return { handler, calls: () => calls };
}
async function login(handler) {
  const response = await handler(req('login', { data: { password } }));
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie');
}

test('Hosted personal lookup fails closed without configured access or a session', async () => {
  for (const getPassword of [() => undefined, () => 'too-short', () => 'x'.repeat(257)]) {
    const { handler, calls } = fixture({ getPassword });
    assert.equal((await handler(req('lookup', { data: input }))).status, 503);
    assert.equal((await handler(req('health')).then(r => r.json())).auth.configured, false);
    assert.equal(calls(), 0);
  }
  const { handler, calls } = fixture();
  assert.equal((await handler(req('lookup', { data: input }))).status, 401);
  assert.equal((await handler(req('login', { data: { password: 'wrong' } }))).status, 401);
  assert.equal(calls(), 0);
});

test('Login, lookup and logout preserve privacy and existing identity validation', async () => {
  const { handler, calls } = fixture();
  const cookie = await login(handler);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes(password));
  assert.equal((await handler(req('health', { cookie })).then(r => r.json())).auth.authenticated, true);
  assert.equal((await handler(req('lookup', { data: { ...input, consent: false }, cookie }))).status, 400);
  const response = await handler(req('lookup', { data: input, cookie }));
  assert.equal(response.status, 200); assert.equal(calls(), 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).identity.cuit, input.document);
  assert.match((await handler(req('logout', { method: 'POST', cookie }))).headers.get('set-cookie'), /Max-Age=0/);
});

test('Tampered, expired and password-rotated sessions cannot reach the provider', async () => {
  let time = 1000000; let secret = password;
  const { handler, calls } = fixture({ now: () => time, getPassword: () => secret });
  const cookie = await login(handler);
  assert.equal((await handler(req('lookup', { data: input, cookie: cookie.replace('=', '=x') }))).status, 401);
  time += 8 * 60 * 60 * 1000;
  assert.equal((await handler(req('lookup', { data: input, cookie }))).status, 401);
  time = 1000000; secret = 'another-test-only-password';
  assert.equal((await handler(req('lookup', { data: input, cookie }))).status, 401);
  assert.equal(calls(), 0);
});

test('Cross-origin login and lookup requests are denied', async () => {
  const { handler, calls } = fixture();
  const cookie = await login(handler);
  for (const headers of [{ Origin: 'https://other.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await handler(req('lookup', { data: input, cookie, headers }))).status, 403);
    assert.equal((await handler(req('login', { data: { password }, headers }))).status, 403);
  }
  assert.equal(calls(), 0);
});

test('Hosted JSON requests are bounded and errors never echo identifiers or passwords', async () => {
  const { handler } = fixture();
  assert.equal((await handler(req('login', { data: { password: 'x'.repeat(5000) } }))).status, 413);
  assert.equal((await handler(req('login', { data: {}, headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(new Request(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await handler(req('login', { data: null }))).status, 401);
  const broken = fixture({ client: { lookup: async () => { throw new Error(input.document + password); } } }).handler;
  const cookie = await login(broken);
  const response = await broken(req('lookup', { data: input, cookie }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'No se pudo completar la operación.', code: 'INTERNAL_ERROR' });
});

test('Public demo, catalogue and health work without a password; alternate routes cannot bypass authentication', async () => {
  const { handler } = fixture({ getPassword: () => undefined });
  assert.equal((await handler(req('demo')).then(r => r.json())).demo, true);
  assert.deepEqual((await handler(req('products')).then(r => r.json())).products, []);
  const health = await handler(req('health')).then(r => r.json());
  assert.equal(health.mode, 'netlify'); assert.equal(health.auth.required, true);
  for (const path of ['lookup', 'login', 'unknown']) assert.equal((await handler(req(path))).status, 404);
  assert.equal((await handler(new Request(origin + '/.netlify/functions/api'))).status, 404);
  assert.equal(config.path, '/api/*');
  assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
});
