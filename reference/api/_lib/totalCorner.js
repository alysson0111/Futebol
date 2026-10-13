const TOTALCORNER_TODAY_URL = "https://www.totalcorner.com/pt/match/today";
const TOTALCORNER_ENDED_URL = `${TOTALCORNER_TODAY_URL}/ended`;

function totalCornerDateUrl(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error("Data de resultados invalida.");
  return `https://www.totalcorner.com/pt/match/schedule/${dateIso.replaceAll("-", "")}`;
}

function readerUrl(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `https://r.jina.ai/${url}${separator}_=${Date.now()}`;
}

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTeam(value) {
  return cleanLine(value)
    .replace(/\d{1,3}(?:\+\d{1,2})?['\u2019]\s*$/, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

function normalizeTeam(value) {
  return cleanTeam(value)
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

function isScoreLine(value) {
  return /^\d+\s*-\s*\d+$/.test(cleanLine(value));
}

function parseScorePair(value) {
  const match = cleanLine(value).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return { home: asNumber(match[1]), away: asNumber(match[2]) };
}

function parseCornerLine(value) {
  const match = cleanLine(value).match(/^(\d+(?:\.\d+)?)/);
  return match ? asNumber(match[1]) : 0;
}

function parseFirstNumber(value) {
  const match = cleanLine(value).match(/(\d+(?:\.\d+)?)/);
  return match ? asNumber(match[1]) : 0;
}

function parseGoalLine(value) {
  const line = parseFirstNumber(value);
  return line > 0 && line <= 6 ? line : 0;
}

function parseHandicapLine(value) {
  const match = cleanLine(value).match(/([+-]?\d+(?:\.\d+)?)\s*(?:\([^)]+\))?\s*$/);
  return match ? asNumber(match[1]) : null;
}

function stripMarkdownImages(value) {
  return String(value || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
}

function parseBlock(block) {
  const lines = String(block || "").split("\n").map(cleanLine).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^\d{2}:\d{2}\s+/.test(line));
  if (headerIndex <= 0) return null;

  const header = lines[headerIndex];
  const scoreMatch = header.match(/^(.*?)\s+(\d+)\s*-\s*(\d+)\s+(.*)$/);
  if (!scoreMatch) return null;

  const beforeScore = scoreMatch[1];
  const afterScoreRaw = scoreMatch[4];
  const handicapLine = parseHandicapLine(afterScoreRaw);
  const afterScore = afterScoreRaw.replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s*\([^)]+\))?\s*$/, "");
  const timeMatch = beforeScore.match(/^(\d{2}:\d{2})(?:\s+(\d{1,3}|Intervalo|Integral|Fim|Full(?:-time)?|HT|FT))?\s+(.+)$/i);
  if (!timeMatch) return null;

  const cornerIndex = lines.findIndex((line, index) => index > headerIndex && isScoreLine(line));
  const corners = cornerIndex >= 0 ? parseScorePair(lines[cornerIndex]) : null;

  const cornerLine = corners ? parseCornerLine(lines.slice(cornerIndex + 1).find((line) => !/^\(/.test(line) && /^\d/.test(line))) : 0;

  return {
    league: lines[headerIndex - 1],
    time: timeMatch[1],
    status: timeMatch[2] || "",
    home: cleanTeam(timeMatch[3]),
    away: cleanTeam(afterScore),
    homeGoals: asNumber(scoreMatch[2]),
    awayGoals: asNumber(scoreMatch[3]),
    homeCorners: corners?.home ?? null,
    awayCorners: corners?.away ?? null,
    liveCorners: corners ? corners.home + corners.away : null,
    handicapLine,
    cornerLine,
    source: "TotalCorner"
  };
}

function parseCompactRecord(record) {
  const text = String(record || "").replace(/\s+/g, " ").trim();
  if (text.includes("|")) return null;
  const teamMatches = [
    ...text.matchAll(/\[([^\]]+)\]\(https:\/\/www\.totalcorner\.com\/pt\/team\/view\/[^)]*\)/g)
  ];
  if (teamMatches.length < 2) return null;

  const homeMatch = teamMatches[0];
  const awayMatch = teamMatches[1];
  const homeEnd = homeMatch.index + homeMatch[0].length;
  const awayEnd = awayMatch.index + awayMatch[0].length;
  const beforeHome = stripMarkdownImages(text.slice(0, homeMatch.index)).replace(/\s+/g, " ").trim();
  const betweenTeams = text.slice(homeEnd, awayMatch.index);
  const afterAway = stripMarkdownImages(text.slice(awayEnd))
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const timeMatch = beforeHome.match(/(\d{2}:\d{2})(?:\s+(\d{1,3}|Intervalo|Integral|Fim|Full(?:-time)?|HT|FT))?/i);
  const goalsMatch = betweenTeams.match(/(\d+)\s*-\s*(\d+)/);
  if (!timeMatch || !goalsMatch) return null;

  const handicapMatches = [...afterAway.matchAll(/([+-]\d+(?:\.\d+)?|0\.0)(?:\s*\([^)]+\))?/g)];
  const handicapMatch = handicapMatches[0] || null;
  const handicapLine = handicapMatch ? asNumber(handicapMatch[1]) : null;
  const afterHandicap = handicapMatch
    ? afterAway.slice(handicapMatch.index + handicapMatch[0].length)
    : afterAway;
  const cornersMatch = afterHandicap.match(/(\d+)\s*-\s*(\d+)/);
  const afterCorners = cornersMatch ? afterHandicap
    .slice(cornersMatch.index + cornersMatch[0].length)
    .replace(/^\s*\([^)]*\)\s*/, "") : "";
  const cornerLineMatch = cleanLine(afterCorners).match(/^(\d+(?:\.\d+)?)(?:\s*\([^)]+\))?/);
  const afterCornerLine = cornerLineMatch ? cleanLine(afterCorners).slice(cornerLineMatch[0].length) : "";

  return {
    league: "TotalCorner",
    time: timeMatch[1],
    status: timeMatch[2] || "",
    home: cleanTeam(homeMatch[1]),
    away: cleanTeam(awayMatch[1]),
    homeGoals: asNumber(goalsMatch[1]),
    awayGoals: asNumber(goalsMatch[2]),
    homeCorners: cornersMatch ? asNumber(cornersMatch[1]) : null,
    awayCorners: cornersMatch ? asNumber(cornersMatch[2]) : null,
    liveCorners: cornersMatch ? asNumber(cornersMatch[1]) + asNumber(cornersMatch[2]) : null,
    handicapLine,
    cornerLine: parseCornerLine(afterCorners),
    goalLine: parseGoalLine(afterCornerLine),
    source: "TotalCorner"
  };
}

