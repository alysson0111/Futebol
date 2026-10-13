import { isEntryTimingAllowed, isScoreTied, MIN_ENTRY_MINUTE } from '../../src/analysis/entryTiming.js';

const MARKETS = ["over05", "over15", "over25", "under25", "under35", "corners", "handicap", "ml"];

const MARKET_LABELS = {
  over05: "+0.5 gols",
  over15: "+1.5 gols",
  over25: "+2.5 gols",
  under25: "Under 2.5",
  under35: "Under 3.5 IA",
  corners: "Escanteios",
  handicap: "Handicap",
  ml: "ML"
};

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function asBool(value) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "sim";
}

function percent(value, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))));
}

function item(label, passed, value, available = true) {
  return { label, passed: Boolean(passed), value, available: Boolean(available) };
}

function summary(items) {
  return items.map((entry) => {
    if (!entry.available) return `SEM DADO | ${entry.label} | ${entry.value}`;
    return `${entry.passed ? "OK" : "NAO"} | ${entry.label} | ${entry.value}`;
  });
}

function result(game, patch, checks) {
  return {
    ...game,
    ...patch,
    scannerChecks: checks,
    stats: summary(checks)
  };
}

function mlLabel(pick, game) {
  if (pick === "home") return `Casa (${game.home})`;
  if (pick === "away") return `Fora (${game.away})`;
  if (pick === "draw") return "Empate";
  return "-";
}

function pickFromPrediction(prediction, probabilities = []) {
  if (prediction === "1") return "home";
  if (prediction === "2") return "away";
  if (String(prediction).toUpperCase() === "X") return "draw";

  const values = probabilities.map((value) => asNumber(value));
  if (values.length >= 3 && Math.max(...values) > 0) {
    const max = Math.max(...values);
    const index = values.indexOf(max);
    return index === 0 ? "home" : index === 1 ? "draw" : "away";
  }

  return "";
}

