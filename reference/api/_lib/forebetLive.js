import { analyzeFixtures, publicGame } from "./scanner.js";
import { fetchTotalCornerToday, mergeTotalCornerRows } from "./totalCorner.js";

const FOREBET_LIVE_URL = "https://www.forebet.com/en/live-football-tips";
const FOREBET_LIVESCORE_URL = "https://www.forebet.com/en/livescore";

function forebetReaderUrl(url) {
  return `https://r.jina.ai/http://${url}`;
}

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSaoPauloDateText() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function parseAmericanDate(dateText, timeText) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return new Date();

  const timeMatch = String(timeText || "").match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  const [, first, second, year] = match;
  const hasAmPm = Boolean(timeMatch?.[3]);
  const day = hasAmPm ? second : first;
  const month = hasAmPm ? first : second;
  let hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const suffix = timeMatch?.[3] ? timeMatch[3].toUpperCase() : "";
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;

  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

function splitTeams(teamText) {
  const words = cleanLine(teamText).split(" ").filter(Boolean);
  if (words.length <= 1) return { home: cleanLine(teamText) || "Mandante", away: "Visitante" };

  const splitAt = Math.max(1, Math.floor(words.length / 2));
  return {
    home: words.slice(0, splitAt).join(" "),
    away: words.slice(splitAt).join(" ")
  };
}

