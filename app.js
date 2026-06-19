const state = {
  events: [],
  selected: null,
  liveOnly: true,
  matchGoalAlerts: [],
  resultsPayload: null,
  reportPayload: null
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;

const els = {
  dateInput: document.querySelector("#dateInput"),
  sportInput: document.querySelector("#sportInput"),
  searchInput: document.querySelector("#searchInput"),
  leagueFilter: document.querySelector("#leagueFilter"),
  startedToggle: document.querySelector("#startedToggle"),
  matchGoalButton: document.querySelector("#matchGoalButton"),
  resultsType: document.querySelector("#resultsType"),
  stakeInput: document.querySelector("#stakeInput"),
  resultsButton: document.querySelector("#resultsButton"),
  reportButton: document.querySelector("#reportButton"),
  reportDialog: document.querySelector("#reportDialog"),
  reportDateInput: document.querySelector("#reportDateInput"),
  reportEndDateInput: document.querySelector("#reportEndDateInput"),
  reportTypeInput: document.querySelector("#reportTypeInput"),
  consultReportButton: document.querySelector("#consultReportButton"),
  minuteSimulatorButton: document.querySelector("#minuteSimulatorButton"),
  minuteSimulatorDialog: document.querySelector("#minuteSimulatorDialog"),
  simulatorMarketInput: document.querySelector("#simulatorMarketInput"),
  simulatorStartDateInput: document.querySelector("#simulatorStartDateInput"),
  simulatorEndDateInput: document.querySelector("#simulatorEndDateInput"),
  simulatorMinuteInput: document.querySelector("#simulatorMinuteInput"),
  runMinuteSimulatorButton: document.querySelector("#runMinuteSimulatorButton"),
  loadButton: document.querySelector("#loadButton"),
  sourceStatus: document.querySelector("#sourceStatus"),
  sourceMessage: document.querySelector("#sourceMessage"),
  matchCount: document.querySelector("#matchCount"),
  matches: document.querySelector("#matches"),
  emptyState: document.querySelector("#emptyState"),
  resultsPanel: document.querySelector("#resultsPanel"),
  analysisState: document.querySelector("#analysisState"),
  leagueName: document.querySelector("#leagueName"),
  fixtureTitle: document.querySelector("#fixtureTitle"),
  fixtureMeta: document.querySelector("#fixtureMeta"),
  predictButton: document.querySelector("#predictButton"),
  prediction: document.querySelector("#prediction"),
  inputs: {
    formHome: document.querySelector("#formHome"),
    formAway: document.querySelector("#formAway"),
    attackHome: document.querySelector("#attackHome"),
    attackAway: document.querySelector("#attackAway"),
    defenseHome: document.querySelector("#defenseHome"),
    defenseAway: document.querySelector("#defenseAway"),
    absencesHome: document.querySelector("#absencesHome"),
    absencesAway: document.querySelector("#absencesAway")
  }
};

function formatDate(timestamp) {
  if (!timestamp) return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp * 1000));
}

function formatShortTime(timestamp) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value || 0));
}

function formatPtDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`));
}

function reportPeriodLabel(payload) {
  const startDate = payload.startDate || payload.date;
  const endDate = payload.endDate || payload.date;
  if (!startDate || startDate === endDate) return formatPtDate(startDate);
  return `${formatPtDate(startDate)} a ${formatPtDate(endDate)}`;
}

function reportPeriodSlug(payload) {
  const startDate = payload.startDate || payload.date;
  const endDate = payload.endDate || payload.date;
  return startDate === endDate ? startDate : `${startDate}-a-${endDate}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1).replace(".", ",")}%`;
}

function currentStake() {
  const value = Number(String(els.stakeInput.value || "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function recordOdd(record) {
  const odd = Number(record.alert?.marketOdd ?? record.alert?.fairOdd ?? 0);
  return Number.isFinite(odd) && odd > 0 ? odd : 0;
}

function betSimulation(results) {
  const stake = currentStake();
  const resolved = (results || []).filter(item =>
    item.result?.status === "finished"
    && item.result?.hit !== null
    && (item.result?.hit === false || recordOdd(item.record) > 0)
  );
  const hits = resolved.filter(item => item.result.hit);
  const misses = resolved.filter(item => item.result.hit === false);
  const totalStaked = resolved.length * stake;
  const grossReturn = hits.reduce((total, item) => total + stake * recordOdd(item.record), 0);
  const profit = hits.reduce((total, item) => total + stake * (recordOdd(item.record) - 1), 0) - misses.length * stake;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;

  return {
    stake,
    resolved: resolved.length,
    totalStaked,
    grossReturn,
    profit,
    roi
  };
}

function renderBetSimulation(results) {
  const simulation = betSimulation(results);
  return `
    <div class="finance-grid">
      <div><span>Valor por sinal</span><b>${formatMoney(simulation.stake)}</b></div>
      <div><span>Investido</span><b>${formatMoney(simulation.totalStaked)}</b></div>
      <div><span>Retorno greens</span><b>${formatMoney(simulation.grossReturn)}</b></div>
      <div><span>Lucro/Prejuízo</span><b class="${simulation.profit >= 0 ? "positive" : "negative"}">${formatMoney(simulation.profit)}</b></div>
      <div><span>ROI</span><b class="${simulation.roi >= 0 ? "positive" : "negative"}">${formatPercent(simulation.roi)}</b></div>
    </div>
  `;
}

function textForEvent(event) {
  return [
    event.homeTeam?.name,
    event.awayTeam?.name,
    event.tournament?.name,
    event.tournament?.category?.name
  ].join(" ").toLowerCase();
}

function leagueKey(event) {
  return [
    event.tournament?.category?.name || "País não informado",
    event.tournament?.name || "Competição"
  ].join(" - ");
}

function isStarted(event) {
  const type = String(event.status?.type || "").toLowerCase();
  const description = String(event.status?.description || "").toLowerCase();
  return !["notstarted", "ns", "tbd", ""].includes(type)
    || description.includes("1")
    || description.includes("half")
    || description.includes("intervalo")
    || description.includes("iniciado")
    || description.includes("finished")
    || description.includes("encerrado");
}

function isLive(event) {
  const type = String(event.status?.type || "").toLowerCase();
  const description = String(event.status?.description || "").toLowerCase();
  const elapsed = Number(event.status?.elapsed || 0);
  const liveTypes = ["1h", "2h", "ht", "et", "p", "bt", "live", "inprogress"];
  return liveTypes.includes(type)
    || elapsed > 0
    || description.includes("1st")
    || description.includes("2nd")
    || description.includes("half")
    || description.includes("ao vivo")
    || description.includes("intervalo");
}

function isFinished(event) {
  const type = String(event.status?.type || "").toLowerCase();
  const description = String(event.status?.description || "").toLowerCase();
  const finishedTypes = ["ft", "aet", "pen", "finished", "afterpen", "canc", "abd", "awd", "wo"];
  return finishedTypes.includes(type)
    || description.includes("finished")
    || description.includes("match finished")
    || description.includes("after extra time")
    || description.includes("after penalties")
    || description.includes("encerrado")
    || description.includes("finalizado")
    || description.includes("fim");
}

function statusLabel(event) {
  const elapsed = Number(event.status?.elapsed || 0);
  if (isLive(event) && elapsed > 0) {
    return `${elapsed}' · Ao vivo`;
  }
  if (isLive(event)) {
    return translateStatus(event.status?.type, event.status?.description || "Ao vivo");
  }
  return translateStatus(event.status?.type, event.status?.description) || "status indisponível";
}

