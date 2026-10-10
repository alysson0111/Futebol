import test from "node:test";
import assert from "node:assert/strict";
import { summarizeTeamHistory, getSportsResearch } from "./sports-data.mjs";
import { analyzeConfrontation, factualSections, validateNarrative } from "./sports-analysis.mjs";

function fixture(id, date, home, away, goals = [1, 0], status = "FT") {
  return { fixture: { id, date, status: { short: status } }, league: { id: 1, name: "League", season: 2026 }, teams: { home: { id: home, name: `Team ${home}` }, away: { id: away, name: `Team ${away}` } }, goals: { home: goals[0], away: goals[1] } };
}
const current = fixture(100, "2026-10-01T20:00:00Z", 1, 2, [null, null], "NS");
const history = [fixture(1, "2026-09-01T20:00:00Z", 1, 3, [0, 0]), fixture(2, "2026-09-15T20:00:00Z", 3, 1, [2, 1]), fixture(3, "2026-09-20T20:00:00Z", 1, 2, [3, 1]), current, fixture(101, "2026-10-02T20:00:00Z", 1, 4, [5, 0]), fixture(102, "2026-09-30T20:00:00Z", 1, 4, [1, 0], "2H")];

test("team history excludes future, live, unrelated, and missing-score games", () => {
  const event = (id, date, home, away, scores, phase = "finished") => ({ id, date, home: { id: home }, away: { id: away }, score: { home: scores[0], away: scores[1] }, phase });
  const summary = summarizeTeamHistory([
    event(1, "2026-09-01", 1, 3, [0, 0]), event(2, "2026-09-02", 3, 1, [2, 1]),
    event(3, "2026-09-03", 1, 2, [3, 1]), event(4, "2026-10-05", 1, 4, [5, 0]),
    event(5, "2026-09-05", 1, 4, [null, null]), event(6, "2026-09-06", 1, 4, [2, 0], "live"),
    event(7, "2026-09-07", 5, 4, [3, 0])
  ], 1, new Date("2026-10-01").getTime(), 100);
  assert.equal(summary.overall.games, 3);
  assert.equal(summary.overall.wins, 1);
  assert.equal(summary.overall.draws, 1);
  assert.equal(summary.overall.losses, 1);
  assert.equal(summary.overall.scoredAverage, 1.33);
  assert.equal(summary.home.games, 2);
  assert.equal(summary.away.games, 1);
  assert.equal(summarizeTeamHistory([], 1, Date.now(), 100).overall.scoredAverage, null);
});

test("narrative refuses unknown sources and empty evidence citations", () => {
  assert.throws(() => validateNarrative({ sections: [{ title: "Context", text: "Text", sources: ["invented"] }] }, [{ id: "context" }]));
  assert.throws(() => validateNarrative({ sections: [{ title: "Context", text: "Text", sources: [] }] }, [{ id: "context" }]));
});

test("research and optional AI remain grounded in preceding match data", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.APISPORTS_KEY;
  const originalAiKey = process.env.OPENAI_API_KEY;
  process.env.APISPORTS_KEY = "test-sports";
  delete process.env.OPENAI_API_KEY;
  const urls = [];
  let aiCalls = 0;
  let invalidCitation = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); urls.push(url);
    if (url.hostname === "api.openai.com") {
      aiCalls++;
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.text.format.type, "json_schema");
      const evidence = JSON.parse(body.input);
      assert.ok(evidence.home.overall.matches.every(game => new Date(game.date) < new Date(evidence.cutoff)));
      const output = { sections: [{ title: "Contexto", text: "Team 1 enfrenta Team 2 na League.", sources: [invalidCitation ? "invented" : "context"] }] };
      return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) };
    }
    let data;
    if (url.pathname === "/injuries") data = [];
    else if (url.pathname.endsWith("headtohead")) data = history;
    else if (url.searchParams.has("id")) data = [{ ...current, fixture: { ...current.fixture, id: Number(url.searchParams.get("id")) } }];
    else data = history;
    return { ok: true, json: async () => ({ errors: [], response: data }) };
  };
  try {
    const research = await getSportsResearch("football", "100");
    assert.equal(research.home.overall.games, 3);
    assert.equal(research.h2h.length, 1);
    assert.ok(research.h2h.every(game => game.id !== 100 && game.id !== 101));
    assert.equal(research.season, 2026);
    const fallback = await analyzeConfrontation("football", "100");
    assert.equal(fallback.engine, "statistics");
    assert.equal(aiCalls, 0);
    assert.match(factualSections(research).at(-1).text, /não confirma/);
    process.env.OPENAI_API_KEY = "test-ai";
    const ai = await analyzeConfrontation("football", "100");
    assert.equal(ai.engine, "ai");
    await analyzeConfrontation("football", "100");
    assert.equal(aiCalls, 1);
    invalidCitation = true;
    const invalid = await analyzeConfrontation("football", "105");
    assert.equal(invalid.engine, "statistics");
    assert.match(invalid.warning, /referencias/);
    assert.ok(urls.every(url => !url.pathname.includes("odds") && !url.pathname.includes("predictions")));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [["APISPORTS_KEY", originalApiKey], ["OPENAI_API_KEY", originalAiKey]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});
