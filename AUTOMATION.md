# Envio de sinais com o navegador fechado

O agendador chama a rotina no servidor; nao precisa manter o site ou o computador ligado.
O envio segue os mercados marcados, as estrategias existentes e a regra dos 43 minutos
para Over 0.5 e ML. Sinais ja registrados nao sao reenviados.

## Resultados em segundo plano

O mesmo workflow chama `/api/automation/results`, inclusive quando o envio esta
desativado ou falha. Cada rodada consulta 100 sinais pendentes, com cursor persistido
em `central_jobs/results`. Apenas placares finais confirmados e estatisticas suficientes
para o mercado encerram sinais. Resultados manuais ou ja confirmados nao sao sobrescritos.
Paginas adicionais da agenda por data tambem sao consultadas; falhas ficam no resumo.

## Avisos de resultado no Telegram

Ao encerrar um sinal cuja entrada foi enviada, a mesma transacao cria um aviso em
`central_telegram_results`. Uma etapa independente chama `/api/automation/notify-results`
e edita a mensagem original com Green, Red ou Reembolso, incluindo resultados parciais,
sem resposta separada. O texto original da entrada e preservado.
O chat original e salvo para novas entradas. Entradas antigas usam TELEGRAM_CHAT_ID.
Falhas explicitas e limites de envio sao tentados novamente; sucesso fica registrado no
sinal em `telegramResult`. O resumo fica em `central_jobs/telegram-results`.
Timeouts e erros de servidor durante a edicao podem ser tentados novamente no mesmo
message_id, sem criar novas mensagens. "Message is not modified" confirma que o texto
ja esta atualizado. Mensagem excluida ou sem permissao nao gera uma mensagem alternativa.
Itens antigos marcados como incertos ou interrompidos durante um envio exigem conferencia.
Resultados encerrados antes desta versao nao sao enviados em massa. Mercados desmarcados
nao geram avisos se a entrada nao foi enviada. Desmarcar novas entradas nao impede o
aviso das entradas ja enviadas.

## Ativacao gratuita

1. Publique esta versao no GitHub e na Vercel.
2. O workflow autentica usando OIDC do GitHub, sem cadastrar secrets novos.
   Apenas o workflow deste repositorio na branch main pode chamar a rotina.
3. No sistema, informe o Token de envio, marque os mercados e ative
   `Salvar entradas automaticamente`. Aguarde `Configuracao salva no servidor`.
4. No GitHub, abra Actions > Sinais Telegram em segundo plano > Run workflow para testar.
   Depois disso, o agendamento roda nominalmente a cada cinco minutos.

Opcional: a variavel de repositorio `AUTOMATION_URL` muda o endereco da rotina.
O padrao e `https://futebol-jet.vercel.app/api/automation/run`. Para outra audiencia,
configure AUTOMATION_AUDIENCE igual no GitHub e na Vercel.

## Limites e seguranca

- GitHub Actions em repositorios publicos usa runners padrao gratuitos. Horarios agendados
  podem atrasar, e workflows agendados podem ser desativados apos 60 dias sem atividade.
- A Vercel Hobby permite cron nativo somente diario, por isso o agendador e externo.
- O Firebase continua sujeito a cota gratuita. O servidor le no maximo 100 candidatos por
  rodada, evita reenviar duplicados e revalida as preferencias antes de cada envio.
- A coleta ainda depende do TotalCorner/Jina. Erros de acesso, cota do Firebase ou falha
  no Telegram impedem o envio; o agendador nao resolve a indisponibilidade da fonte.
- Alterar mercados ou desativar o envio exige `SCANNER_ACCESS_TOKEN`.
  O agendador usa uma identidade temporaria que so autoriza a rotina de envio.
  Um token fixo AUTOMATION_TOKEN e opcional para outro agendador autorizado.
- Nenhuma aposta e realizada. Nenhum secret e incluido nos arquivos ou no navegador.
- O historico de execucao e os resumos ficam em `central_jobs/telegram`;
  as preferencias ficam em `central_config/telegram`.

Referencias:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
https://docs.github.com/en/billing/concepts/product-billing/github-actions
https://vercel.com/docs/cron-jobs/usage-and-pricing
