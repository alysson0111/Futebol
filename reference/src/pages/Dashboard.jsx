import { useMemo, useState } from "react";
import FiltersBar from "../components/FiltersBar.jsx";
import GameCard from "../components/GameCard.jsx";
import StatsBox from "../components/StatsBox.jsx";
import { getMarketLabel } from "../analysis/index.js";
import { calculateReport, currencyOdd, escapeCsv, getTodayInput } from "../analysis/scoreUtils.js";
import { isFinishedGame } from "../analysis/signalSettlement.js";

const REPORT_MARKETS = ["all", "over05", "over15", "over25", "under25", "under35", "corners", "handicap", "ml"];
const DEFAULT_CORNER_LINE = "Over 9.5 escanteios";
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function isCornerSignal(signal) {
  const market = String(signal.market || signal.marketLabel || "").toLowerCase();
  return market.includes("corner") || market.includes("escanteio");
}

function getMlSignalText(signal) {
  const label = String(signal.mlPickLabel || "").trim();
  if (label) return `ML ${label}`;
  if (signal.mlPick === "home") return `ML Casa (${signal.home || "mandante"})`;
  if (signal.mlPick === "away") return `ML Fora (${signal.away || "visitante"})`;
  if (signal.mlPick === "draw") return "ML Empate";
  return "ML";
}

function getSignalText(signal) {
  const lines = Array.isArray(signal.signalLines) ? signal.signalLines.filter(Boolean) : [];
  if (isCornerSignal(signal)) return lines.find((line) => /9\.5/.test(String(line))) || lines[0] || DEFAULT_CORNER_LINE;
  if (signal.market === "ml") return getMlSignalText(signal);
  if (lines.length) return lines.join(", ");
  return signal.marketLabel || getMarketLabel(signal.market) || "-";
}

function getCornerCount(signal) {
  if (!isCornerSignal(signal)) return "-";
  const status = String(signal.liveStatus || "").toUpperCase();
  if (signal.liveCorners === null || signal.liveCorners === undefined || signal.liveCorners === "") {
    return status === "NS" ? "Nao iniciou" : "Sem dado";
  }
  const total = Number(signal.liveCorners);
  return Number.isFinite(total) ? total : "Sem dado";
}

export default function Dashboard(props) {
  const title = props.title || "Radar de oportunidades";
  const subtitle = props.subtitle || "Jogos analisados pelos scanners internos do sistema.";

  return (
    <main className="main">
      <Topbar {...props} title={title} subtitle={subtitle} />
      <SearchBar {...props} />
      <FiltersBar {...props} />
      <StatsBox metrics={props.metrics} />
      <GameCard games={props.games} updatedAt={props.updatedAt} />
      <SignalsReport {...props} />
    </main>
  );
}

export function Topbar({ title, subtitle, onLive, onPrematch, onStopLive, liveActive }) {
  return (
    <section className="topbar">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onLive}>Jogos em Andamento</button>
        <button className="btn primary" onClick={onPrematch}>Atualizar analise</button>
        <button className="btn primary" onClick={onLive}>{liveActive ? "Ao vivo ativo" : "Ao vivo"}</button>
        <button className="btn" onClick={onStopLive} disabled={!liveActive}>Parar ao vivo</button>
      </div>
    </section>
  );
}

export function SearchBar({ dateStart, setDateStart, dateEnd, setDateEnd, liveInterval, setLiveInterval, onPrematch }) {
  return (
    <section className="date-search panel" aria-label="Busca por periodo">
      <div className="field">
        <label htmlFor="dateStart">Data inicial</label>
        <input id="dateStart" type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="dateEnd">Data final</label>
        <input id="dateEnd" type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sourceInfo">Fonte</label>
        <input id="sourceInfo" value="TotalCorner / Forebet" readOnly />
      </div>
      <div className="field">
        <label htmlFor="liveInterval">Ao vivo</label>
        <select id="liveInterval" value={liveInterval} onChange={(event) => setLiveInterval(Number(event.target.value))}>
          <option value="10000">10 segundos</option>
          <option value="15000">15 segundos</option>
          <option value="30000">30 segundos</option>
          <option value="60000">60 segundos</option>
          <option value="120000">2 minutos</option>
          <option value="300000">5 minutos</option>
        </select>
      </div>
      <button className="btn primary" onClick={onPrematch}>Buscar periodo</button>
    </section>
  );
}

