function failure(body, status) {
  const description = String(body.description || '').toLowerCase();
  const code = Number(body.error_code || status);
  const error = /chat not found/.test(description) ? 'Chat nao encontrado. Confirme TELEGRAM_CHAT_ID e envie /start ao bot.'
    : /blocked by the user/.test(description) ? 'O bot foi bloqueado neste chat. Desbloqueie e envie /start.'
    : /not a member|kicked|not enough rights/.test(description) ? 'O bot precisa participar do grupo/canal e ter permissao para enviar mensagens.'
    : code === 401 || code === 404 ? 'Token do bot invalido. Confira TELEGRAM_BOT_TOKEN na Vercel.'
    : code === 429 ? 'Limite de mensagens do Telegram atingido. O sinal permanece salvo.'
    : 'Telegram recusou o envio. Verifique token, chat e permissoes do bot.';
  return {status:'falhou',code,error};
}
export async function deliverEntry(record, { enabled = true } = {}) {
  if (enabled !== true) return { status: 'desativado', reason: 'Mercado desmarcado para envio.' };
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { status: 'nao-configurado' };
  const text = [record.marketLabel, `${record.home} x ${record.away}`, record.league,
    `Sinal: ${record.signalLines.join(', ')}`, `Confiabilidade do scanner: ${record.confidence}% (pontuacao, nao probabilidade)`,
    `Placar: ${record.entryScoreText} | Minuto: ${record.entryLiveStatus}`, record.createdAtText].join('\n');
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    return response.ok && body.ok ? { status: 'enviado', messageId: body.result?.message_id, at: new Date().toISOString() } : failure(body, response.status);
  } catch { return { status: 'falhou', error: 'Telegram indisponivel. O sinal permanece salvo no banco.' }; }
}
