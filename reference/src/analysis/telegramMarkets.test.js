import test from 'node:test';
import assert from 'node:assert/strict';
import { TELEGRAM_MARKETS, normalizeTelegramMarkets, loadTelegramMarkets, persistTelegramMarkets, isTelegramMarketSelected } from './telegramMarkets.js';
import { deliverEntry } from '../../api/_lib/telegram.js';

test('all eight markets have independent opt-in selection', () => {
  assert.equal(TELEGRAM_MARKETS.length, 8);
  for (const [market] of TELEGRAM_MARKETS) {
    assert.equal(isTelegramMarketSelected(market, [market]), true);
    assert.equal(isTelegramMarketSelected(market, []), false);
    assert.equal(isTelegramMarketSelected(market, TELEGRAM_MARKETS.map(([id]) => id).filter(id => id !== market)), false);
  }
  assert.deepEqual(normalizeTelegramMarkets(['over05', 'unknown', 'over05']), ['over05']);
});

test('selection persists without credentials and invalid storage defaults to no sends', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key,value) => data.set(key,value) };
  assert.deepEqual(loadTelegramMarkets(storage), []);
  persistTelegramMarkets(storage, ['over05', 'corners']);
  assert.deepEqual(loadTelegramMarkets(storage), ['over05', 'corners']);
  assert.equal(data.size, 1);
  assert.deepEqual(loadTelegramMarkets({getItem: () => '{invalid'}), []);
  assert.deepEqual(loadTelegramMarkets({getItem: () => '{"over05":true}'}), []);
  assert.deepEqual(loadTelegramMarkets({getItem: () => {throw new Error('disabled');}}), []);
  assert.doesNotThrow(() => persistTelegramMarkets({setItem: () => {throw new Error('full');}}, ['ml']));
});

test('disabled delivery never calls Telegram even when credentials are configured', async () => {
  const fetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw new Error('No real sends allowed'); };
    assert.equal((await deliverEntry({}, {enabled:false})).status, 'desativado');
    assert.equal((await deliverEntry({}, {enabled:'false'})).status, 'desativado');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = fetch; }
});
