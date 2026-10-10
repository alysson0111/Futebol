import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConfrontation, analysisEvidence, validateNarrative } from './sports-analysis.mjs';

function fixture(id = '10') {
  return { event: { id, sport: 'football', title: 'A vs. B', date: '2026-10-10T20:00:00Z',
    home: { name: 'A' }, away: { name: 'B' }, league: { name: 'Liga teste' }, phase: 'scheduled',
    score: { home: null, away: null }, url: 'https://polymarket.com/event/test', markets: [
      { id: '20', title: 'Total 2.5', description: 'Regras do contrato', outcomes: [
        { label: 'Over', quote: { ask: .5, odd: 2, impliedProbability: .5, availableShares: 30 } },
        { label: 'Under', referencePrice: .6, quote: null }
      ] }
    ] } };
}

test('bounds evidence and does not replace missing quotes with Gamma prices', () => {
  const payload = fixture();
  payload.event.markets = Array.from({ length: 30 }, () => ({ ...payload.event.markets[0], description: 'X'.repeat(4000) }));
  const evidence = analysisEvidence(payload);
  assert.equal(evidence.markets.length, 24);
  assert.equal(evidence.markets[0].description.length, 1200);
  assert.equal(evidence.markets[0].outcomes[1].ask, null);
  assert.equal(evidence.markets[0].outcomes[1].odd, null);
});

test('rejects unknown citations, empty text and oversized sections', () => {
  const section = { title: 'Contexto', text: 'Fatos', sources: ['evento'] };
  assert.equal(validateNarrative({ sections: [section] }, ['evento']).length, 1);
  for (const bad of [{ ...section, sources: ['inventada'] }, { ...section, text: '' }, { ...section, text: 'X'.repeat(1801) }]) {
    assert.throws(() => validateNarrative({ sections: [bad] }, ['evento']));
  }
});

test('missing key never calls OpenAI; valid output is cached; failures return facts without secrets', async () => {
  const originalFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  try {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = () => { throw new Error('Unexpected network'); };
    const missing = await analyzeConfrontation(fixture());
    assert.equal(missing.engine, 'market');
    assert.match(missing.warning, /OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = 'test-secret';
    process.env.OPENAI_MODEL = 'gpt-4.1-mini';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.authorization, 'Bearer test-secret');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, 'json_schema');
      return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ sections: [{ title: 'Contexto', text: 'A contra B.', sources: ['evento'] }] }) }] }] }) };
    };
    const results = await Promise.all([analyzeConfrontation(fixture()), analyzeConfrontation(fixture())]);
    assert.equal(calls, 1);
    assert.equal(results[0].engine, 'ai');
    assert.equal((await analyzeConfrontation(fixture())).engine, 'ai');
    assert.equal(calls, 1);
    globalThis.fetch = async () => ({ ok: false, status: 401, json: () => { throw new Error('test-secret'); } });
    const failed = await analyzeConfrontation(fixture('11'));
    assert.equal(failed.engine, 'market');
    assert.ok(!JSON.stringify(failed).includes('test-secret'));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 'incomplete', output: [] }) });
    assert.equal((await analyzeConfrontation(fixture('12'))).engine, 'market');
  } finally {
    globalThis.fetch = originalFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = model;
  }
});
