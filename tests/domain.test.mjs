import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity, isValidCuit, validateLookup, checkDigit } from '../lib/identity.mjs';
import { suggestedCuit, installment, assessProduct, compareProducts, csvCell } from '../public/domain.js';

// Identifiers in tests are synthetic and are never sent to a live data provider.
const cuit = resolveIdentity('12345678', '20').cuit;
test('DNI formatting, CUIL check digit, and client/server calculation agree', () => {
  assert.equal(cuit, '20123456786');
  assert.equal(resolveIdentity('12.345.678', '20').cuit, cuit);
  assert.equal(resolveIdentity('20-12345678-6').method, 'provided');
  assert.equal(suggestedCuit('12.345.678', '20'), cuit);
  assert.equal(isValidCuit(cuit.slice(0, -1) + '9'), false);
  assert.equal(isValidCuit('00000000000'), false);
});
test('DNI alone and invalid characters cannot silently resolve an identity', () => {
  for (const input of ['123456', '123456789', 'abc12345678', '12345678<script>', '', null, 12345678]) assert.throws(() => resolveIdentity(input, '20'));
  assert.throws(() => resolveIdentity('12345678'));
  assert.throws(() => resolveIdentity('00000000', '20'));
});
test('CUIL remainder 10 is not substituted with another unconfirmed prefix', () => {
  let dni;
  for (let i = 12345670; i < 12345700; i++) if (checkDigit('20' + i) === null) { dni = String(i); break; }
  assert.ok(dni); assert.throws(() => resolveIdentity(dni, '20')); assert.equal(suggestedCuit(dni, '20'), null);
});
test('Consent and calculated identity confirmation must be literal true', () => {
  assert.throws(() => validateLookup({ document: cuit, consent: 'true' }));
  assert.throws(() => validateLookup({ document: '12345678', prefix: '20', consent: true }));
  assert.equal(validateLookup({ document: '12345678', prefix: '20', consent: true, confirmedIdentity: true }).cuit, cuit);
  assert.equal(validateLookup({ document: cuit, consent: true }).method, 'provided');
});
test('Effective annual interest converts to monthly rate (not TEA/12)', () => {
  assert.ok(Math.abs(installment(10000, (1.01 ** 12 - 1) * 100, 12) - 888.4878868) < .001);
  assert.equal(installment(12000, 0, 12), 1000);
  assert.equal(installment(12000, null, 12), null);
  assert.equal(installment(12000, -1, 12), null);
});
const now = new Date('2026-10-16T12:00:00Z');
const p = { descripcionEntidad: 'BANCO SUPERVIELLE S.A.', codigoEntidad: 27, destinoFondos: 'Adquisición de automotores usados', denominacion: 'Pesos', tipoTasa: 'Fija', montoMinimoOtorgable: 1000, montoMaximoOtorgable: 100000, plazoMaximoOtorgable: 60, relacionMontoTasacion: 70, tasaEfectivaAnualMaxima: 60, costoFinancieroEfectivoTotalMaximo: 85, fechaInformacion: '2026-10-01' };
const q = { principal: 12000, vehicleValue: 22000, months: 36, condition: 'used' };
test('Principal, term and loan to value limits are evaluated independently', () => {
  assert.equal(assessProduct(p, q, now).compatible, true);
  assert.equal(assessProduct(p, { ...q, principal: 90000 }, now).compatible, false);
  assert.equal(assessProduct(p, { ...q, months: 72 }, now).payment, null);
  assert.equal(assessProduct(p, { ...q, principal: 500 }, now).compatible, false);
  assert.throws(() => compareProducts([p], { ...q, principal: 30000 }, now));
});
test('Missing rates and limits stay unknown rather than becoming zero', () => {
  const row = assessProduct({ ...p, tasaEfectivaAnualMaxima: null, costoFinancieroEfectivoTotalMaximo: null, montoMaximoOtorgable: null }, q, now);
  assert.equal(row.payment, null); assert.equal(row.cft, null); assert.equal(row.completeLimits, false);
});
test('Only fixed peso vehicle products are compared; stale publications are opt in', () => {
  const rows = [p, { ...p, denominacion: 'UVA' }, { ...p, tipoTasa: 'Variable' }, { ...p, destinoFondos: 'Adquisición de motocicletas' }, { ...p, fechaInformacion: '2017-01-01' }];
  assert.equal(compareProducts(rows, q, now).length, 1);
  assert.equal(compareProducts(rows, { ...q, includeOld: true }, now).length, 2);
});
test('Comparator uses CFT, does not invent borrower approval, and filters confirmed banks', () => {
  const rows = compareProducts([{ ...p, costoFinancieroEfectivoTotalMaximo: 120 }, { ...p, costoFinancieroEfectivoTotalMaximo: 80 }, { ...p, descripcionEntidad: 'OTRO BANCO', codigoEntidad: 999 }], { ...q, bank: 'partners' }, now);
  assert.equal(rows.length, 2); assert.equal(rows[0].cft, 80); assert.equal('approved' in rows[0], false);
});
test('CSV exports neutralize spreadsheet formulas and escape quotes', () => {
  assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"'); assert.equal(csvCell('  @cmd'), '"\'  @cmd"'); assert.equal(csvCell('Banco "A"'), '"Banco ""A"""');
});
