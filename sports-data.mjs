const TIMEZONE = "America/Sao_Paulo";
export const sports = {
  football: { label: "Futebol", host: "https://v3.football.api-sports.io", path: "fixtures", key: "API_FOOTBALL_KEY" },
  tennis: { label: "Tênis" },
  eafootball: { label: "EA Sports FC/FIFA" },
  basketball: { label: "Basquete", host: "https://v1.basketball.api-sports.io", path: "games", key: "API_BASKETBALL_KEY" },
  nfl: { label: "NFL", host: "https://v1.american-football.api-sports.io", path: "games", key: "API_NFL_KEY" }
};
const cache = new Map();
const pending = new Map();
const liveCodes = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "Q1", "Q2", "Q3", "Q4", "OT"]);
const finishedCodes = new Set(["FT", "AET", "PEN", "AOT", "AWD"]);
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function apiKey(sport) {
  const config = sports[sport];
  return process.env[config?.key] || process.env.APISPORTS_KEY || process.env.API_FOOTBALL_KEY || "";
}
function team(value) {
  return { id: value?.id ?? null, name: value?.name || "A definir", logo: value?.logo || null };
}
export function normalizeSportsEvent(item, sport) {
  const football = sport === "football";
  const game = football ? item.fixture : item.game || item;
  const status = game?.status || item.status || {};
  const code = status.short || "NS";
  const score = side => football ? item.goals?.[side] : item.scores?.[side]?.total;
  const epoch = game?.date?.timestamp || game?.timestamp;
  const timestamp = epoch ? new Date(epoch * 1000).toISOString() : typeof game?.date === "object" ? game.date.start || game.date.date : game?.date;
  return {
    id: game?.id ?? item.id, sport,
    date: timestamp || null,
    league: { id: item.league?.id ?? null, name: item.league?.name || "Competicao", season: item.league?.season ?? null, country: typeof item.league?.country === "string" ? item.league.country : item.league?.country?.name || item.country?.name || "", logo: item.league?.logo || null },
    home: team(item.teams?.home), away: team(item.teams?.away),
    score: { home: score("home") ?? null, away: score("away") ?? null },
    phase: liveCodes.has(code) ? "live" : finishedCodes.has(code) ? "finished" : code === "NS" ? "scheduled" : "other",
    status: code, elapsed: status.elapsed ?? status.timer ?? null,
    venue: game?.venue?.name || game?.venue || "", round: item.league?.round || game?.week || item.week || "",
    periods: football ? item.score || {} : item.scores || {}
  };
}
export async function requestSportsData(sport, path, params) {
  const config = sports[sport];
  const key = apiKey(sport);
  if (!key) throw new Error("Chave da API-Sports nao configurada no servidor.");
  const url = new URL(path, `${config.host}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const cacheKey = `${sport}:${url}:${key}`;
  const saved = cache.get(cacheKey);
  if (saved && saved.expires > Date.now()) return saved.data;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const operation = (async () => {
    const response = await fetch(url, { headers: { "x-apisports-key": key, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 429 ? "Limite de consultas atingido. Aguarde antes de atualizar." : `API-Sports respondeu HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.errors && Object.keys(payload.errors).length) {
      const message = Object.values(payload.errors).join("; ");
      if (message.includes("Free plans do not have access to this season")) {
        const range = message.match(/try from (\d{4}) to (\d{4})/);
        throw new Error(`O plano gratuito da API-Sports bloqueia o histórico da temporada solicitada.${range ? ` A fonte permite temporadas de ${range[1]} a ${range[2]}.` : ""}`);
      }
      throw new Error(`API-Sports: ${message}`);
    }
    if (!Array.isArray(payload.response)) throw new Error("Resposta da fonte sem dados validos.");
    cache.set(cacheKey, { data: payload.response, expires: Date.now() + 300000 });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return payload.response;
  })();
  pending.set(cacheKey, operation);
  try { return await operation; } finally { pending.delete(cacheKey); }
}
const request = requestSportsData;
export async function getSportsEvents(sport, date) {
  if (!sports[sport]) throw new Error("Modalidade invalida.");
  if (!validDate(date)) throw new Error("Data invalida.");
  const config = sports[sport];
  if (!config.host) return {
    source: null, available: false, events: [],
    warning: `Fonte de dados para ${config.label} ainda nao configurada. Nenhum jogo de outra modalidade sera exibido.`
  };
  const params = { date, timezone: TIMEZONE };
  const data = await request(sport, config.path, params);
  return { source: "API-Sports", available: true, events: data.filter(item => sport !== "nfl" || item.league?.id === 1).map(item => normalizeSportsEvent(item, sport)).filter(item => item.id != null), warning: "" };
}
export async function getSportsDetails(sport, id) {
  if (!sports[sport]?.host || !/^\d+$/.test(id || "")) throw new Error("Partida invalida.");
  const config = sports[sport];
  const data = await request(sport, config.path, { id });
  if (!data.length) throw new Error("Partida nao encontrada.");
  const event = normalizeSportsEvent(data[0], sport);
  let statistics = [];
  let timeline = [];
  const warnings = [];
  const statPath = sport === "football" ? "fixtures/statistics" : "games/statistics/teams";
  const parameter = sport === "football" ? { fixture: id } : { id };
  try { statistics = await request(sport, statPath, parameter); }
  catch (error) { warnings.push(error.message); }
  if (sport === "football") {
    try { timeline = await request(sport, "fixtures/events", { fixture: id }); }
    catch (error) { warnings.push(error.message); }
  }
  statistics = statistics.map(item => ({ ...item, team: { ...item.team, name: item.team?.name || [event.home, event.away].find(team => team.id === item.team?.id)?.name || "Equipe" } }));
  return { event, statistics, timeline, warning: warnings.join(" ") };
}

