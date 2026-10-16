import { spawn } from 'node:child_process';
import { AppError } from './identity.mjs';

export const BCRA_BASE = 'https://api.bcra.gob.ar';
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT = 20000;

// Windows Schannel interoperates with the BCRA TLS endpoint on this host.
// TLS verification stays enabled; the URL travels through stdin, not command arguments.
export function curlJson(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--disable', '--config', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let finished = false;
    const stop = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); stop(new AppError('El BCRA demoró demasiado. Volvé a intentar.', 504, 'BCRA_TIMEOUT')); }, TIMEOUT + 2000);
    child.on('error', () => stop(new AppError('No se pudo conectar al BCRA desde este equipo.', 502, 'BCRA_CONNECTION')));
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > MAX_BYTES) { child.kill(); stop(new AppError('La respuesta del BCRA supera el límite admitido.', 502, 'BCRA_RESPONSE')); } else chunks.push(chunk); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code !== 0) return stop(new AppError(code === 28 ? 'El BCRA demoró demasiado. Volvé a intentar.' : 'No se pudo conectar al BCRA. Volvé a intentar.', code === 28 ? 504 : 502, code === 28 ? 'BCRA_TIMEOUT' : 'BCRA_CONNECTION'));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const index = text.lastIndexOf('\n__HTTP_STATUS__:');
        if (index < 0) throw new Error('No status');
        stop(null, { status: Number(text.slice(index + 17)), body: JSON.parse(text.slice(0, index)) });
      } catch { stop(new AppError('El BCRA devolvió una respuesta no interpretable.', 502, 'BCRA_RESPONSE')); }
    });
    child.stdin.end(`url = "${url}"\nsilent\nshow-error\nmax-time = 20\nconnect-timeout = 8\nproto = "=https"\nheader = "Accept: application/json"\nwrite-out = "\\n__HTTP_STATUS__:%{http_code}"\n`);
  });
}

async function fetchJson(url) {
  if (process.platform === 'win32') return curlJson(url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'error', headers: { Accept: 'application/json' } });
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Large response'); } chunks.push(value); }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch (error) {
    throw new AppError(error.name === 'TimeoutError' ? 'El BCRA demoró demasiado.' : 'No se pudo consultar el BCRA. Volvé a intentar.', error.name === 'TimeoutError' ? 504 : 502, error.name === 'TimeoutError' ? 'BCRA_TIMEOUT' : 'BCRA_CONNECTION');
  }
}

export function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
const total = (values) => values.length && values.every(x => x !== null) ? values.reduce((a, b) => a + b, 0) : null;
const flags = ['refinanciaciones', 'recategorizacionOblig', 'situacionJuridica', 'irrecDisposicionTecnica', 'enRevision', 'procesoJud'];
export function normalizePeriods(results) {
  if (!Array.isArray(results.periodos)) throw new AppError('El BCRA respondió sin períodos reconocibles.', 502, 'BCRA_SCHEMA');
  return results.periodos.map(p => {
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(p.periodo) || !Array.isArray(p.entidades)) throw new AppError('Formato de período BCRA no reconocido.', 502, 'BCRA_SCHEMA');
    const entities = p.entidades.map(e => {
      const amountThousands = numberOrNull(e.monto);
      return { name: typeof e.entidad === 'string' ? e.entidad : 'Entidad no informada', situation: Number.isInteger(e.situacion) && e.situacion >= 1 && e.situacion <= 6 ? e.situacion : null,
        amount: amountThousands === null ? null : amountThousands * 1000,
        delayDays: numberOrNull(e.diasAtrasoPago), flags: flags.filter(flag => e[flag] === true) };
    });
    return { period: p.periodo, entities, total: total(entities.map(e => e.amount)), worstSituation: entities.length && entities.every(e => e.situation !== null) ? Math.max(...entities.map(e => e.situation)) : null };
  }).sort((a, b) => b.period.localeCompare(a.period));
}

