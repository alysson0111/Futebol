import MarketSelector from "./MarketSelector.jsx";

export default function FiltersBar({ leagues, filters, setFilters, selectedMarket, setSelectedMarket }) {
  function update(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="filters panel" aria-label="Filtros">
      <div className="field">
        <label htmlFor="leagueFilter">Liga</label>
        <select id="leagueFilter" value={filters.league} onChange={(event) => update("league", event.target.value)}>
          <option value="all">Todas</option>
          {leagues.map((league) => <option key={league} value={league}>{league}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="marketFilter">Mercado</label>
        <MarketSelector
          value={selectedMarket !== "all" ? selectedMarket : filters.market}
          onChange={(value) => {
            setSelectedMarket("all");
            update("market", value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="minConfidence">Confianca minima</label>
        <input id="minConfidence" type="number" min="0" max="100" value={filters.minConfidence} onChange={(event) => update("minConfidence", event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="search">Buscar jogo</label>
        <input id="search" placeholder="Time ou liga" value={filters.search} onChange={(event) => update("search", event.target.value)} />
      </div>
      <div className="field check-field">
        <label className="check-label" htmlFor="approvedOnly">
          <input
            id="approvedOnly"
            type="checkbox"
            checked={Boolean(filters.mostrarApenasAprovados)}
            onChange={(event) => update("mostrarApenasAprovados", event.target.checked)}
          />
          Só aprovados
        </label>
      </div>
    </section>
  );
}
