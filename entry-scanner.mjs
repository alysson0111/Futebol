const labels = { 'over-05': 'Over 0.5 gols', 'over-15': 'Over 1.5 gols', 'over-25': 'Over 2.5 gols', 'under-25': 'Under 2.5 gols', 'under-35': 'Under 3.5 gols', corners: 'Over 9.5 escanteios', handicap: 'Handicap', ml: 'ML' };
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
export function assessEntry(payload, market, context = {}) {
  if (!labels[market]) throw new Error('Mercado invalido.');
  const event = payload.event;
  const checks = [];
  const check = (label, value, predicate) => checks.push({ label, value, available: value !== null, passed: value !== null && predicate(value) });
  const home = numeric(event.score.home), away = numeric(event.score.away);
  const goals = home !== null && away !== null ? home + away : null;
  const gap = goals !== null ? Math.abs(home - away) : null;
  const clock = /^([0-9]{1,3})(?:\+([0-9]{1,2}))?(?:['\u2032]|:[0-9]{2})?$/.exec(String(event.elapsed ?? '').trim());
  const minute = clock ? Number(clock[1]) + Number(clock[2] || 0) : null;
  const total = label => {
    const values = ['home', 'away'].map(side => numeric(payload.statistics?.find(row => row.team?.id === event[side].id && row.team?.name === event[side].name)?.statistics?.find(stat => stat.type === label)?.value));
    return values.every(value => value !== null) ? values[0] + values[1] : null;
  };
  const corners = total('Escanteios');
  // A listed contract line is not the independent projected line used by the reference scanner.
  const goalLine = numeric(context.projectedGoalLine), handicap = numeric(context.favoriteHandicap);
  check('Modalidade futebol', event.sport ?? null, value => value === 'football');
  check('Partida ao vivo', event.phase ?? null, value => value === 'live');
  if (market.startsWith('over') || market.startsWith('under')) {
    const over = market.startsWith('over');
    const line = Number(market.split('-')[1]) / 10;
    const windows = { 'over-05': [15, 70], 'over-15': [25, 72], 'over-25': [22, 72], 'under-25': [35, 78], 'under-35': [10, 82] };
    const [from, to] = windows[market];
    check('Minuto util para entrada', minute, value => value >= from && value <= to);
    check('Placar adequado ao mercado', goals, value => over ? value < line && (market !== 'over-25' || value >= 1) : market === 'under-25' ? value <= 1 : value <= 2 || (value === 3 && minute >= 75));
    check('Linha projetada de gols', goalLine, value => over ? value >= ({ 'over-05': 2, 'over-15': 2.5, 'over-25': 2.75 })[market] : value > 0 && value <= (market === 'under-25' ? 2.75 : 3.25));
    check('Pressao por escanteios', corners, value => over ? value >= ({ 'over-05': 5, 'over-15': 6, 'over-25': 6.5 })[market] : value <= (market === 'under-25' ? 9.5 : 10.5));
    check('Sem favorito extremo', handicap, value => Math.abs(value) <= (market === 'over-05' ? 1.75 : over ? 2 : 1.5));
    if (market !== 'over-05') check('Diferenca de gols controlada', gap, value => value <= (market === 'over-25' || market === 'under-35' ? 2 : 1));
  } else if (market === 'corners') {
    check('Favorito joga em casa', typeof context.homeFavorite === 'boolean' ? context.homeFavorite : null, value => value);
    check('Media conjunta acima de 10 escanteios', numeric(context.averageCorners), value => value > 10);
    check('Favorito finaliza mais de 10 vezes', numeric(context.favoriteAverageShots), value => value > 10);
  } else {
    check('Favorito definido por analise independente', context.favorite || null, value => ['home', 'away'].includes(value));
    check('Forma recente e casa/fora verificadas', context.historyVerified === true ? true : null, value => value);
    check('Escalacao e ausencias verificadas', context.lineupVerified === true ? true : null, value => value);
    if (market === 'handicap') check('Linha da estrategia confirmada', handicap, value => [-1, -.75, -.25, 0].includes(value));
  }
  const passed = checks.filter(item => item.passed).length;
  const complete = checks.every(item => item.available);
  const confidence = complete ? passed / checks.length : null;
  // Rules are auditable, but approval requires a validated strategy, not a fabricated hit probability.
  const approved = context.strategyValidated === true && complete && checks.every(item => item.passed);
  return { selection: labels[market], confidence, confidenceKind: 'rule-score', checks, passed, total: checks.length,
    coverage: checks.filter(item => item.available).length / checks.length, approved,
    status: approved ? 'Entrada' : complete ? 'Observar' : 'Dados insuficientes',
    reason: !complete ? 'Dados ausentes: ' + checks.filter(item => !item.available).map(item => item.label).join('; ') + '. Nenhuma entrada enviada.'
      : approved ? 'Criterios confirmados pela estrategia validada.' : 'Criterios avaliados; estrategia ainda nao validada para envio.' };
}