function parseCompactRows(markdown) {
  const records = [
    ...String(markdown || "").matchAll(
      /!\[Image\s+\d+[^\]]*\]\(https:\/\/static\.totalcorner\.com\/img\/countries\/[^)]*\)([\s\S]*?)(?=!\[Image\s+\d+[^\]]*\]\(https:\/\/static\.totalcorner\.com\/img\/countries\/|Para usar nossos dados|$)/g
    )
  ];
  return records.map((match) => parseCompactRecord(match[1])).filter((row) => row && row.home && row.away);
}

function parseMarkdownTableRows(markdown) {
  return String(markdown || "").split("\n").filter((line) => line.includes("|")).map((line) => {
    const rawCells = line.split("|");
    const cells = rawCells.map((cell) => cleanLine(stripMarkdownImages(cell)));
    const scoreIndex = cells.findIndex((cell) => isScoreLine(cell));
    const timeIndex = cells.findIndex((cell) => /^\d{2}:\d{2}$/.test(cell));
    if (scoreIndex < 2 || timeIndex < 0 || timeIndex >= scoreIndex - 1) return null;
    const goals = parseScorePair(cells[scoreIndex]);
    const linkedTeam = (index) => rawCells[index]?.match(/\[([^\]]+)\]\([^)]*\/team\/view\/[^)]*\)/)?.[1];
    const home = cleanTeam(linkedTeam(scoreIndex - 1) || cells[scoreIndex - 1]);
    const away = cleanTeam(linkedTeam(scoreIndex + 1) || cells[scoreIndex + 1]);
    if (!home || !away) return null;
    const statusCell = cells.slice(timeIndex + 1, scoreIndex - 1).join(" ").trim();
    const status = statusCell.match(/^(Integral|Fim|Full(?:-time)?|FT|HT|Intervalo|\d{1,3})\b/i)?.[1] || "";
    const cornersMatch = String(cells[scoreIndex + 3] || "").match(/^(\d+)\s*-\s*(\d+)/);
    return {
      league: cells.slice(0, timeIndex).filter(Boolean).at(-1) || "TotalCorner",
      time: cells[timeIndex], status, home, away,
      homeGoals: goals.home, awayGoals: goals.away,
      homeCorners: cornersMatch ? Number(cornersMatch[1]) : null,
      awayCorners: cornersMatch ? Number(cornersMatch[2]) : null,
      liveCorners: cornersMatch ? Number(cornersMatch[1]) + Number(cornersMatch[2]) : null,
      handicapLine: parseHandicapLine(String(cells[scoreIndex + 2] || "").replace(/\s*\([^)]*\)\s*$/, "")),
      cornerLine: parseCornerLine(cells[scoreIndex + 4]),
      goalLine: parseGoalLine(cells[scoreIndex + 5]),
      source: "TotalCorner"
    };
  }).filter(Boolean);
}

