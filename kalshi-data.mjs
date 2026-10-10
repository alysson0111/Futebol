import { validDate } from './sports-data.mjs';
import { assessEntry } from './entry-scanner.mjs';

const base = 'https://external-api.kalshi.com/trade-api/v2';
const types = { football: 'soccer_tournament_multi_leg', tennis: 'tennis_tournament_singles', basketball: 'basketball_game', nfl: 'football_game' };
const cache = new Map(), pending = new Map();
export const validMilestone = id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '');
export function dateKey(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
async function request(path, params = {}) {
  const url = new URL(base + path);
  for (const [key, values] of Object.entries(params)) for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(key, value);
  const key = url.href, saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.data;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Limite de consultas Kalshi atingido. Aguarde antes de atualizar.' : `Kalshi respondeu HTTP ${response.status}.`);
    const data = await response.json();
    cache.set(key, { data, expires: Date.now() + 60000 });
    while (cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
export function matchesSport(milestone, sport) {
  return types[sport] === milestone.type && (sport !== 'nfl' || milestone.details?.league === 'NFL')
    && !/^(SIM|KXEBBALL|KXEFOOTBALL)/.test(milestone.details?.main_game_event_ticker || '');
}
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function normalizeMilestone(milestone, sport, live = {}) {
  const details = milestone.details || {};
  const awayFirst = / at /i.test(milestone.title || '');
  const names = String(milestone.title || '').split(/ at | vs\.? /i);
  const home = { id: details.home_team_id || details.first_competitor_id || null, name: names[awayFirst ? 1 : 0] || milestone.title || 'Participante 1', logo: null };
  const away = { id: details.away_team_id || details.second_competitor_id || null, name: names[awayFirst ? 0 : 1] || 'Participante 2', logo: null };
  const statuses = [live.match_status, live.widget_status, live.status, details.status].filter(Boolean).map(status => String(status).toLowerCase());
  const has = values => statuses.some(status => values.includes(status));
  const phase = has(['ended', 'finished', 'complete', 'completed', 'played']) ? 'finished'
    : has(['inprogress', 'in_progress', 'in progress', 'live', 'playing', 'halftime', 'halftime break']) ? 'live'
      : has(['scheduled', 'not_started', 'notstarted', 'created']) ? 'scheduled' : 'other';
  return { id: milestone.id, source: 'Kalshi', sport, title: milestone.title, date: milestone.start_date,
    league: { id: details.league || details.tournament_name || details.tour || milestone.type, name: details.league || details.tournament_name || details.tour || 'Competicao', country: '' },
    home, away, score: { home: number(live.home_same_game_score ?? live.home_score), away: number(live.away_same_game_score ?? live.away_score) },
    phase, status: live.half || (phase === 'finished' ? 'FT' : phase === 'live' ? 'LIVE' : phase === 'scheduled' ? 'NS' : 'UNKNOWN'),
    elapsed: live.time || live.clock || null, round: details.round || '', venue: '', eventTickers: [...new Set(milestone.primary_event_tickers || [])],
    mainTicker: details.main_game_event_ticker || milestone.primary_event_tickers?.[0] || null,
    updatedAt: milestone.last_updated_ts };
}
export function bookQuote(book, side) {
  const valid = levels => (levels || []).map(([price, size]) => [number(price), number(size)]).filter(([price, size]) => price > 0 && price < 1 && size > 0);
  const opposite = valid(book?.[side === 'yes' ? 'no_dollars' : 'yes_dollars']);
  const own = valid(book?.[side === 'yes' ? 'yes_dollars' : 'no_dollars']);
  const best = opposite.reduce((saved, level) => !saved || level[0] > saved[0] ? level : saved, null);
  const ask = best ? Number((1 - best[0]).toFixed(6)) : null;
  return { ask, bid: own.length ? Math.max(...own.map(level => level[0])) : null,
    availableShares: best ? opposite.filter(level => level[0] === best[0]).reduce((sum, level) => sum + level[1], 0) : null,
    odd: ask ? 1 / ask : null, impliedProbability: ask, checkedAt: new Date().toISOString() };
}
export function normalizeMarket(raw, book) {
  const series = raw.event_ticker?.split('-')[0] || '';
  const scope = !/(?:1H|2H|TEAM|[1-4]Q|SET)/.test(series);
  const type = scope && /TOTAL$/.test(series) ? 'totals' : scope && /SPREAD$/.test(series) ? 'spreads'
    : scope && /(?:GAME|MATCH)$/.test(series) ? 'moneyline' : scope && /CORNERS$/.test(series) ? 'corners' : 'other';
  const active = raw.status === 'active' && (!raw.close_time || Date.parse(raw.close_time) > Date.now());
  return { id: raw.ticker, title: raw.title, type, line: number(raw.floor_strike), status: raw.status,
    description: [raw.rules_primary, raw.rules_secondary].filter(Boolean).join('\n'), volume: number(raw.volume_fp), result: raw.result || null,
    url: `https://kalshi.com/markets/${encodeURIComponent(series.toLowerCase())}`,
    outcomes: ['yes', 'no'].map(side => ({ label: side === 'yes' ? 'Sim' : 'Nao',
      quote: active && book ? bookQuote(book, side) : null })) };
}
export async function getKalshiEvents(sport, date) {
  if (!validDate(date)) throw new Error('Data invalida.');
  if (!types[sport]) return { source: 'Kalshi', available: false, events: [], warning: 'Nenhuma categoria EA Sports FC/FIFA verificada na Kalshi. eFootball e um jogo diferente e nao sera misturado.' };
  const saved = new Map();
  let cursor = '', pages = 0;
  do {
    const payload = await request('/milestones', { limit: 500, minimum_start_date: `${date}T00:00:00-03:00`, type: types[sport], ...(sport === 'nfl' ? { competition: 'Pro Football' } : {}), ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(payload.milestones)) throw new Error('Kalshi retornou calendario invalido.');
    for (const milestone of payload.milestones) if (dateKey(milestone.start_date) === date && matchesSport(milestone, sport)) saved.set(milestone.id, milestone);
    cursor = payload.cursor || ''; pages++;
  } while (cursor && pages < 4);
  const milestones = [...saved.values()].slice(0, 300), live = new Map(), warnings = [];
  if (cursor || saved.size > 300) warnings.push('Consulta parcial: limite de 2.000 registros de calendario e 300 partidas por consulta.');
  for (let i = 0; i < milestones.length; i += 100) {
    try {
      const payload = await request('/live_data/batch', { milestone_ids: milestones.slice(i, i + 100).map(item => item.id) });
      for (const item of payload.live_datas || []) live.set(item.milestone_id, item.details || {});
    } catch (error) { warnings.push(`Placares indisponiveis: ${error.message}`); }
  }
  return { source: 'Kalshi', available: true, events: milestones.map(item => normalizeMilestone(item, sport, live.get(item.id))),
    warning: warnings.join(' '), updatedAt: new Date().toISOString() };
}
export async function getKalshiDetails(sport, id) {
  if (!validMilestone(id)) throw new Error('Partida Kalshi invalida.');
  const payload = await request(`/milestones/${encodeURIComponent(id)}`);
  const milestone = payload.milestone;
  if (!milestone || !matchesSport(milestone, sport)) throw new Error('Partida nao pertence a modalidade selecionada.');
  const warnings = [], live = {};
  try { Object.assign(live, (await request(`/live_data/milestone/${encodeURIComponent(id)}`)).live_data?.details || {}); }
  catch (error) { warnings.push(error.message); }
  const event = normalizeMilestone(milestone, sport, live);
  const tickers = event.eventTickers.slice(0, 24);
  if (event.eventTickers.length > tickers.length) warnings.push('Contratos adicionais omitidos: limite de 24 eventos por partida.');
  const markets = [];
  if (tickers.length) {
    const contracts = await request('/events', { tickers: tickers.join(','), with_nested_markets: true, limit: 200 });
    for (const item of contracts.events || []) if (tickers.includes(item.event_ticker)) markets.push(...item.markets || []);
    if (contracts.cursor) warnings.push('Resposta de contratos parcial.');
  }
  const unique = [...new Map(markets.map(market => [market.ticker, market])).values()].slice(0, 100);
  if (markets.length > unique.length) warnings.push('Limite de 100 contratos por partida.');
  const books = new Map(), active = unique.filter(market => market.status === 'active').map(market => market.ticker);
  if (active.length) {
    try { const payload = await request('/markets/orderbooks', { tickers: active });
      for (const item of payload.orderbooks || []) books.set(item.ticker, item.orderbook_fp);
    } catch (error) { warnings.push(`Livro de ofertas indisponivel: ${error.message}`); }
  }
  event.markets = unique.map(market => normalizeMarket(market, books.get(market.ticker)));
  const statLabels = { corners: 'Escanteios', shots: 'Finalizações', shots_on_target: 'Chutes no gol', fouls: 'Faltas', possession: 'Posse de bola', accurate_passes: 'Passes certos', total_passes: 'Passes', yellow_cards: 'Cartões amarelos', red_cards: 'Cartões vermelhos' };
  const statistics = ['home', 'away'].flatMap(side => {
    const stats = live[`${side}_stats`];
    if (!stats || typeof stats !== 'object') return [];
    const rows = Object.entries(stats).filter(([name, value]) => statLabels[name] && number(value) !== null).map(([name, value]) => ({ type: statLabels[name], value: number(value) }));
    return rows.length ? [{ team: event[side], statistics: rows }] : [];
  });
  const timeline = ['home', 'away'].flatMap(side => (live[`${side}_significant_events`] || []).map(item => ({
    type: ({ score_change: 'Gol', yellow_card: 'Cartão amarelo', red_card: 'Cartão vermelho' })[item.event_type] || item.event_type,
    time: { elapsed: String(item.time || '').replace(/'$/, '') }, player: { name: item.player }, team: event[side]
  })));
  const result = { source: 'Kalshi', event, statistics, timeline, warning: warnings.join(' '), updatedAt: new Date().toISOString() };
  result.entries = ['over-05', 'over-15', 'over-25', 'under-25', 'under-35', 'corners', 'handicap', 'ml'].map(market => ({ market, ...assessEntry(result, market) }));
  return result;
}
export async function scanKalshi(sport, id, market) {
  const payload = await getKalshiDetails(sport, id);
  const line = { 'over-05': .5, 'over-15': 1.5, 'over-25': 2.5, 'under-25': 2.5, 'under-35': 3.5 }[market];
  const eligible = payload.event.markets.filter(contract => market === 'ml' ? contract.type === 'moneyline'
    : market === 'handicap' ? contract.type === 'spreads' : market === 'corners' ? contract.type === 'corners'
      : ['football'].includes(sport) && contract.type === 'totals' && contract.line === line);
  const side = market.startsWith('under') ? 'Nao' : 'Sim';
  const analysis = assessEntry(payload, market);
  const assessments = eligible.flatMap(contract => contract.outcomes.filter(outcome => outcome.label === side).map(outcome => ({
    selection: `${contract.title} - ${outcome.label}`, odd: outcome.quote?.odd ?? null,
    impliedProbability: outcome.quote?.impliedProbability ?? null, quote: outcome.quote, approved: false,
    rate: null, lower: null, upper: null, sample: null, ...analysis
  }))).slice(0, 1);
  return { source: 'Kalshi', event: payload.event, market, signals: [], assessments: assessments.length ? assessments : [analysis], warnings: payload.warning ? [payload.warning] : [], delivery: [],
    checkedAt: new Date().toISOString(), reason: analysis.reason };
}
