export const TELEGRAM_MARKETS = [
  ['over05', '+0.5 gols'],
  ['over15', '+1.5 gols'],
  ['over25', '+2.5 gols'],
  ['under25', 'Under 2.5'],
  ['under35', 'Under 3.5 IA'],
  ['corners', 'Escanteios'],
  ['handicap', 'Handicap'],
  ['ml', 'ML']
];

const STORAGE_KEY = 'central.telegram-markets.v1';

export function normalizeTelegramMarkets(value) {
  if (!Array.isArray(value)) return [];
  return TELEGRAM_MARKETS.map(([id]) => id).filter(id => value.includes(id));
}

export function loadTelegramMarkets(storage) {
  try { return normalizeTelegramMarkets(JSON.parse(storage?.getItem(STORAGE_KEY) || '[]')); }
  catch { return []; }
}

export function persistTelegramMarkets(storage, markets) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeTelegramMarkets(markets))); }
  catch { /* Unavailable storage must not prevent changing the current selection. */ }
}

export function isTelegramMarketSelected(market, selected) {
  return normalizeTelegramMarkets(selected).includes(market);
}
