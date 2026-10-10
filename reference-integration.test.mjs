import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { deleteApp, getApps } from 'firebase-admin/app';
import { getDb, now } from './reference/api/_lib/firebase.js';
import handler from './reference-server.mjs';
import { deliverEntry } from './reference/api/_lib/telegram.js';
import { analyzeFixtures, publicGame } from './reference/api/_lib/scanner.js';
const response = () => ({ setHeader() {}, end(body) { this.body = JSON.parse(body); } });

test('Firebase initializes through the installed modular Admin API without network writes', async () => {
  const names = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const old = names.map(name => process.env[name]);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
  process.env.FIREBASE_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  try {
    const db = getDb();
    assert.equal(db.projectId, 'test-project');
    assert.equal(getDb(), db);
    assert.equal(typeof now().isEqual, 'function');
  } finally {
    const app = getApps().find(entry => entry.name === 'central-reference');
    if (app) await deleteApp(app);
    names.forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index]; });
  }
});
test('all bank operations require a server token, including GET settlement', async () => {
  const old = process.env.SCANNER_ACCESS_TOKEN;
  process.env.SCANNER_ACCESS_TOKEN = 'test-access-token';
  try {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const res = response();
      await handler({ method, url: '/api/signals', headers: {} }, res);
      assert.equal(res.statusCode, 401);
    }
    const res = response();
    await handler({ method: 'GET', url: '/api/unknown', headers: {} }, res);
    assert.equal(res.statusCode, 404);
  } finally { if (old === undefined) delete process.env.SCANNER_ACCESS_TOKEN; else process.env.SCANNER_ACCESS_TOKEN = old; }
});
test('original scanner generates all eight markets and keeps actual entry lines', () => {
  const fixture = { fixture: { id: 1, date: '2026-10-10T16:00:00Z', status: { short: '2H', elapsed: 60 } }, teams: { home: { name: 'A' }, away: { name: 'B' } }, goals: { home: 1, away: 0 }, league: { name: 'Liga' }, source: 'TotalCorner', totalCorner: {}, goalLine: 3, handicapLine: -.75,
    liveStats: [{ statistics: [{ type: 'Corner Kicks', value: 4 }, { type: 'Total Shots', value: 12 }] }, { statistics: [{ type: 'Corner Kicks', value: 3 }, { type: 'Total Shots', value: 8 }] }] };
  const rows = analyzeFixtures({ response: [fixture] }).map(publicGame);
  assert.equal(rows.length, 8);
  const over = rows.find(row => row.market === 'over25');
  assert.equal(over.status, 'Entrada');
  assert.deepEqual(over.signals, ['Over 2.5 gols']);
  assert.equal(over.liveCorners, 7);
  assert.equal(over.confidence, 87);
  assert.equal(rows.find(row => row.market === 'over05').status, 'Observar');
});
test('Telegram is tested with a mock only and never includes odds or secrets in errors', async () => {
  const oldFetch = globalThis.fetch, oldToken = process.env.TELEGRAM_BOT_TOKEN, oldChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token'; process.env.TELEGRAM_CHAT_ID = '1';
  const record = { marketLabel: 'Over 2.5', home: 'A', away: 'B', league: 'Liga', signalLines: ['Over 2.5 gols'], confidence: 87, entryScoreText: '1x0', entryLiveStatus: "60'", createdAtText: '10/10/2026 13:00' };
  try {
    globalThis.fetch = async (url, options) => {
      const payload = JSON.parse(options.body);
      assert.match(payload.text, /pontuacao, nao probabilidade/);
      assert.doesNotMatch(payload.text, /odd/i);
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 3 } }) };
    };
    assert.equal((await deliverEntry(record)).status, 'enviado');
    globalThis.fetch = async () => ({ok:false,status:400,json:async()=>({ok:false,error_code:400,description:'Bad Request: chat not found'})});
    assert.match((await deliverEntry(record)).error, /Chat nao encontrado/);
    globalThis.fetch = async () => ({ok:false,status:401,json:async()=>({ok:false,error_code:401,description:'Unauthorized test-token'})});
    assert.match((await deliverEntry(record)).error, /Token do bot invalido/);
    globalThis.fetch = async () => { throw new Error('secret-test-token'); };
    assert.equal((await deliverEntry(record)).error.includes('test-token'), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
  }
});
