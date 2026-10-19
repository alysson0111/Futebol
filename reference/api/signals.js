import { getDb, now } from "./_lib/firebase.js";
import { analyzeFixtures } from "./_lib/scanner.js";
import { fetchTotalCornerResultsDate, totalCornerRowsToFixtures } from "./_lib/totalCorner.js";
import { isFinishedGame, buildFinalSignalUpdate } from "../src/analysis/signalSettlement.js";
import { selectResultDates, findResultGame } from "./_lib/signalResultLookup.js";
import { deliverEntry } from './_lib/telegram.js';
import { enqueueResult } from './_lib/resultNotifications.js';
import { createHash } from 'node:crypto';
import { isEntryTimingAllowed, isScoreTied, minEntryMinute } from '../src/analysis/entryTiming.js';

const SIGNAL_COLLECTION = 'central_sinais';

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const SIGNALS_READ_LIMIT = 2000;
const PENDING_READ_LIMIT = 100;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

function cleanSignal(input) {
  const analysis = input.analise || {};
  const stats = [
    ...(Array.isArray(analysis.dadosJogo) ? analysis.dadosJogo : []),
    ...(Array.isArray(analysis.sinais) ? analysis.sinais : []),
    ...(Array.isArray(input.stats) ? input.stats : [])
  ];
  const signalLines = [
    ...(Array.isArray(analysis.linhas) ? analysis.linhas : []),
    ...(Array.isArray(input.signals) ? input.signals : []),
    ...(Array.isArray(input.signalLines) ? input.signalLines : [])
  ].map(String).filter(Boolean);
  const market = String(analysis.mercado || input.market || "");
  const mlPick = String(analysis.mlPick || input.mlPick || "");
  const mlPickLabel = String(analysis.mlPickLabel || input.mlPickLabel || mlLabelFromPick(mlPick, input) || "");
  const normalizedSignalLines = market === "corners" && !signalLines.length
    ? ["Over 9.5 escanteios"]
    : [...new Set(signalLines)];
  const liveCorners = Number(input.liveCorners);

  return {
    key: String(input.key || ""),
    sourceId: String(input.sourceId || ""),
    source: String(input.source || ""),
    forebetUrl: String(input.forebetUrl || ""),
    home: String(input.home || ""),
    away: String(input.away || ""),
    league: String(input.league || ""),
    market,
    marketLabel: String(analysis.label || input.marketLabel || ""),
    mlPick,
    mlPickLabel,
    handicapLine: Number.isFinite(Number(input.handicapLine)) ? Number(input.handicapLine) : extractHandicapLine(input),
    odd: Number(analysis.odd || input.odd || 0),
    oddSource: String(input.oddSource || ""),
    oddTicker: String(input.oddTicker || ""),
    oddSide: String(input.oddSide || ""),
    oddFetchedAt: String(input.oddFetchedAt || ""),
    confidence: Number(analysis.confianca || input.confidence || 0),
    scoreText: String(input.scoreText || ""),
    entryScoreText: String(input.scoreText || ""),
    entryLiveStatus: String(input.liveStatus || ""),
    entryLiveCorners: Number.isFinite(liveCorners) ? liveCorners : null,
    settlementPolicy: "final-only",
    liveStatus: String(input.liveStatus || ""),
    dateText: String(input.dateText || ""),
    stats: stats.map(String).filter(Boolean).slice(0, 20),
    signalLines: normalizedSignalLines.slice(0, 10),
    liveCorners: Number.isFinite(liveCorners) ? liveCorners : null,
    result: "pendente",
    createdAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  };
}

function mlLabelFromPick(pick, game) {
  if (pick === "home") return `Casa (${game.home || "mandante"})`;
  if (pick === "away") return `Fora (${game.away || "visitante"})`;
  if (pick === "draw") return "Empate";
  return "";
}

