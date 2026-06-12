# Sistema de Analise de Jogos

Aplicacao local para carregar jogos da API-Football/API-Sports e gerar previsao do confronto com um modelo local explicavel.

## Como pegar a chave gratuita

1. Acesse https://dashboard.api-football.com/register
2. Crie uma conta gratuita.
3. No dashboard, copie sua API key em `Account` > `My Access`.
4. Crie um arquivo chamado `.env` nesta pasta `outputs`.
5. Coloque a chave assim:

```text
API_FOOTBALL_KEY=sua_chave_aqui
```

O plano gratuito da API-Football oferece 100 requisicoes por dia. Isso e suficiente para testar e desenvolver.

## Salvar sinais no Firebase

O sistema pode gravar cada sinal na colecao `signals` do Cloud Firestore. Os documentos
usam um ID fixo por mercado, data e jogo, evitando sinais duplicados. Quando os resultados
sao conferidos, o mesmo documento recebe o status de acerto, erro ou pendente.

1. Crie um projeto em https://console.firebase.google.com/
2. Ative `Firestore Database`.
3. Abra `Configuracoes do projeto` > `Contas de servico`.
4. Clique em `Gerar nova chave privada` e abra o JSON baixado.
5. Adicione ao arquivo `.env`:

```text
FIREBASE_PROJECT_ID=valor_de_project_id
FIREBASE_CLIENT_EMAIL=valor_de_client_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nCONTEUDO_DA_CHAVE\n-----END PRIVATE KEY-----\n"
```

Nao coloque esse arquivo JSON dentro do projeto e nao envie a chave privada para o navegador.
Para conferir a conexao, abra:

```text
http://127.0.0.1:4173/api/firebase-status
```

## Como rodar

```powershell
cd C:\Users\HP\Documents\Codex\2026-05-30\montar-um-sistema-de-analise-de\outputs
npm start
```

Depois acesse:

```text
http://127.0.0.1:4173
```

## Fonte dos jogos

Por padrao o sistema usa:

```text
https://v3.football.api-sports.io/fixtures?date=YYYY-MM-DD&timezone=America/Sao_Paulo
```

A autenticacao usa o header oficial:

```text
x-apisports-key: SUA_CHAVE
```

Se a chave nao estiver configurada, ou se a cota gratuita acabar, o painel entra em modo demonstracao e mostra jogos de exemplo para manter a previsao funcionando.

## Modelo de previsao

A analise considera forma, ataque, defesa, mando de campo, desfalques e variacao por competicao. O resultado mostra probabilidades 1X2, placar provavel, mercados uteis e alertas de risco.
