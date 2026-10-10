import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
const { default: handler } = await import('./server.mjs');

async function request(url) {
  const response = { status: null, body: '', writeHead(status) { this.status = status; }, end(body = '') { this.body = String(body); } };
  await handler({ method: 'GET', url, headers: { host: 'localhost' } }, response);
  return response;
}

test('original interface and its script/styles are served', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Análise de Jogos/);
  assert.match(page.body, /stakeInput/);
  assert.match(page.body, /reportEndDateInput/);
  assert.match(page.body, /minuteSimulatorButton/);
  assert.ok(!page.body.includes('Polymarket'));
  for (const file of ['/app.js', '/styles.css']) assert.equal((await request(file)).status, 200);
});

test('secrets, saved data and removed provider assets cannot be downloaded', async () => {
  for (const file of ['/.env', '/.env.local', '/server.mjs', '/data/prediction-history.json', '/polymarket.mjs', '/sports-dashboard.js']) {
    assert.equal((await request(file)).status, 404, file);
  }
});

test('removed Polymarket API route is unavailable', async () => {
  assert.equal((await request('/api/sports/details?sport=football&id=10')).status, 404);
});
