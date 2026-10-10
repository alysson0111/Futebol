import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL = '1';
const { default: handler } = await import('./server.mjs');
test('Kalshi routes validate IDs and block all writes without touching providers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Unexpected provider call'); };
  try {
    for (const [url, method, status] of [
      ['/api/sports/events?provider=kalshi&sport=football&date=bad', 'GET', 400],
      ['/api/sports/details?provider=kalshi&sport=football&id=123', 'GET', 400],
      ['/api/sports/events?provider=kalshi&sport=invalid&date=2026-10-10', 'GET', 400],
      ['/api/scanner?provider=kalshi&sport=football&market=over-25&id=11111111-1111-1111-1111-111111111111', 'POST', 409]
    ]) {
      const response = { writeHead(value) { this.status = value; }, end(value) { this.body = JSON.parse(value); } };
      await handler({ url, method, headers: { host: 'localhost' } }, response);
      assert.equal(response.status, status);
    }
  } finally { globalThis.fetch = original; }
});
