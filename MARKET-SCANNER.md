# Scanner de mercados

Menu: painel geral, +0.5, +1.5, +2.5, Under 2.5, Under 3.5 IA,
escanteios (8.5/9.5/10.5), handicap e ML (vitoria sem protecao ao empate).

O scanner novo e estatistico. Frequencia historica nao e probabilidade
calibrada nem garantia de lucro. Under 3.5 conserva o nome solicitado,
mas nao invoca IA para gerar probabilidades.

Pre-jogo: exige dez partidas anteriores por equipe, sem resultados futuros,
odd confirmada pela API e atualizacao de no maximo quatro horas.
Esta tolerancia acompanha a cadencia de tres horas da fonte pre-jogo;
nao significa cotacao executavel nem valida mercados ao vivo.
Jogos com prorrogacao/disputa de penaltis sao excluidos da amostra.
Totais usam os jogos distintos das duas equipes, minimo quinze resultados.
ML/handicap usam dez jogos na condicao casa/fora da equipe selecionada.
Intervalo Wilson de 95%; limite inferior precisa superar 1/odd em pelo
menos cinco pontos percentuais. Handicap conta apenas vitorias integrais
no filtro conservador; devolucoes e meias vitorias nao contam como acerto.
Escanteios exige estatisticas historicas reais, nunca preenche ausencias
com zero. Este filtro novo nao equivale aos scanners heuristicos antigos.

+0.5 mantem o filtro Premium antigo, exclusivamente ao vivo, placar 0x0,
minutos 45 a 82 e odd real >=1.60. Nao exibe a probabilidade heuristica
antiga como confiabilidade.

Consultas em lotes de tres jogos, apenas do mercado aberto e filtros
selecionados, avancando no proximo clique/atualizacao de cinco minutos.
O envio automatico opera apenas enquanto a pagina estiver aberta/visivel.
Nao existe servico agendado no servidor nesta versao.

Para envio: configure TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, Firebase Admin
e SCANNER_ACCESS_TOKEN no servidor. Informe apenas esse ultimo token no
campo Token de envio; nao use token Telegram ou chave OpenAI nesse campo.
O token de envio fica apenas na memoria da pagina. POST /api/scanner
revalida a analise no servidor e exige Authorization: Bearer <token>.
GET consulta sem salvar ou enviar. O Firebase guarda os sinais e controla
envio duplicado. Status da entrega fica visivel no painel.

Historicos bloqueados pelo plano gratuito impedem aprovacao, sem dados
simulados. Nao ha aposta automatica, nem uso de OPENAI_API_KEY no scanner.
Publicacao no GitHub/Vercel apenas quando solicitada.
