# Central Esportiva - Polymarket

Dados esportivos exclusivamente das APIs publicas da Polymarket.
Gamma fornece eventos, horarios, participantes e contratos. CLOB fornece
as ofertas reais de compra e venda, tamanho disponivel e cotacoes.
Nao e necessaria chave para leitura. Execute `npm start` e abra
http://127.0.0.1:4173/.

Modalidades: futebol, tenis, EA Sports FC/FIFA, basquete e NFL, isoladas
por tags. EA Sports FC usa a categoria esportiva propria, nao a FIFA
como entidade organizadora do futebol real. Eventos do mesmo jogo sao
agrupados, incluindo mercados adicionais. Horarios em America/Sao_Paulo.
A data usa startTime, nunca a criacao do contrato. Consulta paginada,
limite de 1.000 eventos por modalidade; limite atingido gera aviso.
Como a API filtra pelo encerramento do contrato, a descoberta abrange o
dia escolhido e sete dias seguintes, com filtro local pelo inicio real.
Partidas fora dessa janela de encerramento podem nao aparecer.

Odds equivalentes = 1 / menor oferta de venda (ask), antes de taxas.
Probabilidade implicita = ask. Referencias Gamma ficam identificadas
como indicativas e nunca substituem uma oferta CLOB ausente. Cotacoes
nao garantem execucao por um valor arbitrario; tamanho disponivel e
regras do contrato sao exibidos. Mercados fechados nao tem cotacao de
entrada. Nenhuma ordem ou aposta e enviada.

Scanners mostram somente contratos existentes: totais de gols exatos,
Under/Over, escanteios da partida, spreads e moneyline. Contratos de
primeiro tempo, segundo tempo ou totais de uma equipe nao substituem
o mercado da partida. Spreads nao sao automaticamente handicap asiatico.
O envio automatico esta bloqueado: a Polymarket nao substitui o historico
de finalizacoes/xG dos scanners anteriores, e precos nao demonstram EV+
ou confiabilidade independente. E necessario definir/validar novas
estrategias antes de reativar sinais.

Historicos locais e Firebase sao preservados sem recalcular resultados
com a nova fonte. A rota /api/signals-report permite leitura por periodo.
Firebase/Telegram conservam suas configuracoes. Integracoes antigas e
suas rotas de dados foram removidas. O arquivo legado app.js, que possui
uma alteracao local anterior, nao e servido nem incluido na publicacao.

## Analise OpenAI opcional

O botao Analisar com IA gera uma leitura descritiva em portugues com
fontes, contexto do evento, cotacoes, liquidez e limitacoes. Configure
OPENAI_API_KEY apenas no servidor (.env local ou variavel na Vercel).
OPENAI_MODEL e opcional, com padrao gpt-4.1-mini. Nunca publique a chave.
Sem chave ou em caso de falha, aparecem apenas os fatos disponiveis.
A OpenAI nao substitui a Polymarket como fonte, nao consulta noticias
externas e nao inventa forma recente, xG, lesoes ou escalacoes ausentes.
Esta analise nao ativa sinais, apostas ou previsoes de EV positivo.
Somente o clique manual chama a IA; atualizacao automatica consulta
apenas a Polymarket. Respostas com a mesma evidencia ficam em cache
por ate cinco minutos nesta instancia, com limite de 100 entradas.
A API OpenAI tem cobranca propria; a assinatura ChatGPT nao a inclui.

Documentacao oficial:
- https://docs.polymarket.com/api-reference/events/list-events
- https://docs.polymarket.com/api-reference/market-data/get-order-book
- https://docs.polymarket.com/api-reference/wss/sports

Testes: `node --test polymarket.test.mjs scanner-route.test.mjs sports-analysis.test.mjs`.
Publicacao no GitHub/Vercel somente quando solicitada.