function normalizeMarketName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function extractHandicapLine(value) {
  if (Number.isFinite(Number(value?.handicapLine))) return Number(value.handicapLine);
  const text = [
    ...(Array.isArray(value?.signalLines) ? value.signalLines : []),
    ...(Array.isArray(value?.signals) ? value.signals : []),
    ...(Array.isArray(value?.stats) ? value.stats : [])
  ].join(" ");
  const match = text.match(/Handicap[^+-]*([+-]\d+(?:\.\d+)?|0\.0)/i);
  return match ? asNumber(match[1], NaN) : NaN;
}

function parseScoreTotal(scoreText) {
  const parts = String(scoreText || "").split("x").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] : 0;
}

function elapsedFromStatus(value) {
  const match = String(value || "").match(/\d{1,3}/);
  return match ? asNumber(match[0]) : 0;
}

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function forebetReaderUrl(url) {
  return `https://r.jina.ai/http://${url}`;
}

function forebetMatchUrl(signal) {
  if (signal.forebetUrl) return signal.forebetUrl;
  const sourceId = String(signal.sourceId || "");
  if (!/^\d+$/.test(sourceId)) return "";
  const slug = slugify(`${signal.home || ""} ${signal.away || ""}`);
  return slug ? `https://www.forebet.com/en/football/matches/${slug}-${sourceId}` : "";
}

function parsePtDateTime(dateText, stats = []) {
  const dateMatch = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) return null;
  const timeLine = (Array.isArray(stats) ? stats : []).find((entry) => /DADO \| Horario \|/i.test(String(entry)));
  const timeMatch = String(timeLine || "").match(/(\d{1,2}):(\d{2})/);
  const [, day, month, year] = dateMatch;
  const hour = timeMatch ? timeMatch[1].padStart(2, "0") : "00";
  const minute = timeMatch ? timeMatch[2] : "00";
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ptDateToIso(dateText) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function uniqueRows(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = `${row.dateIso || ""}|${row.league || ""}|${row.home || ""}|${row.away || ""}|${row.time || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldFetchDatedResult(signal) {
  const liveStatus = String(signal.liveStatus || "").toUpperCase();
  if (!signal.dateText) return false;
  if (FINISHED_STATUSES.has(liveStatus)) return true;

  const elapsed = elapsedFromStatus(liveStatus);
  const createdSeconds = Number(signal.createdAt?._seconds || 0);
  const olderThanOneHour = createdSeconds > 0 && Date.now() - createdSeconds * 1000 > 60 * 60 * 1000;
  return elapsed >= 45 || olderThanOneHour;
}

function shouldCheckForebetSettlement(signal) {
  if (!forebetMatchUrl(signal)) return false;
  const liveStatus = String(signal.liveStatus || "").toUpperCase().replace("'", "");
  const alreadyFinal = FINISHED_STATUSES.has(liveStatus);
  if (signal.result !== "pendente" && alreadyFinal) return false;
  const hasPartialScore = /^\d{1,3}$/.test(liveStatus);
  const checkedSeconds = Number(signal.settleCheckedAt?._seconds || 0);
  if (!hasPartialScore && checkedSeconds && Date.now() - checkedSeconds * 1000 < 2 * 60 * 60 * 1000) return false;

  const kickoff = parsePtDateTime(signal.dateText, signal.stats);
  if (!kickoff) return true;

  const nowMs = Date.now();
  const settleWindowMs = 120 * 60 * 1000;
  return kickoff.getTime() + settleWindowMs <= nowMs;
}

function parseForebetMatchScore(markdown) {
  const text = String(markdown || "");
  const scoreMatch = text.match(/\*\*(\d+)\s*-\s*(\d+)\*\*\s*(FT|AET|PEN)/i)
    || text.match(/(FT|AET|PEN)\s*\n+\s*\*\*(\d+)\s*-\s*(\d+)\*\*/i)
    || text.match(/\*\*(\d+)\s*-\s*(\d+)\*\*\s*(HT|\d{1,3}'?)/i)
    || text.match(/(HT|\d{1,3}'?)\s*\n+\s*\*\*(\d+)\s*-\s*(\d+)\*\*/i);
  if (!scoreMatch) return null;

  const scoreFirst = scoreMatch[0].trim().startsWith("**");
  const homeGoals = asNumber(scoreFirst ? scoreMatch[1] : scoreMatch[2]);
  const awayGoals = asNumber(scoreFirst ? scoreMatch[2] : scoreMatch[3]);
  const status = String(scoreFirst ? scoreMatch[3] : scoreMatch[1]).toUpperCase().replace("'", "");
  const elapsed = /^\d+$/.test(status) ? asNumber(status) : (status === "HT" ? 45 : FINISHED_STATUSES.has(status) ? 90 : 0);

  return {
    scoreText: `${homeGoals}x${awayGoals}`,
    totalGoals: homeGoals + awayGoals,
    apiStatus: status,
    liveStatus: /^\d+$/.test(status) ? `${status}'` : status,
    fixture: { status: { short: status, elapsed } },
    goals: { home: homeGoals, away: awayGoals }
  };
}



