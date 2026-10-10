import { getSportsResearch, requestSportsData } from './sports-data.mjs';

export const scannerMarkets = {
  'over-05': '+0.5 gols', 'over-15': '+1.5 gols', 'over-25': '+2.5 gols',
  'under-25': 'Under 2.5', 'under-35': 'Under 3.5 IA', corners: 'Escanteios', handicap: 'Handicap', ml: 'ML'
};
export function wilson(hits, count) {
  if (!count) return { rate: null, lower: null, upper: null };
  const p = hits / count, z = 1.96, divisor = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / divisor;
  return { rate: p, lower: center - margin, upper: center + margin };
}
export function parseOdds(items, market) {
  const goals = market.startsWith('over-') || market.startsWith('under-');
  const line = goals ? Number(market.split('-')[1]) / 10 : null;
  const selections = [];
  for (const item of items) for (const bookmaker of item.bookmakers || []) for (const bet of bookmaker.bets || []) {
    const name = String(bet.name || '').toLowerCase();
    const accepted = goals ? name === 'goals over/under' : market === 'corners' ? ['corners over under', 'corners over/under'].includes(name)
      : market === 'handicap' ? name === 'asian handicap' : name === 'match winner';
    if (!accepted) continue;
    for (const value of bet.values || []) {
      const label = String(value.value || '').trim();
      const odd = Number(value.odd);
      if (!(odd > 1) || value.suspended === true) continue;
      if (goals && label.toLowerCase() !== `${market.startsWith('over') ? 'over' : 'under'} ${line}`) continue;
      if (market === 'corners' && !/^Over (8\.5|9\.5|10\.5)$/i.test(label)) continue;
      if (market === 'handicap' && !/^(Home|Away) (-0\.75|-1(?:\.0)?|0|-0\.25)$/i.test(label)) continue;
      if (market === 'ml' && !/^(Home|Away)$/i.test(label)) continue;
      selections.push({ selection: label, odd, bookmaker: bookmaker.name, updatedAt: item.update || null });
    }
  }
  return selections;
}
export function assessSample(games, predicate, odd) {
  const hits = games.filter(predicate).length;
  const interval = wilson(hits, games.length);
  return { sample: games.length, hits, ...interval, approved: games.length >= 15 && interval.lower > 1 / odd + 0.05 };
}
export async function scanMatch(id, market) {
  if (!scannerMarkets[market]) throw new Error('Mercado invalido.');
  const research = await getSportsResearch('football', id);
  const { event } = research;
  const base = { event, market, label: scannerMarkets[market], signals: [], warnings: [...research.warnings], checkedAt: new Date().toISOString() };
  if (market === 'over-05') return { ...base, reason: 'Scanner ao vivo +0.5 preservado: requer odd ao vivo e filtro Premium. Consulte a rota de sinais ao vivo; frequencia pre-jogo nao valida uma entrada no segundo tempo.' };
  if (event.phase !== 'scheduled' || new Date(event.date) <= new Date()) return { ...base, reason: 'Este scanner pre-jogo nao envia sinais de partidas iniciadas ou encerradas.' };
  const regulation = game => game.status === 'FT';
  const home = (research.home?.overall.matches || []).filter(regulation), away = (research.away?.overall.matches || []).filter(regulation);
  if (home.length < 10 || away.length < 10) return { ...base, reason: 'Historico insuficiente: sao necessarios os 10 jogos anteriores de cada equipe. Nenhum sinal enviado.' };
  const rawOdds = await requestSportsData('football', 'odds', { fixture: id });
  const odds = parseOdds(rawOdds, market).filter(item => {
    const age = Date.now() - new Date(item.updatedAt).getTime();
    return Number.isFinite(age) && age >= -60000 && age <= 4 * 60 * 60000;
  });
  if (!odds.length) return { ...base, reason: 'Odd real ausente, suspensa ou atualizada ha mais de quatro horas. Nenhum sinal enviado.' };
  let games = [...new Map([...home, ...away].map(game => [game.id, game])).values()];
  if (market === 'corners') {
    const evidence = [];
    for (const game of games) {
      try {
        const stats = await requestSportsData('football', 'fixtures/statistics', { fixture: game.id });
        const numbers = stats.map(team => team.statistics?.find(stat => stat.type === 'Corner Kicks')?.value);
        if (numbers.length === 2 && numbers.every(n => n !== null && n !== undefined && Number.isFinite(Number(n)))) evidence.push({ ...game, corners: numbers.reduce((a, b) => a + Number(b), 0) });
      } catch { /* Missing evidence must not count as zero corners. */ }
    }
    games = evidence;
  }
  const evaluated = odds.map(quote => {
    const side = quote.selection.startsWith('Away') ? 'away' : 'home';
    const teamId = event[side].id;
    let sample = games;
    let predicate;
    if (market === 'ml' || market === 'handicap') {
      // Full wins only: pushes and half wins do not inflate the conservative gate.
      const line = market === 'handicap' ? Number(quote.selection.split(' ')[1]) : 0;
      sample = (research[side]?.[side]?.matches || []).filter(regulation).slice(0, 10);
      predicate = game => {
        const margin = game.home.id === teamId ? game.score.home - game.score.away : game.score.away - game.score.home;
        return line === -0.75 ? margin >= 2 : margin + line > 0;
      };
    } else if (market === 'corners') predicate = game => game.corners > Number(quote.selection.split(' ')[1]);
    else predicate = game => market.startsWith('over') ? game.score.home + game.score.away > Number(market.split('-')[1]) / 10 : game.score.home + game.score.away < Number(market.split('-')[1]) / 10;
    const assessment = assessSample(sample, predicate, quote.odd);
    // Venue-specific team samples are capped at ten by the research provider.
    if (market === 'ml' || market === 'handicap') assessment.approved = sample.length === 10 && assessment.lower > 1 / quote.odd + 0.05;
    return { ...quote, ...assessment, team: market === 'ml' || market === 'handicap' ? event[side].name : 'Partida' };
  });
  const bySelection = new Map();
  for (const item of evaluated.sort((a, b) => b.odd - a.odd)) if (!bySelection.has(item.selection)) bySelection.set(item.selection, item);
  const best = [...bySelection.values()];
  return { ...base, assessments: best, signals: best.filter(item => item.approved),
    reason: 'Frequencia historica, nao probabilidade calibrada. Envio exige amostra completa, odd recente e limite inferior do intervalo de 95% acima de 1/odd + 5 pontos percentuais. Este scanner usa estatisticas, nao IA, inclusive no Under 3.5.' };
}
