import { useEffect, useMemo, useRef, useState } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import Live from "./pages/Live.jsx";
import Prematch from "./pages/Prematch.jsx";
import GameDetails from "./pages/GameDetails.jsx";
import { getTodayInput } from "./analysis/scoreUtils.js";
import { buildFinalSignalUpdate, isFinishedGame } from "./analysis/signalSettlement.js";
import { mergeReportSignals, selectPendingSignalIds } from "./analysis/reportSignals.js";
import { useLiveGames } from "./hooks/useLiveGames.js";
import { usePrematchGames } from "./hooks/usePrematchGames.js";
import { useGameAnalysis } from "./hooks/useGameAnalysis.js";
import { deleteSignal, listSignals, saveSignal, updateSignalResult } from "./firebase/firebase.js";
import { setApiAccessToken } from './api/serverApi.js';

const styles = `
  :root {
    --bg: #f4f7f5;
    --panel: #ffffff;
    --panel-soft: #eef4ef;
    --ink: #17211c;
    --muted: #62726a;
    --line: #dbe5df;
    --green: #086474;
    --green-dark: #064953;
    --amber: #c47b14;
    --red: #b33b3b;
    --blue: #2468a2;
    --shadow: 0 16px 40px rgba(28, 45, 36, .10);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }
  html, body, #root { min-height: 100%; width: 100%; margin: 0; overflow-x: hidden; }
  body { background: var(--bg); color: var(--ink); }
  button, input, select { font: inherit; }

  .app { min-height: 100vh; width: 100%; max-width: 100vw; display: grid; grid-template-columns: 250px minmax(0, 1fr); }
  .sidebar { background: #063e49; color: #f7fff9; padding: 24px 18px; display: flex; flex-direction: column; gap: 22px; }
  .brand { display: flex; gap: 12px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, .12); }
  .brand-mark { width: 40px; height: 40px; border-radius: 8px; display: grid; place-items: center; background: #24b47e; color: #06150f; font-weight: 900; }
  .brand strong { display: block; line-height: 1.1; }
  .brand span { color: #a9bcb2; font-size: 12px; }
  .nav { display: grid; gap: 8px; }
  .nav button { min-height: 42px; border: 0; border-radius: 8px; background: transparent; color: #cadbd1; display: flex; align-items: center; gap: 10px; padding: 0 12px; cursor: pointer; text-align: left; }
  .nav button.active, .nav button:hover { background: rgba(255, 255, 255, .10); color: #fff; }
  .nav button.has-signal { color: #fff; background: rgba(36, 180, 126, .18); animation: signalPulse 1.15s ease-in-out infinite; }
  .signal-count { margin-left: auto; min-width: 22px; height: 22px; border-radius: 999px; display: inline-grid; place-items: center; background: #24b47e; color: #06150f; font-size: 12px; font-weight: 900; }
  @keyframes signalPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(36, 180, 126, .58); } 50% { box-shadow: 0 0 0 7px rgba(36, 180, 126, 0); } }

  .main { min-width: 0; max-width: 100vw; padding: 24px; display: grid; gap: 18px; align-content: start; }
  .topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 0; font-size: 18px; }
  .subtitle { margin: 0; color: var(--muted); font-size: 14px; }
  .actions, .report-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .report-select { min-height: 40px; border: 1px solid var(--line); background: white; color: var(--ink); border-radius: 8px; padding: 0 12px; min-width: 180px; }
  .btn { min-height: 40px; border: 1px solid var(--line); background: white; color: var(--ink); border-radius: 8px; padding: 0 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; white-space: normal; text-align: center; }
  .btn.primary { border-color: var(--green); background: var(--green); color: white; }
  .btn.green { border-color: var(--green); color: var(--green-dark); background: #e9f7f0; }
  .btn.red { border-color: var(--red); color: var(--red); background: #fdecec; }
  .btn:disabled { opacity: .65; cursor: wait; }

  .panel, .metric { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
  .date-search, .filters, .report-box { padding: 14px; }
  .date-search, .filters, .metrics { display: grid; gap: 12px; }
  .report-grid { display: block; min-width: 0; }
  .date-search { grid-template-columns: repeat(4, minmax(150px, 1fr)) auto; align-items: end; }
  .filters { grid-template-columns: repeat(6, minmax(120px, 1fr)); }
  .metrics { grid-template-columns: repeat(4, minmax(150px, 1fr)); }
  .report-box { display: grid; gap: 12px; }
  .report-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .field { display: grid; gap: 6px; }
  .field label { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .field input, .field select { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); min-height: 40px; padding: 0 10px; outline: none; }
  .check-field { align-content: end; }
  .check-label { min-height: 40px; border: 1px solid var(--line); border-radius: 8px; background: #fff; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--ink); font-size: 13px; font-weight: 700; }
  .check-label input { width: 16px; min-height: 16px; padding: 0; }
  .metric { padding: 16px; }
  .metric span { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .metric strong { display: block; margin-top: 8px; font-size: 28px; line-height: 1; }

  .table-panel { overflow: hidden; min-width: 0; }
  .table-head { padding: 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .table-wrap { width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .games-wrap { overflow-x: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 12px 14px; border-bottom: 1px solid var(--line); text-align: left; font-size: 14px; }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; background: #f7faf8; }
  tr:last-child td { border-bottom: 0; }
  .games-table { table-layout: fixed; min-width: 0; }
  .games-table th, .games-table td { padding: 8px 6px; font-size: 12px; line-height: 1.25; vertical-align: middle; overflow-wrap: anywhere; }
  .games-table th { font-size: 10px; }
  .games-table th:nth-child(1) { width: 16%; }
  .games-table th:nth-child(2) { width: 10%; }
  .games-table th:nth-child(3) { width: 5%; }
  .games-table th:nth-child(4) { width: 6%; }
  .games-table th:nth-child(5) { width: 8%; }
  .games-table th:nth-child(6) { width: 8%; }
  .games-table th:nth-child(7) { width: 7%; }
  .games-table th:nth-child(8) { width: 26%; }
  .games-table th:nth-child(9) { width: 10%; }
  .games-table .btn { min-height: 30px; padding: 0 6px; font-size: 11px; }
  .games-table td:nth-child(9) { overflow-wrap: normal; white-space: nowrap; }
  .games-table .status { min-width: 72px; justify-content: center; padding: 4px 7px; font-size: 10px; gap: 4px; }
  .status { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 8px; background: #e9f7f0; color: var(--green-dark); font-weight: 800; font-size: 12px; white-space: nowrap; flex-shrink: 0; }
  .status.wait { background: #fff3de; color: #8a5207; }
  .result-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 78px; min-height: 30px; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 900; text-transform: uppercase; }
  .result-pill.green { background: #e9f7f0; color: var(--green-dark); border: 1px solid var(--green); }
  .result-pill.red { background: #fdecec; color: var(--red); border: 1px solid var(--red); }
  .result-pill.push { background: #edf6fc; color: #174f7a; border: 1px solid var(--blue); }
  .result-pill.pending { background: #fff3de; color: #8a5207; border: 1px solid #f0c985; }
  .report-actions-cell { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .report-actions-cell .btn { min-height: 32px; padding: 0 10px; }
  .dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; }
  .stats { display: grid; gap: 3px; min-width: 0; font-size: 11px; line-height: 1.2; color: var(--muted); }
  .stat-line { border-left: 3px solid transparent; border-radius: 4px; padding: 2px 4px; background: #f7faf8; }
  .stat-data { border-left-color: var(--blue); background: #edf6fc; color: #174f7a; }
  .stat-ok { border-left-color: var(--green); background: #e9f7f0; color: var(--green-dark); }
  .stat-fail { border-left-color: var(--red); background: #fdecec; color: var(--red); }
  .stat-missing { border-left-color: var(--amber); background: #fff6e8; color: #8a5207; }
  .stat-grade { border-left-color: #263238; background: #eef1f0; color: #263238; font-weight: 800; }
  .empty { padding: 28px; color: var(--muted); text-align: center; }
  .mini-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
  .mini-stat { background: #f7faf8; border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .mini-stat span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; font-weight: 800; }
  .mini-stat strong { display: block; margin-top: 5px; font-size: 20px; }

  @media (max-width: 1100px) {
    .app { grid-template-columns: 1fr; }
    .nav { grid-template-columns: repeat(3, 1fr); }
    .date-search, .filters, .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 720px) {
    .main { padding: 16px; }
    .topbar { grid-template-columns: 1fr; }
    .actions { justify-content: stretch; }
    .actions .btn, .report-actions .btn { flex: 1 1 140px; min-width: 0; }
    .report-select { flex: 1 1 180px; min-width: 0; }
    .date-search, .filters, .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { padding: 12px; }
    .metric span { overflow-wrap: anywhere; font-size: 11px; }
    .metric strong { font-size: 24px; }
    .games-wrap { overflow-x: auto; }
    .games-table { min-width: 900px; }
    .report-table { min-width: 1000px; }
    th, td { padding: 10px; font-size: 13px; }
    .games-table th, .games-table td { padding: 6px 4px; font-size: 11px; }
    .games-table th { font-size: 9px; }
    .stats { font-size: 10px; }
  }

  @media (max-width: 420px) {
    .sidebar { padding: 18px 12px; }
    .main { padding: 12px; }
    .brand { align-items: flex-start; }
    .btn { padding: 0 10px; }
    .games-table th, .games-table td { font-size: 10px; }
  }
`;