export function SignalsReport({ signals, bankStatus, changeSignalResult, removeSignal, dateStart, dateEnd }) {
  const [reportMarket, setReportMarket] = useState("all");
  const filteredSignals = useMemo(() => {
    return signals.filter(signal => {
      const parts = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(signal.createdAtText || '');
      const day = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null;
      return (reportMarket === 'all' || signal.market === reportMarket) && day && (!dateStart || day >= dateStart) && (!dateEnd || day <= dateEnd);
    });
  }, [signals, reportMarket, dateStart, dateEnd]);
  const report = calculateReport(filteredSignals);
  const resultLabel = { green: "Green", push: "Push", red: "Red", pendente: "Pendente" };

  function exportCsv() {
    const header = ["data_hora", "jogo", "liga", "placar_entrada", "placar", "mercado", "sinal", "escanteios_jogo", "confianca", "resultado", "scanner"];
    const rows = filteredSignals.map((signal) => [
      signal.createdAtText || "",
      `${signal.home} x ${signal.away}`,
      signal.league || "",
      signal.entryScoreText ?? "",
      signal.scoreText || "",
      signal.marketLabel || signal.market || "",
      getSignalText(signal),
      getCornerCount(signal),
      `${Math.round(Number(signal.confidence || 0))}%`,
      signal.result || "pendente",
      (signal.stats || []).join(" | ")
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-sinais-${getTodayInput()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportPdf() {
    const win = window.open("", "_blank");
    if (!win) return;
    const selectedMarketLabel = reportMarket === "all" ? "Todos" : getMarketLabel(reportMarket);
    const rows = filteredSignals.map((signal) => `
      <tr>
        <td>${html(signal.createdAtText || "-")}</td>
        <td>${html(signal.home)} x ${html(signal.away)}</td>
        <td>${html(signal.league || "-")}</td>
        <td>${html(signal.scoreText || "-")}</td>
        <td>${html(signal.marketLabel || signal.market)}</td>
        <td>${html(getSignalText(signal))}</td>
        <td>${html(getCornerCount(signal))}</td>
        <td>${Math.round(Number(signal.confidence || 0))}%</td>
        <td>${html(signal.result || "pendente")}</td>
      </tr>
    `).join("");
    win.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>Relatorio de sinais</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #17211c; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #dbe5df; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #eef4ef; }
          </style>
        </head>
        <body>
          <h1>Relatorio de sinais</h1>
          <p>Mercado: ${html(selectedMarketLabel)}</p>
          <table>
            <thead><tr><th>Data/Hora</th><th>Jogo</th><th>Liga</th><th>Placar</th><th>Mercado</th><th>Sinal</th><th>Escanteios jogo</th><th>Confianca</th><th>Resultado</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <section className="report-grid">
      <div className="report-box panel">
        <div className="report-head">
          <div>
            <h2>Relatorio de sinais</h2>
            <p className="subtitle">{bankStatus}</p>
          </div>
          <div className="report-actions">
            <select
              className="report-select"
              value={reportMarket}
              onChange={(event) => setReportMarket(event.target.value)}
              aria-label="Mercado do relatorio"
            >
              {REPORT_MARKETS.map((market) => (
                <option key={market} value={market}>{market === "all" ? "Todos os mercados" : getMarketLabel(market)}</option>
              ))}
            </select>
            <button className="btn" onClick={exportCsv}>Excel CSV</button>
            <button className="btn" onClick={exportPdf}>PDF</button>
          </div>
        </div>
        <div className="mini-stats">
          <div className="mini-stat"><span>Total</span><strong>{report.total}</strong></div>
          <div className="mini-stat"><span>Green</span><strong>{report.green}</strong></div>
          <div className="mini-stat"><span>Red</span><strong>{report.red}</strong></div>
          <div className="mini-stat"><span>Push</span><strong>{report.push}</strong></div>
          <div className="mini-stat"><span>Assertividade</span><strong>{report.hitRate}%</strong></div>
        </div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Jogo</th>
                <th>Liga</th>
                <th>Placar</th>
                <th>Mercado</th>
                <th>Sinal</th>
                <th>Escanteios jogo</th>
                <th>Confianca</th>
                <th>Resultado</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {!filteredSignals.length && <tr><td colSpan="10" className="empty">Nenhum sinal salvo neste mercado.</td></tr>}
              {filteredSignals.map((signal) => (
                <tr key={signal.id}>
                  <td>{signal.createdAtText || "-"}</td>
                  <td>{signal.home} x {signal.away}</td>
                  <td>{signal.league || "-"}</td>
                  <td title={signal.finalConfirmed ? `Placar da entrada: ${signal.entryScoreText || "-"}` : "Placar da entrada"}>{signal.scoreText || "-"}</td>
                  <td>{signal.marketLabel || signal.market}</td>
                  <td>{getSignalText(signal)}</td>
                  <td>{getCornerCount(signal)}</td>
                  <td>{Math.round(Number(signal.confidence || 0))}%</td>
                  <td>
                    <span className={`result-pill ${["green", "push", "red"].includes(signal.result) ? signal.result : "pending"}`}>
                      {resultLabel[signal.result] || "Pendente"}
                    </span>
                  </td>
                  <td className="report-actions-cell">
                    {signal.telegram && <span>Telegram: {signal.telegram.status}{signal.telegram.error ? ` · ${signal.telegram.error}` : ''}</span>}
                    <button className="btn green" disabled={!isFinishedGame(signal)} onClick={() => changeSignalResult(signal.id, "green")}>Green</button>
                    <button className="btn" disabled={!isFinishedGame(signal)} onClick={() => changeSignalResult(signal.id, "push")}>Push</button>
                    <button className="btn red" disabled={!isFinishedGame(signal)} onClick={() => changeSignalResult(signal.id, "red")}>Red</button>
                    <button className="btn red" onClick={() => removeSignal(signal.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
