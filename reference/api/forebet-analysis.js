import { enforceEntryTiming } from '../src/analysis/entryTiming.js';

const FOREBET_TODAY_URL = "https://www.forebet.com/en/football-tips-and-predictions-for-today/predictions-under-over-goals";
const FOREBET_DATE_URL = "https://www.forebet.com/en/football-predictions/under-over-25-goals";
const FOREBET_CORNERS_TODAY_URL = "https://www.forebet.com/en/football-tips-and-predictions-for-today/corners";
const FOREBET_CORNERS_DATE_URL = "https://www.forebet.com/en/football-predictions/corners";

const MARKET_LABELS = {
  over05: "+0.5 gols",
  over15: "+1.5 gols",
  over25: "+2.5 gols",
  corners: "Escanteios",
  ml: "ML"
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

function parseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function getSaoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateRange(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end || start}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [start];

  const days = [];
  const current = new Date(startDate);
  while (current <= endDate && days.length < 7) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function forebetReaderUrl(date, type = "goals") {
  const today = getSaoPauloDate();
  const sourceUrl = type === "corners"
    ? (date === today ? FOREBET_CORNERS_TODAY_URL : `${FOREBET_CORNERS_DATE_URL}/${date}`)
    : (date === today ? FOREBET_TODAY_URL : `${FOREBET_DATE_URL}/${date}`);
  return `https://r.jina.ai/http://r.jina.ai/http://${sourceUrl}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function meaningfulTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !["club", "city", "team", "united", "football", "de"].includes(token));
}

function tokenScore(team, target) {
  const tokens = meaningfulTokens(team);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => target.includes(token)).length;
  return hits / tokens.length;
}

function marketFromForebet(prediction) {
  const avgGoals = Number(prediction.avgGoals || prediction.line || 0);
  const scoreGoals = String(prediction.correctScore || "")
    .split("-")
    .reduce((sum, part) => sum + Number(part.trim() || 0), 0);
  const total = Math.max(avgGoals, scoreGoals);

  if (total >= 2.8) return "over25";
  if (total >= 1.8) return "over15";
  return "over05";
}

function confidenceFromPrediction(prediction) {
  const overProb = Number(prediction.overProb || 0);
  const avgGoals = Number(prediction.avgGoals || 0);
  return Math.max(62, Math.min(92, Math.round(56 + overProb * 0.28 + Math.max(0, avgGoals - 2.5) * 8)));
}

function confidenceFromCorners(prediction) {
  const overProb = Number(prediction.overProb || 0);
  const avgCorners = Number(prediction.avgCorners || 0);
  return Math.max(62, Math.min(92, Math.round(54 + overProb * 0.32 + Math.max(0, avgCorners - 9.5) * 5)));
}

function winnerFromScore(score) {
  const [home, away] = String(score || "").split("-").map((part) => Number(part.trim()));
  if (!Number.isFinite(home) || !Number.isFinite(away)) return "";
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function mlLabel(pick, game) {
  if (pick === "home") return `Casa (${game.home})`;
  if (pick === "away") return `Fora (${game.away})`;
  if (pick === "draw") return "Empate";
  return "-";
}

function confidenceFromMl(prediction) {
  const pick = winnerFromScore(prediction.correctScore);
  const avgGoals = Number(prediction.avgGoals || 0);
  const base = pick === "draw" ? 62 : 68;
  return Math.max(60, Math.min(88, Math.round(base + Math.max(0, avgGoals - 2) * 5)));
}

function parseForebetGoals(markdown) {
  const items = [];
  const rowPattern = /\[([^\]\n]+?)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\]\((https:\/\/www\.forebet\.com\/en\/football\/matches\/[^)]+)\)\s*\n+\s*(\d{1,3})\s+(\d{1,3})\s*\n+\s*(Over|Under)\s+(\d+(?:\.\d+)?)\s*\n+\s*([0-9]\s*-\s*[0-9])\s*\n+\s*(\d+(?:\.\d+)?)/gi;

  let match = rowPattern.exec(markdown);
  while (match) {
    const [, teamsText, kickoffText, url, underProb, overProb, side, line, correctScore, avgGoals] = match;
    items.push({
      teamsText: teamsText.trim(),
      kickoffText,
      url,
      side,
      line: Number(line),
      underProb: Number(underProb),
      overProb: Number(overProb),
      correctScore: correctScore.replace(/\s+/g, ""),
      avgGoals: Number(avgGoals),
      type: "goals",
      normalized: normalizeText(`${teamsText} ${url}`)
    });
    match = rowPattern.exec(markdown);
  }

  return items;
}

function parseForebetCorners(markdown) {
  const items = [];
  const rowPattern = /\[([^\]\n]+?)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\]\((https:\/\/www\.forebet\.com\/en\/football\/matches\/[^)]+)\)\s*\n+\s*(\d{1,3})\s+(\d{1,3})\s*\n+\s*(Over|Under)\s+(\d+\s*-\s*\d+)\s*\n+\s*(\d+\s*-\s*\d+)\s*\n+\s*(\d+(?:\.\d+)?)/gi;

  let match = rowPattern.exec(markdown);
  while (match) {
    const [, teamsText, kickoffText, url, underProb, overProb, side, cornerPrediction, cornerScore, avgCorners] = match;
    items.push({
      teamsText: teamsText.trim(),
      kickoffText,
      url,
      side,
      cornerPrediction: cornerPrediction.replace(/\s+/g, ""),
      cornerScore: cornerScore.replace(/\s+/g, ""),
      avgCorners: Number(avgCorners),
      underProb: Number(underProb),
      overProb: Number(overProb),
      type: "corners",
      normalized: normalizeText(`${teamsText} ${url}`)
    });
    match = rowPattern.exec(markdown);
  }

  return items;
}

export async function fetchForebetPredictions(date, type = "goals") {
  const response = await fetch(forebetReaderUrl(date, type), {
    headers: {
      "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0",
      ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` } : {})
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) throw new Error(`Forebet retornou ${response.status}.`);
  const markdown = await response.text();
  const predictions = type === "corners" ? parseForebetCorners(markdown) : parseForebetGoals(markdown);
  if (!predictions.length) throw new Error("Forebet nao retornou previsoes legiveis.");
  return predictions.map((prediction) => ({ ...prediction, date }));
}