export function normalizeChecks(results) {
  if (!Array.isArray(results.causales)) throw new AppError('El BCRA respondió sin un detalle de cheques reconocible.', 502, 'BCRA_SCHEMA');
  const checks = [];
  for (const cause of results.causales) {
    if (!Array.isArray(cause.entidades)) throw new AppError('Formato de cheques no reconocido.', 502, 'BCRA_SCHEMA');
    for (const bank of cause.entidades) {
      if (!Array.isArray(bank.detalle)) throw new AppError('Formato de cheques no reconocido.', 502, 'BCRA_SCHEMA');
      for (const c of bank.detalle) checks.push({ cause: typeof cause.causal === 'string' ? cause.causal : 'No informada', bank: bank.entidad, date: c.fechaRechazo || null, amount: numberOrNull(c.monto), paidDate: c.fechaPago || null, fineStatus: c.estadoMulta || null, flags: flags.filter(f => c[f] === true) });
    }
  }
  return { checks, count: checks.length, unpaidCount: checks.filter(c => !c.paidDate).length, total: checks.length ? total(checks.map(c => c.amount)) : 0 };
}

export function createBcraClient(transport = fetchJson) {
  let cachedProducts = null; let pendingProducts = null;
  async function request(path, { allowNotFound = false } = {}) {
    const { status, body } = await transport(BCRA_BASE + path);
    if (allowNotFound && status === 404 && body?.status === 404 && Array.isArray(body.errorMessages)) return null;
    if (status === 429 || body?.status === 429) throw new AppError('El BCRA limitó temporalmente las consultas. Intentá más tarde.', 429, 'BCRA_RATE_LIMIT');
    if (status !== 200 || body?.status !== 200 || body.results == null) throw new AppError('El BCRA no pudo completar esta consulta. Intentá nuevamente.', 502, 'BCRA_UNAVAILABLE');
    return body.results;
  }
  async function lookup(cuit) {
    const definitions = [ ['current', '/Deudas/'], ['history', '/Deudas/Historicas/'], ['checks', '/Deudas/ChequesRechazados/'] ];
    const entries = await Promise.all(definitions.map(async ([key, path]) => {
      const start = Date.now();
      try {
        const raw = await request('/centraldedeudores/v1.0' + path + cuit, { allowNotFound: true });
        if (raw === null) return [key, { status: 'no_records', durationMs: Date.now() - start }];
        if (String(raw.identificacion) !== cuit) throw new AppError('El BCRA respondió con otra identificación. No se muestra el resultado.', 502, 'IDENTITY_MISMATCH');
        const data = key === 'checks' ? normalizeChecks(raw) : { periods: normalizePeriods(raw) };
        return [key, { status: 'found', name: typeof raw.denominacion === 'string' ? raw.denominacion : null, ...data, durationMs: Date.now() - start }];
      } catch (error) { return [key, { status: 'unavailable', code: error.code || 'BCRA_UNAVAILABLE', message: error instanceof AppError ? error.message : 'No se pudo interpretar la respuesta del BCRA.', durationMs: Date.now() - start }]; }
    }));
    return { source: 'BCRA', demo: false, consultedAt: new Date().toISOString(), cuit, sources: Object.fromEntries(entries) };
  }
  async function products() {
    if (cachedProducts && Date.now() - Date.parse(cachedProducts.fetchedAt) < 15 * 60 * 1000) return { ...cachedProducts, cached: true };
    if (pendingProducts) return pendingProducts;
    pendingProducts = (async () => {
      const data = await request('/transparencia/v1.0/Prestamos/Prendarios');
      if (!Array.isArray(data) || !data.length || data.some(row => !row || typeof row !== 'object' || typeof row.descripcionEntidad !== 'string')) throw new AppError('El catálogo BCRA tiene un formato inesperado.', 502, 'BCRA_SCHEMA');
      cachedProducts = { source: 'BCRA', fetchedAt: new Date().toISOString(), products: data, cached: false };
      return cachedProducts;
    })();
    try { return await pendingProducts; } finally { pendingProducts = null; }
  }
  return { lookup, products };
}