function translateStatus(type, description = "") {
  const key = String(type || "").toLowerCase();
  const statusMap = {
    notstarted: "Não iniciado",
    ns: "Não iniciado",
    "1h": "1º tempo",
    "2h": "2º tempo",
    ht: "Intervalo",
    bt: "Intervalo",
    et: "Prorrogação",
    p: "Pênaltis",
    ft: "Encerrado",
    aet: "Encerrado após prorrogação",
    pen: "Encerrado nos pênaltis",
    pst: "Adiado",
    post: "Adiado",
    susp: "Suspenso",
    int: "Interrompido",
    canc: "Cancelado",
    abd: "Abandonado",
    awd: "Resultado administrativo",
    wo: "W.O.",
    tbd: "A definir"
  };
  if (statusMap[key]) return statusMap[key];

  const text = String(description || "").toLowerCase();
  if (text.includes("not started")) return "Não iniciado";
  if (text.includes("match finished") || text.includes("finished")) return "Encerrado";
  if (text.includes("postponed")) return "Adiado";
  if (text.includes("cancelled") || text.includes("canceled")) return "Cancelado";
  if (text.includes("halftime")) return "Intervalo";
  if (text.includes("live")) return "Ao vivo";
  return description;
}

function hasScore(event) {
  return event.score?.home !== null
    && event.score?.home !== undefined
    && event.score?.away !== null
    && event.score?.away !== undefined;
}

function scoreText(event) {
  if (!hasScore(event)) return "";
  return `${event.score.home} x ${event.score.away}`;
}

function populateLeagueFilter() {
  const selected = els.leagueFilter.value;
  const leagues = [...new Set(state.events.map(leagueKey))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  els.leagueFilter.innerHTML = '<option value="">Todos os campeonatos</option>';

  for (const league of leagues) {
    const option = document.createElement("option");
    option.value = league;
    option.textContent = league;
    els.leagueFilter.append(option);
  }

  if (leagues.includes(selected)) {
    els.leagueFilter.value = selected;
  }
}

function filteredEvents() {
  const query = els.searchInput.value.trim().toLowerCase();
  const league = els.leagueFilter.value;

  return state.events.filter(event => {
    if (isFinished(event)) return false;
    if (query && !textForEvent(event).includes(query)) return false;
    if (league && leagueKey(event) !== league) return false;
    if (state.liveOnly && !isLive(event)) return false;
    return true;
  });
}

function groupedByLeague(events) {
  return events.reduce((groups, event) => {
    const key = leagueKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
    return groups;
  }, new Map());
}

function renderMatches() {
  const events = filteredEvents();
  els.matchCount.textContent = String(events.length);
  els.matches.innerHTML = "";

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "model-note";
    empty.textContent = "Nenhum jogo encontrado para os filtros atuais.";
    els.matches.append(empty);
    return;
  }

  for (const [league, leagueEvents] of groupedByLeague(events)) {
    const group = document.createElement("section");
    group.className = "league-group";

    const heading = document.createElement("div");
    heading.className = "league-heading";
    heading.innerHTML = `<h3>${league}</h3><span>${leagueEvents.length}</span>`;
    group.append(heading);

    for (const event of leagueEvents) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `match-card ${state.selected?.id === event.id ? "active" : ""}`;
      button.innerHTML = `
        <span class="match-line">
          <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
          ${hasScore(event) ? `<b class="current-score">${scoreText(event)}</b>` : ""}
        </span>
        <small>${formatDate(event.startTimestamp)} · <span class="${isLive(event) ? "live-minute" : ""}">${statusLabel(event)}</span></small>
        ${isLive(event) ? `
          <span class="match-odds ${event.liveOver05 ? "" : "unavailable"}">
            <span>Over 0.5</span>
            <b>${event.liveOver05 ? Number(event.liveOver05.odd).toFixed(2) : "indisponível"}</b>
          </span>
        ` : ""}
      `;
      button.addEventListener("click", () => selectEvent(event));
      group.append(button);
    }

    els.matches.append(group);
  }
}

