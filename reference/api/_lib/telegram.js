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
    return response.ok && body.ok ? { status: 'enviado', messageId: body.result?.message_id, chatId: String(body.result?.chat?.id ?? chat), at: new Date().toISOString() } : failure(body, response.status);
  } catch { return { status: 'falhou', error: 'Telegram indisponivel. O sinal permanece salvo no banco.' }; }
}

export function resultMessage(record) {
  const partial=Number(record.settlementFactor)===0.5;
  const label=record.result==='push'?'REEMBOLSO':record.result==='green'?(partial?'GREEN PARCIAL (metade ganha, metade devolvida)':'GREEN'):(partial?'RED PARCIAL (metade perdida, metade devolvida)':'RED');
  return [`RESULTADO: ${label}`,`${record.home} x ${record.away}`,record.marketLabel || record.market,
    `Sinal: ${(record.signalLines||[]).join(', ')}`,`Placar final: ${record.finalScoreText}`,
    ...(record.market==='corners'?[`Escanteios: ${record.liveCorners}`]:[]),
    `Entrada: ${record.createdAtText || record.dateText || ''} | Minuto: ${record.entryLiveStatus || '-'}`,
    `Confirmado: ${record.settledAtText || '-'}`].join('\n');
}

export async function deliverResult(record) {
  if(!record.finalConfirmed||!['green','red','push'].includes(record.result)||record.telegram?.status!=='enviado'||!Number.isInteger(record.telegram.messageId))return {status:'ignorado'};
  const token=process.env.TELEGRAM_BOT_TOKEN,chat=record.telegram.chatId||process.env.TELEGRAM_CHAT_ID;
  if(!token||!chat)return {status:'pendente',retryAfter:300,error:'Telegram nao configurado.'};
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:chat,text:resultMessage(record),reply_parameters:{message_id:record.telegram.messageId,allow_sending_without_reply:false}}),
      signal:AbortSignal.timeout(8000)
    });
    if(response.status>=500)return {status:'incerto',error:'Telegram retornou erro de servidor. Confira o chat antes de reenviar.'};
    const body=await response.json();
    if(response.ok&&body.ok&&Number.isInteger(body.result?.message_id))return {status:'enviado',messageId:body.result.message_id,chatId:String(chat),at:new Date().toISOString()};
    if(Number(body.error_code||response.status)===429)return {status:'pendente',retryAfter:Math.max(60,Number(body.parameters?.retry_after)||300),error:'Limite do Telegram. Nova tentativa agendada.'};
    return {...failure(body,response.status),retryAfter:300};
  } catch {
    // A timeout can happen after Telegram accepted the message; never retry blindly.
    return {status:'incerto',error:'Nao foi possivel confirmar o envio. Confira o Telegram antes de reenviar.'};
  }
}