function scanMl(game) {
  const probabilities = Array.isArray(game.mlProbabilities) ? game.mlProbabilities.map((value) => asNumber(value)) : [];
  const handicapLine = Number(game.handicapLine);
  const hasHandicap = Number.isFinite(handicapLine);
  const hasTotalCorner = Boolean(game.totalCornerSource);
  const scoreGap = game.homeGoals - game.awayGoals;
  const elapsed = asNumber(game.elapsed);
  const goalLine = asNumber(game.goalLine || game.totalCornerGoalLine);
  const fromForebet = game.mlPick || pickFromPrediction(game.mlPrediction, probabilities);
  const fromHandicap = hasHandicap
    ? (handicapLine <= -0.25 ? "home" : handicapLine >= 0.25 ? "away" : "")
    : "";
  const fromScore = scoreGap > 0 ? "home" : scoreGap < 0 ? "away" : "";
  const drawLean = hasHandicap && Math.abs(handicapLine) <= 0.25 && scoreGap === 0 && goalLine > 0 && goalLine <= 2.75;
  const pick = fromForebet || fromHandicap || fromScore || (drawLean ? "draw" : "");
  const favoriteStrength = hasHandicap ? Math.abs(handicapLine) : 0;
  const favoriteBase = favoriteStrength >= 1.5 ? 76 : favoriteStrength >= 1 ? 72 : favoriteStrength >= 0.5 ? 66 : favoriteStrength >= 0.25 ? 61 : 0;
  const scoreBoost = pick && fromScore === pick ? Math.min(12, Math.abs(scoreGap) * 5 + (elapsed >= 60 ? 5 : 0)) : 0;
  const scorePenalty = pick && fromScore && fromScore !== pick ? 24 : 0;
  const drawConfidence = pick === "draw" ? (drawLean ? 62 : 0) : 0;
  const forebetConfidence = probabilities.length >= 3 ? Math.max(...probabilities) : asNumber(game.mlConfidence);
  const confidence = Math.max(forebetConfidence, drawConfidence, favoriteBase + scoreBoost - scorePenalty);
  const hasPrediction = Boolean(pick);
  const scoreConfirmsPick = elapsed === 0
    || !fromScore
    || fromScore === pick
    || (elapsed < 60 && favoriteStrength >= 0.75);
  const lateGameSafe = elapsed === 0 || elapsed < 70 || fromScore === pick;
  const timingOk = isEntryTimingAllowed(game);
  const tiedScore = isScoreTied(game);
  const passed = timingOk && tiedScore && hasTotalCorner && hasPrediction && confidence >= 68 && scoreConfirmsPick && lateGameSafe;
  const checks = [
    item(`Entrada a partir de ${MIN_ENTRY_MINUTE} minutos`, timingOk, game.liveStatus || game.apiStatus || "Minuto indisponivel"),
    item("Placar empatado para ML", tiedScore, game.scoreText || "Placar indisponivel"),
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Vencedor previsto", hasPrediction, mlLabel(pick, game), hasPrediction),
    item("Confianca ML >= 68%", confidence >= 68, confidence ? `${Math.round(confidence)}%` : "indisponivel", Boolean(confidence)),
    item("Linha handicap usada", hasHandicap, hasHandicap ? formatHandicapLine(handicapLine) : "indisponivel", hasHandicap),
    item("Placar confirma entrada", scoreConfirmsPick, game.scoreText || "-", true),
    item("Evita ML contra placar no fim", lateGameSafe, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Linha de gols como contexto", goalLine > 0, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine))
  ];

  return result(game, {
    confidence: passed ? Math.round(confidence) : 0,
    odd: game.mlOdd || game.odd || 0,
    status: passed ? "Entrada" : "Observar",
    grade: passed ? "IA ML" : "Descarta",
    statsPrefix: `IA ML ${passed ? "Aprovado" : "Descarta"} - ${mlLabel(pick, game)}`,
    mlPick: pick,
    mlPickLabel: mlLabel(pick, game),
    generatedSignals: passed ? [`ML ${mlLabel(pick, game)}`] : []
  }, checks);
}

function gameContext(game) {
  const elapsed = asNumber(game.elapsed);
  const goalLine = asNumber(game.goalLine || game.totalCornerGoalLine);
  const cornerPressure = Math.max(game.liveCorners, game.avgCornersTotal);
  const handicapAbs = Number.isFinite(Number(game.handicapLine)) ? Math.abs(Number(game.handicapLine)) : 0;
  const scoreGap = Math.abs(game.homeGoals - game.awayGoals);
  const hasTotalCorner = Boolean(game.totalCornerSource);
  return { elapsed, goalLine, cornerPressure, handicapAbs, scoreGap, hasTotalCorner };
}

function pointsOf(checks) {
  return checks.filter((entry) => entry.available && entry.passed).length;
}

function scanOver05(game) {
  if (game.totalGoals >= 1) {
    const checks = [
      item("Over 0.5 ainda precisa de gol", false, `${game.scoreText || game.totalGoals} ja bateu`, true)
    ];
    return result(game, {
      confidence: 0,
      odd: game.over05Odd || game.odd || 0,
      grade: "Descarta",
      status: "Observar",
      statsPrefix: "IA +0.5 Descarta (linha ja batida)"
    }, checks);
  }

  const { elapsed, goalLine, cornerPressure, handicapAbs, hasTotalCorner } = gameContext(game);
  const usefulMinute = isEntryTimingAllowed(game) && elapsed >= MIN_ENTRY_MINUTE && elapsed <= 70;
  const goalLineOk = goalLine >= 2;
  const pressureOk = cornerPressure >= 5;
  const noExtremeFavorite = handicapAbs <= 1.75;
  const checks = [
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Placar 0x0 para buscar primeiro gol", game.totalGoals === 0, game.scoreText || "-", true),
    item("Linha de gols favorece +0.5", goalLineOk, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine)),
    item("Minuto util para entrada (43 a 70)", usefulMinute, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Pressao minima por escanteios", pressureOk, `${cornerPressure.toFixed(1)}`, game.hasCorners),
    item("Sem favorito extremo travando jogo", noExtremeFavorite, Number.isFinite(Number(game.handicapLine)) ? formatHandicapLine(game.handicapLine) : "sem linha", true)
  ];
  const points = pointsOf(checks);
  const passed = hasTotalCorner && game.totalGoals === 0 && goalLineOk && usefulMinute && points >= 5;
  return result(game, {
    confidence: passed ? Math.min(86, 50 + points * 6) : 0,
    odd: game.over05Odd || game.odd || 0,
    grade: passed ? `IA ${points}/6` : "Descarta",
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA +0.5 ${passed ? "Aprovado" : "Descarta"} (${points}/6)`,
    generatedSignals: passed ? ["Over 0.5 gols"] : []
  }, checks);
}

function scanOver15(game) {
  if (game.totalGoals >= 2) {
    const checks = [
      item("Over 1.5 ainda precisa de gol", false, `${game.scoreText || game.totalGoals} ja bateu`, true)
    ];
    return result(game, {
      confidence: 0,
      odd: game.over15Odd || game.odd || 0,
      grade: "Descarta",
      status: "Observar",
      statsPrefix: "IA +1.5 Descarta (linha ja batida)"
    }, checks);
  }

  const { elapsed, goalLine, cornerPressure, handicapAbs, scoreGap, hasTotalCorner } = gameContext(game);
  const usefulMinute = elapsed >= 25 && elapsed <= 72;
  const goalLineOk = goalLine >= 2.5;
  const pressureOk = cornerPressure >= 6;
  const scoreOk = game.totalGoals <= 1 && scoreGap <= 1;
  const noExtremeFavorite = handicapAbs <= 2;
  const checks = [
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Linha de gols favorece +1.5", goalLineOk, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine)),
    item("Placar ainda precisa do mercado", scoreOk, game.scoreText || "-", true),
    item("Minuto util para entrada", usefulMinute, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Pressao por escanteios suficiente", pressureOk, `${cornerPressure.toFixed(1)}`, game.hasCorners),
    item("Sem favorito extremo", noExtremeFavorite, Number.isFinite(Number(game.handicapLine)) ? formatHandicapLine(game.handicapLine) : "sem linha", true)
  ];
  const points = pointsOf(checks);
  const passed = hasTotalCorner && goalLineOk && scoreOk && usefulMinute && points >= 5;
  const confidence = passed ? Math.min(88, 48 + points * 7 - game.totalGoals * 3) : 0;

  return result(game, {
    confidence,
    odd: game.over15Odd || game.odd || 0,
    grade: passed ? `IA ${points}/6` : "Descarta",
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA +1.5 ${passed ? "Aprovado" : "Descarta"} (${points}/6)`,
    generatedSignals: passed ? ["Over 1.5 gols"] : []
  }, checks);
}

function scanOver25(game) {
  if (game.totalGoals >= 3) {
    const checks = [
      item("Over 2.5 ainda precisa de gol", false, `${game.scoreText || game.totalGoals} ja bateu`, true)
    ];
    return result(game, {
      confidence: 0,
      odd: game.over25Odd || game.odd || 0,
      grade: "Descarta",
      status: "Observar",
      statsPrefix: "IA +2.5 Descarta (linha ja batida)"
    }, checks);
  }

  const { elapsed, goalLine, cornerPressure, handicapAbs, scoreGap, hasTotalCorner } = gameContext(game);
  const usefulMinute = elapsed === 0 || (elapsed >= 22 && elapsed <= 72);
  const goalLineOk = goalLine >= 2.75;
  const pressureOk = cornerPressure >= 6.5;
  const scoreOk = game.totalGoals >= 1 && game.totalGoals <= 2 && scoreGap <= 2;
  const noExtremeFavorite = handicapAbs <= 2;
  const checks = [
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Linha de gols favorece +2.5", goalLineOk, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine)),
    item("Placar vivo para buscar mais gols", scoreOk, game.scoreText || "-", true),
    item("Minuto util para entrada", usefulMinute, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Pressao por escanteios forte", pressureOk, `${cornerPressure.toFixed(1)}`, game.hasCorners),
    item("Sem favorito extremo", noExtremeFavorite, Number.isFinite(Number(game.handicapLine)) ? formatHandicapLine(game.handicapLine) : "sem linha", true)
  ];
  const points = pointsOf(checks);
  const passed = hasTotalCorner && goalLineOk && scoreOk && usefulMinute && pressureOk && points >= 5;
  return result(game, {
    confidence: passed ? Math.min(87, 46 + points * 7 + game.totalGoals * 2) : 0,
    odd: game.over25Odd || game.odd || 0,
    grade: passed ? `IA ${points}/6` : "Descarta",
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA +2.5 ${passed ? "Aprovado" : "Descarta"} (${points}/6)`,
    generatedSignals: passed ? ["Over 2.5 gols"] : []
  }, checks);
}

function scanUnder25(game) {
  if (game.totalGoals >= 3) {
    const checks = [
      item("Under 2.5 ainda possivel", false, `${game.scoreText || game.totalGoals} ja passou da linha`, true)
    ];
    return result(game, {
      confidence: 0,
      odd: game.under25Odd || game.odd || 0,
      grade: "Descarta",
      status: "Observar",
      statsPrefix: "CLASSIFICACAO Descarta (linha ja perdida)"
    }, checks);
  }

  const { elapsed, goalLine, cornerPressure, handicapAbs, scoreGap, hasTotalCorner } = gameContext(game);
  const usefulMinute = elapsed >= 35 && elapsed <= 78;
  const goalLineOk = goalLine > 0 && goalLine <= 2.75;
  const scoreOk = game.totalGoals <= 1 && scoreGap <= 1;
  const pressureControlled = cornerPressure <= 9.5;
  const noExtremeFavorite = handicapAbs <= 1.5;
  const checks = [
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Linha de gols aceita para Under 2.5", goalLineOk, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine)),
    item("Placar ainda protege o Under 2.5", scoreOk, game.scoreText || "-", true),
    item("Minuto util para entrada", usefulMinute, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Pressao por escanteios controlada", pressureControlled, `${cornerPressure.toFixed(1)}`, game.hasCorners),
    item("Sem favorito extremo no handicap", noExtremeFavorite, Number.isFinite(Number(game.handicapLine)) ? formatHandicapLine(game.handicapLine) : "sem linha", true),
    item("Jogo sem diferenca exagerada no placar", scoreGap <= 1, game.scoreText || "-", true)
  ];
  const points = pointsOf(checks);
  const passed = hasTotalCorner && goalLineOk && scoreOk && usefulMinute && points >= 6;
  const grade = passed ? `IA ${points}/7` : "Descarta";
  return result(game, {
    confidence: passed ? Math.min(88, 50 + points * 6 - game.totalGoals * 4) : 0,
    odd: game.under25Odd || game.odd || 0,
    grade,
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA Under 2.5 ${passed ? "Aprovado" : "Descarta"} (${points}/7)`,
    generatedSignals: passed ? ["Under 2.5 gols"] : []
  }, checks);
}

function scanUnder35(game) {
  if (game.totalGoals >= 4) {
    const checks = [
      item("Under 3.5 ainda possivel", false, `${game.scoreText || game.totalGoals} ja passou da linha`, true)
    ];
    return result(game, {
      confidence: 0,
      odd: game.under35Odd || game.odd || 0,
      grade: "Descarta",
      status: "Observar",
      statsPrefix: "IA Descarta (linha ja perdida)"
    }, checks);
  }

  const elapsed = asNumber(game.elapsed);
  const goalLine = asNumber(game.goalLine || game.totalCornerGoalLine);
  const cornerPressure = Math.max(game.liveCorners, game.avgCornersTotal);
  const handicapAbs = Number.isFinite(Number(game.handicapLine)) ? Math.abs(Number(game.handicapLine)) : 0;
  const scoreGap = Math.abs(game.homeGoals - game.awayGoals);
  const stillUsefulMinute = elapsed === 0 || (elapsed >= 10 && elapsed <= 82);
  const lowGoalState = game.totalGoals <= 2 || (game.totalGoals === 3 && elapsed >= 75);
  const controlledGoalLine = goalLine > 0 && goalLine <= 3.25;
  const noExtremeFavorite = !Number.isFinite(Number(game.handicapLine)) || handicapAbs <= 1.5;
  const scoreControlled = scoreGap <= 2;
  const pressureControlled = cornerPressure <= 10.5;
  const hasTotalCorner = Boolean(game.totalCornerSource);

  const checks = [
    item("IA confrontou dados do TotalCorner", hasTotalCorner, hasTotalCorner ? "ok" : "indisponivel", hasTotalCorner),
    item("Linha de gols aceita para Under 3.5", controlledGoalLine, goalLine ? goalLine.toFixed(2) : "indisponivel", Boolean(goalLine)),
    item("Placar ainda protege o Under 3.5", lowGoalState, game.scoreText || "-", true),
    item("Minuto util para entrada", stillUsefulMinute, elapsed ? `${elapsed}'` : game.apiStatus || "-", true),
    item("Pressao por escanteios controlada", pressureControlled, `${cornerPressure.toFixed(1)}`, game.hasCorners),
    item("Sem favorito extremo no handicap", noExtremeFavorite, Number.isFinite(Number(game.handicapLine)) ? formatHandicapLine(game.handicapLine) : "sem linha", true),
    item("Jogo sem diferenca exagerada no placar", scoreControlled, game.scoreText || "-", true)
  ];
  const points = checks.filter((entry) => entry.available && entry.passed).length;
  const passed = hasTotalCorner && controlledGoalLine && lowGoalState && stillUsefulMinute && points >= 6;
  const confidence = passed ? Math.min(88, 50 + points * 6 - Math.max(0, game.totalGoals - 1) * 5) : 0;

  return result(game, {
    confidence,
    odd: game.under35Odd || game.odd || 0,
    grade: passed ? `IA ${points}/7` : "Descarta",
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA Under 3.5 ${passed ? "Aprovado" : "Descarta"} (${points}/7)`,
    generatedSignals: passed ? ["Under 3.5 gols"] : []
  }, checks);
}

function scanCorners(game) {
  const checks = [
    item("Favorito joga em casa", game.homeFavoriteByModel, game.homeFavoriteByModel ? "sim" : "nao", game.hasModel),
    item("Media conjunta de escanteios alta", game.avgCornersTotal > 10, `${game.avgCornersTotal.toFixed(1)}`, game.hasCorners),
    item("Favorito finaliza bastante", game.favoriteAvgShots > 10, `${game.favoriteAvgShots.toFixed(1)}`, game.hasShots)
  ];
  const passed = checks.every((entry) => entry.available && entry.passed);
  const probability = passed ? Math.max(65, Math.min(88, Math.round(55 + (game.avgCornersTotal - 10) * 10))) : 0;
  return result(game, {
    confidence: probability,
    odd: game.odd || 0,
    status: passed ? "Entrada" : "Observar",
    generatedSignals: passed ? ["Over 9.5 escanteios"] : []
  }, checks);
}

function formatHandicapLine(value) {
  if (!Number.isFinite(Number(value))) return "-";
  const line = Number(value);
  return `${line > 0 ? "+" : ""}${line}`;
}

function scanHandicap(game) {
  const hasLine = Number.isFinite(Number(game.handicapLine));
  const line = hasLine ? Number(game.handicapLine) : 0;
  const hasUsefulLine = hasLine && Math.abs(line) >= 0.25;
  const signal = hasUsefulLine ? `Handicap mandante ${formatHandicapLine(line)}` : "";
  const confidence = hasUsefulLine ? Math.max(62, Math.min(82, Math.round(60 + Math.abs(line) * 12))) : 0;
  const checks = [
    item("Linha handicap TotalCorner", hasUsefulLine, signal || (hasLine ? formatHandicapLine(line) : "indisponivel"), hasLine),
    item("Linha minima >= 0.25", hasUsefulLine, hasLine ? formatHandicapLine(line) : "indisponivel", hasLine),
    item("Fonte TotalCorner", Boolean(game.totalCornerSource), game.totalCornerSource || "indisponivel", Boolean(game.totalCornerSource))
  ];
  const passed = hasUsefulLine && Boolean(game.totalCornerSource);

  return result(game, {
    confidence: passed ? confidence : 0,
    odd: game.odd || 0,
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `IA Handicap ${passed ? "Aprovado" : "Descarta"}${signal ? ` - ${signal}` : ""}`,
    generatedSignals: passed ? [signal] : []
  }, checks);
}

function getRows(payload) {
  return Array.isArray(payload) ? payload : payload.response || payload.data || payload.games || [];
}

function getStatTotal(row, type) {
  return (row.liveStats || []).reduce((sum, teamStats) => {
    const stat = (teamStats.statistics || []).find((entry) => entry.type === type);
    return sum + asNumber(stat?.value);
  }, 0);
}

function getStatMax(row, type) {
  return Math.max(0, ...(row.liveStats || []).map((teamStats) => {
    const stat = (teamStats.statistics || []).find((entry) => entry.type === type);
    return asNumber(stat?.value);
  }));
}

function getOddFromBookmakers(bookmakers, names) {
  const wanted = names.map((name) => name.toLowerCase());
  for (const bookmaker of bookmakers || []) {
    for (const bet of bookmaker.bets || []) {
      for (const value of bet.values || []) {
        const label = String(value.value || value.label || "").toLowerCase();
        if (wanted.some((name) => label === name || label.includes(name))) {
          const odd = asNumber(value.odd);
          if (odd > 0) return odd;
        }
      }
    }
  }
  return 0;
}

function getMarketOdd(row, directFields, names) {
  for (const field of directFields) {
    const odd = asNumber(row[field]);
    if (odd > 0) return odd;
  }

  const oddsRows = Array.isArray(row.oddsPayload) ? row.oddsPayload : [];
  for (const oddsRow of oddsRows) {
    const odd = getOddFromBookmakers(oddsRow.bookmakers, names);
    if (odd > 0) return odd;
  }

  return getOddFromBookmakers(row.bookmakers, names);
}

function buildGameData({ totalGoals, liveCorners, liveShots, liveShotsOnTarget, elapsed, apiStatus, hasLiveStats }) {
  const data = [
    `DADO | Gols no jogo | ${totalGoals}`,
    `DADO | Tempo/status | ${elapsed ? `${elapsed}'` : apiStatus || "-"}`
  ];

  if (hasLiveStats) {
    data.push(`DADO | Escanteios ao vivo | ${liveCorners}`);
    data.push(`DADO | Finalizacoes ao vivo | ${liveShots}`);
    data.push(`DADO | Finalizacoes no alvo | ${liveShotsOnTarget}`);
  } else {
    data.push("DADO | Estatisticas ao vivo | API nao trouxe estatisticas");
  }

  return data;
}

function normalizeFixture(row) {
  const kickoff = row.fixture?.date ? new Date(row.fixture.date) : null;
  const source = row.source || "";
  const isForebetLive = source === "Forebet Live" || source === "Forebet Livescore";
  const homeGoals = asNumber(row.goals?.home);
  const awayGoals = asNumber(row.goals?.away);
  const totalGoals = homeGoals + awayGoals;
  const elapsed = row.fixture?.status?.elapsed;
  const apiStatus = row.fixture?.status?.short;
  const liveCorners = getStatTotal(row, "Corner Kicks");
  const liveShots = getStatTotal(row, "Total Shots");
  const liveShotsOnTarget = getStatTotal(row, "Shots on Goal");
  const favoriteShots = getStatMax(row, "Total Shots") || getStatMax(row, "Shots on Goal");
  const hasLiveStats = Boolean((row.liveStats || []).length);
  const hasHistory = !isForebetLive && Boolean(row.bothTeamsScorePercent || row.bttsPercent || row.avgGoalsTotal || row.mediaGolsConjunta);

  return {
    sourceId: String(row.fixture?.id || `${row.teams?.home?.name}-${row.teams?.away?.name}-${row.fixture?.date}`),
    home: row.teams?.home?.name || "Mandante",
    away: row.teams?.away?.name || "Visitante",
    league: row.league?.name || "Liga",
    time: row.displayTime || (kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "--:--"),
    dateText: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-",
    liveStatus: elapsed ? `${elapsed}'` : apiStatus || "",
    apiStatus: apiStatus || "",
    scoreText: `${homeGoals}x${awayGoals}`,
    homeGoals,
    awayGoals,
    totalGoals,
    liveCorners,
    cornersAvailable: row.cornersAvailable !== false,
    liveShots,
    liveShotsOnTarget,
    source,
    mlPrediction: row.mlPrediction || row.forebetPrediction || "",
    mlProbabilities: row.mlProbabilities || row.forebetProbabilities || [],
    mlConfidence: asNumber(row.mlConfidence),
    mlAvgGoals: asNumber(row.mlAvgGoals || row.forebetAvgGoals || row.avgGoalsTotal || row.mediaGolsConjunta || row.averageGoalsTotal),
    mlPick: row.mlPick || "",
    mlOdd: getMarketOdd(row, ["mlOdd", "moneylineOdd", "oddMl"], ["home", "draw", "away"]),
    dadosJogo: buildGameData({ totalGoals, liveCorners, liveShots, liveShotsOnTarget, elapsed, apiStatus, hasLiveStats }),
    odd: 0,
    bttsPercent: percent(row.bothTeamsScorePercent || row.bttsPercent || row.ambosMarcamPercentual),
    avgGoalsTotal: asNumber(row.avgGoalsTotal || row.mediaGolsConjunta || row.averageGoalsTotal || totalGoals),
    xgTotal: asNumber(row.xgTotal || row.xgConjunto || row.expectedGoalsTotal),
    xgPercent: asNumber(row.xgPercent || row.percentualXg || row.xgPercentage),
    xgAvailable: Boolean(row.xgTotal || row.xgConjunto || row.expectedGoalsTotal || row.xgPercent || row.percentualXg || row.xgPercentage),
    zeroZeroLast5Both: asNumber(row.zeroZeroLast5Both || row.zeroAZeroUltimos5Ambos),
    avgGoalsBothTeams: asNumber(row.avgGoalsBothTeams || row.mediaGolsDoisTimes || row.averageGoalsBothTeams || totalGoals),
    favoriteAtHome: asBool(row.favoriteAtHome || row.favoritoEmCasa || row.homeFavorite),
    bttsLast10Percent: percent(row.bothTeamsScoredLast10Percent || row.ambosMarcaramUltimos10Percentual || row.bttsLast10Percent),
    avgShotsPerGame: asNumber(row.avgShotsPerGame || row.mediaFinalizacoes || row.averageShotsPerGame || liveShots),
    over05Odd: getMarketOdd(row, ["over05Odd", "oddOver05", "overZeroPointFiveOdd"], ["over 0.5", "over 0.5 goals", "over 0,5"]),
    over15Odd: getMarketOdd(row, ["over15Odd", "oddOver15", "overOnePointFiveOdd"], ["over 1.5", "over 1.5 goals", "over 1,5"]),
    over25Odd: getMarketOdd(row, ["over25Odd", "oddOver25", "overTwoPointFiveOdd"], ["over 2.5", "over 2.5 goals", "over 2,5"]),
    homeFavoriteByModel: asBool(row.homeFavoriteByModel || row.favoritoMandanteModelo || row.favoritoEmCasaModelo),
    handicapLine: Number.isFinite(Number(row.handicapLine)) ? Number(row.handicapLine) : null,
    handicapSignal: row.handicapSignal || "",
    totalCornerSource: row.totalCorner ? "TotalCorner" : "",
    avgCornersTotal: asNumber(row.avgCornersTotal || row.mediaEscanteiosConjunta || row.averageCornersTotal || liveCorners),
    favoriteAvgShots: asNumber(row.favoriteAvgShots || row.mediaFinalizacoesFavorito || row.favoriteAverageShots || favoriteShots),
    avgGoalsForBothTeams: asNumber(row.avgGoalsForBothTeams || row.mediaGolsMarcadosTimes),
    avgGoalsAgainstBothTeams: asNumber(row.avgGoalsAgainstBothTeams || row.mediaGolsSofridosTimes),
    over25Percent: percent(row.over25Percent || row.percentualOver25 || row.overTwoPointFivePercent),
    shotsOnTargetTotal: asNumber(row.shotsOnTargetTotal || row.finalizacoesCertasSomadas || liveShotsOnTarget),
    firstHalfGoalPercent: percent(row.firstHalfGoalPercent || row.percentualGolPrimeiroTempo),
    decisiveGame: asBool(row.decisiveGame || row.jogoDecisivo),
    under25Odd: getMarketOdd(row, ["under25Odd", "oddUnder25", "underTwoPointFiveOdd"], ["under 2.5", "under 2.5 goals", "under 2,5"]),
    under35Odd: getMarketOdd(row, ["under35Odd", "oddUnder35", "underThreePointFiveOdd"], ["under 3.5", "under 3.5 goals", "under 3,5"]),
    goalLine: asNumber(row.goalLine || row.totalCornerGoalLine || row.goalsLine),
    underFriendlyLeague: row.underFriendlyLeague === undefined ? true : asBool(row.underFriendlyLeague),
    elapsed: asNumber(elapsed),
    hasHistory,
    hasModel: Boolean(row.favoriteAtHome || row.homeFavoriteByModel || row.favoritoEmCasaModelo),
    hasShots: hasLiveStats || Boolean(row.avgShotsPerGame || row.favoriteAvgShots || row.mediaFinalizacoes),
    hasCorners: hasLiveStats || Boolean(row.avgCornersTotal || row.mediaEscanteiosConjunta)
  };
}

export function analyzeFixtures(payload) {
  return getRows(payload).flatMap((row) => {
    if (!row.fixture || !row.teams) return [];
    const base = normalizeFixture(row);
    return MARKETS.map((market) => {
      const game = { ...base, market, marketLabel: MARKET_LABELS[market] };
      if (market === "over05") return scanOver05(game);
      if (market === "over15") return scanOver15(game);
      if (market === "over25") return scanOver25(game);
      if (market === "under25") return scanUnder25(game);
      if (market === "under35") return scanUnder35(game);
      if (market === "corners") return scanCorners(game);
      if (market === "handicap") return scanHandicap(game);
      return scanMl(game);
    });
  });
}

export function publicGame(game) {
  return {
    key: `${game.sourceId}-${game.market}`,
    sourceId: game.sourceId,
    home: game.home,
    away: game.away,
    league: game.league,
    time: game.time,
    dateText: game.dateText,
    liveStatus: game.liveStatus,
    apiStatus: game.apiStatus,
    elapsed: game.elapsed,
    scoreText: game.scoreText,
    totalGoals: game.totalGoals,
    liveCorners: game.liveCorners,
    cornersAvailable: game.cornersAvailable,
    liveShots: game.liveShots,
    liveShotsOnTarget: game.liveShotsOnTarget,
    source: game.source,
    handicapLine: game.handicapLine,
    handicapSignal: game.handicapSignal || "",
    mlPick: game.mlPick || "",
    mlPickLabel: game.mlPickLabel || "",
    dadosJogo: game.dadosJogo || [],
    market: game.market,
    marketLabel: game.marketLabel,
    odd: game.odd,
    confidence: game.confidence,
    status: game.status,
    grade: game.grade || "",
    signals: game.generatedSignals || [],
    stats: game.statsPrefix ? [game.statsPrefix, ...game.stats] : game.stats
  };
}