function selectEvent(event) {
  state.selected = event;
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.add("hidden");
  els.analysisState.classList.remove("hidden");
  els.prediction.classList.add("hidden");
  els.leagueName.textContent = `${event.tournament?.name || "Competição"} · ${event.tournament?.category?.name || "País"}`;
  els.fixtureTitle.textContent = hasScore(event)
    ? `${event.homeTeam?.name || "Mandante"} ${scoreText(event)} ${event.awayTeam?.name || "Visitante"}`
    : `${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}`;
  const stadium = event.venue?.stadium?.name ? ` · ${event.venue.stadium.name}` : "";
  els.fixtureMeta.textContent = `${formatDate(event.startTimestamp)}${stadium}`;
  renderMatches();
}

function readInputs() {
  return Object.fromEntries(
    Object.entries(els.inputs).map(([key, input]) => {
      const value = input.value;
      return [key, value === "" ? undefined : Number(value)];
    })
  );
}

function line(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function listItems(items) {
  return items.map(item => `<li>${item}</li>`).join("");
}

function renderDeepAnalysis(analysis) {
  if (!analysis) return "";
  return `
    <div class="deep-analysis">
      <section>
        <h3>Contexto do jogo</h3>
        <ul>${listItems(analysis.context)}</ul>
      </section>

      <section>
        <h3>Momento das equipes</h3>
        <div class="team-moment-grid">
          ${analysis.teamMoments.map(team => `
            <div>
              <h4>${team.team}</h4>
              <ul>${listItems(team.lines)}</ul>
            </div>
          `).join("")}
        </div>
      </section>

      <section>
        <h3>Tendências do jogo</h3>
        <ul>${listItems(analysis.tendencies)}</ul>
        <div class="scenario-row">
          ${analysis.scenarios.map(score => `<span>${score}</span>`).join("")}
        </div>
      </section>

      <section>
        <h3>Melhores apostas</h3>
        <ul>${listItems(analysis.bestBets)}</ul>
      </section>

      <section>
        <h3>Leitura tática</h3>
        <ul>${listItems(analysis.tacticalReading)}</ul>
      </section>

      <section class="final-read">
        <h3>Palpite final</h3>
        <strong>${analysis.finalPick}</strong>
      </section>

      <section>
        <h3>Resumo pra aposta</h3>
        <div class="bet-summary">
          <div><span>Mais segura</span><b>${analysis.bettingSummary.safe}</b></div>
          <div><span>Média</span><b>${analysis.bettingSummary.medium}</b></div>
          <div><span>Arriscada</span><b>${analysis.bettingSummary.risky}</b></div>
        </div>
      </section>
    </div>
  `;
}

function renderPrediction(prediction) {
  els.prediction.innerHTML = `
    <div class="hero-prediction">
      <div>
        <div class="pick">${prediction.pick}</div>
        <p>Confiança do modelo: <strong>${prediction.confidence}%</strong></p>
        <div class="probabilities">
          <div class="probability-row"><span>Casa</span><div class="bar"><i style="width:${prediction.probabilities.home}%"></i></div><span>${prediction.probabilities.home}%</span></div>
          <div class="probability-row"><span>Empate</span><div class="bar"><i style="width:${prediction.probabilities.draw}%"></i></div><span>${prediction.probabilities.draw}%</span></div>
          <div class="probability-row"><span>Fora</span><div class="bar"><i style="width:${prediction.probabilities.away}%"></i></div><span>${prediction.probabilities.away}%</span></div>
        </div>
      </div>
      <div class="score">${prediction.expectedScore}</div>
    </div>
    <div class="market-grid">
      ${line("Dupla chance", prediction.markets.doubleChance)}
      ${line("Linha de gols", prediction.markets.goals)}
      ${line("Ambas marcam", prediction.markets.bothTeamsScore)}
    </div>
    <div class="list-lines">
      ${prediction.signals.map(item => `<div>${item}</div>`).join("")}
      ${prediction.riskFlags.map(item => `<div>${item}</div>`).join("")}
    </div>
    ${renderDeepAnalysis(prediction.deepAnalysis)}
    <p class="model-note">${prediction.model}</p>
  `;
  els.prediction.classList.remove("hidden");
}

function renderFavoriteGoalAlerts(items, date, source, mode = "favorite") {
  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.remove("hidden");
  els.resultsPanel.classList.remove("print-report");

  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`));
  const sourceLabel = source === "api-football" ? "API-Football" : source === "demo" ? "Demonstração" : source;
  const isMatchMode = mode === "match";
  const emptyTitle = isMatchMode ? "Nenhuma partida com odd real mínima 1.60" : "Nenhum favorito com odd mínima 1.60";
  const emptyCopy = isMatchMode
    ? "Nenhum jogo ao vivo em 0 x 0, na janela de segundo tempo, está com o mercado Over 0.5 ativo e odd real a partir de 1.60."
    : "A IA não encontrou jogos ao vivo, em janela de segundo tempo, com favorito precisando de gol e odd justa a partir de 1.60.";
  const panelTitle = isMatchMode ? "Partida +0.5 gol 0x0 com odd real mínima 1.60" : "Favorito +0.5 gol com odd mínima 1.60";

  if (!items.length) {
    els.resultsPanel.innerHTML = `
      <div class="results-panel-head">
        <div>
          <p class="eyebrow">Alerta ao vivo · ${sourceLabel}</p>
          <h2>${emptyTitle}</h2>
        </div>
      </div>
      <p class="model-note">${emptyCopy}</p>
    `;
    return;
  }

  els.resultsPanel.innerHTML = `
    <div class="results-panel-head goal-alert-head">
      <div>
        <p class="eyebrow">Alerta ao vivo · ${sourceLabel}</p>
        <h2>${panelTitle}</h2>
      </div>
      <span>${items.length} jogos</span>
    </div>
    <div class="prediction-ranking">
      ${items.map(item => {
        const event = item.event;
        const prediction = item.prediction;
        const market = item.alert;
        return `
          <button class="ranking-card goal-alert-card" type="button" data-event-id="${event.id}">
            <span class="ranking-number">#${item.rank}</span>
            <span class="ranking-main">
              <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
              <small>${event.tournament?.name || "Competição"} · ${market.minute}' · Placar ${market.score}</small>
              <em>${market.label}</em>
              <small>${market.reason}</small>
            </span>
            <span class="ranking-score">
              <b>${Number(market.marketOdd ?? market.fairOdd).toFixed(2)}</b>
              <small>${isMatchMode ? "odd real do mercado" : "odd justa mínima 1.60"}</small>
            </span>
            <span class="ranking-market">${market.probability}% para +0.5 gol</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  els.resultsPanel.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const event = items.find(item => String(item.event.id) === card.dataset.eventId)?.event;
      if (event) selectEvent(event);
    });
  });
}

function renderMarketAlerts(items, date, source, mode = "match") {
  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.remove("hidden");
  els.resultsPanel.classList.remove("print-report");

  const sourceLabel = source === "api-football" ? "API-Football" : source === "demo" ? "Demonstracao" : source;
  const marketLabel = mode === "match" ? typeLabel(els.resultsType.value) : "Favorito +0.5 gol";
  const emptyCopy = els.resultsType.value === "match-goal"
    ? "Nenhum jogo ao vivo em 0 x 0, na janela de segundo tempo, esta com o mercado Over 0.5 ativo e odd real a partir de 1.60."
    : `A IA nao encontrou jogos que passassem nos criterios de ${marketLabel} para a data selecionada.`;

  if (!items.length) {
    els.resultsPanel.innerHTML = `
      <div class="results-panel-head">
        <div>
          <p class="eyebrow">Sinais da IA - ${sourceLabel}</p>
          <h2>Nenhum sinal em ${marketLabel}</h2>
        </div>
      </div>
      <p class="model-note">${emptyCopy}</p>
    `;
    return;
  }

  els.resultsPanel.innerHTML = `
    <div class="results-panel-head goal-alert-head">
      <div>
        <p class="eyebrow">Sinais da IA - ${sourceLabel}</p>
        <h2>${marketLabel}</h2>
      </div>
      <span>${items.length} jogos</span>
    </div>
    <div class="prediction-ranking">
      ${items.map(item => {
        const event = item.event;
        const market = item.alert || {};
        const odd = Number(market.marketOdd ?? market.fairOdd);
        const oddText = Number.isFinite(odd) && odd > 0 ? odd.toFixed(2) : "--";
        const minuteText = market.minute ? `${market.minute}'` : "pre-jogo";
        return `
          <button class="ranking-card goal-alert-card" type="button" data-event-id="${event.id}">
            <span class="ranking-number">#${item.rank}</span>
            <span class="ranking-main">
              <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
              <small>${event.tournament?.name || "Competicao"} - ${minuteText} - ${market.score || "sem placar"}</small>
              <em>${market.label || marketLabel}</em>
              <small>${market.reason || "Sinal gerado pelos criterios do mercado."}</small>
            </span>
            <span class="ranking-score">
              <b>${oddText}</b>
              <small>${oddText === "--" ? "odd indisponivel" : "odd do mercado"}</small>
            </span>
            <span class="ranking-market">${market.probability || 0}% no modelo</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  els.resultsPanel.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const event = items.find(item => String(item.event.id) === card.dataset.eventId)?.event;
      if (event) selectEvent(event);
    });
  });
}

function renderPredictionResults(payload) {
  const summary = payload.summary || {};
  const selectedTypeLabel = typeLabel(payload.type || "match-goal");
  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(new Date(`${payload.date}T12:00:00`));

  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.remove("hidden");
  els.resultsPanel.classList.remove("print-report");

  els.resultsPanel.innerHTML = `
    <div class="results-panel-head results-head">
      <div>
        <p class="eyebrow">Resultados · ${selectedTypeLabel}</p>
        <h2>Acertos de ${dateLabel}</h2>
      </div>
      <span>${summary.accuracy || 0}%</span>
    </div>
    <div class="accuracy-grid">
      <div><span>Total</span><b>${summary.total || 0}</b></div>
      <div><span>Resolvidos</span><b>${summary.finished || 0}</b></div>
      <div><span>Acertos</span><b>${summary.hits || 0}</b></div>
      <div><span>Erros</span><b>${summary.misses || 0}</b></div>
      <div><span>Pendentes</span><b>${summary.pending || 0}</b></div>
    </div>
    ${renderBetSimulation(payload.results || [])}
    ${(payload.results || []).length ? `
      <div class="prediction-ranking">
        ${payload.results.map(item => {
          const record = item.record;
          const event = item.event;
          const result = item.result;
          const statusClass = result.status === "pending" ? "pending" : result.hit ? "hit" : "miss";
          const statusText = result.status === "pending" ? "Pendente" : result.hit ? "Acertou" : "Errou";
          const market = record.type === "favorite-goal" || record.type === "match-goal"
            ? record.alert?.label || "Ao vivo +0.5 gol"
            : record.prediction?.pick || "Previsão";
          return `
            <button class="ranking-card result-card ${statusClass}" type="button" data-event-id="${event.id}">
              <span class="ranking-number">#${record.rank || "-"}</span>
              <span class="ranking-main">
                <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
                <small>${event.tournament?.name || "Competição"} · Placar ${result.score}</small>
                <em>${market}</em>
                <small>${signalSentText(record)}${result.hit ? ` · ${greenMomentText(record, result)}` : ""}</small>
                <small>${result.detail}</small>
              </span>
              <span class="ranking-score">
                <b>${statusText}</b>
                <small>${record.type === "favorite-goal" || record.type === "match-goal" ? `alerta ${record.alert?.minute || "-"}'` : `${record.prediction?.confidence || 0}% conf.`}</small>
              </span>
              <span class="ranking-market">${record.type === "favorite-goal" || record.type === "match-goal" ? `Odd ${Number(record.alert?.marketOdd ?? record.alert?.fairOdd ?? 0).toFixed(2)}` : record.prediction?.expectedScore || ""}</span>
            </button>
          `;
        }).join("")}
      </div>
    ` : `<p class="model-note">Ainda não há previsões salvas para esse tipo e data. Gere primeiro o ${selectedTypeLabel}.</p>`}
  `;

  els.resultsPanel.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = (payload.results || []).find(result => String(result.event.id) === card.dataset.eventId);
      if (item) selectEvent(item.event);
    });
  });
}

function typeLabel(type) {
  if (type === "favorite-goal") return "Favorito +0.5 gol";
  if (type === "over-25") return "Over 2.5 gols";
  if (type === "under-25") return "Under 2.5 gols";
  if (type === "handicap") return "Handicap Asiatico";
  if (type === "corners") return "Escanteios";
  return "Partida +0.5 gol";
}

function simulatorMarketLabel(market) {
  const labels = {
    "match-over-05": "Partida +0.5 gol",
    "match-over-goals": "Over gols",
    "match-under-goals": "Under gols",
    handicap: "Handicap",
    corners: "Escanteios"
  };
  return labels[market] || "Mercado";
}

function signalSentText(record) {
  const sentMinute = record.sentMinute ?? record.alert?.minute;
  if (sentMinute !== null && sentMinute !== undefined) {
    return `Sinal enviado aos ${sentMinute}'`;
  }
  if (!record.createdAt) return "Horário de envio indisponível";
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(record.createdAt));
  return `Sinal enviado às ${time}`;
}

function greenMomentText(record, result) {
  if (!result.hit) return "";
  if (result.greenMinute !== null && result.greenMinute !== undefined) {
    return `Green aos ${result.greenMinute}'`;
  }
  return "Green confirmado · minuto não registrado";
}

function renderSignalsReport(payload) {
  const summary = payload.summary || {};
  const dateLabel = reportPeriodLabel(payload);
  const selectedTypeLabel = typeLabel(payload.type || "match-goal");

  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.remove("hidden");
  els.resultsPanel.classList.add("print-report");
  els.resultsPanel.innerHTML = `
    <div class="results-panel-head results-head">
      <div>
        <p class="eyebrow">Histórico salvo no Firebase · ${selectedTypeLabel}</p>
        <h2>Relatório de ${dateLabel}</h2>
      </div>
      <div class="report-head-actions">
        <span>${summary.accuracy || 0}%</span>
        <button id="reportPdfButton" class="pdf-button" type="button">Gerar PDF</button>
      </div>
    </div>
    <div class="accuracy-grid">
      <div><span>Sinais</span><b>${summary.total || 0}</b></div>
      <div><span>Resolvidos</span><b>${summary.finished || 0}</b></div>
      <div><span>Acertos</span><b>${summary.hits || 0}</b></div>
      <div><span>Erros</span><b>${summary.misses || 0}</b></div>
      <div><span>Pendentes</span><b>${summary.pending || 0}</b></div>
    </div>
    ${renderBetSimulation(payload.results || [])}
    ${(payload.results || []).length ? `
      <div class="prediction-ranking">
        ${payload.results.map(item => {
          const record = item.record;
          const event = item.event;
          const result = item.result;
          const statusClass = result.status === "pending" ? "pending" : result.hit ? "hit" : "miss";
          const statusText = result.status === "pending" ? "Pendente" : result.hit ? "Acertou" : "Errou";
          const market = record.alert?.label || typeLabel(record.type);
          return `
            <button class="ranking-card result-card ${statusClass}" type="button" data-record-id="${record.id}">
              <span class="ranking-number">#${record.rank || "-"}</span>
              <span class="ranking-main">
                <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
                <small>${typeLabel(record.type)} · ${event.tournament?.name || "Competição"}</small>
                <em>${market}</em>
                <small>${signalSentText(record)}${result.hit ? ` · ${greenMomentText(record, result)}` : ""}</small>
                <small>${result.detail}</small>
              </span>
              <span class="ranking-score">
                <b>${statusText}</b>
                <small>Placar ${result.score}</small>
              </span>
              <span class="ranking-market">${record.alert?.marketOdd || record.alert?.fairOdd ? `Odd ${Number(record.alert?.marketOdd ?? record.alert?.fairOdd).toFixed(2)}` : record.prediction?.expectedScore || ""}</span>
            </button>
          `;
        }).join("")}
      </div>
    ` : `<p class="model-note">Nenhum sinal salvo para este período.</p>`}
  `;
  document.querySelector("#reportPdfButton")?.addEventListener("click", printSignalsReport);
}

function renderMinuteSimulator(payload) {
  const summary = payload.summary || {};
  const period = reportPeriodLabel(payload);
  const breakEvenOdd = summary.hits > 0 ? summary.breakEvenOdd : 0;
  const marketLabel = payload.marketLabel || simulatorMarketLabel(payload.market);

  state.reportPayload = null;
  state.resultsPayload = null;
  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.resultsPanel.classList.remove("hidden");
  els.resultsPanel.classList.remove("print-report");
  els.resultsPanel.innerHTML = `
    <div class="results-panel-head results-head">
      <div>
        <p class="eyebrow">Simulador historico · ${marketLabel}</p>
        <h2>Entrada aos ${payload.entryMinute}' · ${period}</h2>
      </div>
      <span>${summary.hitRate || 0}%</span>
    </div>
    <div class="accuracy-grid">
      <div><span>Entradas</span><b>${summary.total || 0}</b></div>
      <div><span>Greens</span><b>${summary.hits || 0}</b></div>
      <div><span>Reds</span><b>${summary.misses || 0}</b></div>
      <div><span>Acerto</span><b>${summary.hitRate || 0}%</b></div>
      <div><span>Odd equilibrio</span><b>${breakEvenOdd ? breakEvenOdd.toFixed(2) : "--"}</b></div>
    </div>
    ${summary.profitUnits !== null && summary.profitUnits !== undefined ? `
      <div class="finance-grid">
        <div><span>Meio green</span><b>${summary.halfWins || 0}</b></div>
        <div><span>Unidades</span><b class="${summary.profitUnits >= 0 ? "positive" : "negative"}">${Number(summary.profitUnits).toFixed(2)}</b></div>
        <div><span>ROI</span><b class="${summary.roi >= 0 ? "positive" : "negative"}">${Number(summary.roi || 0).toFixed(1).replace(".", ",")}%</b></div>
      </div>
    ` : ""}
    <p class="model-note">${payload.description || "Estrategia ainda nao configurada para este mercado."}</p>
    ${(payload.results || []).length ? `
      <div class="prediction-ranking">
        ${payload.results.map((item, index) => {
          const event = item.event;
          const statusClass = item.hit ? "hit" : "miss";
          const isUnderMarket = payload.market === "match-under-goals";
          const isHandicapMarket = payload.market === "handicap";
          const goalsMarketName = isUnderMarket ? "Under 2.5 gols" : "Over 2.5 gols";
          const detailText = item.totalCorners !== undefined
            ? `Linha Over ${item.line} · ${item.totalCorners} escanteios`
            : isHandicapMarket
              ? `${item.favoriteTeam || "Favorito"} AH ${item.handicapLine} · odd ${Number(item.handicapOdd || 0).toFixed(2)} · score ${item.handicapScore || "-"} · ${Number(item.profitUnits || 0).toFixed(2)}u`
            : item.totalGoals !== undefined
              ? `${item.totalGoals} gols no jogo`
              : item.hit ? `Primeiro gol aos ${item.firstGoalText}` : "Sem gol na partida";
          const marketText = item.totalCorners !== undefined
            ? `Over ${item.line} escanteios`
            : isHandicapMarket
              ? `Handicap ${item.handicapLine}`
            : item.totalGoals !== undefined
              ? goalsMarketName
              : item.hit ? "Bateu +0.5" : "Nao bateu";
          const resultText = item.outcome === "half-win"
            ? "Meio green"
            : item.outcome === "push"
              ? "Devolvida"
              : item.outcome === "half-loss"
                ? "Meio red"
                : item.hit ? "Green" : "Red";
          return `
            <button class="ranking-card result-card ${statusClass}" type="button" data-event-id="${event.id}">
              <span class="ranking-number">#${index + 1}</span>
              <span class="ranking-main">
                <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
                <small>${item.date} · ${event.tournament?.name || "Competicao"} · Placar final ${item.finalScore}</small>
                <em>${resultText} · ${marketText}</em>
                <small>${detailText}</small>
              </span>
              <span class="ranking-score">
                <b>${resultText}</b>
                <small>${item.firstGoalText || item.totalCorners || item.totalGoals || "0 x 0"}</small>
              </span>
              <span class="ranking-market">${marketText}</span>
            </button>
          `;
        }).join("")}
      </div>
    ` : `<p class="model-note">Nenhum jogo encontrado para esse periodo e minuto.</p>`}
  `;

  els.resultsPanel.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = (payload.results || []).find(result => String(result.event.id) === card.dataset.eventId);
      if (item) selectEvent(item.event);
    });
  });
}

function openReportDialog() {
  els.reportDateInput.value = els.dateInput.value;
  els.reportEndDateInput.value = els.dateInput.value;
  els.reportTypeInput.value = els.resultsType.value || "match-goal";
  els.reportDialog.showModal();
}

function openMinuteSimulatorDialog() {
  els.simulatorMarketInput.value = localStorage.getItem("simulatorMarket") || "match-over-05";
  els.simulatorStartDateInput.value = els.dateInput.value;
  els.simulatorEndDateInput.value = els.dateInput.value;
  els.simulatorMinuteInput.value = localStorage.getItem("simulatorEntryMinute") || "80";
  els.minuteSimulatorDialog.showModal();
}

async function runMinuteSimulator() {
  els.runMinuteSimulatorButton.disabled = true;
  els.runMinuteSimulatorButton.textContent = "Simulando";
  els.sourceStatus.textContent = "Rodando backtest";
  try {
    localStorage.setItem("simulatorEntryMinute", els.simulatorMinuteInput.value || "80");
    localStorage.setItem("simulatorMarket", els.simulatorMarketInput.value || "match-over-05");
    const params = new URLSearchParams({
      market: els.simulatorMarketInput.value || "match-over-05",
      startDate: els.simulatorStartDateInput.value,
      endDate: els.simulatorEndDateInput.value || els.simulatorStartDateInput.value,
      minute: els.simulatorMinuteInput.value || "80",
      sport: "football"
    });
    const response = await fetch(`/api/minute-simulator?${params}`);
    const payload = await response.json();
    if (payload.warning) {
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    }
    renderMinuteSimulator(payload);
    els.sourceStatus.textContent = `${payload.summary?.total || 0} entradas simuladas`;
    els.minuteSimulatorDialog.close();
  } catch (error) {
    els.sourceStatus.textContent = "Erro na simulacao";
    els.resultsPanel.classList.remove("hidden");
    els.resultsPanel.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.runMinuteSimulatorButton.disabled = false;
    els.runMinuteSimulatorButton.textContent = "Rodar simulacao";
  }
}

async function consultSignalsReport() {
  els.consultReportButton.disabled = true;
  els.consultReportButton.textContent = "Consultando";
  els.sourceStatus.textContent = "Consultando Firebase";
  try {
    const params = new URLSearchParams({
      startDate: els.reportDateInput.value,
      endDate: els.reportEndDateInput.value || els.reportDateInput.value,
      sport: "football",
      type: els.reportTypeInput.value
    });
    const response = await fetch(`/api/signals-report?${params}`);
    const payload = await response.json();
    if (payload.warning) {
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    }
    state.resultsPayload = null;
    state.reportPayload = payload;
    els.dateInput.value = payload.endDate || payload.date;
    renderSignalsReport(payload);
    els.sourceStatus.textContent = `${payload.summary?.total || 0} sinais salvos`;
    els.reportDialog.close();
  } catch (error) {
    els.sourceStatus.textContent = "Erro no relatório";
    els.resultsPanel.classList.remove("hidden");
    els.resultsPanel.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.consultReportButton.disabled = false;
    els.consultReportButton.textContent = "Consultar relatório";
  }
}

function printSignalsReport() {
  if (!state.reportPayload) return;
  const previousTitle = document.title;
  const reportName = typeLabel(state.reportPayload.type || "match-goal")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  document.title = `relatorio-${reportName}-${reportPeriodSlug(state.reportPayload)}`;
  document.body.classList.add("printing-report");
  window.print();
  window.setTimeout(() => {
    document.body.classList.remove("printing-report");
    document.title = previousTitle;
  }, 500);
}

async function showPredictionResults() {
  els.resultsButton.disabled = true;
  els.resultsButton.textContent = "Conferindo";
  els.sourceStatus.textContent = "Conferindo resultados";
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value,
      type: els.resultsType.value
    });
    const response = await fetch(`/api/prediction-results?${params}`);
    const payload = await response.json();
    if (payload.warning) {
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    }
    state.reportPayload = null;
    state.resultsPayload = payload;
    renderPredictionResults(payload);
    els.sourceStatus.textContent = `Acerto ${payload.summary?.accuracy || 0}%`;
  } catch (error) {
    els.sourceStatus.textContent = "Erro nos resultados";
    els.resultsPanel.classList.remove("hidden");
    els.emptyState.classList.add("hidden");
    els.analysisState.classList.add("hidden");
    els.resultsPanel.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.resultsButton.disabled = false;
    els.resultsButton.textContent = "Ver acertos";
  }
}

