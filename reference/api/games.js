import { analyzeFixtures, publicGame } from "./_lib/scanner.js";
import { fetchTotalCornerToday, fetchTotalCornerDate, totalCornerRowsToFixtures } from "./_lib/totalCorner.js";
import { validDate } from '../../sports-data.mjs';
const cache = new Map();
const pending = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(JSON.stringify(body));
}

function addTotalCornerStats(game, source) {
  const stats = [];
  if (source?.totalCorner) {
    stats.push(`TOTALCORNER | Escanteios | ${source.totalCorner.homeCorners}-${source.totalCorner.awayCorners}`);
    stats.push(`TOTALCORNER | Linha escanteios | ${Number(source.totalCorner.cornerLine || 0).toFixed(1)}`);
    if (source.totalCorner.goalLine) {
      stats.push(`TOTALCORNER | Linha gols | ${Number(source.totalCorner.goalLine || 0).toFixed(1)}`);
    }
    if (source.totalCorner.handicapLine !== null && source.totalCorner.handicapLine !== undefined) {
      const line = Number(source.totalCorner.handicapLine || 0);
      stats.push(`TOTALCORNER | Handicap | Mandante ${line > 0 ? "+" : ""}${line}`);
    }
  }

  return {
    ...game,
    dadosJogo: [
      `DADO | Gols no jogo | ${game.totalGoals}`,
      `DADO | Tempo/status | ${game.liveStatus || "-"}`,
      `DADO | Escanteios ao vivo | ${game.liveCorners}`,
      "DADO | Fonte ao vivo | TotalCorner"
    ],
    stats: [...stats, ...(game.stats || [])]
  };
}

async function fetchTotalCornerGames(dates = []) {
  const totalCornerRows = [];
  if (dates.length) {
    for (const date of dates) totalCornerRows.push(...await fetchTotalCornerDate(date));
  } else totalCornerRows.push(...await fetchTotalCornerToday());
  const rows = totalCornerRowsToFixtures(totalCornerRows);
  const analyzedRows = analyzeFixtures({ response: rows });
  const games = analyzedRows.map((game) => {
    const source = rows.find((row) => String(row.fixture.id) === String(game.sourceId));
    return addTotalCornerStats(publicGame(game), source);
  });

  return {
    updatedAt: new Date().toISOString(),
    count: rows.length,
    marketRows: games.length,
    source: "TotalCorner",
    totalCornerCount: totalCornerRows.length,
    games
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const url = new URL(req.url, 'http://localhost');
    const start = url.searchParams.get('start'), end = url.searchParams.get('end') || start;
    const dates = [];
    if (start) {
      const days = (Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86400000;
      if (!validDate(start) || !validDate(end) || days < 0 || days > 30) return send(res, 400, { error: 'Selecione um periodo valido de ate 31 dias.' });
      for (let i = 0; i <= days; i++) dates.push(new Date(Date.parse(start + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10));
    }
    const key = dates.join(',') || 'live';
    const saved = cache.get(key);
    if (saved?.expires > Date.now()) return send(res, 200, saved.data);
    if (!pending.has(key)) pending.set(key, fetchTotalCornerGames(dates));
    try {
      const data = await pending.get(key);
      cache.set(key, { data, expires: Date.now() + 60000 });
      while (cache.size > 32) cache.delete(cache.keys().next().value);
      send(res, 200, data);
    } finally { pending.delete(key); }
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar TotalCorner." });
  }
}
