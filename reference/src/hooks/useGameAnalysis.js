import { useMemo } from "react";
import { analisarMercado } from "../analysis/index.js";

export function useGameAnalysis(games, filters) {
  return useMemo(() => {
    const selectedMarket = filters.market || "all";
    const jogosComAnalise = games.map((jogo) => {
      const analise = analisarMercado(jogo, selectedMarket);

      return {
        ...jogo,
        analise
      };
    });

    const iaMarkets = new Set(["over05", "over15", "over25", "under25", "under35", "ml"]);
    const mostrarApenasAprovados = Boolean(filters.mostrarApenasAprovados) || iaMarkets.has(selectedMarket);
    const jogosExibidos = mostrarApenasAprovados
      ? jogosComAnalise.filter((jogo) => jogo.analise.status === "aprovado")
      : jogosComAnalise;

    const leagues = [...new Set(jogosComAnalise.map((game) => game.league).filter(Boolean))].sort();
    const filteredGames = jogosExibidos.filter((game) => {
      if (filters.league !== "all" && game.league !== filters.league) return false;
      if (selectedMarket !== "all" && game.market !== selectedMarket) return false;
      if (Number(game.analise.confianca || 0) < Number(filters.minConfidence || 0)) return false;
      if (Number(game.analise.odd || 0) < Number(filters.minOdd || 0)) return false;
      const search = String(filters.search || "").trim().toLowerCase();
      if (search && !`${game.home} ${game.away} ${game.league}`.toLowerCase().includes(search)) return false;
      return true;
    });

    const entries = filteredGames.filter((game) => game.analise.entrada);
    const uniqueGames = new Set(filteredGames.map((game) => game.sourceId || game.key)).size;
    const oddAvg = entries.length ? entries.reduce((sum, game) => sum + Number(game.analise.odd || 0), 0) / entries.length : 0;
    const confidenceAvg = entries.length ? entries.reduce((sum, game) => sum + Number(game.analise.confianca || 0), 0) / entries.length : 0;
    const marketCounts = jogosComAnalise.reduce((acc, game) => {
      if (game.analise.entrada) acc[game.market] = (acc[game.market] || 0) + 1;
      return acc;
    }, {});

    return {
      leagues,
      filteredGames,
      marketCounts,
      metrics: {
        games: uniqueGames,
        entries: entries.length,
        oddAvg,
        confidenceAvg
      }
    };
  }, [games, filters]);
}