function updateMatchGoalButton(count) {
  const label = typeLabel(els.resultsType.value || "match-goal");
  els.matchGoalButton.textContent = count > 0
    ? `${label} (${count})`
    : label;
  els.matchGoalButton.classList.toggle("blink-alert", count > 0);
  els.matchGoalButton.classList.toggle("active", count > 0);
}

async function refreshMatchGoalAlerts(options = {}) {
  const { silent = false } = options;
  if (els.sportInput.value !== "football") {
    state.matchGoalAlerts = [];
    updateMatchGoalButton(0);
    return { source: "indisponível", date: els.dateInput.value, alerts: [] };
  }
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value,
      type: els.resultsType.value
    });
    const response = await fetch(`/api/market-alerts?${params}`);
    const payload = await response.json();
    state.matchGoalAlerts = payload.alerts || [];
    updateMatchGoalButton(state.matchGoalAlerts.length);
    if (payload.warning && !silent) {
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    }
    return payload;
  } catch {
    state.matchGoalAlerts = [];
    updateMatchGoalButton(0);
    return { source: "erro", date: els.dateInput.value, alerts: [] };
  }
}

async function showMatchGoalAlerts() {
  if (els.sportInput.value !== "football") return;
  els.matchGoalButton.disabled = true;
  els.matchGoalButton.textContent = "Buscando alertas";
  try {
    const payload = await refreshMatchGoalAlerts();
    renderMarketAlerts(payload.alerts || [], payload.date, payload.source, "match");
    els.sourceStatus.textContent = (payload.alerts || []).length ? "Sinais encontrados" : "Sem sinais";
  } finally {
    els.matchGoalButton.disabled = false;
    updateMatchGoalButton(state.matchGoalAlerts.length);
  }
}

