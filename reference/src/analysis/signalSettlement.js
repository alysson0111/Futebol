export function isFinishedGame(game) {
  if (!game) return false;
  const statuses = [game.apiStatus, game.fixture?.status?.short, game.liveStatus].map((value) => String(value || "").trim().toUpperCase());
  return statuses.some((status) => ["FT", "AET", "PEN", "INTEGRAL"].includes(status));
}

function numberOrNaN(value) {
  return value === null || value === undefined || value === "" ? NaN : Number(value);
}

function savedHandicap(signal) {
  const line = numberOrNaN(signal.handicapLine);
  if (Number.isFinite(line)) return line;
  const text = [...(signal.signalLines || []), ...(signal.signals || []), ...(signal.stats || [])].join(" ");
  const match = text.match(/Handicap[^+-]*([+-]\d+(?:\.\d+)?|0(?:\.0)?)/i);
  return match ? Number(match[1]) : NaN;
}

function outcome(margin, factor = 1) {
  return { result: margin > 0 ? "green" : margin < 0 ? "red" : "push", settlementFactor: margin === 0 ? 0 : factor };
}

export function getSettlementOutcome(signal, game) {
  if (!isFinishedGame(game)) return null;
  const score = String(game.scoreText || "").match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!score) return null;
  const home = Number(score[1]);
  const away = Number(score[2]);
  const total = home + away;
  const market = String(signal.market || signal.marketLabel || "").toLowerCase().replace(/\s+/g, "");
  const totals = { over05: 0.5, "+0.5gols": 0.5, over15: 1.5, "+1.5gols": 1.5, over25: 2.5, "+2.5gols": 2.5, under25: 2.5, "under2.5": 2.5, under35: 3.5, "under3.5ia": 3.5 };
  if (market in totals) return outcome(market.startsWith("under") ? totals[market] - total : total - totals[market]);
  if (market.includes("corner") || market.includes("escanteio")) {
    if (game.cornersAvailable === false) return null;
    const corners = numberOrNaN(game.liveCorners);
    const signals = signal.signalLines?.length ? signal.signalLines : signal.signals || [];
    const match = signals.length === 1 ? String(signals[0]).match(/^(Over|Under)\s+(\d+(?:\.\d+)?)/i) : null;
    if (!Number.isFinite(corners) || !match) return null;
    const margin = corners - Number(match[2]);
    return outcome(match[1].toLowerCase() === "under" ? -margin : margin);
  }
  if (market === "ml" || market.includes("moneyline")) {
    const savedPicks = [...new Set((signal.signalLines || []).map(line => String(line).match(/^(?:SINAL\s*\|\s*)?ML\s+(Casa|Fora|Empate)\b/i)?.[1]?.toLowerCase()).filter(Boolean))];
    const pick = signal.mlPick || (savedPicks.length === 1 ? {casa:'home',fora:'away',empate:'draw'}[savedPicks[0]] : '');
    if (!["home", "away", "draw"].includes(pick)) return null;
    return outcome(pick === (home > away ? "home" : away > home ? "away" : "draw") ? 1 : -1);
  }
  if (market.includes("handicap")) {
    const line = savedHandicap(signal);
    if (!Number.isFinite(line)) return null;
    if (Math.abs(line * 4) % 2 === 1) {
      const lower = Math.floor(line * 2) / 2;
      const margins = [home - away + lower, home - away + lower + 0.5];
      const net = margins.reduce((sum, margin) => sum + Math.sign(margin), 0) / 2;
      return outcome(net, Math.abs(net));
    }
    return outcome(home - away + line);
  }
  return null;
}

export function buildFinalSignalUpdate(signal, game) {
  const settlement = getSettlementOutcome(signal, game);
  if (!settlement) return null;
  const corners = numberOrNaN(game.liveCorners);
  return {
    ...settlement,
    scoreText: game.scoreText,
    finalScoreText: game.scoreText,
    entryScoreText: signal.entryScoreText ?? signal.scoreText ?? "",
    entryLiveStatus: signal.entryLiveStatus ?? signal.liveStatus ?? "",
    entryLiveCorners: signal.entryLiveCorners ?? signal.liveCorners ?? null,
    liveStatus: "FT",
    finalConfirmed: true,
    ...(Number.isFinite(corners) ? { liveCorners: corners } : {})
  };
}