function normalizeTeam(value) {
  return cleanLine(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|ac|ec|club|de|do|da|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamScore(left, right) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;
  const hits = [...aTokens].filter((token) => bTokens.has(token)).length;
  return hits / Math.max(aTokens.size, bTokens.size);
}

function findMatchingTip(livescoreRow, tipRows) {
  let best = null;
  let bestScore = 0;

  for (const tip of tipRows) {
    const homeScore = teamScore(livescoreRow.teams?.home?.name, tip.teams?.home?.name);
    const awayScore = teamScore(livescoreRow.teams?.away?.name, tip.teams?.away?.name);
    const score = (homeScore + awayScore) / 2;
    if (score > bestScore) {
      best = tip;
      bestScore = score;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

function mergeLivescoreWithTips(livescoreRows, tipRows) {
  return livescoreRows.map((row) => {
    const tip = findMatchingTip(row, tipRows);
    if (!tip) return row;

    return {
      ...tip,
      fixture: {
        ...tip.fixture,
        date: row.fixture?.date || tip.fixture?.date,
        status: row.fixture?.status || tip.fixture?.status
      },
      teams: row.teams,
      league: row.league,
      goals: tip.goals || row.goals,
      displayTime: row.displayTime,
      liveStatus: row.liveStatus,
      source: "Forebet Livescore"
    };
  });
}

function extractLeague(beforeMatch) {
  const matches = [...String(beforeMatch || "").matchAll(/!\[Image[^\]]*\]\([^)]*\)\s*([A-Za-z0-9]+)/g)];
  return matches.at(-1)?.[1] || "Forebet Live";
}

function extractSourceId(url, fallback) {
  const match = String(url || "").match(/-(\d+)(?:\?|$)/);
  return match ? match[1] : fallback;
}

function extractScore(chunk) {
  const text = String(chunk || "");
  const scoreMatch = text.match(/\*\*(\d+)\s*-\s*(\d+)\*\*/i)
    || text.match(/(?:^|\n)\s*(?:HT|FT|Live Pen\.|\+?\d{1,3}'?|\d{1,3})\s*\n+\s*(\d+)\s*-\s*(\d+)(?:\s*\(|\s*\n)/i);
  const homeGoals = asNumber(scoreMatch?.[1]);
  const awayGoals = asNumber(scoreMatch?.[2]);
  return {
    homeGoals,
    awayGoals,
    scoreText: scoreMatch ? `${homeGoals}x${awayGoals}` : "0x0"
  };
}

function extractStatus(chunk) {
  const lines = String(chunk || "").split("\n").map(cleanLine).filter(Boolean);
  const scoreIndex = lines.findIndex((line) => /^\d+\s*-\s*\d+/.test(line));
  const searchLines = scoreIndex > 0 ? lines.slice(0, scoreIndex).reverse() : lines.slice().reverse();
  const status = searchLines.find((line) => /^(HT|FT|Live Pen\.|\+?\d{1,3}'?|\d{1,3})$/i.test(line));
  if (!status) return { elapsed: 0, apiStatus: "NS", liveStatus: "Sem tempo" };
  if (/^HT$/i.test(status)) return { elapsed: 45, apiStatus: "HT", liveStatus: "HT" };
  if (/^FT$/i.test(status)) return { elapsed: 90, apiStatus: "FT", liveStatus: "FT" };
  if (/Live Pen\./i.test(status)) return { elapsed: 90, apiStatus: "PEN", liveStatus: "Penaltis" };

  const elapsed = asNumber(status.replace(/[^0-9]/g, ""));
  return { elapsed, apiStatus: "LIVE", liveStatus: elapsed ? `${elapsed}'` : "Live" };
}

function parseBrazilDate(dateText) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return new Date();
  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T12:00:00Z`);
}

function parseLiveScoreStatus(value) {
  const status = cleanLine(value);
  if (/^\d{1,3}$/.test(status)) {
    const elapsed = asNumber(status);
    return { elapsed, apiStatus: "LIVE", liveStatus: `${elapsed}'`, isLive: true };
  }
  if (/^HT$/i.test(status)) return { elapsed: 45, apiStatus: "HT", liveStatus: "HT", isLive: true };
  if (/^Pen\.?$/i.test(status)) return { elapsed: 90, apiStatus: "PEN", liveStatus: "Penaltis", isLive: true };
  return { elapsed: 0, apiStatus: status, liveStatus: status, isLive: false };
}

function isScoreStatus(value) {
  const status = cleanLine(value);
  return /^(\d{1,3}|HT|FT|Pen\.?|Postp\.|Cancl\.|\d{1,2}:\d{2})$/i.test(status);
}

function isLeagueLine(value) {
  const line = cleanLine(value);
  if (!line || isScoreStatus(line)) return false;
  if (/[[\]|#]/.test(line)) return false;
  if (/^(Livescore|Football predictions|June 2026|Featured match|Pick of the day|Top trends)$/i.test(line)) return false;
  return line.includes(":") || line.startsWith("World:");
}

function isTeamLine(value) {
  const line = cleanLine(value);
  if (!line || isScoreStatus(line) || isLeagueLine(line)) return false;
  if (/[[\]|#]/.test(line)) return false;
  if (/\b(TABLE|OVERALL|HOME|AWAY|NEXT|WINS|DRAWS|LOSSES|POINTS)\b/i.test(line)) return false;
  if (/^\d/.test(line) || line.length > 60) return false;
  return /[A-Za-zÀ-ÿ]/.test(line);
}

function parseLivescoreMarkdown(markdown) {
  const lines = String(markdown || "").split("\n").map(cleanLine).filter(Boolean);
  const rows = [];
  let league = "Forebet Livescore";

  for (let index = 0; index < lines.length - 2; index += 1) {
    const line = lines[index];
    if (isLeagueLine(line)) {
      league = line;
      continue;
    }

    const status = parseLiveScoreStatus(line);
    if (!status.isLive) continue;

    const home = lines[index + 1];
    const away = lines[index + 2];
    if (!isTeamLine(home) || !isTeamLine(away)) continue;

    const date = parseBrazilDate(getSaoPauloDateText());
    rows.push({
      fixture: {
        id: `${league}-${home}-${away}-${line}`,
        date: date.toISOString(),
        status: { elapsed: status.elapsed, short: status.apiStatus }
      },
      teams: {
        home: { name: home },
        away: { name: away }
      },
      league: { name: league },
      goals: { home: 0, away: 0 },
      forebetPrediction: "",
      forebetProbabilities: [0, 0, 0],
      forebetAvgGoals: 0,
      displayTime: "--:--",
      liveStatus: status.liveStatus,
      source: "Forebet Livescore"
    });
  }

  return rows;
}

function extractPrediction(chunk) {
  const lines = String(chunk || "").split("\n").map(cleanLine).filter(Boolean);
  const probIndex = lines.findIndex((line) => /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(line));
  const probabilities = probIndex >= 0 ? lines[probIndex].split(/\s+/).map(Number) : [0, 0, 0];
  const prediction = probIndex >= 0 ? lines[probIndex + 1] || "" : "";
  const avgGoals = probIndex >= 0 ? asNumber(lines[probIndex + 2]) : 0;

  return {
    probabilities,
    prediction: ["1", "X", "2"].includes(prediction) ? prediction : "",
    avgGoals
  };
}

function parseLiveMarkdown(markdown) {
  const sectionStart = markdown.indexOf("# Live football predictions");
  const rawSection = sectionStart >= 0 ? markdown.slice(sectionStart) : markdown;
  const endMarkers = ["### More predictions", "### Pick of the day", "### Top trends", "[All trends]"];
  const sectionEnd = endMarkers
    .map((marker) => rawSection.indexOf(marker))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  const section = sectionEnd ? rawSection.slice(0, sectionEnd) : rawSection;
  const matchPattern = /\[([^\]\n]+?\s+\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}(?:\s+[AP]M)?)\]\((https:\/\/www\.forebet\.com\/en\/football\/matches\/[^)]+)\)/gi;
  const matches = [...section.matchAll(matchPattern)];

  return matches.map((match, index) => {
    const [, title, url] = match;
    const next = matches[index + 1];
    const before = section.slice(Math.max(0, match.index - 180), match.index);
    const chunk = section.slice(match.index + match[0].length, next ? next.index : section.length);
    const titleMatch = title.match(/^(.*?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s+[AP]M)?)$/i);
    const teamsText = titleMatch?.[1] || title;
    const dateText = titleMatch?.[2] || "";
    const timeText = titleMatch?.[3] || "";
    const kickoff = parseAmericanDate(dateText, timeText);
    const { home, away } = splitTeams(teamsText);
    const { homeGoals, awayGoals, scoreText } = extractScore(chunk);
    const { elapsed, apiStatus, liveStatus } = extractStatus(chunk);
    const { probabilities, prediction, avgGoals } = extractPrediction(chunk);
    const sourceId = extractSourceId(url, `${home}-${away}-${dateText}-${timeText}`);

    return {
      fixture: {
        id: sourceId,
        date: kickoff.toISOString(),
        status: { elapsed, short: apiStatus }
      },
      teams: {
        home: { name: home },
        away: { name: away }
      },
      league: { name: extractLeague(before) },
      goals: { home: homeGoals, away: awayGoals },
      avgGoalsTotal: avgGoals || homeGoals + awayGoals,
      avgGoalsBothTeams: avgGoals || homeGoals + awayGoals,
      bttsPercent: Math.round(Math.min(100, Math.max(0, (probabilities[1] || 0) + (avgGoals || 0) * 8))),
      over25Percent: Math.round(Math.min(100, Math.max(0, (avgGoals || 0) * 24))),
      forebetPrediction: prediction,
      forebetProbabilities: probabilities,
      forebetAvgGoals: avgGoals,
      forebetUrl: url,
      liveStatus,
      source: "Forebet Live"
    };
  });
}

function addForebetStats(game, source) {
  const sourceName = source?.source === "Forebet Livescore" ? "Livescore" : "Ao vivo";
  const stats = [
    `FOREBET | Fonte | ${sourceName}`,
    `FOREBET | Previsao 1X2 | ${source?.forebetPrediction || "-"}`,
    `FOREBET | Probabilidades 1/X/2 | ${(source?.forebetProbabilities || []).join("/") || "-"}`,
    `FOREBET | Media de gols | ${Number(source?.forebetAvgGoals || 0).toFixed(2)}`
  ];
  if (source?.totalCorner) {
    stats.push(`TOTALCORNER | Escanteios | ${source.totalCorner.homeCorners}-${source.totalCorner.awayCorners}`);
    stats.push(`TOTALCORNER | Linha escanteios | ${Number(source.totalCorner.cornerLine || 0).toFixed(1)}`);
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
      ...(source?.totalCorner ? [`DADO | Escanteios ao vivo | ${game.liveCorners}`] : []),
      `DADO | Fonte ao vivo | ${source?.totalCorner ? "Forebet + TotalCorner" : "Forebet"}`
    ],
    stats: [...stats, ...(game.stats || []).filter((entry) => !String(entry).includes("API nao trouxe"))]
  };
}

export async function fetchForebetLiveGames() {
  const headers = {
    "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };
  const [liveScoreResponse, tipsResponse, totalCornerResult] = await Promise.all([
    fetch(forebetReaderUrl(FOREBET_LIVESCORE_URL), { headers }),
    fetch(forebetReaderUrl(FOREBET_LIVE_URL), { headers }),
    fetchTotalCornerToday().then((rows) => ({ ok: true, rows })).catch((error) => ({ ok: false, error }))
  ]);

  if (!liveScoreResponse.ok && !tipsResponse.ok) {
    throw new Error(`Forebet livescore retornou ${liveScoreResponse.status}; tips retornou ${tipsResponse.status}.`);
  }

  const livescoreRows = liveScoreResponse.ok ? parseLivescoreMarkdown(await liveScoreResponse.text()) : [];
  let tipRows = [];
  if (tipsResponse.ok) {
    tipRows = parseLiveMarkdown(await tipsResponse.text()).filter((row) => row.fixture?.status?.short !== "NS");
  }
  const forebetRows = livescoreRows.length ? mergeLivescoreWithTips(livescoreRows, tipRows) : tipRows;
  const rows = totalCornerResult.ok ? mergeTotalCornerRows(forebetRows, totalCornerResult.rows) : forebetRows;
  const games = analyzeFixtures({ response: rows }).map((game) => {
    const source = rows.find((row) => String(row.fixture.id) === String(game.sourceId));
    return addForebetStats(publicGame({
      ...game,
      liveStatus: source?.liveStatus || game.liveStatus
    }), source);
  });

  return {
    updatedAt: new Date().toISOString(),
    count: rows.length,
    marketRows: games.length,
    source: totalCornerResult.ok ? "Forebet Live + TotalCorner" : "Forebet Live",
    totalCornerCount: totalCornerResult.ok ? totalCornerResult.rows.length : 0,
    games,
    dateText: getSaoPauloDateText()
  };
}
