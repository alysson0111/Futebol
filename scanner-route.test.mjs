import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL = '1';
const { default: handler } = await import('./server.mjs');
function response() {
  return { statusCode: 0, writeHead(status) { this.statusCode = status; }, end(body) { this.payload = JSON.parse(body); } };
}
test('scanner rejects invalid markets and unauthorized delivery before API calls', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unauthorized request must not fetch'); };
  try {
    const invalid = response();
    await handler({ method: 'GET', url: '/api/scanner?market=unknown&id=5', headers: { host: 'localhost' } }, invalid);
    assert.equal(invalid.statusCode, 400);
    const unauthorized = response();
    await handler({ method: 'POST', url: '/api/scanner?market=over-25&id=5', headers: { host: 'localhost' } }, unauthorized);
    assert.equal(unauthorized.statusCode, 403);
  } finally { globalThis.fetch = originalFetch; }
});
