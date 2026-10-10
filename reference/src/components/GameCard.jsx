import AnalysisBadge from "./AnalysisBadge.jsx";
import { currencyOdd } from "../analysis/scoreUtils.js";
import { getMarketLabel } from "../analysis/index.js";

function getStatClass(entry) {
  const value = String(entry || "").trim().toUpperCase();
  if (value.startsWith("OK |")) return "stat-line stat-ok";
  if (value.startsWith("NAO |") || value.startsWith("NÃO |")) return "stat-line stat-fail";
  if (value.startsWith("SEM DADO |")) return "stat-line stat-missing";
  if (value.startsWith("DADO |")) return "stat-line stat-data";
  if (value.startsWith("CLASSIFICACAO") || value.startsWith("CLASSIFICAÇÃO")) return "stat-line stat-grade";
  return "stat-line";
}

function getGameSignalLines(game) {
  const generated = game.analise?.linhas || game.signals || [];
  const mlLine = game.market === "ml" && game.mlPickLabel ? [`ML ${game.mlPickLabel}`] : [];
  return [...new Set([...mlLine, ...generated].map(String).filter(Boolean))];
}

export default function GameCard({ games, updatedAt }) {
  if (!games.length) {
    return (
      <section className="table-panel panel">
        <div className="table-head">
          <h2>Lista de jogos</h2>
          <span className="subtitle">{updatedAt}</span>
        </div>
        <div className="empty">Nenhum jogo encontrado.</div>
      </section>
    );
  }

  return (
    <section className="table-panel panel">
      <div className="table-head">
        <h2>Lista de jogos</h2>
        <span className="subtitle">{updatedAt}</span>
      </div>
      <div className="table-wrap games-wrap">
        <table className="games-table">
          <thead>
            <tr>
              <th>Jogo</th>
              <th>Liga</th>
              <th>Tempo</th>
              <th>Placar</th>
              <th>Mercado</th>
              <th>Data</th>
              <th>Confianca</th>
              <th>Sinais</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const signalLines = getGameSignalLines(game);
              const dataLines = game.analise?.dadosJogo || game.dadosJogo || [];
              const scannerLines = game.analise?.sinais || game.stats || [];
              return (
                <tr key={game.key}>
                  <td><strong>{game.home} x {game.away}</strong></td>
                  <td>{game.league}</td>
                  <td>{game.liveStatus || game.time || "-"}</td>
                  <td>{game.scoreText || "-"}</td>
                  <td>{game.analise?.label || game.marketLabel || getMarketLabel(game.market)}</td>
                  <td>{game.dateText || "-"}</td>
                  <td>{Math.round(Number(game.analise?.confianca ?? game.confidence ?? 0))}%</td>
                  <td>
                    <div className="stats">
                      {signalLines.map((entry) => <span className="stat-line stat-grade" key={`signal-${entry}`}>SINAL | {entry}</span>)}
                      {dataLines.map((entry) => <span className={getStatClass(entry)} key={entry}>{entry}</span>)}
                      {scannerLines.slice(0, 8).map((entry) => <span className={getStatClass(entry)} key={entry}>{entry}</span>)}
                      {!(dataLines.length || scannerLines.length || signalLines.length) && <span className="stat-line stat-missing">Sem dados da API</span>}
                    </div>
                  </td>
                  <td><AnalysisBadge status={game.analise?.statusOriginal || game.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