async function loadEvents(options = {}) {
  const { silent = false, preservePanel = false } = options;
  if (els.loadButton.disabled) return;

  const previousSelectedId = state.selected?.id;
  els.loadButton.disabled = true;
  if (!silent) {
    els.sourceStatus.textContent = state.liveOnly ? "Buscando jogos ao vivo" : "Buscando jogos";
  }
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value
    });
    const response = await fetch(`/api/events?${params}`);
    const payload = await response.json();
    state.events = payload.events || [];
    const updatedSelected = state.events.find(event => String(event.id) === String(previousSelectedId));
    state.selected = updatedSelected || (preservePanel ? state.selected : null);
    if (!preservePanel) {
      els.analysisState.classList.add("hidden");
      els.resultsPanel.classList.add("hidden");
      els.emptyState.classList.remove("hidden");
    }
    const sourceLabels = {
      "api-football": "API-Football conectado",
      sofascore: "SofaScore conectado",
      demo: "Modo demonstração"
    };
    const refreshedAt = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
    els.sourceStatus.textContent = payload.liveOnly
      ? `Jogos ao vivo · ${refreshedAt}`
      : `${sourceLabels[payload.source] || "Fonte conectada"} · ${refreshedAt}`;
    if (payload.warning) {
      els.sourceStatus.title = payload.warning;
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    } else {
      els.sourceStatus.title = "";
      els.sourceMessage.textContent = "";
      els.sourceMessage.classList.add("hidden");
    }
    populateLeagueFilter();
    renderMatches();
    await refreshMatchGoalAlerts({ silent: true });
  } catch (error) {
    if (!silent) {
      els.sourceStatus.textContent = "Erro ao carregar";
      els.matches.innerHTML = `<p class="model-note">${error.message}</p>`;
    }
  } finally {
    els.loadButton.disabled = false;
  }
}

