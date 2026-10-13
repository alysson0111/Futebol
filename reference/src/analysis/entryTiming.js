export const MIN_ENTRY_MINUTE = 43;
const TIMED_MARKETS = new Set(['over05', 'ml']);

export function entryMinute(game) {
  const status = String(game.liveStatus || '').trim();
  if (/^(HT|Intervalo)$/i.test(status)) return 45;
  const match = status.match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*['\u2019]?$/);
  if (match) return Number(match[1]) + Number(match[2] || 0);
  const elapsed = game.elapsed ?? game.fixture?.status?.elapsed;
  if (elapsed === null || elapsed === undefined || elapsed === '') return null;
  const minute = Number(elapsed);
  return Number.isFinite(minute) && minute >= 0 ? minute : null;
}

export function isEntryTimingAllowed(game) {
  if (!TIMED_MARKETS.has(game.market)) return true;
  const statuses = [game.apiStatus, game.fixture?.status?.short, game.liveStatus].map(value => String(value || '').trim().toUpperCase());
  if (statuses.some(status => ['NS', 'PRE-JOGO', 'FT', 'AET', 'PEN', 'FIM', 'FULL', 'INTEGRAL', 'CANC', 'PST', 'SUSP', 'ABD'].includes(status))) return false;
  return entryMinute(game) !== null && entryMinute(game) >= MIN_ENTRY_MINUTE;
}

export function enforceEntryTiming(game) {
  if (isEntryTimingAllowed(game)) return game;
  const minute = entryMinute(game);
  return {
    ...game,
    status: 'Observar',
    signals: [],
    stats: [...(game.stats || []), `NAO | Entrada a partir de ${MIN_ENTRY_MINUTE} minutos | ${minute === null ? 'Minuto indisponivel' : `${minute}'`}`]
  };
}
