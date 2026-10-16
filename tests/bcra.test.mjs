import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBcraClient, normalizeChecks, normalizePeriods } from '../lib/bcra.mjs';
import { AppError } from '../lib/identity.mjs';

const cuit = '20123456786'; // Synthetic fixture: all transports in this file are mocked.
const raw = { identificacion: Number(cuit), denominacion: 'PERSONA FICTICIA', periodos: [{ periodo: '202608', entidades: [{ entidad: 'ENTIDAD FICTICIA', monto: 1.5, situacion: 1, diasAtrasoPago: 0, enRevision: true }] }] };
const ok = body => ({ status: 200, body: { status: 200, results: body } });
test('Debt amounts are thousands of pesos and missing amounts are not zero', () => {
  const p = normalizePeriods(raw)[0]; assert.equal(p.total, 1500); assert.deepEqual(p.entities[0].flags, ['enRevision']);
  const copy = structuredClone(raw); copy.periodos[0].entidades.push({ entidad: 'Otra', monto: null, situacion: null });
  const partial = normalizePeriods(copy)[0]; assert.equal(partial.total, null); assert.equal(partial.worstSituation, null);
});
test('Historical periods are sorted; absent months are not fabricated', () => {
  const p = normalizePeriods({ periodos: [{ periodo: '202605', entidades: [] }, ...raw.periodos] });
  assert.deepEqual(p.map(x => x.period), ['202608', '202605']); assert.equal(p[1].total, null);
  assert.throws(() => normalizePeriods({ periodos: [{ periodo: '202613', entidades: [] }] }));
});
test('Rejected check amounts are already pesos (do not multiply by 1000)', () => {
  const checks = normalizeChecks({ causales: [{ causal: 'SIN FONDOS', entidades: [{ entidad: 1, detalle: [{ monto: 1500, fechaPago: '2026-01-01' }, { monto: 500, fechaPago: null }] }] }] });
  assert.equal(checks.total, 2000); assert.equal(checks.count, 2); assert.equal(checks.unpaidCount, 1);
});
test('Parallel sources remain independent when history fails', async () => {
  const calls = [];
  const client = createBcraClient(async url => { calls.push(url); if (url.includes('Historicas')) throw new AppError('Timeout', 504, 'BCRA_TIMEOUT'); if (url.includes('ChequesRechazados')) return { status: 404, body: { status: 404, errorMessages: ['No hay datos'] } }; return ok(raw); });
  const report = await client.lookup(cuit);
  assert.equal(calls.length, 3); assert.equal(report.sources.current.status, 'found'); assert.equal(report.sources.history.status, 'unavailable'); assert.equal(report.sources.checks.status, 'no_records');
});
test('Responses for a different identifier fail closed', async () => {
  const client = createBcraClient(async () => ok({ ...raw, identificacion: 999 }));
  const report = await client.lookup(cuit); assert.equal(report.sources.current.code, 'IDENTITY_MISMATCH'); assert.equal(report.sources.current.name, undefined);
});
test('A 404 HTML error or a failure disguised by HTTP 200 is not no-records', async () => {
  for (const response of [{ status: 404, body: '<html>Not found</html>' }, { status: 200, body: { status: 500 } }, { status: 500, body: { status: 404, errorMessages: [] } }]) {
    const report = await createBcraClient(async () => response).lookup(cuit);
    assert.ok(Object.values(report.sources).every(s => s.status === 'unavailable'));
  }
});
test('Rate limits and malformed schemas remain unavailable', async () => {
  const limited = await createBcraClient(async () => ({ status: 429, body: {} })).lookup(cuit);
  assert.equal(limited.sources.current.code, 'BCRA_RATE_LIMIT');
  const malformed = await createBcraClient(async () => ok({ identificacion: cuit })).lookup(cuit);
  assert.equal(malformed.sources.current.code, 'BCRA_SCHEMA');
});
test('Product cache coalesces simultaneous downloads and caches no personal reports', async () => {
  let calls = 0;
  const client = createBcraClient(async url => { calls++; return ok(url.includes('Prendarios') ? [{ descripcionEntidad: 'Banco de prueba' }] : raw); });
  await Promise.all([client.products(), client.products()]); assert.equal(calls, 1); assert.equal((await client.products()).cached, true); assert.equal(calls, 1);
  await client.lookup(cuit); await client.lookup(cuit); assert.equal(calls, 7);
});