function getSaoPauloDateText() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function getSaoPauloDateIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function statusInfo(status) {
  const value = cleanLine(status);
  if (/^\d{1,3}$/.test(value)) return { elapsed: asNumber(value), short: "LIVE", liveStatus: `${value}'` };
  if (/^Intervalo|HT$/i.test(value)) return { elapsed: 45, short: "HT", liveStatus: "HT" };
  if (/^(Integral|Fim|Full(?:-time)?|FT)$/i.test(value)) return { elapsed: 90, short: "FT", liveStatus: "FT" };
  return { elapsed: 0, short: value ? "LIVE" : "NS", liveStatus: value || "Pre-jogo" };
}

export function totalCornerRowsToFixtures(rows) {
  const today = getSaoPauloDateIso();
  return (rows || []).map((row) => {
    const status = statusInfo(row.status);
    const cornersAvailable = row.homeCorners != null && row.awayCorners != null;
    return {
      fixture: {
        id: `totalcorner-${row.league}-${row.home}-${row.away}-${row.time}`,
        date: `${row.dateIso || today}T${String(row.time || "00:00").padStart(5, "0")}:00-03:00`,
        status: { elapsed: status.elapsed, short: status.short }
      },
      teams: {
        home: { name: row.home },
        away: { name: row.away }
      },
      league: { name: row.league || "TotalCorner" },
      goals: { home: row.homeGoals || 0, away: row.awayGoals || 0 },
      displayTime: row.time || "--:--",
      liveStatus: status.liveStatus,
      source: "TotalCorner",
      cornersAvailable,
      totalCorner: row,
      handicapLine: row.handicapLine,
      handicapSignal: row.handicapLine === null ? "" : `Handicap mandante ${row.handicapLine > 0 ? "+" : ""}${row.handicapLine}`,
      goalLine: row.goalLine || 0,
      totalCornerGoalLine: row.goalLine || 0,
      avgCornersTotal: row.cornerLine || row.liveCorners,
      mediaEscanteiosConjunta: row.cornerLine || row.liveCorners,
      liveStats: cornersAvailable ? [
        { team: { name: row.home }, statistics: [{ type: "Corner Kicks", value: row.homeCorners }] },
        { team: { name: row.away }, statistics: [{ type: "Corner Kicks", value: row.awayCorners }] }
      ] : [],
      totalCornerDateText: getSaoPauloDateText()
    };
  });
}

