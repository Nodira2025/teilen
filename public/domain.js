export const bankTargets = [
  { name: 'Supervielle', matches: ['SUPERVIELLE', 'IUDU'], partner: true, platform: 'IuduCarApp' },
  { name: 'Galicia', matches: ['BANCO DE GALICIA'], partner: true },
  { name: 'ICBC', matches: ['ICBC', 'INDUSTRIAL AND COMMERCIAL BANK'], partner: true },
  { name: 'Columbia', matches: ['COLUMBIA'], partner: true },
  { name: 'Nación', matches: ['BANCO DE LA NACION ARGENTINA'] },
  { name: 'Santander', matches: ['BANCO SANTANDER'] },
  { name: 'BBVA', matches: ['BBVA'] },
  { name: 'Provincia', matches: ['BANCO DE LA PROVINCIA DE BUENOS AIRES'] },
  { name: 'Macro', matches: ['BANCO MACRO'] },
  { name: 'Credicoop', matches: ['CREDICOOP'] },
  { name: 'Brubank', matches: ['BRUBANK'] },
  { name: 'Ualá', matches: ['UALA'] },
  { name: 'Mercado Pago', matches: ['MERCADO PAGO', 'MERCADOPAGO', 'MERCADOLIBRE'] },
  { name: 'Naranja X', matches: ['NARANJA'] }
];
export const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
export const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const money = value => numeric(value) === null ? 'No informado' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
export const percent = value => numeric(value) === null ? 'No informado' : `${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;
export function formatCuit(value) { return value ? `${value.slice(0, 2)}-${value.slice(2, 10)}-${value.slice(10)}` : 'Documento de ejemplo'; }
export function maskedCuit(value) { return value ? `${value.slice(0, 2)}-•••••${value.slice(7, 10)}-${value.slice(10)}` : 'DEMO'; }
export function periodLabel(value) {
  return /^\d{4}(0[1-9]|1[0-2])$/.test(value || '') ? new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 4)}-${value.slice(4)}-01T12:00:00Z`)) : 'Período no informado';
}
export function suggestedCuit(document, prefix) {
  if (!/^[\d.\s-]*$/.test(document)) return null;
  const dni = document.replace(/[.\s-]/g, '');
  if (!/^\d{7,8}$/.test(dni) || !['20', '23', '24', '27'].includes(prefix)) return null;
  const firstTen = prefix + dni.padStart(8, '0');
  let digit = 11 - [...firstTen].reduce((sum, n, index) => sum + Number(n) * [5, 4, 3, 2, 7, 6, 5, 4, 3, 2][index], 0) % 11;
  if (digit === 10) return null;
  if (digit === 11) digit = 0;
  return firstTen + digit;
}
export function installment(principal, annualEffective, months) {
  if (!(principal > 0) || numeric(annualEffective) === null || !Number.isInteger(months) || months < 1) return null;
  if (annualEffective === 0) return principal / months;
  const monthly = Math.expm1(Math.log1p(annualEffective / 100) / 12);
  return principal * monthly / -Math.expm1(-months * Math.log1p(monthly));
}
export function assessProduct(product, { principal, vehicleValue, months }, now = new Date()) {
  const reasons = []; const unknowns = [];
  const minimum = numeric(product.montoMinimoOtorgable);
  const maximum = numeric(product.montoMaximoOtorgable);
  const term = numeric(product.plazoMaximoOtorgable);
  const ratio = numeric(product.relacionMontoTasacion);
  if (minimum !== null && minimum > 0 && principal < minimum) reasons.push('El monto es menor al mínimo publicado');
  if (maximum !== null && maximum > 0 && principal > maximum) reasons.push('El monto supera el máximo publicado');
  if (!maximum) unknowns.push('Monto máximo sin informar');
  if (term !== null && term > 0 && months > term) reasons.push('El plazo supera el máximo publicado');
  if (!term) unknowns.push('Plazo máximo sin informar');
  if (ratio !== null && ratio > 0 && principal > vehicleValue * ratio / 100 + 0.01) reasons.push('Supera el porcentaje financiable del vehículo');
  if (!ratio) unknowns.push('Porcentaje financiable sin informar');
  const date = typeof product.fechaInformacion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(product.fechaInformacion) ? Date.parse(product.fechaInformacion + 'T12:00:00Z') : NaN;
  const ageDays = Number.isFinite(date) ? Math.floor((now.getTime() - date) / 86400000) : null;
  const old = ageDays === null || ageDays > 180 || ageDays < -1;
  const fixedPesos = product.denominacion === 'Pesos' && product.tipoTasa === 'Fija';
  const payment = fixedPesos && !reasons.length ? installment(principal, numeric(product.tasaEfectivaAnualMaxima), months) : null;
  return { product, reasons, unknowns, old, ageDays, payment, baseTotal: payment === null ? null : payment * months,
    cft: numeric(product.costoFinancieroEfectivoTotalMaximo), compatible: reasons.length === 0, completeLimits: unknowns.length === 0 };
}
export function compareProducts(products, query, now = new Date()) {
  const principal = Number(query.principal), vehicleValue = Number(query.vehicleValue), months = Number(query.months);
  if (!(principal > 0 && vehicleValue > 0 && principal <= vehicleValue && principal <= 1e12 && vehicleValue <= 1e12 && Number.isInteger(months) && months >= 1 && months <= 120)) throw new Error('Revisá los importes y el plazo. El monto solicitado no puede superar el valor del vehículo.');
  return products.filter(p => {
    const purpose = normalize(p.destinoFondos);
    const selected = query.condition === 'used' ? purpose.includes('USADOS') : purpose.includes('0 KM');
    if (!selected && !purpose.includes('MARCAS CON CONVENIOS')) return false;
    if (p.denominacion !== 'Pesos' || p.tipoTasa !== 'Fija') return false;
    if (query.bank === 'partners' && !bankTargets.some(b => b.partner && b.matches.some(t => normalize(p.descripcionEntidad).includes(t)))) return false;
    if (query.bank && query.bank !== 'partners' && String(p.codigoEntidad) !== String(query.bank)) return false;
    return true;
  }).map(p => assessProduct(p, { principal, vehicleValue, months }, now))
    .filter(r => (query.includeOld || !r.old) && (query.includeOutside || r.compatible))
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(a.old) - Number(b.old) || (a.cft ?? Infinity) - (b.cft ?? Infinity) || (a.payment ?? Infinity) - (b.payment ?? Infinity));
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
