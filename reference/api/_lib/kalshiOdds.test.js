import test from "node:test";
import assert from "node:assert/strict";
import { attachKalshiOdds } from "./kalshiOdds.js";

const now = Date.parse("2026-10-09T15:00:00Z");
const game = { home: "Cruzeiro", away: "Remo", dateText: "09/10/2026", market: "over25", odd: 0, status: "Entrada", confidence: 78 };
const market = {
  ticker: "KXBRASILEIROTOTAL-26OCT09CRUCR-3",
  event_ticker: "KXBRASILEIROTOTAL-26OCT09CRUCR",
  status: "active", close_time: "2026-10-10T23:00:00Z",
  rules_primary: "If over 2.5 goals are scored in the Cruzeiro vs Remo professional Brasileiro Serie A soccer game after 90 minutes plus stoppage time, then the market resolves to Yes.",
  strike_type: "greater", floor_strike: 2.5,
  yes_ask_dollars: "0.50", no_ask_dollars: "0.65"
};

test("adds the exact total quote without changing the scanner", () => {
  const [result] = attachKalshiOdds([game], [market], now);
  assert.equal(result.odd, 2);
  assert.equal(result.oddSource, "Kalshi");
  assert.equal(result.status, game.status);
  assert.equal(result.confidence, game.confidence);
  assert.equal(attachKalshiOdds([{ ...game, market: "under25" }], [market], now)[0].odd, 1.54);
});

test("rejects wrong dates, opponents, lines, closed markets and missing prices", () => {
  const incorrect = [
    { ...market, event_ticker: "KXBRASILEIROTOTAL-26OCT10CRUCR" },
    { ...market, rules_primary: market.rules_primary.replace("Remo", "Remo B") },
    { ...market, floor_strike: 3.5 },
    { ...market, status: "closed" },
    { ...market, close_time: "2026-10-09T14:00:00Z" },
    { ...market, yes_ask_dollars: "0" },
    { ...market, yes_ask_dollars: undefined }
  ];
  for (const candidate of incorrect) assert.deepEqual(attachKalshiOdds([game], [candidate], now), [game]);
});

test("ML uses the selected winner, never the opposite side's price", () => {
  const ml = { ...market, event_ticker: "KXBRASILEIROGAME-26OCT09CRUCR", yes_sub_title: "Remo" };
  assert.equal(attachKalshiOdds([{ ...game, market: "ml", mlPick: "away" }], [ml], now)[0].odd, 2);
  assert.equal(attachKalshiOdds([{ ...game, market: "ml", mlPick: "home" }], [ml], now)[0].odd, 0);
});

test("handicap allows equivalent half-lines and excludes Asian refunds", () => {
  const spread = { ...market, event_ticker: "KXBRASILEIROSPREAD-26OCT09CRUCR", yes_sub_title: "Cruzeiro wins by more than 2.5 goals" };
  assert.equal(attachKalshiOdds([{ ...game, market: "handicap", handicapLine: -2.5 }], [spread], now)[0].odd, 2);
  for (const handicapLine of [-2.25, -2, null]) {
    assert.equal(attachKalshiOdds([{ ...game, market: "handicap", handicapLine }], [spread], now)[0].odd, 0);
  }
});

test("corners uses only the single signal line", () => {
  const corners = { ...market, event_ticker: "KXEPLCORNERS-26OCT09CRUCR", floor_strike: 9.5 };
  assert.equal(attachKalshiOdds([{ ...game, market: "corners", signals: ["Over 9.5 escanteios"] }], [corners], now)[0].odd, 2);
  assert.equal(attachKalshiOdds([{ ...game, market: "corners", signals: ["Over 8.5 escanteios"] }], [corners], now)[0].odd, 0);
});
