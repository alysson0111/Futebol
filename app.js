const state = {
  events: [],
  selected: null,
  liveOnly: true,
  matchGoalAlerts: []
};

const els = {
  dateInput: document.querySelector("#dateInput"),
  sportInput: document.querySelector("#sportInput"),
  searchInput: document.querySelector("#searchInput"),
  leagueFilter: document.querySelector("#leagueFilter"),
  startedToggle: document.querySelector("#startedToggle"),
  topPredictionsButton: document.querySelector("#topPredictionsButton"),
  matchGoalButton: document.querySelector("#matchGoalButton"),
  resultsType: document.querySelector("#resultsType"),
  resultsButton: document.querySelector("#resultsButton"),
  loadButton: document.querySelector("#loadButton"),
  sourceStatus: document.querySelector("#sourceStatus"),
  sourceMessage: document.querySelector("#sourceMessage"),
  matchCount: document.querySelector("#matchCount"),
  matches: document.querySelector("#matches"),
  emptyState: document.querySelector("#emptyState"),
  topPredictions: document.querySelector("#topPredictions"),
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
  const liveTypes = ["1h", "2h", "ht", "et", "p", "q1", "q2", "q3", "q4", "ot", "bt", "live", "inprogress"];
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
  const finishedTypes = ["ft", "aet", "aot", "pen", "finished", "afterpen", "canc", "abd", "awd", "wo"];
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
  const clock = String(event.status?.clock || "").trim();
  if (isLive(event) && clock) {
    return `${translateStatus(event.status?.type, event.status?.description || "Ao vivo")} · ${clock}`;
  }
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
    q1: "1º quarto",
    q2: "2º quarto",
    q3: "3º quarto",
    q4: "4º quarto",
    ht: "Intervalo",
    bt: "Intervalo",
    et: "Prorrogação",
    ot: "Prorrogação",
    p: "Pênaltis",
    ft: "Encerrado",
    aet: "Encerrado após prorrogação",
    aot: "Encerrado após prorrogação",
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
  els.topPredictions.classList.add("hidden");
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

function renderTopPredictions(items, date, source) {
  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.topPredictions.classList.remove("hidden");

  if (!items.length) {
    els.topPredictions.innerHTML = `
      <div class="top-predictions-head">
        <div>
          <p class="eyebrow">Top 10 IA</p>
          <h2>Sem jogos elegíveis</h2>
        </div>
      </div>
      <p class="model-note">Não encontrei jogos não-finalizados para a data selecionada.</p>
    `;
    return;
  }

  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`));
  const sourceLabel = source === "api-football" ? "API-Football" : source === "demo" ? "Demonstração" : source;
  els.topPredictions.innerHTML = `
    <div class="top-predictions-head">
      <div>
        <p class="eyebrow">Top 10 IA · ${sourceLabel}</p>
        <h2>Melhores previsões de ${dateLabel}</h2>
      </div>
      <span>${items.length} palpites</span>
    </div>
    <div class="prediction-ranking">
      ${items.map(item => {
        const event = item.event;
        const prediction = item.prediction;
        return `
          <button class="ranking-card" type="button" data-event-id="${event.id}">
            <span class="ranking-number">#${item.rank}</span>
            <span class="ranking-main">
              <strong>${event.homeTeam?.name || "Mandante"} x ${event.awayTeam?.name || "Visitante"}</strong>
              <small>${event.tournament?.name || "Competição"} · ${event.tournament?.category?.name || "País"} · ${formatShortTime(event.startTimestamp)}</small>
              <em>${prediction.pick}</em>
            </span>
            <span class="ranking-score">
              <b>${prediction.confidence}%</b>
              <small>${prediction.expectedScore}</small>
            </span>
            <span class="ranking-market">${prediction.markets.goals}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  els.topPredictions.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const event = items.find(item => String(item.event.id) === card.dataset.eventId)?.event;
      if (event) selectEvent(event);
    });
  });
}

function renderFavoriteGoalAlerts(items, date, source, mode = "favorite") {
  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.topPredictions.classList.remove("hidden");

  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(new Date(`${date}T12:00:00`));
  const sourceLabel = source === "api-football" ? "API-Football" : source === "demo" ? "Demonstração" : source;
  const isMatchMode = mode === "match";
  const emptyTitle = isMatchMode ? "Nenhuma partida com odd mínima 1.60" : "Nenhum favorito com odd mínima 1.60";
  const emptyCopy = isMatchMode
    ? "A IA não encontrou jogos ao vivo em 0 x 0, na janela de segundo tempo, com possibilidade de primeiro gol da partida e odd justa a partir de 1.60."
    : "A IA não encontrou jogos ao vivo, em janela de segundo tempo, com favorito precisando de gol e odd justa a partir de 1.60.";
  const panelTitle = isMatchMode ? "Partida +0.5 gol 0x0 com odd mínima 1.60" : "Favorito +0.5 gol com odd mínima 1.60";

  if (!items.length) {
    els.topPredictions.innerHTML = `
      <div class="top-predictions-head">
        <div>
          <p class="eyebrow">Alerta ao vivo · ${sourceLabel}</p>
          <h2>${emptyTitle}</h2>
        </div>
      </div>
      <p class="model-note">${emptyCopy}</p>
    `;
    return;
  }

  els.topPredictions.innerHTML = `
    <div class="top-predictions-head goal-alert-head">
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
              <b>${market.fairOdd.toFixed(2)}</b>
              <small>odd justa mínima 1.60</small>
            </span>
            <span class="ranking-market">${market.probability}% para +0.5 gol</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  els.topPredictions.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const event = items.find(item => String(item.event.id) === card.dataset.eventId)?.event;
      if (event) selectEvent(event);
    });
  });
}

