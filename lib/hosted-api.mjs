import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createBcraClient } from './bcra.mjs';
import { demoReport } from './demo.mjs';
import { AppError, validateLookup } from './identity.mjs';

const COOKIE = '__Host-teilen_session';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_BODY = 4096;
const digest = value => createHash('sha256').update(value).digest();
const same = (left, right) => timingSafeEqual(digest(left), digest(right));
const signature = (payload, secret) => createHmac('sha256', secret).update('teilen-session:' + payload).digest('base64url');
const cookie = (token, age = SESSION_SECONDS) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

function authenticated(request, secret, now) {
  const token = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!secret || !token || token.length > 256) return false;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra !== undefined || !same(mac, signature(payload, secret))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(data.exp) && data.exp > now && data.exp <= now + SESSION_SECONDS * 1000 && typeof data.nonce === 'string';
  } catch { return false; }
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new AppError('Se requiere una solicitud JSON.', 415);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new AppError('Solicitud demasiado extensa.', 413);
  const chunks = []; let size = 0;
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Solicitud inválida.');
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new AppError('Solicitud demasiado extensa.', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('Solicitud inválida.'); }
}

const json = (status, value, extra = {}) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
} });

export function createHostedHandler({ client = createBcraClient(), getPassword = () => process.env.TEILEN_ACCESS_PASSWORD, now = Date.now } = {}) {
  return async request => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site' || (request.method === 'POST' && origin !== url.origin)) {
        throw new AppError('Origen de solicitud no permitido.', 403, 'ORIGIN_DENIED');
      }
      const configuredPassword = getPassword();
      const secret = typeof configuredPassword === 'string' && configuredPassword.length >= 16 && configuredPassword.length <= 256 ? configuredPassword : null;
      const signedIn = authenticated(request, secret, now());
      const path = url.pathname;
      if (request.method === 'GET' && path === '/api/health') return json(200, { ok: true, mode: 'netlify', version: '0.2.0', storage: 'none', auth: { required: true, configured: Boolean(secret), authenticated: signedIn } });
      if (request.method === 'GET' && path === '/api/demo') return json(200, demoReport());
      if (request.method === 'GET' && path === '/api/products') return json(200, await client.products());
      if (request.method === 'POST' && path === '/api/logout') return json(200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      if (request.method === 'POST' && ['/api/login', '/api/lookup'].includes(path)) {
        if (!secret) throw new AppError('El administrador todavía debe habilitar el acceso a consultas.', 503, 'ACCESS_NOT_CONFIGURED');
        if (path === '/api/lookup' && !signedIn) throw new AppError('Ingresá con la clave de Teilen para consultar.', 401, 'AUTH_REQUIRED');
        const body = await readJson(request);
        if (path === '/api/login') {
          if (typeof body?.password !== 'string' || !same(body.password, secret)) throw new AppError('La clave no es correcta.', 401, 'INVALID_PASSWORD');
          const payload = Buffer.from(JSON.stringify({ exp: now() + SESSION_SECONDS * 1000, nonce: randomBytes(16).toString('hex') })).toString('base64url');
          return json(200, { ok: true }, { 'Set-Cookie': cookie(payload + '.' + signature(payload, secret)) });
        }
        const identity = validateLookup(body);
        return json(200, { ...await client.lookup(identity.cuit), identity });
      }
      return json(404, { error: 'Recurso no encontrado.' });
    } catch (error) {
      const known = error instanceof AppError;
      return json(known ? error.status : 500, { error: known ? error.message : 'No se pudo completar la operación.', code: known ? error.code : 'INTERNAL_ERROR' });
    }
  };
}
