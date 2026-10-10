const GAMMA = 'https://gamma-api.polymarket.com', CLOB = 'https://clob.polymarket.com';
const cache = new Map(), pending = new Map();
export const sports = { football: { tag: '100350' }, tennis: { tag: '864' }, eafootball: { tag: '102751' }, basketball: { tag: '28' }, nfl: { tag: '450' } };
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function dateKey(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function array(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
async function request(host, path, params = {}, body = null, ttl = 60000) {
  const url = new URL(path, host);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const key = `${url}:${JSON.stringify(body)}`;
  const saved = cache.get(key);
  if (saved?.expires > Date.now()) return saved.data;
  if (pending.has(key)) return pending.get(key);
  const operation = (async () => {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Limite da Polymarket atingido. Aguarde para atualizar.' : `Polymarket respondeu HTTP ${response.status}.`);
    const data = await response.json();
    if (data?.error) throw new Error(`Polymarket: ${data.error}`);
    cache.set(key, { data, expires: Date.now() + ttl });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
export function normalizeMarket(raw) {
  const outcomes = array(raw.outcomes), tokens = array(raw.clobTokenIds), prices = array(raw.outcomePrices);
  const line = raw.line == null || raw.line === '' ? null : Number(raw.line);
  return { id: String(raw.id), question: raw.question || '', title: raw.groupItemTitle || raw.question || '', type: raw.sportsMarketType || 'other',
    line: Number.isFinite(line) ? line : null, description: raw.description || '',
    active: raw.active === true && raw.closed !== true && raw.acceptingOrders === true && raw.enableOrderBook === true,
    closed: raw.closed === true, resolutionStatus: raw.umaResolutionStatus || null,
    liquidity: Number(raw.liquidityNum ?? raw.liquidity) || 0, volume: Number(raw.volumeNum ?? raw.volume) || 0,
    feesEnabled: raw.feesEnabled === true, minSize: Number(raw.orderMinSize) || null, updatedAt: raw.updatedAt || null,
    outcomes: outcomes.map((label, index) => {
      const price = prices[index] == null ? null : Number(prices[index]);
      return { label: String(label), tokenId: tokens[index] ? String(tokens[index]) : null, referencePrice: Number.isFinite(price) && price >= 0 && price <= 1 ? price : null };
    }) };
}
export function normalizeEvent(raw, sport) {
  const title = String(raw.title || '').split(' - ')[0];
  const names = title.split(/\s+(?:vs\.?|v\.)\s+/i);
  if (names.length !== 2) return null;
  const info = raw.sport || {}, ordering = info.ordering === 'away' ? ['away', 'home'] : ['home', 'away'];
  const participants = {};
  for (const [index, side] of ordering.entries()) {
    const record = (raw.teams || []).find(team => team.ordering === side) || (raw.teams || []).find(team => team.name === names[index]);
    participants[side] = { id: record?.id || null, name: record?.name || names[index], logo: record?.logo || null };
  }
  const date = raw.startTime || raw.markets?.find(m => m.gameStartTime)?.gameStartTime || null;
  const scoreMatch = typeof raw.score === 'string' ? raw.score.match(/^(\d+)\s*[-:]\s*(\d+)$/) : null;
  const score = scoreMatch ? { [ordering[0]]: Number(scoreMatch[1]), [ordering[1]]: Number(scoreMatch[2]) } : { home: null, away: null };
  const phase = raw.ended === true ? 'finished' : raw.live === true ? 'live' : date && Date.parse(date) > Date.now() ? 'scheduled' : 'other';
  return { id: String(raw.id), sourceIds: [String(raw.id)], sport, title, date, ...participants, score, scoreText: raw.score || null,
    league: { id: raw.series?.[0]?.id || info.series || null, name: info.name || raw.series?.[0]?.title || 'Polymarket', country: '', logo: info.image || null },
    phase, status: raw.period || (phase === 'finished' ? 'FT' : phase === 'scheduled' ? 'NS' : ''), elapsed: raw.elapsed || null,
    venue: '', round: '', liveConfirmed: raw.live === true, endedConfirmed: raw.ended === true,
    url: `https://polymarket.com/event/${raw.slug || raw.id}`, markets: (raw.markets || []).map(normalizeMarket), updatedAt: raw.updatedAt || null };
}
export async function getSportsEvents(sport, date) {
  if (!sports[sport]) throw new Error('Modalidade invalida.');
  if (!validDate(date)) throw new Error('Data invalida.');
  const from = new Date(`${date}T00:00:00-03:00`), to = new Date(+from + 8 * 86400000);
  const groups = new Map();
  let partial = false;
  // Market closing date is not kickoff; discovery is filtered by actual startTime.
  for (let page = 0; page < 10; page++) {
    const items = await request(GAMMA, '/events', { tag_id: sports[sport].tag, end_date_min: from.toISOString(), end_date_max: to.toISOString(), limit: 100, offset: page * 100, order: 'endDate', ascending: true });
    if (!Array.isArray(items)) throw new Error('Resposta de eventos da Polymarket invalida.');
    for (const raw of items) {
      if (!raw.tags?.some(tag => String(tag.id) === '100639') || !raw.tags?.some(tag => String(tag.id) === sports[sport].tag)) continue;
      const event = normalizeEvent(raw, sport);
      if (!event || dateKey(event.date) !== date) continue;
      const groupKey = `${event.league.id}:${event.title.normalize('NFC')}:${event.date}`;
      const saved = groups.get(groupKey);
      if (!saved) groups.set(groupKey, event);
      else {
        saved.sourceIds.push(event.id);
        saved.markets = [...new Map([...saved.markets, ...event.markets].map(market => [market.id, market])).values()];
        if ((event.liveConfirmed || event.endedConfirmed) && (!saved.updatedAt || Date.parse(event.updatedAt) >= Date.parse(saved.updatedAt))) Object.assign(saved, { phase: event.phase, status: event.status, elapsed: event.elapsed, score: event.score, scoreText: event.scoreText, liveConfirmed: event.liveConfirmed, endedConfirmed: event.endedConfirmed, updatedAt: event.updatedAt });
      }
    }
    if (items.length < 100) break;
    if (page === 9) partial = true;
  }
  return { source: 'Polymarket', available: true, events: [...groups.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))), updatedAt: new Date().toISOString(), warning: partial ? 'Consulta parcial: limite de 1.000 eventos da fonte atingido. Nem todos os confrontos podem estar presentes.' : '' };
}
export function quoteFromBook(book, tokenId) {
  if (String(book.asset_id) !== tokenId) return null;
  const levels = key => (book[key] || []).map(level => ({ price: Number(level.price), size: Number(level.size) })).filter(level => level.price > 0 && level.price < 1 && level.size > 0);
  const asks = levels('asks').sort((a, b) => a.price - b.price), bids = levels('bids').sort((a, b) => b.price - a.price);
  const ask = asks[0] || null, bid = bids[0] || null;
  return { ask: ask?.price ?? null, bid: bid?.price ?? null, availableShares: ask?.size ?? 0, odd: ask ? 1 / ask.price : null,
    impliedProbability: ask?.price ?? null, spread: ask && bid ? ask.price - bid.price : null, minSize: Number(book.min_order_size) || null,
    bookTimestamp: book.timestamp || null, checkedAt: new Date().toISOString(), source: 'Polymarket CLOB' };
}
export async function getSportsDetails(sport, id, filter = null) {
  if (!sports[sport] || !/^\d+$/.test(id || '')) throw new Error('Partida invalida.');
  const raw = await request(GAMMA, `/events/${id}`);
  if (!raw.tags?.some(tag => String(tag.id) === sports[sport].tag)) throw new Error('Evento pertence a outra modalidade.');
  let event = normalizeEvent(raw, sport);
  if (!event) throw new Error('Evento sem confronto identificado.');
  const date = dateKey(event.date);
  if (date) {
    const day = await getSportsEvents(sport, date);
    event = day.events.find(game => game.sourceIds.includes(String(id))) || event;
  }
  const selected = filter ? event.markets.filter(filter) : event.markets;
  const markets = selected.slice(0, 100).map(market => ({ ...market, outcomes: market.outcomes.map(outcome => ({ ...outcome, quote: null })) }));
  const ids = [...new Set(markets.filter(m => m.active).flatMap(m => m.outcomes.map(outcome => outcome.tokenId)).filter(Boolean))];
  let warning = selected.length > 100 ? 'Cotacoes limitadas aos primeiros 100 mercados.' : '';
  if (ids.length) {
    try {
      const books = await request(CLOB, '/books', {}, ids.map(token_id => ({ token_id })), 30000);
      if (!Array.isArray(books)) throw new Error('Livro de ofertas invalido.');
      const byToken = new Map(books.map(book => [String(book.asset_id), book]));
      for (const market of markets) for (const outcome of market.outcomes) if (byToken.has(outcome.tokenId)) outcome.quote = quoteFromBook(byToken.get(outcome.tokenId), outcome.tokenId);
    } catch (error) { warning = [warning, error.message, 'Sem cotacao CLOB confirmada; preco de referencia nao substitui oferta de compra.'].filter(Boolean).join(' '); }
  }
  return { source: 'Polymarket', event: { ...event, markets }, statistics: [], timeline: [], warning, updatedAt: new Date().toISOString() };
}