function renderPredictionResults(payload) {
  const summary = payload.summary || {};
  const typeLabel = payload.type === "favorite-goal"
    ? "Ao vivo +0.5 gol"
    : payload.type === "match-goal"
      ? "Partida +0.5 gol"
      : "Top 10 IA";
  const dateLabel = new Intl.DateTimeFormat("pt-BR").format(new Date(`${payload.date}T12:00:00`));

  els.analysisState.classList.add("hidden");
  els.emptyState.classList.add("hidden");
  els.topPredictions.classList.remove("hidden");

  els.topPredictions.innerHTML = `
    <div class="top-predictions-head results-head">
      <div>
        <p class="eyebrow">Resultados · ${typeLabel}</p>
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
                <small>${result.detail}</small>
              </span>
              <span class="ranking-score">
                <b>${statusText}</b>
                <small>${record.type === "favorite-goal" || record.type === "match-goal" ? `alerta ${record.alert?.minute || "-"}'` : `${record.prediction?.confidence || 0}% conf.`}</small>
              </span>
              <span class="ranking-market">${record.type === "favorite-goal" || record.type === "match-goal" ? `Odd ${Number(record.alert?.fairOdd || 0).toFixed(2)}` : record.prediction?.expectedScore || ""}</span>
            </button>
          `;
        }).join("")}
      </div>
    ` : `<p class="model-note">Ainda não há previsões salvas para esse tipo e data. Gere primeiro o ${typeLabel}.</p>`}
  `;

  els.topPredictions.querySelectorAll(".ranking-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = (payload.results || []).find(result => String(result.event.id) === card.dataset.eventId);
      if (item) selectEvent(item.event);
    });
  });
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
    renderPredictionResults(payload);
    els.sourceStatus.textContent = `Acerto ${payload.summary?.accuracy || 0}%`;
  } catch (error) {
    els.sourceStatus.textContent = "Erro nos resultados";
    els.topPredictions.classList.remove("hidden");
    els.emptyState.classList.add("hidden");
    els.analysisState.classList.add("hidden");
    els.topPredictions.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.resultsButton.disabled = false;
    els.resultsButton.textContent = "Ver acertos";
  }
}

function updateMatchGoalButton(count) {
  els.matchGoalButton.textContent = count > 0
    ? `Partida +0.5 gol (${count})`
    : "Partida +0.5 gol";
  els.matchGoalButton.classList.toggle("blink-alert", count > 0);
  els.matchGoalButton.classList.toggle("active", count > 0);
}

async function refreshMatchGoalAlerts() {
  if (els.sportInput.value !== "football") {
    state.matchGoalAlerts = [];
    updateMatchGoalButton(0);
    return { source: "indisponível", date: els.dateInput.value, alerts: [] };
  }
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value
    });
    const response = await fetch(`/api/match-goal-alerts?${params}`);
    const payload = await response.json();
    state.matchGoalAlerts = payload.alerts || [];
    updateMatchGoalButton(state.matchGoalAlerts.length);
    if (payload.warning) {
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
    renderFavoriteGoalAlerts(payload.alerts || [], payload.date, payload.source, "match");
    els.sourceStatus.textContent = (payload.alerts || []).length ? "Alerta partida ativo" : "Sem alerta partida";
  } finally {
    els.matchGoalButton.disabled = false;
    updateMatchGoalButton(state.matchGoalAlerts.length);
  }
}

async function generateTopPredictions() {
  if (els.sportInput.value !== "football") return;
  els.topPredictionsButton.disabled = true;
  els.topPredictionsButton.textContent = "Gerando top 10";
  els.sourceStatus.textContent = "IA analisando";
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value
    });
    const response = await fetch(`/api/top-predictions?${params}`);
    const payload = await response.json();
    if (payload.warning) {
      els.sourceMessage.textContent = payload.warning;
      els.sourceMessage.classList.remove("hidden");
    }
    renderTopPredictions(payload.predictions || [], payload.date, payload.source);
    els.sourceStatus.textContent = payload.source === "api-football" ? "Top 10 gerado" : "Modo demonstração";
  } catch (error) {
    els.sourceStatus.textContent = "Erro ao gerar";
    els.topPredictions.classList.remove("hidden");
    els.emptyState.classList.add("hidden");
    els.analysisState.classList.add("hidden");
    els.topPredictions.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.topPredictionsButton.disabled = false;
    els.topPredictionsButton.textContent = "Top 10 IA do dia";
  }
}

async function loadEvents() {
  els.loadButton.disabled = true;
  els.sourceStatus.textContent = state.liveOnly ? "Buscando jogos ao vivo" : "Buscando jogos";
  try {
    const params = new URLSearchParams({
      date: els.dateInput.value,
      sport: els.sportInput.value
    });
    const response = await fetch(`/api/events?${params}`);
    const payload = await response.json();
    state.events = payload.events || [];
    state.selected = null;
    els.analysisState.classList.add("hidden");
    els.topPredictions.classList.add("hidden");
    els.emptyState.classList.remove("hidden");
    const sourceLabels = {
      "api-football": "API-Football conectado",
      "api-basketball": "API-Basketball conectada",
      sofascore: "SofaScore conectado",
      demo: "Modo demonstração"
    };
    els.sourceStatus.textContent = payload.liveOnly
      ? "Jogos ao vivo"
      : sourceLabels[payload.source] || "Fonte conectada";
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
    await refreshMatchGoalAlerts();
  } catch (error) {
    els.sourceStatus.textContent = "Erro ao carregar";
    els.matches.innerHTML = `<p class="model-note">${error.message}</p>`;
  } finally {
    els.loadButton.disabled = false;
  }
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
els.startedToggle.setAttribute("aria-pressed", "true");
els.startedToggle.textContent = "Mostrar todos";
els.startedToggle.classList.add("active");
els.loadButton.addEventListener("click", loadEvents);
els.sportInput.addEventListener("change", () => {
  const isFootball = els.sportInput.value === "football";
  els.topPredictionsButton.disabled = !isFootball;
  els.matchGoalButton.disabled = !isFootball;
  els.resultsType.disabled = !isFootball;
  els.resultsButton.disabled = !isFootball;

  if (!isFootball) {
    state.liveOnly = false;
    els.startedToggle.setAttribute("aria-pressed", "false");
    els.startedToggle.textContent = "Ao vivo agora";
    els.startedToggle.classList.remove("active");
  }

  loadEvents();
});
els.topPredictionsButton.addEventListener("click", generateTopPredictions);
els.matchGoalButton.addEventListener("click", showMatchGoalAlerts);
els.resultsButton.addEventListener("click", showPredictionResults);
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
