const $ = id => document.getElementById(id);
const labels = { football: "Futebol", tennis: "Tênis", eafootball: "EA Sports FC/FIFA", basketball: "Basquete", nfl: "NFL" };
const phases = { live: "Ao vivo", scheduled: "Agendado", finished: "Encerrado", other: "Outro" };
const statuses = { HT: "Intervalo", BT: "Intervalo", POST: "Adiado", PST: "Adiado", CANC: "Cancelado", SUSP: "Suspenso", ABD: "Interrompido", Q1: "1º quarto", Q2: "2º quarto", Q3: "3º quarto", Q4: "4º quarto", OT: "Prorrogação", ET: "Prorrogação" };
const timezone = "America/Sao_Paulo";
let sport = "football";
let events = [];
let selected = null;
let loadController;
let detailController;
let analysisController;
let reportController;
let reportRows = [];
let reportMeta = null;
const analysisCache = new Map();
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
function today() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
}
function formatted(value, date = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "--";
  return new Date(value).toLocaleString("pt-BR", { timeZone: timezone, ...(date ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" });
}
function phaseLabel(event) {
  const label = statuses[event.status] || phases[event.phase];
  return event.phase === "live" && event.elapsed != null ? `${event.elapsed}${event.sport === "football" ? "'" : ""} · ${label}` : label;
}
function logo(team) {
  let url;
  try { const parsed = new URL(team.logo); if (parsed.protocol === "https:") url = parsed.href; } catch { /* A missing logo uses the team initial. */ }
  return url ? `<img src="${escape(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="initial" aria-hidden="true">${escape(team.name.slice(0, 1))}</span>`;
}
function visibleEvents() {
  const query = $("search").value.trim().toLocaleLowerCase("pt-BR");
  return events.filter(event => (!$("league").value || String(event.league.id ?? event.league.name) === $("league").value)
    && (!$("phase").value || event.phase === $("phase").value)
    && (!query || `${event.home.name} ${event.away.name} ${event.league.name} ${event.league.country}`.toLocaleLowerCase("pt-BR").includes(query)));
}
function render() {
  const list = visibleEvents();
  $("total").textContent = list.length;
  for (const phase of ["live", "scheduled", "finished"]) $(phase).textContent = list.filter(event => event.phase === phase).length;
  $("count").textContent = `${list.length} partidas`;
  $("listTitle").textContent = `${labels[sport]} · Jogos do dia`;
  if (!list.length) { $("games").innerHTML = '<p class="empty">Nenhuma partida disponível para esta seleção.</p>'; return; }
  const groups = new Map();
  for (const event of list) {
    const key = `${event.league.id ?? event.league.name}:${event.league.country}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  $("games").innerHTML = [...groups.values()].map(group => `<h3 class="league-heading">${escape(group[0].league.name)}${group[0].league.country ? ` · ${escape(group[0].league.country)}` : ""}</h3>${group.sort((a, b) => String(a.date).localeCompare(String(b.date))).map(event => `
    <button class="game" data-id="${escape(event.id)}" aria-pressed="${String(event.id) === selected}" aria-label="${escape(`${event.home.name} contra ${event.away.name}`)}">
      <span><time>${escape(formatted(event.date))}</time><span class="game-status ${event.phase === "live" ? "live-status" : ""}">${escape(phaseLabel(event))}</span></span>
      <span class="teams"><span class="team">${logo(event.home)}${escape(event.home.name)}</span><span class="team">${logo(event.away)}${escape(event.away.name)}</span></span>
      <span class="score"><span>${escape(event.score.home ?? "–")}</span><span>${escape(event.score.away ?? "–")}</span></span>
    </button>`).join("")}`).join("");
  for (const img of $("games").querySelectorAll("img")) img.addEventListener("error", () => { img.hidden = true; }, { once: true });
}
async function api(path, params, signal, method = "GET") {
  const response = await fetch(`/api/sports/${path}?${new URLSearchParams(params)}`, { signal, method });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os dados.");
  return payload;
}
function resetDetail() {
  selected = null;
  detailController?.abort();
  analysisController?.abort();
  $("detail").innerHTML = '<h2>Detalhes da partida</h2><p class="muted">Nenhuma partida selecionada.</p>';
}
async function load() {
  if (!$("date").value) return;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const currentSport = sport;
  $("refresh").disabled = true;
  $("connection").textContent = "Atualizando";
  $("message").hidden = true;
  try {
    const payload = await api("events", { sport, date: $("date").value }, controller.signal);
    if (currentSport !== sport) return;
    events = payload.events;
    const previousLeague = $("league").value;
    const leagues = new Map(events.map(event => [String(event.league.id ?? event.league.name), event.league.name]));
    $("league").innerHTML = '<option value="">Todos</option>' + [...leagues].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join("");
    if (leagues.has(previousLeague)) $("league").value = previousLeague;
    $("connection").textContent = payload.available ? "API-Sports" : "Fonte pendente";
    $("updated").textContent = payload.available ? formatted(payload.updatedAt) : "--";
    if (payload.warning) { $("message").textContent = payload.warning; $("message").hidden = false; }
    render();
    if (selected && events.some(event => String(event.id) === selected)) await selectGame(selected);
    else resetDetail();
  } catch (error) {
    if (error.name === "AbortError") return;
    events = [];
    $("league").innerHTML = '<option value="">Todos</option>';
    $("connection").textContent = "Fonte indisponível";
    $("updated").textContent = "--";
    $("message").textContent = error.message;
    $("message").hidden = false;
    resetDetail(); render();
  } finally { if (loadController === controller) $("refresh").disabled = false; }
}
const statNames = { "Shots on Goal": "Chutes no gol", "Shots off Goal": "Chutes para fora", "Total Shots": "Finalizações", "Blocked Shots": "Chutes bloqueados", "Shots insidebox": "Chutes na área", "Shots outsidebox": "Chutes fora da área", Fouls: "Faltas", "Corner Kicks": "Escanteios", Offsides: "Impedimentos", "Ball Possession": "Posse de bola", "Yellow Cards": "Cartões amarelos", "Red Cards": "Cartões vermelhos", "Goalkeeper Saves": "Defesas do goleiro", "Total passes": "Passes", "Passes accurate": "Passes certos", "Passes %": "Precisão de passes", expected_goals: "Gols esperados", points: "Pontos", assists: "Assistências", rebounds: "Rebotes", steals: "Roubos de bola", turnovers: "Erros de posse", blocks: "Bloqueios", fouls: "Faltas", total: "Total", percentage: "Percentual", field_goals: "Arremessos", threepoint_goals: "Bolas de três", freethrows_goals: "Lances livres", attempts: "Tentativas", made: "Convertidos", yards: "Jardas", passing: "Passes", rushing: "Corridas", tackles: "Tackles", sacks: "Sacks", interceptions: "Interceptações", touchdowns: "Touchdowns" };
function statLabel(name) { return statNames[name] || name.replace(/_/g, " "); }
function statRows(value, prefix = "") {
  const rows = [];
  for (const [key, entry] of Object.entries(value || {})) {
    if (["id", "game", "team"].includes(key) || entry == null) continue;
    const label = prefix ? `${prefix} · ${statLabel(key)}` : statLabel(key);
    if (typeof entry === "object") rows.push(...statRows(entry, label));
    else rows.push(`<div class="stats-row"><span>${escape(label)}</span><strong>${escape(entry)}</strong></div>`);
  }
  return rows;
}
function statisticsHtml(statistics) {
  if (!statistics.length) return '<p class="muted">Estatísticas ainda não disponibilizadas pela fonte.</p>';
  return statistics.map(item => {
    const rows = Array.isArray(item.statistics)
      ? item.statistics.filter(stat => stat.value != null).map(stat => `<div class="stats-row"><span>${escape(statLabel(stat.type))}</span><strong>${escape(stat.value)}</strong></div>`)
      : statRows(item.statistics || item);
    return `<h3>${escape(item.team?.name || "Equipe")}</h3>${rows.length ? rows.join("") : '<p class="muted">Sem estatísticas disponíveis.</p>'}`;
  }).join("");
}
async function selectGame(id) {
  detailController?.abort();
  analysisController?.abort();
  const controller = new AbortController();
  detailController = controller;
  selected = String(id); render();
  $("detail").innerHTML = '<h2>Detalhes da partida</h2><p class="muted">Carregando...</p>';
  try {
    const payload = await api("details", { sport, id }, controller.signal);
    const event = payload.event;
    const savedAnalysis = analysisCache.get(`${sport}:${id}`);
    const timeline = payload.timeline.map(item => `<li>${escape(item.time?.elapsed ?? "--")}' · ${escape(({ Goal: "Gol", Card: "Cartão", subst: "Substituição", Var: "VAR" })[item.type] || item.type)} · ${escape(item.player?.name || item.team?.name || "")}</li>`).join("");
    $("detail").innerHTML = `<h2>${escape(event.home.name)} × ${escape(event.away.name)}</h2>
      <p class="muted">${escape(event.league.name)}</p><div class="detail-score">${escape(event.score.home ?? "–")} : ${escape(event.score.away ?? "–")}</div>
      <dl class="detail-meta"><dt>Data e hora</dt><dd>${escape(formatted(event.date, true))} · Brasília</dd><dt>Situação</dt><dd>${escape(phaseLabel(event))}</dd><dt>Local</dt><dd>${escape(event.venue || "Não informado")}</dd><dt>Rodada</dt><dd>${escape(event.round || "Não informada")}</dd></dl>
      <div class="analysis-actions"><button id="analyzeGame" type="button" class="primary">Analisar confronto</button></div><section id="confrontationAnalysis" aria-live="polite">${savedAnalysis ? researchHtml(savedAnalysis) : ""}</section>
      <h3>Estatísticas</h3>${statisticsHtml(payload.statistics)}${timeline ? `<h3>Eventos da partida</h3><ol class="timeline">${timeline}</ol>` : ""}${payload.warning ? `<p class="muted">${escape(payload.warning)}</p>` : ""}`;
  } catch (error) { if (error.name !== "AbortError") $("detail").innerHTML = `<h2>Detalhes da partida</h2><p class="muted">${escape(error.message)}</p>`; }
}
function historyHtml(title, stats, teamId) {
  if (!stats?.matches?.length) return `<h3>${escape(title)}</h3><p class="muted">Nenhum resultado anterior disponível.</p>`;
  return `<h3>${escape(title)} · ${stats.games} jogos</h3><ol class="history-list">${stats.matches.map(game => {
    const home = game.home.id === teamId;
    const scored = home ? game.score.home : game.score.away;
    const conceded = home ? game.score.away : game.score.home;
    const outcome = scored > conceded ? "Vitória" : scored === conceded ? "Empate" : "Derrota";
    return `<li><time>${escape(formatted(game.date, true))}</time><span>${escape(game.home.name)} × ${escape(game.away.name)}</span><strong>${escape(game.score.home)} : ${escape(game.score.away)} · ${outcome}</strong></li>`;
  }).join("")}</ol>`;
}
function researchHtml(payload) {
  const research = payload.research;
  const refs = new Map(research.sources.map(source => [source.id, source]));
  const sections = payload.sections.map(section => `<section class="analysis-section"><h3>${escape(section.title)}</h3><p>${escape(section.text)}</p>${section.sources.length ? `<p class="analysis-references">${section.sources.map(id => `<a href="${escape(refs.get(id)?.url || "#")}" target="_blank" rel="noopener noreferrer">${escape(refs.get(id)?.label || id)}</a>`).join(" · ")}</p>` : ""}</section>`).join("");
  const h2h = research.h2h.length ? `<h3>Últimos encontros · ${escape(research.h2hScope)}</h3><ol class="history-list">${research.h2h.map(game => `<li><time>${escape(formatted(game.date, true))}</time><span>${escape(game.home.name)} × ${escape(game.away.name)}</span><strong>${escape(game.score.home)} : ${escape(game.score.away)}</strong></li>`).join("")}</ol>` : "";
  const injuries = research.injuries?.length ? `<h3>Ausências informadas pela fonte</h3><ul class="injury-list">${research.injuries.map(item => `<li><strong>${escape(item.player)}</strong> · ${escape(item.team)}${item.reason ? ` · ${escape(item.reason)}` : ""}</li>`).join("")}</ul>` : "";
  return `<div class="analysis-heading"><h3>${payload.engine === "ai" ? "Análise informativa por IA" : "Resumo estatístico"}</h3><span>${escape(formatted(payload.generatedAt, true))}</span></div>
    ${payload.warning ? `<p class="analysis-notice">${escape(payload.warning)}</p>` : ""}${sections}
    <details class="history-details"><summary>Resultados que fundamentam a análise</summary>${historyHtml(research.event.home.name, research.home?.overall, research.event.home.id)}${historyHtml(research.event.away.name, research.away?.overall, research.event.away.id)}${h2h}${injuries}</details>
    <p class="analysis-footnote">Fonte: API-Sports. Consulta: ${escape(formatted(research.consultedAt, true))} · Brasília. Histórico limitado à temporada ${escape(research.season ?? "não informada")}, até 10 jogos anteriores por equipe. Vitórias e empates calculados pelo placar final informado, sem gols da disputa de pênaltis.</p>
    ${research.warnings.length ? `<p class="analysis-notice">Dados incompletos: ${escape(research.warnings.join(" "))}</p>` : ""}`;
}
async function analyzeGame() {
  const id = selected;
  const currentSport = sport;
  const target = $("confrontationAnalysis");
  const button = $("analyzeGame");
  if (!id || !target || !button) return;
  analysisController?.abort();
  const controller = new AbortController();
  analysisController = controller;
  button.disabled = true;
  target.innerHTML = '<p class="muted">Consultando resultados, confrontos diretos e ausências...</p>';
  try {
    const payload = await api("analysis", { sport: currentSport, id }, controller.signal, "POST");
    if (selected === id && sport === currentSport && target.isConnected) {
      analysisCache.set(`${currentSport}:${id}`, payload);
      if (analysisCache.size > 20) analysisCache.delete(analysisCache.keys().next().value);
      target.innerHTML = researchHtml(payload);
    }
  } catch (error) {
    if (error.name !== "AbortError" && target.isConnected) target.innerHTML = `<p class="analysis-notice">${escape(error.message)}</p>`;
  } finally { if (button.isConnected) button.disabled = false; }
}
function datesInRange(start, end) {
  const from = new Date(`${start}T12:00:00Z`), to = new Date(`${end}T12:00:00Z`);
  const days = (to - from) / 86400000;
  if (!Number.isFinite(days) || days < 0 || days > 30) throw new Error("Selecione um período de até 31 dias, com a data final igual ou posterior à inicial.");
  return Array.from({ length: days + 1 }, (_, i) => new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10));
}
function reportTable() {
  return `<h3>${escape(reportMeta.label)} · ${escape(reportMeta.start)} a ${escape(reportMeta.end)}</h3><p class="muted">${reportRows.length} partidas · Horários de Brasília${reportMeta.partial ? " · Relatório parcial" : ""}</p>${reportMeta.warning ? `<p class="muted">${escape(reportMeta.warning)}</p>` : ""}<div class="table-scroll"><table><thead><tr><th>Data e hora</th><th>Campeonato</th><th>Partida</th><th>Placar</th><th>Situação</th></tr></thead><tbody>${reportRows.map(event => `<tr><td>${escape(formatted(event.date, true))}</td><td>${escape(event.league.name)}</td><td>${escape(event.home.name)} × ${escape(event.away.name)}</td><td>${escape(event.score.home ?? "–")} : ${escape(event.score.away ?? "–")}</td><td>${escape(phaseLabel(event))}</td></tr>`).join("")}</tbody></table></div>`;
}
async function generateReport(event) {
  event.preventDefault();
  reportController?.abort();
  const controller = new AbortController();
  reportController = controller;
  reportRows = []; $("reportContent").innerHTML = "";
  $("csv").disabled = $("print").disabled = true;
  const currentSport = sport;
  reportMeta = { label: labels[sport], start: $("startDate").value, end: $("endDate").value };
  $("generateReport").disabled = true;
  try {
    const dates = datesInRange(reportMeta.start, reportMeta.end);
    const warnings = [];
    for (const [i, date] of dates.entries()) {
      $("reportStatus").textContent = `Consultando ${i + 1} de ${dates.length} dias...`;
      try {
        const payload = await api("events", { sport: currentSport, date }, controller.signal);
        if (!payload.available) throw new Error(payload.warning);
        reportRows.push(...payload.events);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        warnings.push(`${date}: ${error.message}`);
        if (!sportsAvailable(currentSport)) break;
      }
    }
    reportRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    reportMeta.partial = warnings.length > 0;
    reportMeta.warning = warnings.join(" | ");
    $("reportStatus").textContent = warnings.length ? `Consulta incompleta. ${warnings.join(" | ")}` : "Consulta concluída.";
    $("reportContent").innerHTML = reportTable();
    $("csv").disabled = $("print").disabled = reportRows.length === 0;
  } catch (error) { if (error.name !== "AbortError") $("reportStatus").textContent = error.message; }
  finally { if (reportController === controller) $("generateReport").disabled = false; }
}
function sportsAvailable(value) { return ["football", "basketball", "nfl"].includes(value); }
function exportCsv() {
  const cell = value => {
    let text = String(value ?? "");
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [["Modalidade", "Data e hora (Brasília)", "Campeonato", "Mandante", "Visitante", "Placar mandante", "Placar visitante", "Situação", "Relatório parcial"], ...reportRows.map(event => [reportMeta.label, formatted(event.date, true), event.league.name, event.home.name, event.away.name, event.score.home, event.score.away, phaseLabel(event), reportMeta.partial ? "Sim" : "Não"])];
  const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `partidas-${reportMeta.start}-${reportMeta.end}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("date").value = today();
$("date").addEventListener("change", () => { resetDetail(); load(); });
$("refresh").addEventListener("click", load);
for (const id of ["search", "league", "phase"]) $(id).addEventListener(id === "search" ? "input" : "change", render);
$("sports").addEventListener("click", event => {
  const button = event.target.closest("button[data-sport]");
  if (!button || sport === button.dataset.sport) return;
  sport = button.dataset.sport;
  for (const tab of $("sports").querySelectorAll("button")) tab.setAttribute("aria-pressed", String(tab === button));
  events = []; $("league").value = ""; $("search").value = ""; resetDetail(); render(); load();
});
$("games").addEventListener("click", event => { const button = event.target.closest("button[data-id]"); if (button) selectGame(button.dataset.id); });
$("detail").addEventListener("click", event => { if (event.target.closest("#analyzeGame")) analyzeGame(); });
$("openReport").addEventListener("click", () => {
  $("startDate").value = $("endDate").value = $("date").value;
  reportRows = []; $("reportContent").innerHTML = ""; $("reportStatus").textContent = "";
  $("csv").disabled = $("print").disabled = true; $("reportDialog").showModal();
});
$("closeReport").addEventListener("click", () => $("reportDialog").close());
$("reportDialog").addEventListener("close", () => { reportController?.abort(); $("generateReport").disabled = false; });
$("reportForm").addEventListener("submit", generateReport);
$("csv").addEventListener("click", exportCsv);
$("print").addEventListener("click", () => window.print());
setInterval(() => { if (!document.hidden && !$("reportDialog").open && !$("analyzeGame")?.disabled) load(); }, 300000);
load();
