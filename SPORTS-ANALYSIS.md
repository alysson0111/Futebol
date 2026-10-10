# Pesquisa dos confrontos

Selecione uma partida e use **Analisar confronto**. O servidor consulta resultados da temporada, confrontos diretos e, no futebol, registros de ausencias relacionados a partida. Cada secao apresenta sua fonte e a data da consulta.

O historico inclui somente jogos encerrados antes do confronto selecionado, com placar conhecido. As amostras de cada equipe e de casa/fora possuem ate 10 partidas. Confrontos diretos possuem ate 5 partidas; no basquete e NFL, sao extraidos da temporada consultada. Vitorias e empates usam o placar final, sem os gols da disputa de penaltis.

## IA opcional

Configure `OPENAI_API_KEY` no `.env` local ou nas variaveis protegidas de Production no Vercel. `OPENAI_MODEL` e opcional; o padrao e `gpt-4.1-mini`. Reinicie o servidor local ou publique um novo deploy apos configurar.

Sem chave, o painel exibe **Resumo estatistico**. Com chave, a API Responses produz uma analise informativa em portugues com referencias aos dados consultados. Falhas na IA preservam o resumo estatistico. A chave nunca e enviada ao navegador.

Documentacao: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

## Limites da fonte

O plano da API-Sports pode bloquear consultas historicas da temporada atual, mesmo retornando o calendario diario. Nesses casos, a tela informa os dados ausentes e nao substitui a temporada por outra. Uma lista vazia de lesoes nao comprova que a escalacao esteja completa. Nao ha previsoes de resultado, probabilidades de aposta ou odds nesta pesquisa.

## Verificacao

Execute `node --test sports-data.test.mjs sports-analysis.test.mjs`. Os testes usam respostas controladas e nao consomem cotas das APIs.
