import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getSportsEvents, getSportsDetails, sports, validDate, dateKey } from './polymarket.mjs';
import { scanMatch, scannerMarkets } from './market-scanner.mjs';
import { analyzeConfrontation } from './sports-analysis.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
for (const file of ['.env', '.env.local']) {
  if (!existsSync(join(root, file))) continue;
  for (const line of readFileSync(join(root, file), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
}
let database;
function firebase() {
  if (database) return database;
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) return null;
  const app = getApps()[0] || initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) });
  database = getFirestore(app);
  return database;
}
function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function history(start, end) {
  let records = [];
  try { records = JSON.parse(await readFile(join(root, 'data', 'prediction-history.json'), 'utf8')).records || []; } catch { /* Local history is optional on Vercel. */ }
  const db = firebase();
  if (db) {
    const saved = await db.collection('signals').where('date', '>=', start).where('date', '<=', end).get();
    records.push(...saved.docs.map(doc => doc.data()));
  }
  return [...new Map(records.filter(record => record.date >= start && record.date <= end).map(record => [record.id, record])).values()];
}
async function handleApi(req, res, url) {
  const params = url.searchParams, sport = params.get('sport') || 'football';
  try {
    if (req.method === 'GET' && url.pathname === '/api/telegram-status') {
      json(res, 200, { configured: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/signals-report') {
      const start = params.get('startDate') || params.get('date') || dateKey(new Date().toISOString()), end = params.get('endDate') || start;
      if (!validDate(start) || !validDate(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 62) { json(res, 400, { error: 'Periodo invalido; maximo 62 dias.' }); return; }
      json(res, 200, { source: 'historico-preservado', startDate: start, endDate: end, records: await history(start, end) }); return;
    }
    if (url.pathname === '/api/scanner' && ['GET', 'POST'].includes(req.method)) {
      const market = params.get('market'), id = params.get('id');
      if (!scannerMarkets[market] || !/^\d+$/.test(id || '') || !sports[sport]) { json(res, 400, { error: 'Mercado ou partida invalida.' }); return; }
      if (req.method === 'POST' && (!process.env.SCANNER_ACCESS_TOKEN || req.headers.authorization !== `Bearer ${process.env.SCANNER_ACCESS_TOKEN}`)) {
        json(res, 403, { error: 'Envio protegido: configure SCANNER_ACCESS_TOKEN no servidor e informe o token de envio.' }); return;
      }
      const result = await scanMatch(id, market, sport);
      // No independent predictive model remains after the provider migration.
      // Market-implied prices alone must never trigger a recommendation or message.
      json(res, 200, { ...result, delivery: [] }); return;
    }
    if (url.pathname.startsWith('/api/sports/')) {
      if (!sports[sport]) { json(res, 400, { error: 'Modalidade invalida.' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/sports/events') {
        const date = params.get('date');
        if (!validDate(date)) { json(res, 400, { error: 'Data invalida.' }); return; }
        json(res, 200, await getSportsEvents(sport, date)); return;
      }
      const id = params.get('id');
      if (!/^\d+$/.test(id || '')) { json(res, 400, { error: 'Partida invalida.' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/sports/details') { json(res, 200, await getSportsDetails(sport, id)); return; }
      if (req.method === 'POST' && url.pathname === '/api/sports/analysis') {
        const payload = await getSportsDetails(sport, id);
        json(res, 200, { ...payload, analysis: await analyzeConfrontation(payload) }); return;
      }
    }
    json(res, 404, { error: 'Rota nao encontrada.' });
  } catch (error) { json(res, 502, { error: error.message }); }
}
export default async function handler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!['/index.html', '/sports-dashboard.js', '/sports.css'].includes(path)) { res.writeHead(404); res.end('Arquivo nao encontrado.'); return; }
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[extname(path)] });
    res.end(data);
  } catch { res.writeHead(404); res.end('Arquivo nao encontrado.'); }
}
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 4173);
  http.createServer((req, res) => handler(req, res).catch(() => json(res, 500, { error: 'Erro interno.' }))).listen(port, '127.0.0.1', () => console.log(`Polymarket em http://127.0.0.1:${port}`));
}
