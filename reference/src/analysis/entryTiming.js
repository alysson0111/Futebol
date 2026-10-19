export const MIN_ENTRY_MINUTE = 43;
export const MIN_OVER05_ENTRY_MINUTE = 65;
export const minEntryMinute = market => market === 'over05' ? MIN_OVER05_ENTRY_MINUTE : MIN_ENTRY_MINUTE;
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
  return entryMinute(game) !== null && entryMinute(game) >= minEntryMinute(game.market);
}

export function isScoreTied(game) {
  const text = String(game.scoreText ?? '').trim();
  const match = text.match(/^(\d+)\s*(?:x|\u00d7|:|-)\s*(\d+)$/i);
  const home = game.homeGoals ?? game.goals?.home;
  const away = game.awayGoals ?? game.goals?.away;
  const valid = value => value !== null && value !== undefined && value !== '' && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
  if (text && !match) return false;
  if (match) {
    if ((home != null && (!valid(home) || Number(home) !== Number(match[1]))) || (away != null && (!valid(away) || Number(away) !== Number(match[2])))) return false;
    return Number.isSafeInteger(Number(match[1])) && Number(match[1]) === Number(match[2]);
  }
  return valid(home) && valid(away) && Number(home) === Number(away);
}

export function isEntryAllowed(game) {
  return isEntryTimingAllowed(game) && (game.market !== 'ml' || isScoreTied(game));
}

export function enforceEntryTiming(game) {
  if (isEntryAllowed(game)) return game;
  const minute = entryMinute(game);
  return {
    ...game,
    status: 'Observar',
    signals: [],
    stats: [
      ...(game.stats || []),
      ...(!isEntryTimingAllowed(game) ? [`NAO | Entrada a partir de ${minEntryMinute(game.market)} minutos | ${minute === null ? 'Minuto indisponivel' : `${minute}'`}`] : []),
      ...(game.market === 'ml' && !isScoreTied(game) ? [`NAO | Placar empatado para ML | ${game.scoreText || 'Placar indisponivel'}`] : [])
    ]
  };
}
