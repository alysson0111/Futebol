import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import games from './reference/api/games.js';
import analysis from './reference/api/forebet-analysis.js';
import signals from './reference/api/signals.js';
const root = fileURLToPath(new URL('.', import.meta.url));
for (const name of ['.env', '.env.local']) {
  try { process.loadEnvFile(resolve(root, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
export function authorized(req) {
  const expected = process.env.SCANNER_ACCESS_TOKEN || '';
  const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
  return expected.length > 0 && Buffer.byteLength(expected) === Buffer.byteLength(supplied) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
let vite;
export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname.startsWith('/api/')) {
    const routes = { '/api/games': games, '/api/forebet-analysis': analysis, '/api/signals': signals };
    if (!routes[url.pathname]) return send(res, 404, { error: 'Rota nao encontrada.' });
    // Report reads also settle results in the reference, so protect every bank operation.
    if (url.pathname === '/api/signals' && !authorized(req)) return send(res, 401, { error: 'Informe o token de envio configurado em SCANNER_ACCESS_TOKEN.' });
    try {
      if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.body == null) {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 262144) return send(res, 413, { error: 'Requisicao muito grande.' }); }
        req.body = JSON.parse(body || '{}');
      }
      return await routes[url.pathname](req, res);
    } catch (error) { return send(res, 400, { error: error instanceof SyntaxError ? 'JSON invalido.' : 'Nao foi possivel processar a consulta.' }); }
  }
  if (vite) return vite.middlewares(req, res, () => send(res, 404, { error: 'Pagina nao encontrada.' }));
  const relative = url.pathname.replace(/^\/+/, '');
  const path = resolve(root, 'dist', relative || 'index.html');
  const dist = resolve(root, 'dist');
  if (!path.startsWith(dist + '/') && !path.startsWith(dist + '\\') && path !== dist) return send(res, 404, { error: 'Arquivo nao encontrado.' });
  try {
    const entry = await stat(path);
    if (!entry.isFile()) throw new Error('not file');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { return send(res, 404, { error: 'Execute npm run build antes de iniciar a pre-visualizacao.' }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--dev')) {
    const { createServer } = await import('vite');
    vite = await createServer({ configFile: resolve(root, 'vite.config.mjs'), server: { middlewareMode: true }, appType: 'spa' });
  }
  http.createServer(handler).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Central Esportiva em http://127.0.0.1:${process.env.PORT || 4173}`));
}