export async function settleSignalsFromTotalCorner(db, signals, cursor = 0, options = {}) {
  const pending = signals.filter((signal) => signal.id && !signal.finalConfirmed && (signal.result === "pendente" || !isFinishedGame(signal)));
  if (!pending.length) return { signals, settlement: { updated: 0, errors: [], nextCursor: 0 } };

  const updates = new Map();
  let games = [];
  const plan = options.dates ? {dates:[...new Set(options.dates)].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&pending.some(signal=>signal.dateText===date.split('-').reverse().join('/'))),nextCursor:0} : selectResultDates(pending, cursor);
  const settlementStatus = { updated: 0, errors: [], warnings: [], sources: [], checkedDates: plan.dates, nextCursor: plan.nextCursor };
  try {
    const rowResults = await Promise.allSettled(plan.dates.map((dateIso) => options.fetchGames ? options.fetchGames(dateIso) : fetchTotalCornerResultsDate(dateIso,{store:db,deadline:options.deadline})));
    rowResults.forEach((result, index) => {
      if(result.status==='fulfilled'){
        settlementStatus.warnings.push(...(result.value.coverageWarnings||[]).map(warning=>`${plan.dates[index]}: ${warning}`));
        settlementStatus.sources.push(...(result.value.resultSources||[]).map(source=>({date:plan.dates[index],source})));
      }
      if (result.status === "rejected") settlementStatus.errors.push(`${plan.dates[index]}: ${result.reason?.message || "Falha ao buscar resultado"}`);
      else if (!result.value.length) settlementStatus.errors.push(`${plan.dates[index]}: fonte sem jogos legiveis`);
      else (result.value.coverageErrors || []).forEach(error => settlementStatus.errors.push(`${plan.dates[index]}: ${error}`));
    });
    const totalCornerRows = rowResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    games = options.fetchGames ? totalCornerRows : analyzeFixtures({ response: totalCornerRowsToFixtures(uniqueRows(totalCornerRows)) });
    settlementStatus.finalGamesFound = games.filter(isFinishedGame).length;
  } catch (error) {
    settlementStatus.errors.push(error.message || "Falha na consulta de resultados");
    return { signals, settlement: settlementStatus };
  }

  for (const signal of pending) {
    const game = findResultGame(signal, games);
    if (!game) continue;
    const currentUpdate = buildFinalSignalUpdate(signal, game);
    if (!currentUpdate) continue;

    const settlement = {
      ...currentUpdate,
      settledAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      updatedAt: now()
    };
    updates.set(signal.id, settlement);
  }
  const entries = [...updates.entries()];
  for (let index = 0; index < entries.length; index += 100) {
    const group=entries.slice(index,index+100);
    const committed=await db.runTransaction(async transaction=>{
      const refs=group.map(([id])=>db.collection(SIGNAL_COLLECTION).doc(id));
      const snapshots=await transaction.getAll(...refs);
      const applied=[];
      snapshots.forEach((snapshot,position)=>{
        const current=snapshot.exists?snapshot.data():null;
        if(!current||current.finalConfirmed||current.result!=='pendente')return;
        transaction.update(refs[position],group[position][1]);
        enqueueResult(transaction,db,group[position][0],current,group[position][1]);
        applied.push(group[position][0]);
      });
      return applied;
    });
    group.filter(([id])=>!committed.includes(id)).forEach(([id])=>updates.delete(id));
  }
  settlementStatus.updated = updates.size;
  settlementStatus.pendingChecked = pending.filter(signal=>plan.dates.includes(String(signal.dateText||'').split('/').reverse().join('-'))).length;
  settlementStatus.pendingDeferred = pending.length-settlementStatus.pendingChecked;
  settlementStatus.unresolved = pending.length - updates.size;
  return { signals: signals.map((signal) => updates.has(signal.id) ? { ...signal, ...updates.get(signal.id) } : signal), settlement: settlementStatus };
}

