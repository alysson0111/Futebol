export async function deliverEntry(record) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { status: 'nao-configurado' };
  const text = [record.marketLabel, `${record.home} x ${record.away}`, record.league,
    `Sinal: ${record.signalLines.join(', ')}`, `Confiabilidade do scanner: ${record.confidence}% (pontuacao, nao probabilidade)`,
    `Placar: ${record.entryScoreText} | Minuto: ${record.entryLiveStatus}`, record.createdAtText].join('\n');
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }), signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    return response.ok && body.ok ? { status: 'enviado', messageId: body.result?.message_id, at: new Date().toISOString() } : { status: 'falhou', error: 'Telegram recusou o envio. Verifique token, chat e permissoes do bot.' };
  } catch { return { status: 'falhou', error: 'Telegram indisponivel. O sinal permanece salvo no banco.' }; }
}
