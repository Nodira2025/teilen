import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { demoReport } from '../lib/demo.mjs';

async function fixture(t, options = {}) {
  let calls = 0;
  const server = createServer({ client: { products: async () => ({ products: [] }), lookup: async cuit => { calls++; return { ...demoReport(), cuit }; } }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}`, server, calls: () => calls };
}
const post = (url, data, headers = {}) => fetch(url + '/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
test('Local static server, policy headers, demo and source code boundaries', async t => {
  const { url } = await fixture(t);
  const page = await fetch(url); assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(await page.text(), /Teilen/);
  assert.equal((await fetch(url + '/api/demo').then(r => r.json())).demo, true);
  for (const path of ['/server.mjs', '/research/chequea.html', '/.env', '/lib/bcra.mjs']) assert.equal((await fetch(url + path)).status, 404);
});
test('Invalid requests and unconfirmed DNI never reach a provider', async t => {
  const { url, calls } = await fixture(t);
  for (const input of [{ document: '20123456786' }, { document: '12345678', prefix: '20', consent: true }, { document: 'invalid', consent: true }]) assert.equal((await post(url, input)).status, 400);
  assert.equal(calls(), 0);
  const response = await post(url, { document: '12345678', prefix: '20', consent: true, confirmedIdentity: true }); assert.equal(response.status, 200); assert.equal(calls(), 1); assert.equal((await response.json()).identity.method, 'calculated');
});
test('Cross-origin requests and host rebinding are rejected', async t => {
  const { url, server, calls } = await fixture(t);
  assert.equal((await post(url, { document: '20123456786', consent: true }, { Origin: 'https://foreign.example' })).status, 403); assert.equal(calls(), 0);
  const status = await new Promise(resolve => http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/', headers: { Host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(status, 403);
});
test('Rate limiting, wrong content types and oversized payloads', async t => {
  const { url, calls } = await fixture(t, { rateLimit: 1 });
  const input = { document: '20123456786', consent: true };
  assert.equal((await post(url, input, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post(url, { padding: 'x'.repeat(5000) })).status, 413);
  assert.equal((await post(url, input)).status, 200);
  const limited = await post(url, input); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(calls(), 1);
});
