import { randomUUID, createHash } from 'node:crypto';
import { now } from './firebase.js';
import { normalizeTelegramMarkets } from '../../src/analysis/telegramMarkets.js';
import { isEntryAllowed } from '../../src/analysis/entryTiming.js';
import { isFinishedGame } from '../../src/analysis/signalSettlement.js';
import { persistApprovedSignal } from '../signals.js';
import { fetchTotalCornerToday, totalCornerRowsToFixtures } from './totalCorner.js';
import { analyzeFixtures, publicGame } from './scanner.js';

const settingsDoc = db => db.collection('central_config').doc('telegram');
const jobDoc = db => db.collection('central_jobs').doc('telegram');

export async function readAutomationSettings(db) {
  const snapshot = await settingsDoc(db).get();
  const data = snapshot.exists ? snapshot.data() : {};
  return { configured: snapshot.exists, enabled: data.enabled === true, markets: normalizeTelegramMarkets(data.markets) };
}

export async function writeAutomationSettings(db, input) {
  const markets = normalizeTelegramMarkets(input.markets);
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.markets) || input.markets.some(market=>!markets.includes(market))) {
    throw Object.assign(new Error('Selecione mercados validos e o estado da automacao.'),{status:400});
  }
  await settingsDoc(db).set({enabled:input.enabled,markets,updatedAt:now()},{merge:true});
  return {configured:true,enabled:input.enabled,markets};
}

export async function claimAutomationRun(db, time = Date.now()) {
  const ref = jobDoc(db), owner = randomUUID();
  const acquired = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref), data = snapshot.exists ? snapshot.data() : {};
    if (Number(data.leaseUntil || 0) > time || (data.lastStartedAtMs && time - data.lastStartedAtMs < 240000)) return false;
    transaction.set(ref,{owner,leaseUntil:time+90000,lastStartedAtMs:time,status:'running',updatedAt:now()},{merge:true});
    return {cursor:Number(data.nextOffset)||0};
  });
  return acquired ? {ref,owner,cursor:acquired.cursor} : null;
}

export function selectAutomationEntries(games, markets, cursor=0) {
  const allowed = new Set(markets), seen = new Set();
  const candidates = games.filter(game => {
    if (!allowed.has(game.market) || game.status !== 'Entrada' || isFinishedGame(game) || !isEntryAllowed(game) || !game.key || seen.has(game.key)) return false;
    seen.add(game.key);
    return true;
  }).sort((a,b)=>Number(b.confidence||0)-Number(a.confidence||0));
  const offset=candidates.length?Math.max(0,Math.trunc(cursor))%candidates.length:0;
  const entries=Array.from({length:Math.min(100,candidates.length)},(_,index)=>candidates[(offset+index)%candidates.length]);
  entries.nextOffset=candidates.length?(offset+entries.length)%candidates.length:0;
  return entries;
}

export async function runAutomation(db, options = {}) {
  const started = Date.now();
  const settings = await readAutomationSettings(db);
  if (!settings.enabled || !settings.markets.length) return {status:'disabled',saved:0,sent:0};
  const lease = await claimAutomationRun(db);
  if (!lease) return {status:'busy',saved:0,sent:0};
  let summary = {status:'failed',saved:0,sent:0};
  try {
    const games = options.fetchGames ? await options.fetchGames() : analyzeFixtures({response:totalCornerRowsToFixtures(await fetchTotalCornerToday())}).map(publicGame);
    const entries = selectAutomationEntries(games,settings.markets,lease.cursor);
    const refs = entries.map(game=>db.collection('central_sinais').doc(createHash('sha256').update(game.key).digest('hex')));
    const existing = refs.length ? await db.getAll(...refs) : [];
    const unsaved = entries.filter((_,index)=>!existing[index].exists);
    summary = {status:'complete',candidates:entries.length,nextOffset:entries.nextOffset,existing:entries.length-unsaved.length,saved:0,sent:0,failed:0,deferred:0};
    for (let index=0;index<unsaved.length;index++) {
      if (Date.now()-started>45000) {summary.deferred=unsaved.length-index;break;}
      // Re-read shared preferences before each new signal, so pausing is effective.
      const current = await readAutomationSettings(db);
      if (!current.enabled) {summary.status='paused';summary.deferred=unsaved.length-index;break;}
      if (!current.markets.includes(unsaved[index].market)) continue;
      const result = await persistApprovedSignal(db,{...unsaved[index],sendTelegram:true},options.deliver);
      if (result.duplicate) continue;
      summary.saved++;
      if (result.telegram.status==='enviado') summary.sent++;
      else summary.failed++;
    }
    return summary;
  } finally {
    await db.runTransaction(async transaction=>{
      const snapshot=await transaction.get(lease.ref);
      if (snapshot.data()?.owner===lease.owner) transaction.set(lease.ref,{leaseUntil:0,nextOffset:summary.nextOffset||0,status:summary.status,summary,finishedAtText:new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),updatedAt:now()},{merge:true});
    });
  }
}
