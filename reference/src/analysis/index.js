import { over05 } from "./over05.js";
import { over15 } from "./over15.js";
import { over25 } from "./over25.js";
import { under25 } from "./under25.js";
import { under35 } from "./under35.js";
import { corners } from "./corners.js";
import { handicap } from "./handicap.js";
import { ml } from "./ml.js";

export const markets = {
  over05,
  over15,
  over25,
  under25,
  under35,
  corners,
  handicap,
  ml
};

export function getMarketLabel(market) {
  return markets[market]?.label || market;
}

export function analisarMercado(jogo, mercadoSelecionado = "all") {
  const mercado = mercadoSelecionado !== "all" ? mercadoSelecionado : jogo.market;
  const statusOriginal = jogo.status || "Observar";
  const confianca = Number(jogo.confidence || 0);
  const odd = Number(jogo.odd || 0);
  const sinais = Array.isArray(jogo.stats) ? jogo.stats : [];
  const dadosJogo = Array.isArray(jogo.dadosJogo) ? jogo.dadosJogo : [];
  const entrada = statusOriginal === "Entrada";

  return {
    mercado,
    label: jogo.marketLabel || getMarketLabel(mercado),
    status: entrada ? "aprovado" : "observacao",
    statusOriginal,
    confianca,
    odd,
    sinais,
    dadosJogo,
    entrada,
    grade: jogo.grade || "",
    mlPick: jogo.mlPick || "",
    mlPickLabel: jogo.mlPickLabel || "",
    linhas: jogo.signals || []
  };
}
