import test from "node:test";
import assert from "node:assert/strict";
import { buildFinalSignalUpdate, getSettlementOutcome } from "./signalSettlement.js";
import { calculateReport } from "./scoreUtils.js";
import { totalCornerRowsToFixtures } from "../../api/_lib/totalCorner.js";
import { analyzeFixtures } from "../../api/_lib/scanner.js";

const signal = { market: "over25", scoreText: "0x0", liveStatus: "30'", liveCorners: 3, mlPick: "home", handicapLine: -1, signalLines: ["Over 2.5 gols"], odd: 1.8, confidence: 80 };

test("dated results retain their match date, including late evening kickoffs", () => {
  const fixtures = totalCornerRowsToFixtures([{ dateIso: "2026-07-04", time: "23:30", home: "Casa", away: "Fora", status: "Integral", homeGoals: 1, awayGoals: 0 }]);
  assert.equal(fixtures[0].fixture.date, "2026-07-04T23:30:00-03:00");
  assert.equal(analyzeFixtures({ response: fixtures })[0].dateText, "04/07/2026");
});

test("report stays frozen even after the goal line is met and through stoppage time", () => {
  const before = structuredClone(signal);
  for (const minute of [35, 89, 90, 95, 103]) {
    assert.equal(buildFinalSignalUpdate(signal, { scoreText: "3x0", apiStatus: "LIVE", liveStatus: `${minute}'`, liveCorners: 10 }), null);
  }
  assert.deepEqual(signal, before);
});

test("final update changes the score and retains the entry snapshot", () => {
  const update = buildFinalSignalUpdate(signal, { scoreText: "3x0", apiStatus: "FT", liveCorners: 12, mlPick: "away", handicapLine: 2 });
  assert.equal(update.scoreText, "3x0");
  assert.equal(update.result, "green");
  assert.equal(update.entryScoreText, "0x0");
  assert.equal(update.entryLiveStatus, "30'");
  assert.equal(update.entryLiveCorners, 3);
  assert.equal(update.liveCorners, 12);
  const saved = { ...signal, ...update };
  assert.equal(saved.mlPick, "home");
  assert.equal(saved.handicapLine, -1);
  assert.deepEqual(saved.signalLines, signal.signalLines);
  assert.equal(saved.odd, 1.8);
});

test("Under and Over are settled only at the end", () => {
  for (const [market, finalScore, result] of [["over05", "0x0", "red"], ["over15", "1x1", "green"], ["under25", "2x1", "red"], ["under35", "2x1", "green"]]) {
    assert.equal(getSettlementOutcome({ ...signal, market }, { scoreText: finalScore, apiStatus: "LIVE" }), null);
    assert.equal(getSettlementOutcome({ ...signal, market }, { scoreText: finalScore, apiStatus: "FT" }).result, result);
  }
});

test("handicap settles the saved line and records a refund as Push", () => {
  const game = { scoreText: "1x0", apiStatus: "FT", handicapLine: -2 };
  assert.deepEqual(getSettlementOutcome({ ...signal, market: "handicap", handicapLine: -1 }, game), { result: "push", settlementFactor: 0 });
  assert.equal(getSettlementOutcome({ ...signal, market: "handicap", handicapLine: 0 }, game).result, "green");
});

test("quarter handicap handles half wins and half losses", () => {
  const game = { scoreText: "1x0", apiStatus: "FT" };
  assert.deepEqual(getSettlementOutcome({ ...signal, market: "handicap", handicapLine: -0.75 }, game), { result: "green", settlementFactor: 0.5 });
  assert.deepEqual(getSettlementOutcome({ ...signal, market: "handicap", handicapLine: -1.25 }, game), { result: "red", settlementFactor: 0.5 });
});

test("ML retains its original predicted side", () => {
  assert.equal(getSettlementOutcome({ ...signal, market: "ml", mlPick: "home" }, { scoreText: "0x1", apiStatus: "FT", mlPick: "away" }).result, "red");
  assert.equal(getSettlementOutcome({ ...signal, market: "ml", mlPick: "draw" }, { scoreText: "1x1", apiStatus: "FT" }).result, "green");
});

test("corner settlement uses the saved signal threshold and rejects missing counts", () => {
  const cornerSignal = { ...signal, market: "corners", signalLines: ["Over 9.5 escanteios"] };
  assert.equal(getSettlementOutcome(cornerSignal, { scoreText: "0x0", apiStatus: "FT", liveCorners: 9 }).result, "red");
  assert.equal(getSettlementOutcome(cornerSignal, { scoreText: "0x0", apiStatus: "FT", liveCorners: 10 }).result, "green");
  assert.equal(getSettlementOutcome(cornerSignal, { scoreText: "0x0", apiStatus: "FT", liveCorners: null }), null);
});

test("missing score and saved handicap cannot produce a result", () => {
  assert.equal(buildFinalSignalUpdate(signal, { apiStatus: "FT" }), null);
  assert.equal(getSettlementOutcome({ market: "handicap", handicapLine: null }, { scoreText: "0x0", apiStatus: "FT" }), null);
});

test("Push has zero profit, is counted in ROI stakes and excluded from hit rate", () => {
  const report = calculateReport([{ result: "green", odd: 2 }, { result: "push", odd: 2 }, { result: "red", odd: 2, settlementFactor: 0.5 }]);
  assert.equal(report.push, 1);
  assert.equal(report.profit, 0.5);
  assert.equal(report.roi, 17);
  assert.equal(report.hitRate, 50);
});