export function summarizeTeamHistory(history, teamId, before, excludeId) {
  const completed = history.filter(event => event.phase === "finished"
    && String(event.id) !== String(excludeId)
    && new Date(event.date).getTime() < before
    && (event.home.id === teamId || event.away.id === teamId)
    && Number.isFinite(event.score.home) && Number.isFinite(event.score.away))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  function summarize(games) {
    let wins = 0, draws = 0, losses = 0, scored = 0, conceded = 0;
    for (const game of games) {
      const home = game.home.id === teamId;
      const own = home ? game.score.home : game.score.away;
      const against = home ? game.score.away : game.score.home;
      scored += own; conceded += against;
      if (own > against) wins++; else if (own === against) draws++; else losses++;
    }
    return { games: games.length, wins, draws, losses, scored, conceded,
      scoredAverage: games.length ? Number((scored / games.length).toFixed(2)) : null,
      concededAverage: games.length ? Number((conceded / games.length).toFixed(2)) : null,
      matches: games };
  }
  return { overall: summarize(completed.slice(0, 10)), home: summarize(completed.filter(game => game.home.id === teamId).slice(0, 10)), away: summarize(completed.filter(game => game.away.id === teamId).slice(0, 10)) };
}

export async function getSportsResearch(sport, id) {
  if (!sports[sport]?.host || !/^\d+$/.test(id || "")) throw new Error("Partida invalida.");
  const config = sports[sport];
  const fixtures = await request(sport, config.path, { id });
  if (!fixtures.length) throw new Error("Partida nao encontrada.");
  const event = normalizeSportsEvent(fixtures[0], sport);
  const before = Math.min(Date.now(), new Date(event.date).getTime());
  if (!Number.isFinite(before)) throw new Error("Data da partida indisponivel para consultar historico.");
  const warnings = [];
  const sources = [{ id: "context", label: "Dados do confronto", url: `${config.host}/${config.path}?id=${id}` }];
  const histories = {};
  for (const side of ["home", "away"]) {
    const participant = event[side];
    const sourceId = `${side}-recent`;
    if (!participant.id || !event.league.season) {
      histories[side] = null;
      warnings.push(`Historico de ${participant.name}: equipe ou temporada nao informada pela fonte.`);
      continue;
    }
    const params = { team: participant.id, season: event.league.season, timezone: TIMEZONE };
    try {
      const items = await request(sport, config.path, params);
      histories[side] = items.map(item => normalizeSportsEvent(item, sport));
      sources.push({ id: sourceId, label: `Historico de ${participant.name} · temporada ${event.league.season}`, url: `${config.host}/${config.path}?${new URLSearchParams(params)}` });
    } catch (error) {
      histories[side] = null;
      warnings.push(`${participant.name}: ${error.message}`);
    }
  }
  let h2h = [];
  let h2hScope = "temporada consultada";
  if (sport === "football" && event.home.id && event.away.id) {
    const params = { h2h: `${event.home.id}-${event.away.id}`, timezone: TIMEZONE };
    try {
      h2h = (await request(sport, "fixtures/headtohead", params)).map(item => normalizeSportsEvent(item, sport));
      h2hScope = "historico disponibilizado pela fonte";
      sources.push({ id: "head-to-head", label: "Confrontos diretos", url: `${config.host}/fixtures/headtohead?${new URLSearchParams(params)}` });
    } catch (error) { warnings.push(`Confrontos diretos: ${error.message}`); }
  }
  if (h2hScope === "temporada consultada") {
    const unique = new Map([...(histories.home || []), ...(histories.away || [])].map(game => [game.id, game]));
    h2h = [...unique.values()].filter(game => [game.home.id, game.away.id].includes(event.home.id) && [game.home.id, game.away.id].includes(event.away.id));
  }
  h2h = h2h.filter(game => [game.home.id, game.away.id].includes(event.home.id) && [game.home.id, game.away.id].includes(event.away.id)
    && game.phase === "finished" && String(game.id) !== String(id) && new Date(game.date).getTime() < before && Number.isFinite(game.score.home) && Number.isFinite(game.score.away))
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  let injuries = null;
  if (sport === "football") {
    try {
      injuries = (await request(sport, "injuries", { fixture: id })).map(item => ({ team: item.team?.name || "Equipe", player: item.player?.name || "Jogador", type: item.player?.type || "", reason: item.player?.reason || "" }));
      sources.push({ id: "injuries", label: "Ausencias relacionadas ao confronto", url: `${config.host}/injuries?fixture=${id}` });
    } catch (error) { warnings.push(`Ausencias: ${error.message}`); }
  }
  return { event, before: new Date(before).toISOString(), season: event.league.season,
    home: histories.home ? summarizeTeamHistory(histories.home, event.home.id, before, id) : null,
    away: histories.away ? summarizeTeamHistory(histories.away, event.away.id, before, id) : null,
    h2h, h2hScope, injuries, sources, warnings, consultedAt: new Date().toISOString() };
}
