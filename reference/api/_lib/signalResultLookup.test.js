import test from "node:test";
import assert from "node:assert/strict";
import { selectResultDates, findResultGame } from "./signalResultLookup.js";
import { mergeReportSignals } from "../../src/analysis/reportSignals.js";
import { parseTotalCornerMarkdown, totalCornerRowsToFixtures, fetchTotalCornerDate, resultPageLinks } from "./totalCorner.js";
import { analyzeFixtures } from "./scanner.js";
import { buildFinalSignalUpdate } from "../../src/analysis/signalSettlement.js";

test('dated recovery follows explicit pagination only for the requested date', async () => {
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async url=>{calls++;return {ok:true,text:async()=>calls===1?'# Match Schedule\n2026-10-10\nLiga A\n08:00 Integral A 1 - 0 B\n[2](https://www.totalcorner.com/pt/match/schedule/20261010?page=2)':'# Match Schedule\n2026-10-10\nLiga B\n09:00 Integral C 0 - 2 D'};};
    const rows=await fetchTotalCornerDate('2026-10-10');
    assert.equal(calls,2);
    assert.equal(rows.length,2);
    assert.equal(rows[1].home,'C');
    assert.deepEqual(resultPageLinks('[2](https://evil.example/pt/match/schedule/20261010?page=2) [3](https://www.totalcorner.com/pt/match/schedule/20261009?page=3)','2026-10-10'),[]);
  } finally {globalThis.fetch=original;}
});

test('saved status/card prefixes cannot hide the final result of the same dated teams', () => {
  const signal={dateText:'10/10/2026',market:'over05',home:"1ºT ' 1 1  Obolon Kyiv",away:'FC Kryvbas',league:'Liga'};
  const game={...signal,home:'Obolon Kyiv',apiStatus:'FT',scoreText:'1x0'};
  assert.equal(findResultGame(signal,[game]),game);
  assert.equal(buildFinalSignalUpdate(signal,game).result,'green');
});

test('a failed additional page preserves confirmed results and reports incomplete coverage', async () => {
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return calls===1?{ok:true,text:async()=> '# Match Schedule\n2026-10-10\nLiga A\n08:00 Integral A 1 - 0 B\n[2](https://www.totalcorner.com/pt/match/schedule/20261010?page=2)'}:{ok:false,status:401};};
    const rows=await fetchTotalCornerDate('2026-10-10');
    assert.equal(rows.length,1);
    assert.match(rows.coverageErrors[0],/401/);
  } finally {globalThis.fetch=original;}
});

test("all historical pending dates are revisited, including signals saved before kickoff", () => {
  const signals = ["10/10/2026", "09/10/2026", "08/10/2026", "07/10/2026", "06/10/2026", "05/10/2026", "04/10/2026"].map((dateText) => ({ dateText, liveStatus: "NS" }));
  let cursor = 0;
  const visited = new Set();
  for (let i = 0; i < 5; i++) {
    const plan = selectResultDates(signals, cursor, "2026-10-10");
    assert.ok(plan.dates.includes("2026-10-10"));
    assert.ok(plan.dates.includes("2026-10-09"));
    plan.dates.forEach((date) => visited.add(date));
    cursor = plan.nextCursor;
  }
  assert.equal(visited.size, 7);
});

test("a final result wins over a stale live row and never uses another date", () => {
  const signal = { sourceId: "same", dateText: "09/10/2026", market: "over05", home: "Casa", away: "Fora" };
  const live = { ...signal, apiStatus: "LIVE", scoreText: "0x0" };
  const final = { ...signal, apiStatus: "FT", scoreText: "1x0" };
  assert.equal(findResultGame(signal, [live, final]), final);
  assert.equal(findResultGame(signal, [{ ...final, dateText: "10/10/2026" }]), null);
  assert.equal(findResultGame(signal, [{ ...final, sourceId: "different", away: "Fora B" }]), null);
});

test("poll responses preserve new local signals, final results and deleted rows", () => {
  const current = [{ id: "new", scoreText: "0x0" }, { id: "final", result: "green", finalConfirmed: true, scoreText: "1x0" }];
  const incoming = [{ id: "final", result: "pendente", scoreText: "0x0" }, { id: "deleted" }];
  const merged = mergeReportSignals(current, incoming, new Set(["deleted"]));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((signal) => signal.id === "final").result, "green");
});

test("both TotalCorner formats are parsed together; missing corners do not hide final scores", () => {
  const markdown = `Liga A
08:00 Integral Casa 2 - 1 Fora
Estatísticas Cotas Ao vivo
![Image 1](https://static.totalcorner.com/img/countries/br.png) 09:00 FT [Outro](https://www.totalcorner.com/pt/team/view/1) 1 - 0 [Visitante](https://www.totalcorner.com/pt/team/view/2) +0.5 4 - 3 9.5 2.5`;
  const rows = parseTotalCornerMarkdown(markdown);
  assert.equal(rows.length, 2);
  const games = analyzeFixtures({ response: totalCornerRowsToFixtures(rows) });
  const game = games.find((item) => item.home === "Casa" && item.market === "over05");
  assert.equal(buildFinalSignalUpdate({ market: "over05", scoreText: "0x0" }, game).result, "green");
  assert.equal(buildFinalSignalUpdate({ market: "corners", signalLines: ["Over 9.5 escanteios"] }, game), null);
});

