import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createBcraClient } from './lib/bcra.mjs';
import { AppError, validateLookup } from './lib/identity.mjs';
import { demoReport } from './lib/demo.mjs';

const publicFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/domain.js', ['domain.js', 'text/javascript; charset=utf-8']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);

export function createServer({ client = createBcraClient(), rateLimit = 15 } = {}) {
  const limits = new Map();
  return http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const expectedHost = `127.0.0.1:${req.socket.localPort}`;
      const alternateHost = `localhost:${req.socket.localPort}`;
      if (![expectedHost, alternateHost].includes(req.headers.host)) throw new AppError('Acceso disponible solamente desde este equipo.', 403, 'LOCAL_ONLY');
      if (req.headers.origin && ![`http://${expectedHost}`, `http://${alternateHost}`].includes(req.headers.origin)) throw new AppError('Origen de solicitud no permitido.', 403, 'ORIGIN_DENIED');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('Origen de solicitud no permitido.', 403, 'ORIGIN_DENIED');
      const url = new URL(req.url, `http://${expectedHost}`);
      if (req.method === 'GET' && publicFiles.has(url.pathname)) {
        const [file, type] = publicFiles.get(url.pathname);
        const data = await readFile(new URL('./public/' + file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(data); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: true, mode: 'local', version: '0.2.0', storage: 'none' });
      if (req.method === 'GET' && url.pathname === '/api/products') return json(200, await client.products());
      if (req.method === 'GET' && url.pathname === '/api/demo') return json(200, demoReport());
      if (req.method === 'POST' && url.pathname === '/api/lookup') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError('Se requiere una solicitud JSON.', 415);
        if (Number(req.headers['content-length'] || 0) > 4096) throw new AppError('Solicitud demasiado extensa.', 413);
        let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) throw new AppError('Solicitud demasiado extensa.', 413); }
        let body; try { body = JSON.parse(raw); } catch { throw new AppError('Solicitud inválida.'); }
        const identity = validateLookup(body);
        const key = req.socket.remoteAddress; const now = Date.now();
        const record = limits.get(key); const limit = record && now - record.start < 60000 ? record : { start: now, count: 0 };
        if (++limit.count > rateLimit) { res.setHeader('Retry-After', '60'); throw new AppError('Esperá un minuto antes de realizar más consultas.', 429, 'RATE_LIMIT'); }
        limits.set(key, limit);
        const report = await client.lookup(identity.cuit);
        return json(200, { ...report, identity });
      }
      json(404, { error: 'Recurso no encontrado.' });
    } catch (error) {
      json(error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : 'No se pudo completar la operación.', code: error.code || 'INTERNAL_ERROR' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 4318);
  const server = createServer();
  server.listen(port, '127.0.0.1', () => console.log(`Teilen listo en http://127.0.0.1:${port} (acceso local, sin guardar consultas)`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `El puerto ${port} ya está en uso.` : 'No se pudo iniciar el servidor.'); process.exitCode = 1; });
}