function startAutoRefresh() {
  window.setInterval(() => {
    if (document.hidden || els.reportDialog.open || els.minuteSimulatorDialog.open) return;
    loadEvents({ silent: true, preservePanel: true });
  }, AUTO_REFRESH_MS);
}

async function predictSelected() {
  if (!state.selected) return;
  els.predictButton.disabled = true;
  els.predictButton.textContent = "Analisando";
  try {
    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: state.selected, inputs: readInputs() })
    });
    const payload = await response.json();
    renderPrediction(payload.prediction);
  } finally {
    els.predictButton.disabled = false;
    els.predictButton.textContent = "Gerar previsão";
  }
}

els.dateInput.value = new Date().toISOString().slice(0, 10);
els.stakeInput.value = localStorage.getItem("simulatedStake") || "10";
els.startedToggle.setAttribute("aria-pressed", "true");
els.startedToggle.textContent = "Mostrar todos";
els.startedToggle.classList.add("active");
els.loadButton.addEventListener("click", loadEvents);
els.sportInput.addEventListener("change", () => {
  const isFootball = els.sportInput.value === "football";
  els.matchGoalButton.disabled = !isFootball;
  els.resultsType.disabled = !isFootball;
  els.resultsButton.disabled = !isFootball;
  els.reportButton.disabled = !isFootball;
  els.minuteSimulatorButton.disabled = !isFootball;

  if (!isFootball) {
    state.liveOnly = false;
    els.startedToggle.setAttribute("aria-pressed", "false");
    els.startedToggle.textContent = "Ao vivo agora";
    els.startedToggle.classList.remove("active");
  }

  loadEvents();
});
els.matchGoalButton.addEventListener("click", showMatchGoalAlerts);
els.resultsType.addEventListener("change", () => {
  state.matchGoalAlerts = [];
  updateMatchGoalButton(0);
  refreshMatchGoalAlerts({ silent: true });
});
els.resultsButton.addEventListener("click", showPredictionResults);
els.reportButton.addEventListener("click", openReportDialog);
els.consultReportButton.addEventListener("click", consultSignalsReport);
els.minuteSimulatorButton.addEventListener("click", openMinuteSimulatorDialog);
els.runMinuteSimulatorButton.addEventListener("click", runMinuteSimulator);
els.stakeInput.addEventListener("input", () => {
  localStorage.setItem("simulatedStake", els.stakeInput.value || "0");
  if (state.reportPayload) {
    renderSignalsReport(state.reportPayload);
  } else if (state.resultsPayload) {
    renderPredictionResults(state.resultsPayload);
  }
});
els.searchInput.addEventListener("input", renderMatches);
els.leagueFilter.addEventListener("change", renderMatches);
els.startedToggle.addEventListener("click", () => {
  state.liveOnly = !state.liveOnly;
  els.startedToggle.setAttribute("aria-pressed", String(state.liveOnly));
  els.startedToggle.textContent = state.liveOnly ? "Mostrar todos" : "Ao vivo agora";
  els.startedToggle.classList.toggle("active", state.liveOnly);
  loadEvents();
});
els.predictButton.addEventListener("click", predictSelected);

loadEvents();
startAutoRefresh();