test("reader errors propagate instead of silently reporting no results", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.ok(String(url).startsWith("https://r.jina.ai/https://www.totalcorner.com/"));
      return { ok: false, status: 401 };
    };
    await assert.rejects(fetchTotalCornerDate("2026-10-09"), /401/);
  } finally {
    globalThis.fetch = original;
  }
});

test("historical results use the schedule route and reject a different date", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes("/pt/match/schedule/20261009?"));
      return { ok: true, text: async () => "URL Source: https://www.totalcorner.com/pt/match/schedule/20261009?date=2026-10-09\n# Jogos de Hoje\n2026-10-10\nLiga A\n08:00 Integral Casa 2 - 1 Fora\nEstatisticas" };
    };
    await assert.rejects(fetchTotalCornerDate("2026-10-09"), /nao confirmou a data/);
    globalThis.fetch = async () => ({ ok: true, text: async () => "# Match Schedule\n2026-10-09 Sort by time\nLiga A\n08:00 Integral Casa 2 - 1 Fora" });
    const rows = await fetchTotalCornerDate("2026-10-09");
    assert.equal(rows[0].dateIso, "2026-10-09");
    assert.equal(rows[0].homeGoals, 2);
    assert.equal(rows[0].status, "Integral");
  } finally {
    globalThis.fetch = original;
  }
});

test("schedule Full labels are final and card counts cannot corrupt team names", () => {
  const rows = parseTotalCornerMarkdown("| Liga | 00:00 | Full | 1 3 [Hartford Athletic](https://www.totalcorner.com/pt/team/view/1) | 2 - 2 | [Louisville City FC](https://www.totalcorner.com/pt/team/view/2) 3 1 | 0.0 | 7 - 7 (2-5) | 10.0 | 2.75 |");
  assert.equal(rows[0].home, "Hartford Athletic");
  assert.equal(rows[0].away, "Louisville City FC");
  const game = analyzeFixtures({ response: totalCornerRowsToFixtures(rows) })[0];
  assert.equal(game.apiStatus, "FT");
  assert.equal(buildFinalSignalUpdate({ market: "over25", scoreText: "0x0" }, game).result, "green");
});

test("Portuguese schedule Fim in tab-separated records confirms the final score", () => {
  const rows = parseTotalCornerMarkdown("Liga A\n\t00:30\tFim\t[5] Fluminense\t4 - 0\tCoritiba [9] 1\t-1.25\t\n6 - 2\n9.5\nEstatisticas");
  const game = analyzeFixtures({ response: totalCornerRowsToFixtures(rows) })[0];
  assert.equal(game.home, "Fluminense");
  assert.equal(game.away, "Coritiba");
  assert.equal(game.apiStatus, "FT");
  assert.equal(buildFinalSignalUpdate({ market: "over25", scoreText: "0x0" }, game).result, "green");
});

test("tab-separated schedules read every match without depending on analysis link labels", () => {
  const markdown = "Liga A\n\t00:30\tFim\tCasa\t4 - 0\tFora\t-1.25\t\n6 - 2\n9.5\nDetalhes Cotas Ao vivo\nLiga B\n\t01:00\tFim\tOutro\t0 - 0\tVisitante\t0.0\t\n3 - 1\n8.5\nDetalhes Cotas Ao vivo";
  const rows = parseTotalCornerMarkdown(markdown);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.home, row.status, row.liveCorners]), [["Casa", "Fim", 8], ["Outro", "Fim", 4]]);
});

test("current pipe-separated tables preserve the final status and score", () => {
  const markdown = `| Liga | Hora | Tempo | Mandante | Placar | Visitante | Handicap | Escanteios | Linha | Gols |
| ![Image 1](https://static.totalcorner.com/img/countries/jp.png) | [Japao - J2](https://www.totalcorner.com/pt/league/1) | 09:00 | Integral | [3] [Jubilo Iwata](https://www.totalcorner.com/pt/team/view/1) | 1 - 0 | [Hokkaido Consadole Sapporo](https://www.totalcorner.com/pt/team/view/2) [18] | -0.75 (-0.25) | 5 - 3 (2-1) | 10.5 (8.5) | 2.5 (1.5) | Detalhes |`;
  const rows = parseTotalCornerMarkdown(markdown);
  const row = rows.find((item) => item.status === "Integral");
  assert.ok(row);
  assert.equal(row.home, "Jubilo Iwata");
  assert.equal(row.away, "Hokkaido Consadole Sapporo");
  assert.equal(row.liveCorners, 8);
  assert.equal(row.handicapLine, -0.75);
  const game = analyzeFixtures({ response: totalCornerRowsToFixtures([row]) })[0];
  assert.equal(game.apiStatus, "FT");
  assert.equal(buildFinalSignalUpdate({ market: "over05", scoreText: "0x0" }, game).result, "green");
});