function findPrediction(game, predictions) {
  const home = normalizeText(game.home);
  const away = normalizeText(game.away);

  let best = null;
  for (const prediction of predictions) {
    const target = prediction.normalized;
    const direct = target.includes(home) && target.includes(away);
    const score = tokenScore(game.home, target) + tokenScore(game.away, target);
    if (direct || score >= 1.3) {
      if (!best || score > best.score) best = { prediction, score };
    }
  }

  return best?.prediction || null;
}

function applyForebet(games, goalPredictions, cornerPredictions) {
  const picks = new Map();
  const sourceMarkets = new Map();

  for (const game of games || []) {
    const sourceId = String(game.sourceId || "");
    if (!sourceId || sourceMarkets.get(sourceId)?.has("goals")) continue;

    const prediction = findPrediction(game, goalPredictions);
    if (!prediction || prediction.side !== "Over") continue;

    const market = marketFromForebet(prediction);
    picks.set(`${sourceId}-${market}`, { market, prediction, type: "goals" });
    if (!sourceMarkets.has(sourceId)) sourceMarkets.set(sourceId, new Set());
    sourceMarkets.get(sourceId).add("goals");
  }

  for (const game of games || []) {
    const sourceId = String(game.sourceId || "");
    if (!sourceId || game.market !== "ml") continue;

    const prediction = findPrediction(game, goalPredictions);
    const mlPick = winnerFromScore(prediction?.correctScore);
    if (!prediction || !mlPick) continue;

    picks.set(`${sourceId}-ml`, { market: "ml", prediction, type: "ml", mlPick });
  }

  for (const game of games || []) {
    const sourceId = String(game.sourceId || "");
    if (!sourceId || sourceMarkets.get(sourceId)?.has("corners")) continue;

    const prediction = findPrediction(game, cornerPredictions);
    if (!prediction || prediction.side !== "Over") continue;

    picks.set(`${sourceId}-corners`, { market: "corners", prediction, type: "corners" });
    if (!sourceMarkets.has(sourceId)) sourceMarkets.set(sourceId, new Set());
    sourceMarkets.get(sourceId).add("corners");
  }

  const analyzedGames = (games || []).map((game) => {
    const sourceId = String(game.sourceId || "");
    const pick = picks.get(`${sourceId}-${game.market}`);
    if (!pick) return game;

    const { prediction } = pick;
    if (pick.type === "ml") {
      const confidence = confidenceFromMl(prediction);
      return {
        ...game,
        marketLabel: MARKET_LABELS.ml,
        confidence,
        status: confidence >= 60 ? "Entrada" : "Observar",
        odd: game.odd || 0,
        mlPick: pick.mlPick,
        mlPickLabel: mlLabel(pick.mlPick, game),
        signals: [`ML ${mlLabel(pick.mlPick, game)}`],
        stats: [
          "FOREBET | Mercado | ML",
          `FOREBET | Vencedor previsto | ${mlLabel(pick.mlPick, game)}`,
          `FOREBET | Placar previsto | ${prediction.correctScore}`,
          `FOREBET | Base +2.5 media gols | ${prediction.avgGoals.toFixed(2)}`
        ]
      };
    }

    if (pick.type === "corners") {
      return {
        ...game,
        marketLabel: MARKET_LABELS[pick.market],
        confidence: confidenceFromCorners(prediction),
        status: "Entrada",
        odd: game.odd || 0,
        signals: ["Over 9.5 escanteios"],
        stats: [
          "FOREBET | Mercado | Escanteios",
          `FOREBET | Previsao | ${prediction.side} 9.5 cantos`,
          `FOREBET | Cantos previstos | ${prediction.cornerPrediction}`,
          `FOREBET | Media de cantos | ${prediction.avgCorners.toFixed(2)}`
        ]
      };
    }

    return {
      ...game,
      marketLabel: MARKET_LABELS[pick.market],
      confidence: confidenceFromPrediction(prediction),
      status: "Entrada",
      odd: game.odd || 0,
      stats: [
        `FOREBET | Mercado | ${MARKET_LABELS[pick.market]}`,
        `FOREBET | Previsao | ${prediction.side} ${prediction.line.toFixed(2)}`,
        `FOREBET | Placar previsto | ${prediction.correctScore}`,
        `FOREBET | Media de gols | ${prediction.avgGoals.toFixed(2)}`
      ]
    };
  });

  return {
    analyzedGames: analyzedGames.map(enforceEntryTiming),
    picksCount: picks.size,
    goalsCount: [...picks.values()].filter((pick) => pick.type === "goals").length,
    cornersCount: [...picks.values()].filter((pick) => pick.type === "corners").length
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const body = readBody(req);
    const games = Array.isArray(body.games) ? body.games : [];
    const start = parseDate(body.start) || getSaoPauloDate();
    const end = parseDate(body.end) || start;
    const days = dateRange(start, end);
    const goalsSettled = await Promise.allSettled(days.map((date) => fetchForebetPredictions(date, "goals")));
    const cornersSettled = await Promise.allSettled(days.map((date) => fetchForebetPredictions(date, "corners")));
    const goalPredictions = goalsSettled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    const cornerPredictions = cornersSettled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    if (!goalPredictions.length && !cornerPredictions.length) {
      const reason = [...goalsSettled, ...cornersSettled].find((entry) => entry.status === "rejected")?.reason?.message;
      throw new Error(reason || "Forebet nao retornou previsoes legiveis.");
    }
    const { analyzedGames, picksCount, goalsCount, cornersCount } = applyForebet(games, goalPredictions, cornerPredictions);

    send(res, 200, {
      games: analyzedGames,
      forebetCount: picksCount,
      forebetGoalsCount: goalsCount,
      forebetCornersCount: cornersCount,
      sourceCount: goalPredictions.length + cornerPredictions.length,
      sourceGoalsCount: goalPredictions.length,
      sourceCornersCount: cornerPredictions.length,
      source: "Forebet",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar Forebet." });
  }
}
