import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOdds, assessSample, wilson, scanMatch } from './market-scanner.mjs';
test('historical interval is conservative and insufficient samples never approve', () => {
  const interval = wilson(20, 20);
  assert.equal(interval.rate, 1);
  assert.ok(interval.lower < 1);
  assert.equal(assessSample([1, 1], Boolean, 2).approved, false);
  assert.equal(assessSample(Array(20).fill(1), Boolean, 1.85).approved, true);
  assert.equal(assessSample(Array(20).fill(1), Boolean, 1.1).approved, false);
});
test('scanner requires complete evidence, excludes partial handicap wins and missing corners', async () => {
  const original = globalThis.fetch;
  const originalKey = process.env.APISPORTS_KEY;
  process.env.APISPORTS_KEY = 'test-scanner-not-a-real-key';
  const now = Date.now();
  function fixture(id, home, away, score, days = 0) {
    return { fixture: { id, date: new Date(now + days * 86400000).toISOString(), status: { short: days > 0 ? 'NS' : 'FT' } }, league: { season: 2026 }, teams: { home: { id: home, name: 'Home' }, away: { id: away, name: 'Away' } }, goals: { home: score[0], away: score[1] } };
  }
  globalThis.fetch = async value => {
    const url = new URL(value);
    let response = [];
    if (url.pathname === '/fixtures') {
      if (url.searchParams.has('id')) response = [fixture(Number(url.searchParams.get('id')), 501, 502, [null, null], 1)];
      else {
        const team = Number(url.searchParams.get('team'));
        response = Array.from({ length: 10 }, (_, i) => fixture(team * 100 + i, team === 501 ? team : 700 + i, team === 501 ? 800 + i : team, team === 501 ? [2, 1] : [1, 2], -i - 1));
      }
    }
    if (url.pathname === '/odds') response = [{ update: new Date(now - 3 * 3600000).toISOString(), bookmakers: [{ name: 'Teste', bets: [
      { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: 1.85 }] },
      { name: 'Asian Handicap', values: [{ value: 'Home -0.75', odd: 1.85 }] },
      { name: 'Corners Over Under', values: [{ value: 'Over 9.5', odd: 1.85 }] }
    ] }] }];
    return { ok: true, json: async () => ({ response, errors: {} }) };
  };
  try {
    const over = await scanMatch('50199', 'over-25');
    assert.equal(over.signals.length, 1);
    assert.equal(over.signals[0].sample, 20);
    const handicap = await scanMatch('50199', 'handicap');
    assert.equal(handicap.signals.length, 0);
    assert.equal(handicap.assessments[0].hits, 0);
    const corners = await scanMatch('50199', 'corners');
    assert.equal(corners.signals.length, 0);
    assert.equal(corners.assessments[0].sample, 0);
  } finally { globalThis.fetch = original; if (originalKey === undefined) delete process.env.APISPORTS_KEY; else process.env.APISPORTS_KEY = originalKey; }
});
test('only exact match totals and full-match markets are accepted', () => {
  const items = [{ update: new Date().toISOString(), bookmakers: [{ name: 'Fonte', bets: [
    { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: '1.9' }, { value: 'Over 1.5', odd: '1.4' }] },
    { name: 'Goals Over/Under First Half', values: [{ value: 'Over 2.5', odd: '4.0' }] },
    { name: 'Match Winner', values: [{ value: 'Home', odd: '1.8' }, { value: 'Draw', odd: '3' }] }
  ] }] }];
  assert.equal(parseOdds(items, 'over-25').length, 1);
  assert.equal(parseOdds(items, 'over-25')[0].odd, 1.9);
  assert.equal(parseOdds(items, 'ml').length, 1);
});
