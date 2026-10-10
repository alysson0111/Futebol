import test from "node:test";
import assert from "node:assert/strict";
import { validDate, normalizeSportsEvent, getSportsEvents, getSportsDetails } from "./sports-data.mjs";

test("validates calendar dates, including leap years", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("../.env"), false);
});

test("preserves zero scores and distinguishes match phases", () => {
  const event = normalizeSportsEvent({ fixture: { id: 5, date: "2026-10-09T21:00:00Z", status: { short: "2H", elapsed: 80 } }, goals: { home: 0, away: 0 }, teams: { home: { name: "A" }, away: { name: "B" } } }, "football");
  assert.deepEqual(event.score, { home: 0, away: 0 });
  assert.equal(event.phase, "live");
  assert.equal(event.elapsed, 80);
  assert.equal(normalizeSportsEvent({ id: 9, status: { short: "AOT" }, scores: { home: { total: 97 }, away: { total: 99 } } }, "basketball").phase, "finished");
});

test("NFL timestamp and country objects retain their actual values", () => {
  const event = normalizeSportsEvent({ game: { id: 17377, week: "Week 4", date: { date: "2025-09-30", time: "00:15", timestamp: 1759191300 }, status: { short: "FT" } }, league: { id: 1, country: { name: "USA" } }, scores: { home: { total: 28 }, away: { total: 3 } } }, "nfl");
  assert.equal(event.date, "2025-09-30T00:15:00.000Z");
  assert.equal(event.league.country, "USA");
  assert.equal(event.round, "Week 4");
});

test("unsupported sports never query or display a different sport", async () => {
  for (const sport of ["tennis", "eafootball"]) {
    const result = await getSportsEvents(sport, "2026-10-09");
    assert.equal(result.available, false);
    assert.deepEqual(result.events, []);
  }
  await assert.rejects(getSportsEvents("unknown", "2026-10-09"));
});

test("read-only requests are deduplicated, filtered, and use correct stat parameters", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.APISPORTS_KEY;
  process.env.APISPORTS_KEY = "test-key";
  const urls = [];
  globalThis.fetch = async input => {
    const url = new URL(input); urls.push(url);
    const payload = url.pathname.endsWith("statistics/teams")
      ? [{ team: { id: 1 }, points: 20 }]
      : [{ game: { id: 10, status: { short: "FT" } }, league: { id: 1 }, teams: { home: { id: 1, name: "Home" }, away: { id: 2, name: "Away" } } }, { game: { id: 11 }, league: { id: 2 } }];
    return { ok: true, json: async () => ({ errors: [], response: payload }) };
  };
  try {
    const results = await Promise.all([getSportsEvents("nfl", "2026-10-08"), getSportsEvents("nfl", "2026-10-08")]);
    assert.equal(urls.length, 1);
    assert.equal(results[0].events.length, 1);
    assert.equal(urls[0].searchParams.get("timezone"), "America/Sao_Paulo");
    await getSportsEvents("nfl", "2026-10-08");
    assert.equal(urls.length, 1);
    const details = await getSportsDetails("nfl", "10");
    assert.equal(urls.at(-1).searchParams.get("id"), "10");
    assert.equal(details.statistics[0].team.name, "Home");
    assert.ok(urls.every(url => !url.pathname.includes("odds")));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ errors: { plan: "Unavailable" }, response: [] }) });
    await assert.rejects(getSportsEvents("basketball", "2026-10-07"), /Unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.APISPORTS_KEY; else process.env.APISPORTS_KEY = originalKey;
  }
});
