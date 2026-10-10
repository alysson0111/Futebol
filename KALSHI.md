# Kalshi na Central Esportiva

O seletor Fonte permite consultar Kalshi (padrao) ou API-Sports sem
misturar IDs, odds, resultados ou historicos das duas fontes. O layout
e as estrategias anteriores da API-Sports foram preservados.

A leitura publica usa https://external-api.kalshi.com/trade-api/v2,
sem chave ou login. Nao consulta carteira nem envia ordens/apostas.
Eventos usam milestones e start_date, nunca close_time, open_time ou
occurrence_datetime como horario do jogo. A data e filtrada em Brasilia.
Calendario: ate quatro paginas de 500 registros e 300 jogos por consulta;
limite atingido gera aviso. Dados ao vivo usam /live_data/batch.
Placares, minutos e status ausentes nao sao preenchidos artificialmente.

Detalhes mostram ate 24 eventos e 100 contratos por partida. Ofertas
vem do livro: compra Sim = 1 - melhor bid Nao; compra Nao = 1 - melhor
bid Sim, em dolares. Odd equivalente = 1/preco de compra, antes de taxas.
Sem ofertas ou com contrato inativo, nao existe odd exibida. O preco
implicito nao e confiabilidade independente nem comprova EV positivo.
Resultado de contrato nao equivale ao placar do jogo.

Os menus consultam contratos de linha exata, separando periodos e
equipes de mercados da partida. Sinais e envio Telegram nao estao
ativados na Kalshi: os filtros anteriores exigem dados historicos e
validacao especifica. A analise OpenAI existente permanece na fonte
API-Sports; na Kalshi o botao atualiza cotacoes, sem inventar historico.
NFL exclui college football. Tenis exclui tenis de mesa. EA Sports FC
nao e substituido por eFootball, que e outro jogo.

Respostas ficam em cache por 60 segundos, com deduplicacao de pedidos
simultaneos e limite de 300 entradas. Atualizacao da tela a cada 5 minutos.
Teste: node --test kalshi-data.test.mjs

Documentacao:
- https://docs.kalshi.com/getting_started/quick_start_market_data
- https://docs.kalshi.com/getting_started/orderbook_responses
- https://docs.kalshi.com/api-reference/milestone/get-milestones
