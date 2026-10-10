const BASE_URL = "https://external-api.kalshi.com/trade-api/v2";
const LEAGUES = ["BRASILEIRO", "BRASILEIROB", "ARGPREMDIV", "EPL", "LALIGA", "SERIEA", "SERIEB", "MLS", "USL", "LIGAMX", "EFLCHAMPIONSHIP"];
const DEFAULT_SERIES = LEAGUES.flatMap((league) => ["GAME", "TOTAL", "SPREAD", "CORNERS"].map((market) => `KX${league}${market}`));
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
let cache = { expiresAt: 0, markets: [] };
let pending;

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function gameDate(game) {
  const match = String(game.dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3].slice(2)}${MONTHS[Number(match[2]) - 1]}${match[1]}` : "";
}

function matchTeams(game, market) {
  const date = gameDate(game);
  if (!date || !String(market.event_ticker || "").split("-")[1]?.startsWith(date)) return false;
  const teams = String(market.rules_primary || "").match(/(?:in|of|wins) the (.+?) vs\.? (.+?) professional/i);
  if (!teams) return false;
  // Keep exact team identities: similar names can belong to different clubs.
  const home = normalize(game.home);
  const away = normalize(game.away);
  return (normalize(teams[1]) === home && normalize(teams[2]) === away)
    || (normalize(teams[1]) === away && normalize(teams[2]) === home);
}

function quoteSide(game, market) {
  const series = String(market.event_ticker || "").split("-")[0];
  const line = market.floor_strike == null ? NaN : Number(market.floor_strike);
  if (series.endsWith("TOTAL") && market.strike_type === "greater") {
    const lines = { over05: 0.5, over15: 1.5, over25: 2.5, under25: 2.5, under35: 3.5 };
    if (line === lines[game.market]) return game.market.startsWith("under") ? "no" : "yes";
  }
  if (series.endsWith("GAME") && game.market === "ml") {
    const pick = normalize(market.yes_sub_title);
    if (game.mlPick === "draw" && /^(tie|draw)$/.test(pick)) return "yes";
    if (game.mlPick === "home" && pick === normalize(game.home)) return "yes";
    if (game.mlPick === "away" && pick === normalize(game.away)) return "yes";
  }
  if (series.endsWith("CORNERS") && game.market === "corners" && market.strike_type === "greater") {
    const signal = game.signals?.length === 1 ? game.signals[0] : "";
    const match = String(signal).match(/^Over (\d+\.5) escanteios$/i);
    if (match && line === Number(match[1])) return "yes";
  }
  if (series.endsWith("SPREAD") && game.market === "handicap" && market.strike_type === "greater") {
    const handicap = game.handicapLine == null ? NaN : Number(game.handicapLine);
    // Binary contracts cannot reproduce refunds or Asian quarter-line settlement.
    if (!Number.isFinite(handicap) || Math.abs(handicap) % 1 !== 0.5) return "";
    const winner = normalize(String(market.yes_sub_title || "").split(/ wins by /i)[0]);
    if (handicap === -line && winner === normalize(game.home)) return "yes";
    if (handicap === line && winner === normalize(game.away)) return "no";
  }
  return "";
}

export function attachKalshiOdds(games, markets, now = Date.now()) {
  return games.map((game) => {
    const candidates = markets.filter((market) => {
      return ["active", "open"].includes(market.status)
        && Date.parse(market.close_time) > now && matchTeams(game, market);
    });
    for (const market of candidates) {
      const side = quoteSide(game, market);
      if (!side) continue;
      const price = Number(market[`${side}_ask_dollars`]);
      if (!(price > 0 && price < 1)) continue;
      return {
        ...game,
        odd: Number((1 / price).toFixed(2)),
        oddSource: "Kalshi",
        oddTicker: market.ticker,
        oddSide: side,
        oddFetchedAt: new Date(now).toISOString()
      };
    }
    return game;
  });
}

async function loadMarkets() {
  const series = [...new Set((process.env.KALSHI_SERIES_TICKERS || DEFAULT_SERIES.join(",")).split(",").map((value) => value.trim()).filter(Boolean))];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const markets = [];
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(6, series.length) }, async () => {
      while (next < series.length && !controller.signal.aborted) {
        const ticker = series[next++];
        let cursor = "";
        try {
          for (let page = 0; page < 3; page += 1) {
            const params = new URLSearchParams({ series_ticker: ticker, status: "open", limit: "1000" });
            if (cursor) params.set("cursor", cursor);
            const response = await fetch(`${BASE_URL}/markets?${params}`, { signal: controller.signal });
            if (!response.ok) break;
            const data = await response.json();
            markets.push(...(Array.isArray(data.markets) ? data.markets : []));
            cursor = data.cursor || "";
            if (!cursor) break;
          }
        } catch {
          // Odds are optional; a provider failure must not interrupt the games.
        }
      }
    }));
  } finally {
    clearTimeout(timeout);
  }
  cache = { markets, expiresAt: Date.now() + 30000 };
  return markets;
}

export async function enrichWithKalshiOdds(games) {
  if (!games.length) return games;
  if (cache.expiresAt <= Date.now()) {
    if (!pending) pending = loadMarkets().finally(() => { pending = null; });
    await pending;
  }
  return attachKalshiOdds(games, cache.markets);
}
