import { isFinishedGame } from "../../src/analysis/signalSettlement.js";

function dateIso(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

export function selectResultDates(signals, cursor = 0, today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })) {
  const dates = [...new Set(signals.map((signal) => dateIso(signal.dateText)).filter((date) => date && date <= today))].sort().reverse();
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const recent = dates.filter((date) => date === today || date === yesterday.toISOString().slice(0, 10));
  const history = dates.filter((date) => !recent.includes(date));
  const offset = history.length ? Math.max(0, Math.trunc(Number(cursor) || 0)) % history.length : 0;
  const selected = Array.from({ length: Math.min(2, history.length) }, (_, i) => history[(offset + i) % history.length]);
  return { dates: [...recent, ...selected], nextCursor: history.length ? (offset + selected.length) % history.length : 0 };
}

function normalize(value) {
  return String(value || "").replace(/^(?:1[ºo]T|2[ºo]T|HT|FT)\s+(?:['’\d]\s*)*/i, '').replace(/\d{1,3}(?:\+\d{1,2})?['\u2019]\s*$/, '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findResultGame(signal, games) {
  const candidates = games.filter((game) => game.dateText === signal.dateText && game.market === signal.market);
  const sameSource = candidates.filter((game) => game.sourceId === signal.sourceId);
  const sameTeams = candidates.filter((game) => normalize(game.home) === normalize(signal.home) && normalize(game.away) === normalize(signal.away));
  const sameLeague = sameTeams.filter(game => normalize(game.league) === normalize(signal.league));
  const kickoff = String(signal.sourceId || '').match(/-(\d{2}:\d{2})$/)?.[1];
  const withoutCards = value => normalize(value).replace(/\s+\d+(?:\s+\d+)*$/, '');
  const legacyCards = candidates.filter(game => kickoff && game.time === kickoff && normalize(game.league) === normalize(signal.league)
    && withoutCards(signal.home) === withoutCards(game.home) && withoutCards(signal.away) === withoutCards(game.away));
  const matches = sameSource.length ? sameSource : sameLeague.length ? sameLeague : sameTeams.length ? sameTeams : legacyCards;
  const finals = matches.filter(isFinishedGame);
  const preferred = finals.length ? finals : matches;
  const identities = new Set(preferred.map(game => `${normalize(game.league)}|${game.time || ''}|${game.scoreText || ''}`));
  if (identities.size > 1) return null;
  return preferred[0] || null;
}