function parseTotalCornerMarkdownLegacy(markdown) {
  const text = String(markdown || "");
  const footerIndex = text.indexOf("Para usar nossos dados");
  const section = footerIndex > 0 ? text.slice(0, footerIndex) : text;
  return section
    .split(/Estatísticas Cotas Ao vivo/i)
    .map(parseBlock)
    .filter((row) => row && row.home && row.away);
}

function parseTabSeparatedRows(markdown) {
  const lines = String(markdown || "").split("\n");
  const headers = lines.flatMap((line, index) => /^\s*\d{2}:\d{2}\t/.test(line) ? [index] : []);
  return headers.map((index, position) => {
    const league = lines.slice(0, index).map(cleanLine).filter(Boolean).at(-1) || "TotalCorner";
    const end = headers[position + 1] ?? lines.length;
    return parseBlock([league, ...lines.slice(index, end)].join("\n"));
  }).filter(Boolean);
}

export function parseTotalCornerMarkdown(markdown) {
  const text = String(markdown || "");
  const footerIndex = text.indexOf("Para usar nossos dados");
  const section = footerIndex > 0 ? text.slice(0, footerIndex) : text;
  const tableRows = parseTotalCornerMarkdownLegacy(section);
  const combined = [...parseMarkdownTableRows(section), ...parseTabSeparatedRows(section), ...tableRows, ...parseCompactRows(section)];
  const seen = new Set();
  return combined.filter((row) => {
    const key = `${row.home}|${row.away}|${row.time}|${row.status}|${row.homeGoals}|${row.awayGoals}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findTotalCornerMatch(row, totalCornerRows) {
  let best = null;
  let bestScore = 0;

  for (const candidate of totalCornerRows) {
    const homeScore = teamScore(row.teams?.home?.name, candidate.home);
    const awayScore = teamScore(row.teams?.away?.name, candidate.away);
    const score = (homeScore + awayScore) / 2;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

export function mergeTotalCornerRows(rows, totalCornerRows) {
  return (rows || []).map((row) => {
    const match = findTotalCornerMatch(row, totalCornerRows || []);
    if (!match) return row;

    return {
      ...row,
      totalCorner: match,
      handicapLine: match.handicapLine,
      handicapSignal: match.handicapLine === null ? "" : `Handicap mandante ${match.handicapLine > 0 ? "+" : ""}${match.handicapLine}`,
      goalLine: match.goalLine || 0,
      totalCornerGoalLine: match.goalLine || 0,
      avgCornersTotal: match.cornerLine || match.liveCorners,
      mediaEscanteiosConjunta: match.cornerLine || match.liveCorners,
      liveStats: [
        { team: row.teams?.home, statistics: [{ type: "Corner Kicks", value: match.homeCorners }] },
        { team: row.teams?.away, statistics: [{ type: "Corner Kicks", value: match.awayCorners }] }
      ]
    };
  });
}

export function resultPageLinks(markdown, dateIso, sourceUrl = totalCornerDateUrl(dateIso)) {
  const base = new URL(sourceUrl);
  const links = new Set();
  const hrefs = [...String(markdown).matchAll(/\]\(([^\s)]+)\)/g)].map(match=>match[1]);
  hrefs.push(...[...String(markdown).matchAll(/https:\/\/www\.totalcorner\.com\/[^\s)<>]+/g)].map(match=>match[0]));
  for (const href of hrefs) {
    let url;
    try { url = new URL(href, base); url.pathname=decodeURIComponent(url.pathname); } catch { continue; }
    if (url.origin !== base.origin || !(url.pathname === base.pathname || url.pathname.startsWith(base.pathname + '/'))) continue;
    const suffix = url.pathname.slice(base.pathname.length);
    if ((suffix && /^\/(?:page[:/]?)?\d+\/?$/.test(suffix)) || [...url.searchParams.keys()].some(key => /^(page|p|offset)$/i.test(key))) links.add(url.href);
  }
  return [...links].slice(0, 8);
}

async function fetchTotalCornerPage(url, expectedDate, sourceUrl = url, deadline = Date.now()+20000) {
  const response = await fetch(readerUrl(url), {
    signal: AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now()))),
    headers: {
      "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "X-No-Cache": "true",
      "X-With-Links-Summary": "true",
      "X-Md-Link-Style": "inlined",
      ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` } : {})
    }
  });

  if (!response.ok) throw new Error(`TotalCorner retornou ${response.status}.`);
  const markdown = await response.text();
  const pageDates = markdown.split("\n").map(cleanLine).map((line) => line.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1]).filter(Boolean);
  if (expectedDate && !pageDates.includes(expectedDate)) {
    throw new Error(`TotalCorner nao confirmou a data ${expectedDate} na pagina de resultados.`);
  }
  return { rows: parseTotalCornerMarkdown(markdown), pages: expectedDate ? resultPageLinks(markdown, expectedDate, sourceUrl) : [] };
}