export default function App() {
  const today = useMemo(() => getTodayInput(), []);
  const [selectedPage, setSelectedPage] = useState("dashboard");
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [dateStart, setDateStart] = useState(today);
  const [dateEnd, setDateEnd] = useState(today);
  const [liveInterval, setLiveInterval] = useState(300000);
  const [accessToken, setAccessToken] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const [reportRefresh, setReportRefresh] = useState(0);
  const [filters, setFilters] = useState({ league: "all", market: "all", minConfidence: 0, minOdd: 0, search: "", mostrarApenasAprovados: false });
  const [signals, setSignals] = useState([]);
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const [bankStatus, setBankStatus] = useState("Servidor conectado ao Firestore pela API.");
  const savedSignalKeysRef = useRef(new Set());
  const settlingSignalIdsRef = useRef(new Set());
  const deletedSignalIdsRef = useRef(new Set());

  const live = useLiveGames(liveInterval);
  const prematch = usePrematchGames();
  const sourceGames = selectedPage === "prematch" ? prematch.games : live.games;
  const updatedAt = selectedPage === "prematch" ? prematch.updatedAt : live.updatedAt;
  const statusText = selectedPage === "prematch" ? prematch.statusText : live.statusText;
  const analysis = useGameAnalysis(sourceGames, { ...filters, market: selectedMarket !== "all" ? selectedMarket : filters.market });

  useEffect(() => {
    live.start().catch((error) => {
      live.stop();
      setBankStatus(`Erro ao iniciar ao vivo: ${error.message}`);
      console.error(error);
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    if (!accessToken) { setBankStatus('Informe o token de envio para consultar o banco de sinais.'); return; }
    let timer;
    let cursor = 0;
    let since = "";
    let pendingOffset = 0;
    let pendingCursor = '';
    async function refreshReport() {
      let retryDelay = 300000;
      try {
        const pending = selectPendingSignalIds(signalsRef.current, pendingOffset);
        const payload = await listSignals(cursor, since, pending.ids, pendingCursor);
        if (stopped) return;
        since = payload.syncToken || since;
        pendingOffset = pending.nextOffset;
        pendingCursor = payload.pendingCursor || '';
        cursor = payload.settlement?.nextCursor || 0;
        const saved = payload.signals || [];
        saved.forEach((signal) => { if (signal.key) savedSignalKeysRef.current.add(signal.key); });
        setSignals((current) => mergeReportSignals(current, saved, deletedSignalIdsRef.current));
        if (payload.settlement?.errors?.length) {
          setBankStatus(`Resultados: falha na fonte. ${payload.settlement.errors[0]}`);
        } else if (payload.settlement?.updated) {
          setBankStatus(`${payload.settlement.updated} resultado(s) final(is) atualizado(s).`);
        } else {
          setBankStatus(`Banco consultado: ${payload.settlement?.pendingChecked || 0} pendente(s) revisado(s), aguardando resultado final confirmado.`);
        }
      } catch (error) {
        if (/quota|RESOURCE_EXHAUSTED/i.test(error.message)) retryDelay = 300000;
        if (!stopped) setBankStatus(`Erro ao consultar resultados: ${error.message}`);
      } finally {
        if (!stopped) timer = window.setTimeout(refreshReport, retryDelay);
      }
    }
    refreshReport();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [accessToken, reportRefresh]);

  useEffect(() => {
    if (!autoSave || !accessToken) return;
    const entries = analysis.filteredGames.filter((game) => {
      const isSignal = game.analise?.entrada || game.status === "Entrada";
      return isSignal && !isFinishedGame(game) && game.key && !savedSignalKeysRef.current.has(game.key);
    });
    if (!entries.length) return;

    let cancelled = false;
    async function autoSaveSignals() {
      let savedCount = 0;
      for (const game of entries) {
        try {
          savedSignalKeysRef.current.add(game.key);
          const saved = await saveSignal(game);
          if (cancelled) return;
          setSignals((current) => {
            const exists = current.some((signal) => signal.id === saved.id || signal.key === saved.key);
            if (exists) {
              return current.map((signal) => signal.id === saved.id || signal.key === saved.key ? { ...signal, ...saved } : signal);
            }
            savedCount += 1;
            return [saved, ...current];
          });
        } catch (error) {
          savedSignalKeysRef.current.delete(game.key);
          if (!cancelled) setBankStatus(`Erro ao salvar sinal automatico: ${error.message}`);
        }
      }
      if (!cancelled && savedCount > 0) setBankStatus(`${savedCount} novo(s) sinal(is) salvo(s). Confira o status de envio no relatorio.`);
    }

    autoSaveSignals();
    return () => {
      cancelled = true;
    };
  }, [analysis.filteredGames, autoSave, accessToken]);

  useEffect(() => {
    const gamesBySource = new Map();
    [...live.games, ...prematch.games, ...sourceGames].forEach((game) => {
      if (!game.sourceId) return;
      const current = gamesBySource.get(game.sourceId) || [];
      current.push(game);
      gamesBySource.set(game.sourceId, current);
    });

    const pendingSignals = signals.filter((signal) => {
      return signal.id && signal.sourceId && signal.result === "pendente" && !settlingSignalIdsRef.current.has(signal.id);
    });

    if (!pendingSignals.length || !gamesBySource.size) return;

    let cancelled = false;
    pendingSignals.forEach((signal) => {
      const candidates = gamesBySource.get(signal.sourceId) || [];
      const game = candidates.find((item) => item.market === signal.market) || candidates[0];
      if (!game) return;
      if (game.dateText !== signal.dateText) return;
      const settlement = buildFinalSignalUpdate(signal, game);
      if (!settlement) return;
      const result = settlement.result;

      settlingSignalIdsRef.current.add(signal.id);
      updateSignalResult(signal.id, result, settlement)
        .then((payload) => {
          setSignals((current) => current.map((item) => item.id === signal.id ? { ...item, ...payload } : item));
          setBankStatus(`Sinal ${result.toUpperCase()} atualizado ao fim do jogo.`);
        })
        .catch((error) => {
          settlingSignalIdsRef.current.delete(signal.id);
          if (!cancelled) setBankStatus(`Erro ao atualizar resultado automatico: ${error.message}`);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [signals, live.games, prematch.games, sourceGames]);

  async function openLive() {
    setSelectedPage("live");
    await live.start();
  }

  async function openPrematch() {
    setSelectedPage("prematch");
    live.stop();
    await prematch.search(dateStart, dateEnd);
  }

  async function changeSignalResult(id, result) {
    try {
      const update = await updateSignalResult(id, result);
      settlingSignalIdsRef.current.add(id);
      setSignals((current) => current.map((signal) => signal.id === id ? { ...signal, ...update } : signal));
    } catch (error) {
      setBankStatus(`Erro ao atualizar sinal: ${error.message}`);
    }
  }

  async function removeSignal(id) {
    await deleteSignal(id);
    deletedSignalIdsRef.current.add(id);
    settlingSignalIdsRef.current.delete(id);
    setSignals((current) => current.filter((signal) => signal.id !== id));
    setBankStatus("Sinal excluido do Firestore.");
  }

  function renderPage() {
    const commonProps = {
      games: analysis.filteredGames,
      metrics: analysis.metrics,
      leagues: analysis.leagues,
      filters,
      setFilters,
      selectedMarket,
      setSelectedMarket,
      marketCounts: analysis.marketCounts,
      updatedAt,
      statusText,
      signals,
      bankStatus,
      changeSignalResult,
      removeSignal,
      onRefreshResults: () => setReportRefresh(value => value + 1),
      canRefreshResults: Boolean(accessToken),
      dateStart,
      setDateStart,
      dateEnd,
      setDateEnd,
      liveInterval,
      setLiveInterval,
      onLive: openLive,
      onPrematch: openPrematch,
      onStopLive: live.stop,
      liveActive: live.active
    };

    if (selectedPage === "live") return <Live {...commonProps} />;
    if (selectedPage === "prematch") return <Prematch {...commonProps} />;
    if (selectedPage === "details") return <GameDetails {...commonProps} />;
    return <Dashboard {...commonProps} />;
  }

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div>
              <strong>Central Esportiva</strong>
              <span>pre-jogo e ao vivo</span>
            </div>
          </div>
          <MarketNav
            selectedMarket={selectedMarket}
            setSelectedMarket={setSelectedMarket}
            marketCounts={analysis.marketCounts}
            selectedPage={selectedPage}
            setSelectedPage={setSelectedPage}
          />
          <div className="field">
            <label htmlFor="accessToken">Token de envio</label>
            <input id="accessToken" type="password" autoComplete="off" value={accessToken} onChange={(event) => { setApiAccessToken(event.target.value); setAccessToken(event.target.value); }} />
          </div>
          <label className="check-label"><input type="checkbox" checked={autoSave} disabled={!accessToken} onChange={(event) => setAutoSave(event.target.checked)} />Salvar e enviar entradas</label>
          <p>Confiabilidade: pontuação do scanner, não probabilidade de acerto.</p>
        </aside>
        {renderPage()}
      </div>
    </>
  );
}

function MarketNav({ selectedMarket, setSelectedMarket, marketCounts, selectedPage, setSelectedPage }) {
  const total = Object.values(marketCounts).reduce((sum, count) => sum + count, 0);
  const markets = [
    ["all", "Painel geral", total],
    ["over05", "+0.5 gols", marketCounts.over05 || 0],
    ["over15", "+1.5 gols", marketCounts.over15 || 0],
    ["over25", "+2.5 gols", marketCounts.over25 || 0],
    ["under25", "Under 2.5", marketCounts.under25 || 0],
    ["under35", "Under 3.5 IA", marketCounts.under35 || 0],
    ["corners", "Escanteios", marketCounts.corners || 0],
    ["handicap", "Handicap", marketCounts.handicap || 0],
    ["ml", "ML", marketCounts.ml || 0]
  ];

  return (
    <nav className="nav" aria-label="Mercados">
      {markets.map(([market, label, count]) => (
        <button
          key={market}
          className={`${selectedMarket === market && selectedPage === "dashboard" ? "active" : ""} ${count > 0 ? "has-signal" : ""}`}
          onClick={() => {
            setSelectedPage("dashboard");
            setSelectedMarket(market);
          }}
        >
          {label}
          {count > 0 && <span className="signal-count">{count}</span>}
        </button>
      ))}
    </nav>
  );
}
