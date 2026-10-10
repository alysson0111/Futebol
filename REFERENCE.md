# Logica do Analise Futebol

O codigo-fonte local de analise-futebol.vercel.app foi copiado para
reference/src e reference/api. O scanner original, os oito mercados,
Forebet, TotalCorner, sincronizacao e liquidacao final foram preservados.
Nao foram copiados credenciais, configuracao da Vercel nem dados do banco.
Os arquivos anteriores continuam no repositorio para recuperacao.

Adaptacoes da Central Esportiva:
- Interface azul-petroleo, sem odds/cotacoes ou ROI dependente de odds.
- Atualizacao inicial a cada cinco minutos, com intervalos selecionaveis.
- Banco e liquidacao protegidos por SCANNER_ACCESS_TOKEN.
- Token fica apenas na memoria da tela, nao em localStorage.
- Salvar e enviar exige habilitacao explicita na tela e token valido.
- Colecao central_sinais, separada de signals/sinais anteriores.
- Registro atomico por chave evita mensagens duplicadas concorrentes.
- Telegram envia apenas depois de salvar, preserva falhas no relatorio.
- Jogos encerrados nao geram novas entradas.
- Exportacao PDF escapa texto recebido das fontes.
- Busca por periodo usa os dias solicitados, com cache de 60 segundos.

Confianca significa pontuacao heuristica do scanner original, nao
probabilidade calibrada, promessa de lucro ou garantia de acerto.
Nao existe execucao de apostas. Salvar sinais nao equivale a apostar.

Configuracao no servidor:
SCANNER_ACCESS_TOKEN, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
FIREBASE_PRIVATE_KEY, TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID.
JINA_API_KEY autentica o leitor usado por TotalCorner/Forebet, se exigido.
Na verificacao de 10/10/2026, a leitura TotalCorner sem essa chave
retornou HTTP 401. Fontes indisponiveis exibem erro, nao jogos ficticios.
Nao coloque essas chaves no codigo ou em variaveis VITE_*.

Executar: npm install; npm run build; npm start (porta 4173).
Vercel: npm run build, saida dist, funcao api/index.mjs.
Testes: node --test reference-integration.test.mjs
  reference/api/_lib/*.test.js reference/src/analysis/*.test.js

As dependencias transitivas foram atualizadas antes da publicacao.
Em 10/10/2026, npm install confirmou zero vulnerabilidades conhecidas.
