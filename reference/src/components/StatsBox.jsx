import { currencyOdd } from "../analysis/scoreUtils.js";

export default function StatsBox({ metrics }) {
  return (
    <section className="metrics" aria-label="Resumo">
      <div className="metric"><span>Jogos analisados</span><strong>{metrics.games}</strong></div>
      <div className="metric"><span>Entradas fortes</span><strong>{metrics.entries}</strong></div>
      <div className="metric"><span>Confianca media</span><strong>{Math.round(metrics.confidenceAvg)}%</strong></div>
    </section>
  );
}