export async function fetchTotalCornerToday() {
  return (await fetchTotalCornerPage(TOTALCORNER_TODAY_URL)).rows;
}

export async function fetchTotalCornerDate(dateIso) {
  return fetchTotalCornerResultPages(totalCornerDateUrl(dateIso), dateIso);
}

async function fetchTotalCornerResultPages(sourceUrl, dateIso) {
  const deadline=Date.now()+45000;
  const first = await fetchTotalCornerPage(sourceUrl, dateIso, sourceUrl,deadline);
  const rows = [...first.rows];
  const errors = [];
  if(first.rows.length>=400&&!first.pages.length)errors.push('Agenda com 400 ou mais jogos sem links de paginacao: cobertura possivelmente incompleta.');
  const visited = new Set([sourceUrl]);
  let pages = first.pages;
  while (pages.length && visited.size <= 8) {
    if(Date.now()>=deadline){errors.push('Tempo de coleta esgotado: paginas restantes serao consultadas novamente.');break;}
    const batch = pages.filter(url => !visited.has(url)).slice(0, Math.min(4, 9 - visited.size));
    if (!batch.length) break;
    batch.forEach(url => visited.add(url));
    const responses = await Promise.allSettled(batch.map(url => fetchTotalCornerPage(url, dateIso, sourceUrl,deadline)));
    const results = responses.filter(result => result.status === 'fulfilled').map(result => result.value);
    responses.filter(result => result.status === 'rejected').forEach(result => errors.push(result.reason?.message || 'Falha em pagina adicional de resultados.'));
    results.forEach(page => rows.push(...page.rows));
    pages = [...pages, ...results.flatMap(page => page.pages)].filter(url => !visited.has(url));
  }
  const output = rows.map((row) => ({ ...row, dateIso }));
  output.coverageErrors = errors;
  return output;
}

export async function fetchTotalCornerResultsDate(dateIso) {
  // A relative "today" page is never used to settle historical signals.
  if (dateIso !== getSaoPauloDateIso()) return fetchTotalCornerDate(dateIso);
  const results = await Promise.allSettled([
    fetchTotalCornerResultPages(TOTALCORNER_ENDED_URL, dateIso),
    fetchTotalCornerDate(dateIso)
  ]);
  const rows = [];
  const errors = [];
  results.forEach((result, index) => {
    const label = index === 0 ? 'Jogos encerrados' : 'Agenda por data';
    if (result.status === 'rejected') errors.push(`${label}: ${result.reason?.message || 'Falha na consulta.'}`);
    else {
      rows.push(...result.value);
      errors.push(...result.value.coverageErrors.map(error => `${label}: ${error}`));
    }
  });
  if (results.every(result => result.status === 'rejected')) throw new Error(errors.join(' | '));
  rows.coverageErrors = errors;
  return rows;
}
