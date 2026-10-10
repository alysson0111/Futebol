import { getSportsDetails } from './polymarket.mjs';
export const scannerMarkets = { 'over-05': '+0.5 gols', 'over-15': '+1.5 gols', 'over-25': '+2.5 gols', 'under-25': 'Under 2.5', 'under-35': 'Under 3.5', corners: 'Escanteios', handicap: 'Handicap', ml: 'ML' };
export function marketFilter(key) {
  if (!scannerMarkets[key]) throw new Error('Mercado invalido.');
  return market => key === 'ml' ? market.type === 'moneyline' : key === 'handicap' ? market.type === 'spreads'
    : key === 'corners' ? market.type === 'total_corners' : market.type === 'totals' && market.line === Number(key.split('-')[1]) / 10;
}
export async function scanMatch(id, key, sport = 'football') {
  if ((key.startsWith('over-') || key.startsWith('under-') || key === 'corners') && !['football', 'eafootball'].includes(sport)) throw new Error('Mercado de gols/escanteios exclusivo de futebol ou EA Sports FC.');
  const payload = await getSportsDetails(sport, id, marketFilter(key));
  const assessments = payload.event.markets.flatMap(market => market.outcomes
    .filter(outcome => !key.startsWith('over-') && !key.startsWith('under-') || outcome.label.toLowerCase() === (key.startsWith('over-') ? 'over' : 'under'))
    .map(outcome => ({ selection: `${market.title} - ${outcome.label}`, team: 'Partida', marketId: market.id, tokenId: outcome.tokenId,
      odd: outcome.quote?.odd ?? null, impliedProbability: outcome.quote?.impliedProbability ?? null, quote: outcome.quote,
      referencePrice: outcome.referencePrice, approved: false, rate: null, lower: null, upper: null, sample: null })));
  return { event: payload.event, market: key, label: scannerMarkets[key], assessments, signals: [], warnings: payload.warning ? [payload.warning] : [], checkedAt: payload.updatedAt,
    reason: assessments.length ? 'Probabilidade implicita da Polymarket nao e confiabilidade independente. Sem historico esportivo e modelo validado, nenhum sinal automatico e aprovado. Handicap segue as regras do contrato, nao liquidacao asiatica presumida.' : 'A Polymarket nao disponibilizou esse mercado para este confronto. Nenhum mercado substituto foi usado.' };
}
