import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, normalizeMilestone, normalizeMarket, bookQuote, matchesSport, getKalshiEvents, getKalshiDetails, scanKalshi } from './kalshi-data.mjs';

const id = '11111111-1111-1111-1111-111111111111';
const milestone = { id, type: 'soccer_tournament_multi_leg', title: 'A vs B', start_date: '2026-10-10T02:30:00Z', details: { league: 'Liga', status: 'scheduled', main_game_event_ticker: 'KXTESTGAME-DAY' }, primary_event_tickers: ['KXTESTTOTAL-DAY'] };
const market = { ticker: 'KXTESTTOTAL-DAY-3', event_ticker: 'KXTESTTOTAL-DAY', title: 'Over 2.5', status: 'active', floor_strike: 2.5, yes_ask_dollars: '0.7', volume_fp: '10' };
const book = { yes_dollars: [['0.2', '4'], ['0.35', '8']], no_dollars: [['0.3', '4'], ['0.5', '10']] };

test('Kalshi quotes use opposite best bids, actual sizes and no indicative fallback', () => {
  assert.equal(bookQuote(book, 'yes').ask, .5);
  assert.equal(bookQuote(book, 'yes').odd, 2);
  assert.equal(bookQuote(book, 'yes').availableShares, 10);
  assert.equal(bookQuote(book, 'no').ask, .65);
  assert.equal(bookQuote({ yes_dollars: [['0', '0']], no_dollars: [] }, 'yes').odd, null);
  assert.equal(normalizeMarket(market).outcomes[0].quote, null);
  assert.equal(normalizeMarket({ ...market, status: 'settled' }, book).outcomes[0].quote, null);
  assert.equal(normalizeMarket({ ...market, event_ticker: 'KXTEST1HTOTAL-DAY' }, book).type, 'other');
  assert.equal(normalizeMarket({ ...market, event_ticker: 'KXTESTTEAMTOTAL-DAY' }, book).type, 'other');
});

test('dates use kickoff in Brasilia; sport, scores and statuses stay conservative', () => {
  assert.equal(dateKey(milestone.start_date), '2026-10-09');
  const event = normalizeMilestone(milestone, 'football', { home_same_game_score: 0, away_same_game_score: 0, match_status: 'inprogress', half: '2H', time: "80'" });
  assert.equal(event.phase, 'live');
  assert.equal(event.score.home, 0);
  assert.equal(event.elapsed, "80'");
  assert.equal(normalizeMilestone(milestone, 'football', { match_status: 'Played', widget_status: 'finished', status: 'closed' }).phase, 'finished');
  assert.equal(normalizeMilestone(milestone, 'football', { match_status: 'Fixture', widget_status: 'scheduled' }).phase, 'scheduled');
  assert.equal(normalizeMilestone({ ...milestone, details: { status: 'closed' } }, 'football').phase, 'other');
  assert.equal(normalizeMilestone(milestone, 'football').score.home, null);
  assert.equal(matchesSport({ ...milestone, type: 'football_game', details: { league: 'NCAAFB' } }, 'nfl'), false);
  assert.equal(matchesSport({ ...milestone, type: 'table_tennis_match' }, 'tennis'), false);
  assert.equal(matchesSport(milestone, 'eafootball'), false);
});

test('calendar pagination deduplicates, details retrieve books, scanner never sends or invents confidence', async () => {
  const original = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async input => {
    const url = new URL(input); paths.push(url.pathname);
    assert.equal(url.host, 'external-api.kalshi.com');
    let body;
    if (url.pathname.endsWith('/milestones')) body = { cursor: url.searchParams.has('cursor') ? '' : 'next', milestones: [milestone, { ...milestone, id: 'other', type: 'football_game' }] };
    else if (url.pathname.includes('/milestones/')) body = { milestone };
    else if (url.pathname.endsWith('/live_data/batch')) body = { live_datas: [{ milestone_id: id, details: { home_same_game_score: 0, away_same_game_score: 1, match_status: 'ended' } }] };
    else if (url.pathname.includes('/live_data/milestone/')) body = { live_data: { details: {} } };
    else if (url.pathname.endsWith('/events')) body = { events: [{ event_ticker: 'KXTESTTOTAL-DAY', markets: [market] }] };
    else if (url.pathname.endsWith('/orderbooks')) body = { orderbooks: [{ ticker: market.ticker, orderbook_fp: book }] };
    else throw Error('Unexpected endpoint');
    return { ok: true, json: async () => body };
  };
  try {
    const [a, b] = await Promise.all([getKalshiEvents('football', '2026-10-09'), getKalshiEvents('football', '2026-10-09')]);
    assert.equal(a.events.length, 1); assert.deepEqual(a, b);
    assert.equal(a.events[0].score.away, 1);
    assert.equal(paths.filter(path => path.endsWith('/milestones')).length, 2);
    const details = await getKalshiDetails('football', id);
    assert.equal(details.event.markets[0].outcomes[0].quote.odd, 2);
    const scan = await scanKalshi('football', id, 'over-25');
    assert.equal(scan.assessments[0].impliedProbability, .5);
    assert.deepEqual(scan.signals, []); assert.deepEqual(scan.delivery, []);
    assert.equal(scan.assessments[0].rate, null);
    assert.equal((await getKalshiEvents('eafootball', '2026-10-09')).available, false);
    await assert.rejects(getKalshiDetails('tennis', id));
  } finally { globalThis.fetch = original; }
});