export async function readPendingSignals(db, cursor = '') {
  let query = db.collection(SIGNAL_COLLECTION).where('result', '==', 'pendente').orderBy('__name__').limit(PENDING_READ_LIMIT);
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(cursor)) query = query.startAfter(cursor);
  let snapshot = await query.get();
  if (!snapshot.size && cursor) snapshot = await db.collection(SIGNAL_COLLECTION).where('result', '==', 'pendente').orderBy('__name__').limit(PENDING_READ_LIMIT).get();
  return {
    signals: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    nextCursor: snapshot.size === PENDING_READ_LIMIT ? snapshot.docs.at(-1).id : ''
  };
}

export async function readSignalSync(db, params) {
  const sinceDate = params.get("since") ? new Date(params.get("since")) : null;
  const collection = db.collection(SIGNAL_COLLECTION);
  const query = sinceDate
    ? collection.where("updatedAt", ">=", sinceDate).orderBy("updatedAt", "asc")
    : collection.orderBy("createdAt", "desc");
  const snapshot = await query.limit(SIGNALS_READ_LIMIT).get();
  const records = new Map(snapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const pendingIds = sinceDate ? [...new Set((params.get("pendingIds") || "").split(",").filter((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)))].slice(0, 20) : [];
  if (pendingIds.length) {
    const pendingDocs = await db.getAll(...pendingIds.map((id) => collection.doc(id)));
    pendingDocs.filter((doc) => doc.exists).forEach((doc) => records.set(doc.id, { id: doc.id, ...doc.data() }));
  }
  // Advance only to the last returned update when a delta page is full.
  const syncTime = sinceDate && snapshot.size === SIGNALS_READ_LIMIT
    ? snapshot.docs.at(-1).data().updatedAt
    : snapshot.readTime;
  const syncToken = syncTime.toDate().toISOString();
  return { signals: [...records.values()], syncToken };
}

async function listSignals(req, res) {
  const db = getDb();
  const params = new URL(req.url || "/api/signals", "http://localhost").searchParams;
  const since = params.get("since");
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && (!Number.isFinite(sinceDate.getTime()) || sinceDate.getTime() > Date.now())) {
    return send(res, 400, { error: "Data de sincronizacao invalida." });
  }
  const { signals, syncToken } = await readSignalSync(db, params);
  // Recovery must not depend on the browser retaining every pending signal.
  const pending = await readPendingSignals(db, params.get('pendingCursor') || '');
  const records = new Map(signals.map(signal => [signal.id, signal]));
  pending.signals.forEach(signal => records.set(signal.id, signal));
  const cursor = params.get("cursor");
  const payload = await settleSignalsFromTotalCorner(db, [...records.values()], cursor);
  send(res, 200, { ...payload, syncToken, pendingCursor: pending.nextCursor, limit: SIGNALS_READ_LIMIT });
}

