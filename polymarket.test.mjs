import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, dateKey, normalizeEvent, normalizeMarket, quoteFromBook, getSportsEvents, getSportsDetails } from './polymarket.mjs';
import { marketFilter, scanMatch } from './market-scanner.mjs';
test('calendar dates use Sao Paulo, not UTC or market creation', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(dateKey('2026-10-11T01:00:00Z'), '2026-10-10');
  assert.equal(normalizeEvent({ id: 1, title: 'A vs. B', startDate: '2026-01-01', endDate: '2026-10-01' }, 'football').date, null);
});
test('market closure never pretends the game has ended and unknown scores remain null', () => {
  const event = normalizeEvent({ id: 1, title: 'A vs. B', closed: true, startTime: '2025-01-01T00:00:00Z' }, 'football');
  assert.equal(event.phase, 'other');
  assert.deepEqual(event.score, { home: null, away: null });
  assert.equal(normalizeEvent({ id: 1, title: 'Tournament winner' }, 'football'), null);
});
test('unavailable prices and token ids never become zero or floating point tokens', () => {
  const token = '76326088900451014450545560314882710445626833280394511816470086098207633976452';
  const market = normalizeMarket({ id: 1, outcomes: '["Over","Under"]', clobTokenIds: JSON.stringify([token, '2']), outcomePrices: '[null,"0.3"]' });
  assert.equal(market.outcomes[0].tokenId, token);
  assert.equal(market.outcomes[0].referencePrice, null);
  assert.equal(market.line, null);
});
test('odds use lowest actual ask, not midpoint or Gamma reference; absent asks have no odd', () => {
  const quote = quoteFromBook({ asset_id: '1', asks: [{ price: '.8', size: '3' }, { price: '.5', size: '10' }], bids: [{ price: '.4', size: '3' }] }, '1');
  assert.equal(quote.odd, 2);
  assert.equal(quote.availableShares, 10);
  assert.equal(quote.impliedProbability, .5);
  assert.equal(quoteFromBook({ asset_id: '1', asks: [], bids: [] }, '1').odd, null);
  assert.equal(quoteFromBook({ asset_id: '2' }, '1'), null);
});
test('scanner never replaces full game markets with team or half markets', () => {
  assert.equal(marketFilter('over-25')({ type: 'totals', line: 2.5 }), true);
  assert.equal(marketFilter('over-25')({ type: 'soccer_first_half_totals', line: 2.5 }), false);
  assert.equal(marketFilter('corners')({ type: 'soccer_team_total_corners' }), false);
  assert.throws(() => marketFilter('invalid'));
});
test('provider deduplicates siblings, rejects mixed sports, and consults only Polymarket', async () => {
  const original = globalThis.fetch;
  const date = '2030-04-10', token = '100000000000000000000000000000000000000000';
  const game = { id: '991', gameId: 22, title: 'A vs. B', startTime: `${date}T22:00:00Z`, tags: [{ id: '100350' }, { id: '100639' }], markets: [{ id: 8, sportsMarketType: 'totals', line: 2.5, outcomes: '["Over","Under"]', clobTokenIds: JSON.stringify([token, '2']), active: true, enableOrderBook: true, acceptingOrders: true, outcomePrices: '[".7",".3"]' }] };
  const calls = [];
  globalThis.fetch = async (value, options) => {
    const url = new URL(value); calls.push(url);
    assert.ok(['gamma-api.polymarket.com', 'clob.polymarket.com'].includes(url.hostname));
    let data;
    if (url.pathname === '/events/991') data = game;
    else if (url.pathname === '/events') data = [game, { ...game, gameId: null, id: '992', title: 'A vs. B - More Markets', markets: [{ id: 9, sportsMarketType: 'spreads', outcomes: '[]' }] }, { ...game, id: '993', tags: [{ id: '450' }, { id: '100639' }] }];
    else if (url.pathname === '/books') {
      assert.equal(options.method, 'POST');
      data = [{ asset_id: token, asks: [{ price: '.6', size: '20' }], bids: [{ price: '.55', size: '30' }] }];
    } else throw new Error(`Unexpected URL ${url}`);
    return { ok: true, json: async () => data };
  };
  try {
    const list = await getSportsEvents('football', date);
    assert.equal(list.events.length, 1);
    assert.equal(list.events[0].markets.length, 2);
    const details = await getSportsDetails('football', '991');
    assert.equal(details.event.markets[0].outcomes[0].quote.odd, 1 / .6);
    const scan = await scanMatch('991', 'over-25');
    assert.equal(scan.assessments.length, 1);
    assert.equal(scan.signals.length, 0);
    await assert.rejects(getSportsDetails('nfl', '991'), /outra modalidade/);
    await assert.rejects(scanMatch('991', 'over-25', 'nfl'), /exclusivo/);
  } finally { globalThis.fetch = original; }
});