export function prepareSignal(input) {
  const reject = (status,message) => { throw Object.assign(new Error(message), {status}); };
  const eligibilityGame = {...input,market:input.analise?.mercado || input.market};
  if (input.sendTelegram !== undefined && typeof input.sendTelegram !== 'boolean') reject(400,'Selecao de envio ao Telegram invalida.');
  if (isFinishedGame(input)) reject(409,'Partida encerrada: nenhuma nova entrada pode ser enviada.');
  if (!isEntryTimingAllowed(eligibilityGame)) reject(409,`${eligibilityGame.market==='over05'?'Over +0.5':'ML'}: entradas somente ao vivo a partir dos ${minEntryMinute(eligibilityGame.market)} minutos, com minuto confirmado.`);
  if (eligibilityGame.market === 'ml' && !isScoreTied(input)) reject(409,'ML: entrada somente com placar empatado e confirmado.');
  if (!(input.analise?.entrada === true || input.status === 'Entrada')) reject(400,'Somente entradas aprovadas podem ser enviadas.');
  const record = cleanSignal(input);
  record.telegramEnabled = input.sendTelegram !== false;
  if (!record.key || !record.home || !record.away || !record.market) {
    reject(400,"Sinal incompleto.");
  }

  if (!Number.isFinite(record.confidence) || record.confidence <= 0 || record.confidence > 100 || !record.signalLines.length) reject(400,'Entrada sem confiabilidade ou sinal valido.');
  return record;
}

export async function persistApprovedSignal(db, input, deliver = deliverEntry) {
  const record = prepareSignal(input);
  const doc = db.collection(SIGNAL_COLLECTION).doc(createHash('sha256').update(record.key).digest('hex'));
  const previous = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(doc);
    if (snapshot.exists) return snapshot.data();
    transaction.set(doc, { ...record, createdAt: now(), updatedAt: now() });
    return null;
  });
  if (previous) return { id: doc.id, ...previous, duplicate: true };

  const delivery = await deliver(record, { enabled: record.telegramEnabled });
  await doc.update({ telegram: delivery, updatedAt: now() });
  return { id: doc.id, ...record, telegram: delivery };
}

async function saveSignal(req, res) {
  const input = readBody(req);
  prepareSignal(input);
  send(res,200,await persistApprovedSignal(getDb(),input));
}

async function updateResult(req, res) {
  const db = getDb();
  const { id, result, scoreText, liveStatus, liveCorners } = readBody(req);
  if (!id || !["green", "push", "red", "pendente"].includes(result)) {
    return send(res, 400, { error: "Resultado invalido." });
  }

  const doc = db.collection(SIGNAL_COLLECTION).doc(String(id));
  const snapshot = await doc.get();
  if (!snapshot.exists) return send(res, 404, { error: "Sinal nao encontrado." });
  const signal = snapshot.data();
  let finalUpdate;
  if (scoreText && isFinishedGame({ liveStatus })) {
    finalUpdate = buildFinalSignalUpdate(signal, { scoreText, liveStatus, liveCorners });
    if (!finalUpdate || finalUpdate.result !== result) return send(res, 400, { error: "Resultado nao corresponde ao sinal salvo." });
  } else if (!signal.finalConfirmed && !isFinishedGame(signal)) {
    return send(res, 409, { error: "O sinal aguarda a confirmacao de fim do jogo." });
  }
  const update = {
    ...(finalUpdate || { result, settlementFactor: result === "push" ? 0 : 1 }),
    settledAtText: result === "pendente" ? "" : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    updatedAt: now()
  };
  await db.runTransaction(async transaction=>{
    const current=await transaction.get(doc);
    if(!current.exists)throw Object.assign(new Error('Sinal nao encontrado.'),{status:404});
    transaction.update(doc,update);
    enqueueResult(transaction,db,String(id),current.data(),update);
  });

  send(res, 200, { ok: true, ...update });
}

async function deleteSignal(req, res) {
  const db = getDb();
  const { id } = readBody(req);
  if (!id) return send(res, 400, { error: "Informe o sinal para excluir." });

  await db.collection(SIGNAL_COLLECTION).doc(String(id)).delete();
  send(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await listSignals(req, res);
    if (req.method === "POST") return await saveSignal(req, res);
    if (req.method === "PATCH") return await updateResult(req, res);
    if (req.method === "DELETE") return await deleteSignal(req, res);
    return send(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Erro no banco de sinais." });
  }
}
