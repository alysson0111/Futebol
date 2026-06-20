import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const root = fileURLToPath(new URL(".", import.meta.url));
loadLocalEnv(".env");
loadLocalEnv(".env.local");

const port = Number(process.env.PORT || 4173);
const apiFootballKey = process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || "";
const historyFile = process.env.VERCEL
  ? join("/tmp", "prediction-history.json")
  : join(root, "data", "prediction-history.json");
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
let firestore = null;
const apiCache = new Map();
let firebaseStatus = firebaseConfig.projectId && firebaseConfig.clientEmail && firebaseConfig.privateKey
  ? "aguardando conexão"
  : "não configurado";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const simulatorMarkets = {
  "match-over-05": {
    label: "Partida +0.5 gol",
    strategy: "minute-first-goal",
    description: "Entram apenas jogos que ainda estavam 0 x 0 no minuto escolhido. Green quando o primeiro gol saiu depois desse minuto; red quando terminou 0 x 0."
  },
  "match-over-goals": {
    label: "Over 2.5 gols",
    strategy: "over-25-pre-match",
    description: "Seleciona jogos com media projetada acima de 2.8, favorito em casa, ambas marcam em pelo menos 60% dos ultimos 10 jogos e odd Over 2.5 entre 1.70 e 2.10 quando a API disponibiliza."
  },
  "match-under-goals": {
    label: "Under 2.5 gols",
    strategy: "under-25-score",
    description: "Scanner por pontuacao: so entram jogos com pelo menos 8 de 10 criterios para Under 2.5 gols."
  },
  handicap: {
    label: "Handicap Asiatico",
    strategy: "asian-handicap-score",
    description: "Pontua o favorito de 0 a 10. Com 8+ procura AH -0.75 e -1.0; com 6 a 7 procura AH 0. Odds entre 1.85 e 2.05."
  },
  corners: {
    label: "Escanteios",
    strategy: "corners-pre-match",
    description: "Seleciona favorito em casa, media conjunta acima de 10 escanteios, favorito com alto volume ofensivo/finalizacoes e contexto decisivo. Entradas planejadas: Over 8.5, Over 9.5 e Over 10.5 escanteios."
  }
};

const marketSignalTypes = {
  "match-goal": {
    label: "Partida +0.5 gol",
    market: "match-over-05"
  },
  "over-25": {
    label: "Over 2.5 gols",
    market: "match-over-goals"
  },
  "under-25": {
    label: "Under 2.5 gols",
    market: "match-under-goals"
  },
  handicap: {
    label: "Handicap Asiatico",
    market: "handicap"
  },
  corners: {
    label: "Escanteios",
    market: "corners"
  }
};

const demoEvents = [
  {
    id: 9001001,
    startTimestamp: Math.floor(Date.now() / 1000) + 7200,
    tournament: { name: "Brasileirao Serie A", category: { name: "Brasil" } },
    homeTeam: { id: 1957, name: "Flamengo", shortName: "FLA" },
    awayTeam: { id: 1961, name: "Palmeiras", shortName: "PAL" },
    status: { description: "Não iniciado", type: "notstarted" },
    venue: { stadium: { name: "Maracana" } }
  },
  {
    id: 9001002,
    startTimestamp: Math.floor(Date.now() / 1000) + 10800,
    tournament: { name: "Premier League", category: { name: "Inglaterra" } },
    homeTeam: { id: 17, name: "Arsenal", shortName: "ARS" },
    awayTeam: { id: 44, name: "Manchester City", shortName: "MCI" },
    status: { description: "Não iniciado", type: "notstarted" },
    venue: { stadium: { name: "Emirates Stadium" } }
  },
  {
    id: 9001003,
    startTimestamp: Math.floor(Date.now() / 1000) + 14400,
    tournament: { name: "LaLiga", category: { name: "Espanha" } },
    homeTeam: { id: 2829, name: "Real Madrid", shortName: "RMA" },
    awayTeam: { id: 2817, name: "Barcelona", shortName: "BAR" },
    status: { description: "Não iniciado", type: "notstarted" },
    venue: { stadium: { name: "Santiago Bernabeu" } }
  }
];

function loadLocalEnv(fileName) {
  const filePath = join(root, fileName);
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || !clean.includes("=")) continue;
    const [rawKey, ...rawValue] = clean.split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function fetchApiJson(url, options = {}, ttlMs = 60_000) {
  const key = String(url);
  const cached = apiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("API-Football limitou as consultas por excesso de requisições. Aguarde 1 minuto e tente novamente.");
    }
    throw new Error(`API-Football respondeu ${response.status}`);
  }

  const payload = await response.json();
  const hasApiErrors = Array.isArray(payload.errors)
    ? payload.errors.length > 0
    : payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length > 0;
  if (hasApiErrors) {
    return payload;
  }
  apiCache.set(key, { expiresAt: Date.now() + ttlMs, payload });
  return payload;
}

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyFile, "utf8"));
  } catch {
    return { records: [] };
  }
}

async function saveHistory(history) {
  await mkdir(dirname(historyFile), { recursive: true });
  await writeFile(historyFile, JSON.stringify(history, null, 2), "utf8");
}

function getFirebaseDatabase() {
  if (firestore) return firestore;
  if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
    return null;
  }

  const app = getApps()[0] || initializeApp({
    credential: cert(firebaseConfig),
    projectId: firebaseConfig.projectId
  });
  firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  firebaseStatus = "conectado";
  return firestore;
}

function firestoreSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

async function saveSignalsToFirebase(records) {
  const database = getFirebaseDatabase();
  if (!database || !records.length) return false;

  try {
    const batch = database.batch();
    for (const record of records) {
      const documentId = encodeURIComponent(record.id);
      batch.set(database.collection("signals").doc(documentId), firestoreSafe({
        ...record,
        updatedAt: new Date().toISOString()
      }), { merge: true });
    }
    await batch.commit();
    firebaseStatus = "conectado";
    return true;
  } catch (error) {
    firebaseStatus = `erro: ${error.message}`;
    console.error("Falha ao salvar sinais no Firebase:", error.message);
    return false;
  }
}

async function readSignalsFromFirebase(date) {
  const database = getFirebaseDatabase();
  if (!database) return [];

  try {
    const snapshot = await database.collection("signals").where("date", "==", date).get();
    firebaseStatus = "conectado";
    return snapshot.docs.map(document => document.data());
  } catch (error) {
    firebaseStatus = `erro: ${error.message}`;
    console.error("Falha ao consultar sinais no Firebase:", error.message);
    return [];
  }
}

async function readSignals(date, type = "") {
  const history = await readHistory();
  const localRecords = history.records.filter(record => record.date === date);
  const firebaseRecords = await readSignalsFromFirebase(date);
  const byId = new Map(localRecords.map(record => [record.id, record]));

  for (const record of firebaseRecords) {
    byId.set(record.id, { ...byId.get(record.id), ...record });
  }

  return [...byId.values()]
    .filter(record => !type || record.type === type)
    .map(record => ({
      ...record,
      sentMinute: record.sentMinute ?? record.alert?.minute ?? null
    }))
    .sort((a, b) => {
      const typeDiff = String(a.type).localeCompare(String(b.type));
      return typeDiff || (a.rank || 999) - (b.rank || 999);
    });
}

function dateFromKey(date) {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function reportDates(startDate, endDate) {
  const start = dateFromKey(startDate);
  const end = dateFromKey(endDate || startDate);
  if (!start || !end) {
    throw new Error("Informe datas válidas para o relatório.");
  }
  if (start > end) {
    throw new Error("A data inicial não pode ser maior que a data final.");
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(isoDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (dates.length > 62) {
    throw new Error("Escolha um período de até 62 dias para manter a consulta estável.");
  }

  return dates;
}

async function recordPredictions(type, date, source, items) {
  const history = await readHistory();
  const now = new Date().toISOString();
  const incoming = items.map(item => ({
    id: `${type}:${date}:${item.event.id}${item.key ? `:${item.key}` : ""}`,
    type,
    date,
    source,
    createdAt: now,
    sentMinute: item.alert?.minute ?? null,
    rank: item.rank,
    event: item.event,
    prediction: item.prediction,
    alert: item.alert ? { ...item.alert, sentAt: item.alert.sentAt || now } : null
  }));

  const byId = new Map(history.records.map(record => [record.id, record]));
  for (const record of incoming) {
    const existing = byId.get(record.id);
    byId.set(record.id, {
      ...existing,
      ...record,
      createdAt: existing?.createdAt || record.createdAt,
      sentMinute: existing?.sentMinute ?? existing?.alert?.minute ?? record.sentMinute,
      alert: record.alert ? {
        ...record.alert,
        sentAt: existing?.alert?.sentAt || existing?.createdAt || record.alert.sentAt
      } : null
    });
  }
  history.records = [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  await saveHistory(history);
  await saveSignalsToFirebase(incoming.map(record => byId.get(record.id)));
}

async function saveEvaluatedResults(results) {
  const history = await readHistory();
  const byId = new Map(history.records.map(record => [record.id, record]));
  const updated = results.map(item => {
    const record = {
      ...item.record,
      event: item.event,
      result: item.result,
      evaluatedAt: new Date().toISOString()
    };
    byId.set(record.id, record);
    return record;
  });
  history.records = [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  await saveHistory(history);
  await saveSignalsToFirebase(updated);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Carga enviada muito grande."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON inválido."));
      }
    });
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededValue(...parts) {
  const text = parts.join(":");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function normalizeEvent(event) {
  return {
    id: event.id,
    sport: event.sport || "football",
    startTimestamp: event.startTimestamp,
    tournament: event.tournament || {},
    homeTeam: event.homeTeam || {},
    awayTeam: event.awayTeam || {},
    status: event.status || {},
    score: event.score || null,
    venue: event.venue || null,
    source: event.source || "sofascore"
  };
}

function countryPtBr(country) {
  const map = {
    World: "Mundo",
    Brazil: "Brasil",
    England: "Inglaterra",
    Spain: "Espanha",
    Germany: "Alemanha",
    Italy: "Itália",
    France: "França",
    Portugal: "Portugal",
    Argentina: "Argentina",
    Uruguay: "Uruguai",
    Paraguay: "Paraguai",
    Chile: "Chile",
    Peru: "Peru",
    Bolivia: "Bolívia",
    Ecuador: "Equador",
    Colombia: "Colômbia",
    Mexico: "México",
    USA: "Estados Unidos",
    Canada: "Canadá",
    Japan: "Japão",
    China: "China",
    Australia: "Austrália",
    Ukraine: "Ucrânia",
    Norway: "Noruega",
    Sweden: "Suécia",
    Finland: "Finlândia",
    Denmark: "Dinamarca",
    Netherlands: "Holanda",
    Belgium: "Bélgica",
    Switzerland: "Suíça",
    Austria: "Áustria",
    Turkey: "Turquia",
    Morocco: "Marrocos",
    Kenya: "Quênia",
    Zimbabwe: "Zimbábue",
    Syria: "Síria",
    Sudan: "Sudão",
    Iceland: "Islândia",
    Iraq: "Iraque",
    Iran: "Irã",
    SaudiArabia: "Arábia Saudita",
    "Saudi Arabia": "Arábia Saudita",
    Qatar: "Catar",
    UAE: "Emirados Árabes Unidos"
  };
  return map[country] || country || "País não informado";
}

function isFinishedEvent(event) {
  const type = String(event.status?.type || "").toLowerCase();
  const description = String(event.status?.description || "").toLowerCase();
  const finishedTypes = ["ft", "aet", "pen", "finished", "afterpen", "canc", "abd", "awd", "wo"];
  return finishedTypes.includes(type)
    || description.includes("finished")
    || description.includes("match finished")
    || description.includes("after extra time")
    || description.includes("after penalties")
    || description.includes("encerrado")
    || description.includes("finalizado")
    || description.includes("fim");
}

function isLiveEvent(event) {
  const type = String(event.status?.type || "").toLowerCase();
  const elapsed = Number(event.status?.elapsed || 0);
  return ["1h", "2h", "ht", "et", "p", "bt", "live", "inprogress"].includes(type)
    || elapsed > 0;
}

function normalizeApiFootballFixture(item) {
  return {
    id: item.fixture?.id,
    sport: "football",
    startTimestamp: item.fixture?.timestamp || Math.floor(Date.parse(item.fixture?.date || "") / 1000),
    tournament: {
      id: item.league?.id,
      name: item.league?.name,
      category: { name: countryPtBr(item.league?.country) },
      season: item.league?.season,
      round: item.league?.round,
      logo: item.league?.logo
    },
    homeTeam: {
      id: item.teams?.home?.id,
      name: item.teams?.home?.name,
      logo: item.teams?.home?.logo
    },
    awayTeam: {
      id: item.teams?.away?.id,
      name: item.teams?.away?.name,
      logo: item.teams?.away?.logo
    },
    status: {
      description: item.fixture?.status?.long,
      type: item.fixture?.status?.short === "NS" ? "notstarted" : item.fixture?.status?.short,
      elapsed: item.fixture?.status?.elapsed
    },
    score: {
      home: item.goals?.home,
      away: item.goals?.away,
      halftime: item.score?.halftime || null,
      fulltime: item.score?.fulltime || null
    },
    venue: item.fixture?.venue ? { stadium: { name: item.fixture.venue.name, city: item.fixture.venue.city } } : null,
    source: "api-football"
  };
}

function predictMatch(event, userInputs = {}) {
  const home = event.homeTeam?.name || "Mandante";
  const away = event.awayTeam?.name || "Visitante";
  const homeSeed = seededValue(event.homeTeam?.id || home, home, "home");
  const awaySeed = seededValue(event.awayTeam?.id || away, away, "away");
  const competitionSeed = seededValue(event.tournament?.name || "liga", event.id || Date.now());

  const formHome = Number(userInputs.formHome ?? Math.round((48 + homeSeed * 42)));
  const formAway = Number(userInputs.formAway ?? Math.round((45 + awaySeed * 42)));
  const attackHome = Number(userInputs.attackHome ?? Math.round((50 + seededValue(home, "ataque") * 40)));
  const attackAway = Number(userInputs.attackAway ?? Math.round((48 + seededValue(away, "ataque") * 40)));
  const defenseHome = Number(userInputs.defenseHome ?? Math.round((50 + seededValue(home, "defesa") * 38)));
  const defenseAway = Number(userInputs.defenseAway ?? Math.round((48 + seededValue(away, "defesa") * 38)));
  const absencesHome = Number(userInputs.absencesHome ?? 0);
  const absencesAway = Number(userInputs.absencesAway ?? 0);

  const homeAdvantage = 8 + competitionSeed * 5;
  const homePower = formHome * 0.34 + attackHome * 0.31 + defenseHome * 0.2 + homeAdvantage - absencesHome * 3.6;
  const awayPower = formAway * 0.34 + attackAway * 0.31 + defenseAway * 0.2 - absencesAway * 3.6;
  const diff = homePower - awayPower;

  const drawBase = clamp(0.31 - Math.abs(diff) / 210, 0.18, 0.33);
  const homeRaw = 1 / (1 + Math.exp(-diff / 18));
  const homeWin = clamp((1 - drawBase) * homeRaw, 0.08, 0.79);
  const awayWin = clamp(1 - drawBase - homeWin, 0.08, 0.79);
  const draw = clamp(1 - homeWin - awayWin, 0.12, 0.38);
  const total = homeWin + draw + awayWin;

  const probs = {
    home: Math.round((homeWin / total) * 100),
    draw: Math.round((draw / total) * 100),
    away: Math.round((awayWin / total) * 100)
  };
  const best = [
    { key: "home", label: `Vitória do ${home}`, value: probs.home },
    { key: "draw", label: "Empate", value: probs.draw },
    { key: "away", label: `Vitória do ${away}`, value: probs.away }
  ].sort((a, b) => b.value - a.value)[0];

  const expectedHome = clamp(1.18 + diff / 38 + attackHome / 180 - defenseAway / 260, 0.25, 3.8);
  const expectedAway = clamp(1.03 - diff / 44 + attackAway / 190 - defenseHome / 280, 0.18, 3.5);
  const scoreHome = Math.max(0, Math.round(expectedHome + seededValue(home, away, "gols-casa") * 0.45 - 0.2));
  const scoreAway = Math.max(0, Math.round(expectedAway + seededValue(away, home, "gols-fora") * 0.45 - 0.2));
  const goalsLine = expectedHome + expectedAway;
  const bothScore = clamp(44 + (attackHome + attackAway - defenseHome - defenseAway) * 0.34 + goalsLine * 7, 24, 72);
  const favoriteIsHome = probs.home >= probs.away;
  const favoriteTeam = favoriteIsHome ? home : away;
  const favoriteExpectedGoals = favoriteIsHome ? expectedHome : expectedAway;
  const favoriteGoalProbability = clamp(1 - Math.exp(-favoriteExpectedGoals), 0.01, 0.95);
  const favoriteGoalOdd = Number((1 / favoriteGoalProbability).toFixed(2));

  const confidence = clamp(Math.round(52 + Math.abs(diff) * 0.55 + Math.abs(best.value - 33) * 0.35), 48, 86);
  const riskFlags = [];
  if (Math.abs(diff) < 7) riskFlags.push("confronto equilibrado");
  if (draw > 0.29) riskFlags.push("probabilidade de empate elevada");
  if (absencesHome + absencesAway >= 3) riskFlags.push("desfalques podem distorcer o modelo");
  if ((event.status?.type || "").toLowerCase() !== "notstarted") riskFlags.push("jogo não está marcado como pré-jogo");

  const prediction = {
    pick: best.label,
    confidence,
    expectedScore: `${scoreHome} x ${scoreAway}`,
    probabilities: probs,
    markets: {
      doubleChance: probs.home >= probs.away ? `${home} ou empate` : `${away} ou empate`,
      goals: goalsLine >= 2.45 ? "Mais de 2.5 gols" : "Menos de 3.5 gols",
      bothTeamsScore: bothScore >= 52 ? "Ambas marcam: sim" : "Ambas marcam: cautela",
      favoriteGoal05: {
        team: favoriteTeam,
        label: `${favoriteTeam} +0.5 gol`,
        probability: Math.round(favoriteGoalProbability * 100),
        fairOdd: favoriteGoalOdd,
        qualifies: favoriteGoalOdd <= 1.6
      }
    },
    signals: [
      `Força mandante: ${Math.round(homePower)}/100`,
      `Força visitante: ${Math.round(awayPower)}/100`,
      `Gols esperados: ${expectedHome.toFixed(2)} x ${expectedAway.toFixed(2)}`
    ],
    riskFlags: riskFlags.length ? riskFlags : ["sem alerta crítico no modelo"],
    model: "Modelo local v1: forma, ataque, defesa, mando, desfalques e variação por competição."
  };
  prediction.deepAnalysis = buildDeepAnalysis(event, prediction, {
    home,
    away,
    homePower,
    awayPower,
    diff,
    expectedHome,
    expectedAway,
    goalsLine,
    bothScore,
    attackHome,
    attackAway,
    defenseHome,
    defenseAway
  });
  return prediction;
}

function strengthWord(value) {
  if (value >= 74) return "muito forte";
  if (value >= 63) return "forte";
  if (value >= 52) return "competitivo";
  return "irregular";
}

function goalScenario(expectedHome, expectedAway) {
  const baseHome = Math.max(0, Math.round(expectedHome));
  const baseAway = Math.max(0, Math.round(expectedAway));
  return [
    `${baseHome}x${baseAway}`,
    `${Math.max(0, baseHome + 1)}x${baseAway}`,
    `${Math.max(0, baseHome)}x${Math.max(0, baseAway + 1)}`
  ];
}

function buildDeepAnalysis(event, prediction, metrics) {
  const league = event.tournament?.name || "Competição";
  const country = event.tournament?.category?.name || "País não informado";
  const venue = event.venue?.stadium?.name || "Estádio não informado";
  const favorite = metrics.diff >= 0 ? metrics.home : metrics.away;
  const underLine = metrics.goalsLine <= 3.15 ? "Menos de 3.5 gols aparece forte" : "Mais de 2.5 gols ganha valor";
  const btts = metrics.bothScore >= 58
    ? "Ambas marcam com boa chance"
    : metrics.bothScore >= 48
      ? "Ambas marcam com chance média"
      : "Ambas marcam exige cautela";
  const homeStyle = metrics.attackHome >= metrics.defenseHome
    ? "posse, volume ofensivo e chegada constante ao último terço"
    : "controle, bloco organizado e paciência para atacar";
  const awayStyle = metrics.attackAway >= metrics.defenseAway
    ? "transições rápidas e ataques diretos quando recupera a bola"
    : "marcação forte, linhas compactas e tentativa de reduzir espaços";

  return {
    context: [
      `${league} (${country})`,
      `Local: ${venue}`,
      `${metrics.home} chega com força ${strengthWord(metrics.homePower)} como mandante`,
      `${metrics.away} aparece ${strengthWord(metrics.awayPower)} como visitante`,
      `Favoritismo do ${favorite}, principalmente por mando, força estimada e equilíbrio ofensivo/defensivo.`
    ],
    teamMoments: [
      {
        team: metrics.home,
        lines: [
          `Ataque ${strengthWord(metrics.attackHome)} para criar volume`,
          "Tende a crescer atuando em casa",
          `Defesa ${strengthWord(metrics.defenseHome)} no modelo atual`,
          Math.abs(metrics.diff) >= 14 ? "Chega com vantagem clara no confronto" : "Precisa controlar os momentos de equilíbrio"
        ]
      },
      {
        team: metrics.away,
        lines: [
          `Ataque ${strengthWord(metrics.attackAway)} para explorar espaços`,
          "Fora de casa tende a sofrer mais pressão",
          `Defesa ${strengthWord(metrics.defenseAway)} para sustentar o jogo`,
          "Pode ser perigoso em transições e bolas paradas"
        ]
      }
    ],
    tendencies: [
      metrics.goalsLine >= 2.45 ? "Tendência de gols moderada/alta" : "Tendência de gols moderada",
      underLine,
      btts,
      `${favorite} favorito no modelo`
    ],
    scenarios: goalScenario(metrics.expectedHome, metrics.expectedAway),
    bestBets: [
      prediction.pick,
      prediction.markets.goals,
      prediction.markets.doubleChance,
      metrics.bothScore >= 58 ? "Ambas marcam: sim" : `${favorite} vence sem sofrer gol (opção de risco)`
    ],
    tacticalReading: [
      `${metrics.home}: ${homeStyle}`,
      `${metrics.away}: ${awayStyle}`,
      `Tendência de controle do ${favorite}, com risco maior se o jogo ficar aberto cedo.`
    ],
    finalPick: `${metrics.home} ${prediction.expectedScore} ${metrics.away}`,
    bettingSummary: {
      safe: prediction.markets.doubleChance,
      medium: prediction.markets.goals,
      risky: metrics.bothScore >= 52 ? `${prediction.pick} e ambas marcam` : `${prediction.pick} sem sofrer gol`
    }
  };
}

function liveFavoriteGoalAlert(event, prediction) {
  if (!isLiveEvent(event) || isFinishedEvent(event)) return null;

  const elapsed = Number(event.status?.elapsed || 0);
  const homeScore = Number(event.score?.home || 0);
  const awayScore = Number(event.score?.away || 0);
  const homeName = event.homeTeam?.name || "Mandante";
  const awayName = event.awayTeam?.name || "Visitante";
  const favoriteIsHome = prediction.probabilities.home >= prediction.probabilities.away;
  const favoriteTeam = favoriteIsHome ? homeName : awayName;
  const favoriteScore = favoriteIsHome ? homeScore : awayScore;
  const opponentScore = favoriteIsHome ? awayScore : homeScore;
  const favoriteWinProbability = favoriteIsHome ? prediction.probabilities.home : prediction.probabilities.away;

  const isSecondHalfWindow = elapsed >= 45 && elapsed <= 82;
  const stillNeedsGoal = favoriteScore <= opponentScore;
  const hasFavoriteEdge = favoriteWinProbability >= 38 || prediction.confidence >= 58;
  const pressureBoost = favoriteScore < opponentScore ? 0.09 : 0.03;
  const minuteFactor = Math.max(0.18, (92 - elapsed) / 47);
  const baseGoalNeed = favoriteScore < opponentScore ? 0.68 : 0.55;
  const estimatedProbability = clamp(
    baseGoalNeed * minuteFactor + (favoriteWinProbability / 100) * 0.24 + pressureBoost,
    0.08,
    0.78
  );
  const fairOdd = Number((1 / estimatedProbability).toFixed(2));

  if (!isSecondHalfWindow || !stillNeedsGoal || !hasFavoriteEdge || fairOdd < 1.6) {
    return null;
  }

  return {
    team: favoriteTeam,
    label: `${favoriteTeam} +0.5 gol ao vivo`,
    fairOdd,
    minimumOdd: 1.6,
    probability: Math.round(estimatedProbability * 100),
    minute: elapsed,
    score: `${homeScore} x ${awayScore}`,
    reason: favoriteScore < opponentScore
      ? "favorito perdendo e pressionado a buscar o gol"
      : "favorito empatado e ainda com força para buscar o gol"
  };
}

function recentPremiumGoalMetrics(teamId, fixtures) {
  const sample = fixtures.filter(event => isFinishedEvent(event)).slice(0, 10);
  let failedToScore = 0;
  let nilNilLastFive = 0;

  for (const [index, event] of sample.entries()) {
    const score = finalScore(event);
    if (!score) continue;
    const isHome = String(event.homeTeam?.id) === String(teamId);
    const teamGoals = isHome ? score.home : score.away;
    if (teamGoals === 0) failedToScore += 1;
    if (index < 5 && score.home === 0 && score.away === 0) nilNilLastFive += 1;
  }

  return {
    games: sample.length,
    failedToScore,
    nilNilLastFive
  };
}

async function premiumOver05Scanner(event) {
  const [homeLast, awayLast] = await Promise.all([
    fetchTeamLastFixtures(event.homeTeam?.id, 10),
    fetchTeamLastFixtures(event.awayTeam?.id, 10)
  ]);
  const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
  const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
  const homePremium = recentPremiumGoalMetrics(event.homeTeam?.id, homeLast);
  const awayPremium = recentPremiumGoalMetrics(event.awayTeam?.id, awayLast);
  const jointGoalsAverage = Number(((homeMetrics.totalAvg + awayMetrics.totalAvg) / 2).toFixed(2));
  const estimatedJointXg = projectedGoals(homeMetrics, awayMetrics);
  const enoughData = homeMetrics.games >= 10 && awayMetrics.games >= 10;
  const checks = [
    {
      key: "scoring",
      label: "No maximo 1 jogo sem marcar nos ultimos 10",
      pass: homePremium.failedToScore <= 1 && awayPremium.failedToScore <= 1
    },
    {
      key: "btts",
      label: "Ambos marcam acima de 55%",
      pass: homeMetrics.bttsRate > 55 && awayMetrics.bttsRate > 55
    },
    {
      key: "goals-average",
      label: "Media conjunta superior a 2.5 gols",
      pass: jointGoalsAverage > 2.5
    },
    {
      key: "xg",
      label: "xG conjunto estimado acima de 2.3",
      pass: estimatedJointXg > 2.3
    },
    {
      key: "nil-nil",
      label: "Nenhum 0x0 nos ultimos 5 jogos",
      pass: homePremium.nilNilLastFive === 0 && awayPremium.nilNilLastFive === 0
    }
  ];

  return {
    qualifies: enoughData && checks.every(check => check.pass),
    enoughData,
    score: checks.filter(check => check.pass).length,
    homeFailedToScore: homePremium.failedToScore,
    awayFailedToScore: awayPremium.failedToScore,
    homeBttsRate: homeMetrics.bttsRate,
    awayBttsRate: awayMetrics.bttsRate,
    jointGoalsAverage,
    estimatedJointXg,
    homeNilNilLastFive: homePremium.nilNilLastFive,
    awayNilNilLastFive: awayPremium.nilNilLastFive,
    checks
  };
}

function liveMatchGoalAlert(event, prediction, liveMarket, premiumScanner) {
  if (!isLiveEvent(event) || isFinishedEvent(event)) return null;

  const elapsed = Number(event.status?.elapsed || 0);
  const homeScore = Number(event.score?.home || 0);
  const awayScore = Number(event.score?.away || 0);
  const totalGoals = homeScore + awayScore;
  const isSecondHalfWindow = elapsed >= 45 && elapsed <= 82;
  const isNilNil = homeScore === 0 && awayScore === 0;
  const expectedSignal = String(prediction.signals?.[2] || "");
  const expectedNumbers = expectedSignal.match(/([0-9]+[.,][0-9]+)/g)?.map(value => Number(value.replace(",", "."))) || [];
  const expectedTotal = expectedNumbers.length >= 2 ? expectedNumbers[0] + expectedNumbers[1] : 2.1;
  const remainingFactor = Math.max(0.16, (92 - elapsed) / 47);
  const scorePressure = homeScore === awayScore ? 0.12 : Math.abs(homeScore - awayScore) === 1 ? 0.08 : 0.03;
  const lowScoreBoost = totalGoals <= 1 ? 0.12 : totalGoals === 2 ? 0.05 : -0.04;
  const estimatedProbability = clamp(
    expectedTotal * 0.18 * remainingFactor + scorePressure + lowScoreBoost,
    0.08,
    0.78
  );
  const fairOdd = Number((1 / estimatedProbability).toFixed(2));
  const marketOdd = Number(liveMarket?.odd || 0);
  const marketAvailable = liveMarket
    && liveMarket.suspended === false
    && liveMarket.market === "Match Goals"
    && liveMarket.selection === "Over"
    && Number(liveMarket.handicap) === 0.5
    && Number.isFinite(marketOdd);

  if (!isSecondHalfWindow || !isNilNil || !marketAvailable || marketOdd < 1.6 || !premiumScanner?.qualifies) {
    return null;
  }

  return {
    team: "Partida",
    label: "Partida +0.5 gol ao vivo",
    fairOdd,
    marketOdd,
    minimumOdd: 1.6,
    market: liveMarket.market,
    selection: `${liveMarket.selection} ${liveMarket.handicap}`,
    oddsUpdatedAt: liveMarket.updatedAt,
    probability: Math.round(estimatedProbability * 100),
    minute: elapsed,
    score: `${homeScore} x ${awayScore}`,
    totalGoals,
    reason: `placar 0 x 0 no segundo tempo e scanner premium ${premiumScanner.score}/5 aprovado`,
    premiumScanner
  };
}

async function buildPremiumMatchGoalAlerts(events, liveOdds) {
  const generatedAt = new Date().toISOString();
  const liveEvents = events
    .map(normalizeEvent)
    .filter(event => {
      if (!isLiveEvent(event) || isFinishedEvent(event)) return false;
      const elapsed = Number(event.status?.elapsed || 0);
      const isNilNil = Number(event.score?.home || 0) === 0 && Number(event.score?.away || 0) === 0;
      const liveMarket = liveOdds.get(String(event.id));
      return elapsed >= 45
        && elapsed <= 82
        && isNilNil
        && liveMarket?.suspended === false
        && Number(liveMarket?.odd || 0) >= 1.6;
    });
  const analyzed = await mapWithConcurrency(liveEvents.slice(0, 20), 3, async event => {
    try {
      const prediction = predictMatch(event);
      const scanner = await premiumOver05Scanner(event);
      const alert = liveMatchGoalAlert(event, prediction, liveOdds.get(String(event.id)), scanner);
      return alert ? { event, prediction, alert } : null;
    } catch {
      return null;
    }
  });

  return analyzed
    .filter(Boolean)
    .sort((a, b) => {
      const minuteDiff = b.alert.minute - a.alert.minute;
      return minuteDiff || b.alert.marketOdd - a.alert.marketOdd;
    })
    .map((item, index) => ({ rank: index + 1, createdAt: generatedAt, ...item }));
}

function finalScore(event) {
  const home = event.score?.fulltime?.home ?? event.score?.home;
  const away = event.score?.fulltime?.away ?? event.score?.away;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return { home: Number(home), away: Number(away) };
}

function matchWinner(score) {
  if (!score) return null;
  if (score.home > score.away) return "home";
  if (score.away > score.home) return "away";
  return "draw";
}

function predictedWinner(record) {
  const pick = String(record.prediction?.pick || "").toLowerCase();
  const home = String(record.event?.homeTeam?.name || "").toLowerCase();
  const away = String(record.event?.awayTeam?.name || "").toLowerCase();
  if (pick.includes("empate")) return "draw";
  if (home && pick.includes(home)) return "home";
  if (away && pick.includes(away)) return "away";
  return null;
}

function evaluateRecord(record, currentEvent, greenMinute = null) {
  const score = finalScore(currentEvent);
  const finished = isFinishedEvent(currentEvent);
  const scoreText = score ? `${score.home} x ${score.away}` : "pendente";

  if (record.type === "match-goal") {
    if (!score) {
      return { status: "pending", hit: null, score: scoreText, detail: "Aguardando atualização do placar." };
    }

    const alert = record.alert || {};
    const currentTotalGoals = score.home + score.away;
    const alertTotalGoals = Number(alert.totalGoals ?? String(alert.score || "0 x 0")
      .split("x")
      .map(part => Number(part.trim()))
      .reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0));
    const scoredAfterAlert = currentTotalGoals >= alertTotalGoals + 1;
    const elapsed = Number(currentEvent.status?.elapsed || 0);
    const marketClosedWithoutGoal = finished || !isLiveEvent(currentEvent) || elapsed > 82;

    if (scoredAfterAlert) {
      return {
        status: "finished",
        hit: true,
        score: scoreText,
        greenMinute: record.result?.greenMinute ?? greenMinute,
        detail: "Saiu pelo menos mais um gol depois do alerta."
      };
    }

    if (marketClosedWithoutGoal) {
      return {
        status: "finished",
        hit: false,
        score: scoreText,
        detail: "O mercado encerrou sem sair gol depois do alerta."
      };
    }

    return {
      status: "pending",
      hit: null,
      score: scoreText,
      detail: `Sinal ativo ou aguardando desfecho aos ${elapsed || alert.minute || "-"} minutos.`
    };
  }

  if (!finished || !score) {
    return { status: "pending", hit: null, score: scoreText, detail: "Jogo ainda sem resultado final." };
  }

  if (record.type === "favorite-goal") {
    const alert = record.alert || {};
    const homeName = record.event?.homeTeam?.name;
    const awayName = record.event?.awayTeam?.name;
    const favoriteIsHome = alert.team === homeName;
    const favoriteFinalGoals = favoriteIsHome ? score.home : score.away;
    const alertScoreParts = String(alert.score || "0 x 0").split("x").map(part => Number(part.trim()));
    const favoriteAlertGoals = favoriteIsHome ? alertScoreParts[0] || 0 : alertScoreParts[1] || 0;
    const hit = favoriteFinalGoals >= favoriteAlertGoals + 1;
    return {
      status: "finished",
      hit,
      score: scoreText,
      detail: hit
        ? `${alert.team} marcou depois do alerta.`
        : `${alert.team || "Favorito"} não marcou depois do alerta.`
    };
  }

  if (["over-25", "under-25", "handicap"].includes(record.type)) {
    const marketByType = {
      "over-25": "match-over-goals",
      "under-25": "match-under-goals",
      handicap: "handicap"
    };
    return preMatchSignalResult(currentEvent, marketByType[record.type], {
      line: record.alert?.line,
      odd: record.alert?.marketOdd ?? record.alert?.fairOdd,
      favoriteSide: record.alert?.favoriteSide
    });
  }

  if (record.type === "corners") {
    return {
      status: "pending",
      hit: null,
      score: scoreText,
      detail: finished
        ? "Aguardando estatisticas de escanteios da API."
        : "Jogo ainda nao terminou."
    };
  }

  return { status: "finished", hit: null, score: scoreText, detail: "Tipo de previsão não reconhecido." };
}

function accuracySummary(results) {
  const settled = results.filter(item => item.result.status === "finished");
  const graded = settled.filter(item => item.result.hit !== null);
  const hits = graded.filter(item => item.result.hit).length;
  return {
    total: results.length,
    finished: settled.length,
    pending: results.length - settled.length,
    hits,
    misses: graded.length - hits,
    unavailable: settled.length - graded.length,
    accuracy: graded.length ? Math.round((hits / graded.length) * 100) : 0
  };
}

function reportSummary(results) {
  const types = ["match-goal", "over-25", "under-25", "handicap", "corners", "favorite-goal"];
  return {
    ...accuracySummary(results),
    byType: Object.fromEntries(types.map(type => [
      type,
      accuracySummary(results.filter(item => item.record.type === type))
    ]))
  };
}

async function fetchSofascoreEvents(date, sport) {
  const url = `https://api.sofascore.com/api/v1/sport/${encodeURIComponent(sport)}/scheduled-events/${encodeURIComponent(date)}`;
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 AnaliseJogos/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`SofaScore respondeu ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.events) ? payload.events.map(normalizeEvent) : [];
}

async function fetchApiFootballEvents(date, sport, options = {}) {
  if (sport !== "football") {
    throw new Error("API-Football cobre apenas futebol neste conector");
  }

  if (!apiFootballKey) {
    throw new Error("Configure API_FOOTBALL_KEY para usar a API-Football gratuita");
  }

  const requestUrl = new URL("https://v3.football.api-sports.io/fixtures");
  if (options.liveOnly) {
    requestUrl.searchParams.set("live", "all");
  } else {
    requestUrl.searchParams.set("date", date);
  }
  requestUrl.searchParams.set("timezone", "America/Sao_Paulo");

  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, options.liveOnly ? 20_000 : 300_000);
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`API-Football: ${payload.errors.join(", ")}`);
  }
  if (payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }

  return Array.isArray(payload.response) ? payload.response.map(normalizeApiFootballFixture).filter(event => event.id) : [];
}

async function fetchLiveMatchGoalOdds() {
  if (!apiFootballKey) {
    throw new Error("Configure API_FOOTBALL_KEY para consultar as odds ao vivo");
  }

  const payload = await fetchApiJson("https://v3.football.api-sports.io/odds/live", {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 30_000);
  if (payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length) {
    throw new Error(`API-Football odds: ${Object.values(payload.errors).join(", ")}`);
  }

  const marketsByFixture = new Map();
  for (const item of Array.isArray(payload.response) ? payload.response : []) {
    if (item.status?.finished || item.status?.blocked) continue;

    const market = (item.odds || []).find(odd =>
      Number(odd.id) === 25 || String(odd.name || "").toLowerCase() === "match goals"
    );
    const selections = (market?.values || [])
      .filter(value =>
        String(value.value || "").toLowerCase() === "over"
        && Number(value.handicap) === 0.5
        && value.suspended === false
        && Number.isFinite(Number(value.odd))
      )
      .sort((a, b) => Number(b.odd) - Number(a.odd));
    const selection = selections[0];
    if (!selection) continue;

    marketsByFixture.set(String(item.fixture?.id), {
      market: "Match Goals",
      selection: "Over",
      handicap: 0.5,
      odd: Number(selection.odd),
      suspended: false,
      updatedAt: item.update || null
    });
  }

  return marketsByFixture;
}

async function fetchFixtureEvents(fixtureId) {
  const requestUrl = new URL("https://v3.football.api-sports.io/fixtures/events");
  requestUrl.searchParams.set("fixture", fixtureId);
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }
  return Array.isArray(payload.response) ? payload.response : [];
}

async function fetchFixtureStatistics(fixtureId) {
  const requestUrl = new URL("https://v3.football.api-sports.io/fixtures/statistics");
  requestUrl.searchParams.set("fixture", fixtureId);
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }
  return Array.isArray(payload.response) ? payload.response : [];
}

function statisticValue(teamStats, name) {
  const stat = (teamStats?.statistics || []).find(item =>
    String(item.type || "").toLowerCase() === String(name).toLowerCase()
  );
  const raw = stat?.value;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.includes("%")) return Number(raw.replace("%", ""));
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function fixtureCornersFromStats(stats) {
  if (!Array.isArray(stats) || stats.length < 2) return null;
  const homeCorners = statisticValue(stats[0], "Corner Kicks");
  const awayCorners = statisticValue(stats[1], "Corner Kicks");
  if (homeCorners === null || awayCorners === null) return null;
  return { home: homeCorners, away: awayCorners, total: homeCorners + awayCorners };
}

function fixtureShotsFromStats(stats) {
  if (!Array.isArray(stats) || stats.length < 2) return null;
  const homeShots = statisticValue(stats[0], "Total Shots");
  const awayShots = statisticValue(stats[1], "Total Shots");
  if (homeShots === null || awayShots === null) return null;
  return { home: homeShots, away: awayShots };
}

function fixtureShotsOnTargetFromStats(stats) {
  if (!Array.isArray(stats) || stats.length < 2) return null;
  const homeShots = statisticValue(stats[0], "Shots on Goal");
  const awayShots = statisticValue(stats[1], "Shots on Goal");
  if (homeShots === null || awayShots === null) return null;
  return { home: homeShots, away: awayShots };
}

async function fetchTeamLastFixtures(teamId, last = 10) {
  const requestUrl = new URL("https://v3.football.api-sports.io/fixtures");
  requestUrl.searchParams.set("team", teamId);
  requestUrl.searchParams.set("last", String(last));
  requestUrl.searchParams.set("timezone", "America/Sao_Paulo");
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }
  return Array.isArray(payload.response) ? payload.response.map(normalizeApiFootballFixture).filter(event => event.id) : [];
}

async function fetchFixtureOver25Odd(fixtureId) {
  const requestUrl = new URL("https://v3.football.api-sports.io/odds");
  requestUrl.searchParams.set("fixture", fixtureId);
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }

  const bookmakers = Array.isArray(payload.response?.[0]?.bookmakers) ? payload.response[0].bookmakers : [];
  const odds = [];
  for (const bookmaker of bookmakers) {
    for (const bet of bookmaker.bets || []) {
      const betName = String(bet.name || "").toLowerCase();
      if (!["goals over/under", "match goals"].includes(betName)) continue;
      for (const value of bet.values || []) {
        const label = String(value.value || "").toLowerCase();
        if ((label.includes("over 2.5") || (label === "over" && Number(value.handicap) === 2.5)) && Number(value.odd)) {
          odds.push(Number(value.odd));
        }
      }
    }
  }

  if (!odds.length) return null;
  return Number((odds.reduce((sum, odd) => sum + odd, 0) / odds.length).toFixed(2));
}

async function fetchFixtureUnder25Odd(fixtureId) {
  const requestUrl = new URL("https://v3.football.api-sports.io/odds");
  requestUrl.searchParams.set("fixture", fixtureId);
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }

  const bookmakers = Array.isArray(payload.response?.[0]?.bookmakers) ? payload.response[0].bookmakers : [];
  const odds = [];
  for (const bookmaker of bookmakers) {
    for (const bet of bookmaker.bets || []) {
      const betName = String(bet.name || "").toLowerCase();
      if (!["goals over/under", "match goals"].includes(betName)) continue;
      for (const value of bet.values || []) {
        const label = String(value.value || "").toLowerCase();
        if ((label.includes("under 2.5") || (label === "under" && Number(value.handicap) === 2.5)) && Number(value.odd)) {
          odds.push(Number(value.odd));
        }
      }
    }
  }

  if (!odds.length) return null;
  return Number((odds.reduce((sum, odd) => sum + odd, 0) / odds.length).toFixed(2));
}

async function fetchFixtureAsianHandicapOdd(fixtureId, side = "home", line = -0.75) {
  const requestUrl = new URL("https://v3.football.api-sports.io/odds");
  requestUrl.searchParams.set("fixture", fixtureId);
  const payload = await fetchApiJson(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  }, 600_000);
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }

  const bookmakers = Array.isArray(payload.response?.[0]?.bookmakers) ? payload.response[0].bookmakers : [];
  const odds = [];
  for (const bookmaker of bookmakers) {
    for (const bet of bookmaker.bets || []) {
      const betName = String(bet.name || "").toLowerCase();
      if (!betName.includes("asian handicap")) continue;
      for (const value of bet.values || []) {
        const label = String(value.value || "").toLowerCase();
        const expectedSide = side === "home" ? "home" : "away";
        const normalizedLine = Number(line);
        const isSide = label.includes(expectedSide);
        const lineMatch = label.match(/[-+]?\\d+(?:\\.\\d+)?/);
        const parsedLine = lineMatch ? Number(lineMatch[0]) : null;
        const hasLine = parsedLine !== null && Math.abs(parsedLine - normalizedLine) < 0.001;
        if (isSide && hasLine && Number(value.odd)) {
          odds.push(Number(value.odd));
        }
      }
    }
  }

  if (!odds.length) return null;
  return Number((odds.reduce((sum, odd) => sum + odd, 0) / odds.length).toFixed(2));
}

function teamRecentMetrics(teamId, fixtures) {
  const sample = fixtures.filter(event => isFinishedEvent(event)).slice(0, 10);
  if (!sample.length) {
    return { games: 0, scoredAvg: 0, concededAvg: 0, totalAvg: 0, bttsRate: 0 };
  }

  let scored = 0;
  let conceded = 0;
  let btts = 0;
  let over25 = 0;
  let firstHalfGoal = 0;
  for (const event of sample) {
    const score = finalScore(event);
    if (!score) continue;
    const isHome = String(event.homeTeam?.id) === String(teamId);
    const teamGoals = isHome ? score.home : score.away;
    const opponentGoals = isHome ? score.away : score.home;
    scored += teamGoals;
    conceded += opponentGoals;
    if (score.home + score.away > 2.5) over25 += 1;
    if (teamGoals > 0 && opponentGoals > 0) btts += 1;
    const halfHome = Number(event.score?.halftime?.home ?? 0);
    const halfAway = Number(event.score?.halftime?.away ?? 0);
    if (halfHome + halfAway > 0) firstHalfGoal += 1;
  }

  return {
    games: sample.length,
    scoredAvg: Number((scored / sample.length).toFixed(2)),
    concededAvg: Number((conceded / sample.length).toFixed(2)),
    totalAvg: Number(((scored + conceded) / sample.length).toFixed(2)),
    bttsRate: Math.round((btts / sample.length) * 100),
    over25Rate: Math.round((over25 / sample.length) * 100),
    firstHalfGoalRate: Math.round((firstHalfGoal / sample.length) * 100)
  };
}

function projectedGoals(homeMetrics, awayMetrics) {
  return Number(((homeMetrics.scoredAvg + homeMetrics.concededAvg + awayMetrics.scoredAvg + awayMetrics.concededAvg) / 2).toFixed(2));
}

function underLeagueScore(event) {
  const text = `${event.tournament?.name || ""} ${event.tournament?.category?.name || ""}`.toLowerCase();
  const good = [
    "brasileiro serie b",
    "brasileirão série b",
    "primera nacional",
    "uruguay",
    "uruguai",
    "paraguay",
    "paraguai"
  ];
  const bad = ["bundesliga", "eredivisie", "austrian bundesliga", "austria bundesliga"];
  if (bad.some(name => text.includes(name))) return { pass: false, label: "liga ruim para under" };
  if (good.some(name => text.includes(name))) return { pass: true, label: "liga favoravel para under" };
  return { pass: true, label: "liga neutra" };
}

function motivationScore(event) {
  const text = `${event.tournament?.round || ""} ${event.tournament?.name || ""}`.toLowerCase();
  const decisive = /final|semi|playoff|promotion|relegation|mata|quartas|oitavas|desempate/.test(text);
  return {
    pass: !decisive,
    label: decisive ? "jogo decisivo evitado" : "fase regular/meio de tabela presumido"
  };
}

function underGrade(score) {
  if (score >= 10) return "A+";
  if (score >= 9) return "A";
  if (score >= 8) return "B+";
  if (score >= 7) return "B";
  return "Descartar";
}

function under25Criteria(event, homeMetrics, awayMetrics, homeShotMetrics, awayShotMetrics, under25Odd) {
  const projected = projectedGoals(homeMetrics, awayMetrics);
  const motivation = motivationScore(event);
  const league = underLeagueScore(event);
  const combinedBttsRate = Math.round((homeMetrics.bttsRate + awayMetrics.bttsRate) / 2);
  const combinedOver25Rate = Math.round((homeMetrics.over25Rate + awayMetrics.over25Rate) / 2);
  const combinedFirstHalfGoalRate = Math.round((homeMetrics.firstHalfGoalRate + awayMetrics.firstHalfGoalRate) / 2);
  const combinedShotsOnTarget = homeShotMetrics.shotsOnTargetAvg !== null && awayShotMetrics.shotsOnTargetAvg !== null
    ? Number((homeShotMetrics.shotsOnTargetAvg + awayShotMetrics.shotsOnTargetAvg).toFixed(2))
    : null;

  const checks = [
    { key: "scoredAvg", label: "Times marcam ate 1.2 gol/jogo", pass: homeMetrics.scoredAvg <= 1.2 && awayMetrics.scoredAvg <= 1.2 },
    { key: "concededAvg", label: "Times sofrem ate 1.2 gol/jogo", pass: homeMetrics.concededAvg <= 1.2 && awayMetrics.concededAvg <= 1.2 },
    { key: "over25Rate", label: "Over 2.5 ate 40%", pass: combinedOver25Rate <= 40 },
    { key: "bttsRate", label: "BTTS ate 50%", pass: combinedBttsRate <= 50 },
    { key: "xg", label: "xG ate 2.50", pass: false, unavailable: true },
    { key: "shotsOnTarget", label: "Finalizacoes certas ate 8", pass: combinedShotsOnTarget !== null && combinedShotsOnTarget <= 8, unavailable: combinedShotsOnTarget === null },
    { key: "firstHalfGoal", label: "Menos de 60% com gol no 1T", pass: combinedFirstHalfGoalRate < 60 },
    { key: "motivation", label: "Evitar jogo decisivo", pass: motivation.pass },
    { key: "odds", label: "Odd Under 2.5 entre 1.70 e 2.20", pass: under25Odd === null || (under25Odd >= 1.7 && under25Odd <= 2.2), unavailable: under25Odd === null },
    { key: "league", label: "Liga favoravel/neutra para Under", pass: league.pass }
  ];
  const score = checks.filter(check => check.pass).length;

  return {
    score,
    grade: underGrade(score),
    projectedGoals: projected,
    combinedBttsRate,
    combinedOver25Rate,
    combinedFirstHalfGoalRate,
    combinedShotsOnTarget,
    under25Odd,
    motivation: motivation.label,
    league: league.label,
    checks
  };
}

function handicapFavorite(event, prediction) {
  const home = prediction.probabilities.home;
  const away = prediction.probabilities.away;
  if (home >= away) {
    return {
      side: "home",
      team: event.homeTeam?.name,
      probability: home,
      opponentProbability: away,
      isHome: true
    };
  }
  return {
    side: "away",
    team: event.awayTeam?.name,
    probability: away,
    opponentProbability: home,
    isHome: false
  };
}

function handicapScore(event, favorite, favoriteMetrics, opponentMetrics, favoriteShotMetrics, opponentShotMetrics) {
  const checks = [
    { key: "form", pass: favorite.probability >= 46, label: "Forma/probabilidade recente" },
    { key: "attack", pass: favoriteMetrics.scoredAvg >= 1.35, label: "Ataque forte" },
    { key: "defense", pass: favoriteMetrics.concededAvg <= 1.25, label: "Defesa confiavel" },
    { key: "homeAway", pass: favorite.isHome || favorite.probability >= 52, label: "Casa/fora favoravel" },
    { key: "motivation", pass: motivationScore(event).pass, label: "Motivacao sem risco decisivo" },
    { key: "lineup", pass: true, label: "Escalacao presumida ok" },
    { key: "edge", pass: favorite.probability >= opponentMetrics.concededAvg * 10 + 38, label: "Superioridade no confronto" },
    { key: "opponentWeak", pass: opponentMetrics.concededAvg >= 1.15 || opponentMetrics.totalAvg >= 2.5, label: "Adversario vulneravel" },
    { key: "favoriteGoals", pass: favoriteMetrics.scoredAvg >= 2.0, label: "Media superior a 2 gols" },
    { key: "shots", pass: favoriteShotMetrics.shotsAvg === null || favoriteShotMetrics.shotsAvg >= 10, label: "Volume ofensivo/finalizacoes" }
  ];
  const score = checks.filter(check => check.pass).length;
  return { score, checks };
}

function handicapCandidateLines(score) {
  if (score >= 8) return [-0.75, -1];
  if (score >= 6) return [0, -0.25];
  return [];
}

function handicapOutcome(margin, line, odd) {
  if (line === 0) {
    if (margin > 0) return { outcome: "full-win", hit: true, profitUnits: odd - 1 };
    if (margin === 0) return { outcome: "push", hit: true, profitUnits: 0 };
    return { outcome: "loss", hit: false, profitUnits: -1 };
  }
  if (line === -1) {
    if (margin >= 2) return { outcome: "full-win", hit: true, profitUnits: odd - 1 };
    if (margin === 1) return { outcome: "push", hit: true, profitUnits: 0 };
    return { outcome: "loss", hit: false, profitUnits: -1 };
  }
  if (line === -0.75) {
    if (margin >= 2) return { outcome: "full-win", hit: true, profitUnits: odd - 1 };
    if (margin === 1) return { outcome: "half-win", hit: true, profitUnits: (odd - 1) / 2 };
    return { outcome: "loss", hit: false, profitUnits: -1 };
  }
  if (line === -0.25) {
    if (margin > 0) return { outcome: "full-win", hit: true, profitUnits: odd - 1 };
    if (margin === 0) return { outcome: "half-loss", hit: false, profitUnits: -0.5 };
    return { outcome: "loss", hit: false, profitUnits: -1 };
  }
  return { outcome: "loss", hit: false, profitUnits: -1 };
}

async function teamRecentCornerMetrics(teamId, fixtures) {
  const sample = fixtures.filter(event => isFinishedEvent(event)).slice(0, 5);
  if (!sample.length) {
    return { games: 0, cornersAvg: null, shotsAvg: null };
  }

  let cornerTotal = 0;
  let cornerGames = 0;
  let shotTotal = 0;
  let shotGames = 0;
  let shotsOnTargetTotal = 0;
  let shotsOnTargetGames = 0;
  await mapWithConcurrency(sample, 2, async event => {
    try {
      const stats = await fetchFixtureStatistics(event.id);
      const corners = fixtureCornersFromStats(stats);
      const shots = fixtureShotsFromStats(stats);
      const shotsOnTarget = fixtureShotsOnTargetFromStats(stats);
      const isHome = String(event.homeTeam?.id) === String(teamId);
      if (corners) {
        cornerTotal += isHome ? corners.home : corners.away;
        cornerGames += 1;
      }
      if (shots) {
        shotTotal += isHome ? shots.home : shots.away;
        shotGames += 1;
      }
      if (shotsOnTarget) {
        shotsOnTargetTotal += isHome ? shotsOnTarget.home : shotsOnTarget.away;
        shotsOnTargetGames += 1;
      }
    } catch {
      return null;
    }
    return null;
  });

  return {
    games: sample.length,
    cornersAvg: cornerGames ? Number((cornerTotal / cornerGames).toFixed(2)) : null,
    shotsAvg: shotGames ? Number((shotTotal / shotGames).toFixed(2)) : null,
    shotsOnTargetAvg: shotsOnTargetGames ? Number((shotsOnTargetTotal / shotsOnTargetGames).toFixed(2)) : null
  };
}

function greenMinuteFromEvents(record, fixtureEvents) {
  const sentMinute = Number(record.sentMinute ?? record.alert?.minute ?? 0);
  const goal = fixtureEvents
    .filter(event => String(event.type || "").toLowerCase() === "goal")
    .sort((a, b) => Number(a.time?.elapsed || 0) - Number(b.time?.elapsed || 0))
    .find(event => Number(event.time?.elapsed || 0) >= sentMinute);
  if (!goal) return null;
  const elapsed = Number(goal.time?.elapsed || 0);
  const extra = Number(goal.time?.extra || 0);
  return extra > 0 ? `${elapsed}+${extra}` : elapsed;
}

function goalMinuteValue(event) {
  const elapsed = Number(event.time?.elapsed || 0);
  const extra = Number(event.time?.extra || 0);
  return elapsed + Math.max(0, extra);
}

function goalMinuteText(event) {
  const elapsed = Number(event.time?.elapsed || 0);
  const extra = Number(event.time?.extra || 0);
  return extra > 0 ? `${elapsed}+${extra}` : String(elapsed);
}

function firstGoalFromEvents(fixtureEvents) {
  return fixtureEvents
    .filter(event => String(event.type || "").toLowerCase() === "goal")
    .sort((a, b) => goalMinuteValue(a) - goalMinuteValue(b))[0] || null;
}

function finalGoalsTotal(event) {
  const score = finalScore(event);
  return score ? score.home + score.away : 0;
}

function halftimeGoalsTotal(event) {
  const home = event.score?.halftime?.home;
  const away = event.score?.halftime?.away;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return Number(home) + Number(away);
}

function minuteSimulatorSummary(results) {
  const hits = results.filter(item => item.hit).length;
  const misses = results.filter(item => !item.hit).length;
  const halfWins = results.filter(item => item.outcome === "half-win").length;
  const total = results.length;
  const hitRate = total ? Math.round((hits / total) * 100) : 0;
  const profitUnits = results.some(item => item.profitUnits !== undefined)
    ? Number(results.reduce((sum, item) => sum + Number(item.profitUnits || 0), 0).toFixed(2))
    : null;
  return {
    total,
    hits,
    misses,
    halfWins,
    hitRate,
    profitUnits,
    roi: profitUnits !== null && total ? Number(((profitUnits / total) * 100).toFixed(1)) : null,
    breakEvenOdd: hits ? Number((total / hits).toFixed(2)) : 0
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    results.push(...await Promise.all(chunk.map(mapper)));
    if (index + limit < items.length) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  return results;
}

async function runMinuteSimulationForDate(date, sport, entryMinute) {
  const events = await fetchApiFootballEvents(date, sport);
  const finished = events
    .map(normalizeEvent)
    .filter(event => isFinishedEvent(event));
  const candidates = finished.filter(event => {
    const totalGoals = finalGoalsTotal(event);
    if (totalGoals === 0) return true;
    const halftimeTotal = halftimeGoalsTotal(event);
    return entryMinute < 46 || halftimeTotal === null || halftimeTotal === 0;
  });

  const results = candidates
    .filter(event => finalGoalsTotal(event) === 0)
    .map(event => {
      const score = finalScore(event);
      return {
        date,
        event,
        hit: false,
        firstGoalMinute: null,
        firstGoalText: "",
        finalScore: score ? `${score.home} x ${score.away}` : "0 x 0"
      };
    });
  const warnings = [];
  const goalCandidates = candidates.filter(event => finalGoalsTotal(event) > 0);
  const limitedGoalCandidates = goalCandidates.slice(0, 30);
  if (goalCandidates.length > limitedGoalCandidates.length) {
    warnings.push(`Amostra limitada: ${limitedGoalCandidates.length} de ${goalCandidates.length} partidas com gol foram consultadas.`);
  }
  const goalResults = await mapWithConcurrency(limitedGoalCandidates, 3, async event => {
    const score = finalScore(event);
    const finalScoreText = score ? `${score.home} x ${score.away}` : "pendente";
    try {
      const fixtureEvents = await fetchFixtureEvents(event.id);
      const firstGoal = firstGoalFromEvents(fixtureEvents);
      if (!firstGoal) return null;
      const firstGoalMinute = goalMinuteValue(firstGoal);
      if (firstGoalMinute >= entryMinute) {
        return {
          date,
          event,
          hit: true,
          firstGoalMinute,
          firstGoalText: goalMinuteText(firstGoal),
          finalScore: finalScoreText
        };
      }
      return null;
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  results.push(...goalResults.filter(Boolean));

  return { results, warnings };
}

async function runOver25SimulationForDate(date, sport) {
  const events = await fetchApiFootballEvents(date, sport);
  const finished = events
    .map(normalizeEvent)
    .filter(event => isFinishedEvent(event));
  const limited = finished.slice(0, 30);
  const warnings = [];
  if (finished.length > limited.length) {
    warnings.push(`Amostra limitada: ${limited.length} de ${finished.length} jogos finalizados foram analisados.`);
  }

  const analyzed = await mapWithConcurrency(limited, 3, async event => {
    try {
      const [homeLast, awayLast, over25Odd] = await Promise.all([
        fetchTeamLastFixtures(event.homeTeam?.id, 10),
        fetchTeamLastFixtures(event.awayTeam?.id, 10),
        fetchFixtureOver25Odd(event.id).catch(() => null)
      ]);
      const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
      const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
      const projected = projectedGoals(homeMetrics, awayMetrics);
      const prediction = predictMatch(event);
      const favoriteHome = prediction.probabilities.home >= prediction.probabilities.away
        && prediction.probabilities.home >= prediction.probabilities.draw;
      const bttsOk = homeMetrics.bttsRate >= 60 && awayMetrics.bttsRate >= 60;
      const goalsOk = projected > 2.8;
      const oddOk = over25Odd === null || (over25Odd >= 1.7 && over25Odd <= 2.1);
      const shotsAvailable = false;
      const qualifies = goalsOk && favoriteHome && bttsOk && oddOk;
      if (!qualifies) return null;

      const score = finalScore(event);
      const totalGoals = score ? score.home + score.away : 0;
      return {
        date,
        event,
        hit: totalGoals >= 3,
        finalScore: score ? `${score.home} x ${score.away}` : "pendente",
        totalGoals,
        over25Odd,
        firstGoalMinute: null,
        firstGoalText: "",
        criteria: {
          projectedGoals: projected,
          favoriteHome,
          homeBttsRate: homeMetrics.bttsRate,
          awayBttsRate: awayMetrics.bttsRate,
          homeScoredAvg: homeMetrics.scoredAvg,
          homeConcededAvg: homeMetrics.concededAvg,
          awayScoredAvg: awayMetrics.scoredAvg,
          awayConcededAvg: awayMetrics.concededAvg,
          oddOk,
          shotsAvailable
        }
      };
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  return { results: analyzed.filter(Boolean), warnings };
}

async function runCornersSimulationForDate(date, sport) {
  const events = await fetchApiFootballEvents(date, sport);
  const finished = events
    .map(normalizeEvent)
    .filter(event => isFinishedEvent(event));
  const limited = finished.slice(0, 20);
  const warnings = [];
  if (finished.length > limited.length) {
    warnings.push(`Amostra limitada: ${limited.length} de ${finished.length} jogos finalizados foram analisados.`);
  }

  const analyzed = await mapWithConcurrency(limited, 2, async event => {
    try {
      const prediction = predictMatch(event);
      const favoriteHome = prediction.probabilities.home >= prediction.probabilities.away
        && prediction.probabilities.home >= prediction.probabilities.draw;
      if (!favoriteHome) return null;

      const [homeLast, awayLast, fixtureStats] = await Promise.all([
        fetchTeamLastFixtures(event.homeTeam?.id, 10),
        fetchTeamLastFixtures(event.awayTeam?.id, 10),
        fetchFixtureStatistics(event.id)
      ]);
      const [homeCorners, awayCorners] = await Promise.all([
        teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
        teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
      ]);
      const matchCorners = fixtureCornersFromStats(fixtureStats);
      const matchShots = fixtureShotsFromStats(fixtureStats);
      const jointCornersAvg = homeCorners.cornersAvg !== null && awayCorners.cornersAvg !== null
        ? Number((homeCorners.cornersAvg + awayCorners.cornersAvg).toFixed(2))
        : null;
      const favoriteShotsAvg = homeCorners.shotsAvg;
      const decisiveGame = /final|semi|playoff|promotion|relegation|mata|quartas|oitavas/i.test(
        `${event.tournament?.round || ""} ${event.tournament?.name || ""}`
      );
      const cornersOk = jointCornersAvg !== null && jointCornersAvg > 10;
      const shotsOk = favoriteShotsAvg !== null && favoriteShotsAvg > 10;
      const dataAvailable = Boolean(matchCorners && jointCornersAvg !== null && favoriteShotsAvg !== null);
      if (!dataAvailable || !cornersOk || !shotsOk) return null;

      const lines = [8.5, 9.5, 10.5];
      return lines.map(line => ({
        date,
        event,
        hit: matchCorners.total > line,
        finalScore: `${matchCorners.total} escanteios`,
        totalCorners: matchCorners.total,
        line,
        firstGoalMinute: null,
        firstGoalText: "",
        criteria: {
          favoriteHome,
          jointCornersAvg,
          favoriteShotsAvg,
          matchShots,
          decisiveGame,
          cornersOk,
          shotsOk
        }
      }));
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  const results = analyzed.flatMap(item => Array.isArray(item) ? item : item ? [item] : []);
  if (!results.length) {
    warnings.push("A API nao retornou dados suficientes de escanteios/finalizacoes para validar entradas.");
  }
  return { results, warnings };
}

async function runUnder25SimulationForDate(date, sport) {
  const events = await fetchApiFootballEvents(date, sport);
  const finished = events
    .map(normalizeEvent)
    .filter(event => isFinishedEvent(event));
  const limited = finished.slice(0, 30);
  const warnings = [];
  if (finished.length > limited.length) {
    warnings.push(`Amostra limitada: ${limited.length} de ${finished.length} jogos finalizados foram analisados.`);
  }

  const analyzed = await mapWithConcurrency(limited, 3, async event => {
    try {
      const [homeLast, awayLast, under25Odd] = await Promise.all([
        fetchTeamLastFixtures(event.homeTeam?.id, 10),
        fetchTeamLastFixtures(event.awayTeam?.id, 10),
        fetchFixtureUnder25Odd(event.id).catch(() => null)
      ]);
      const [homeShotMetrics, awayShotMetrics] = await Promise.all([
        teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
        teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
      ]);
      const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
      const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
      const criteria = under25Criteria(event, homeMetrics, awayMetrics, homeShotMetrics, awayShotMetrics, under25Odd);
      if (criteria.score < 8) return null;

      const score = finalScore(event);
      const totalGoals = score ? score.home + score.away : 0;
      return {
        date,
        event,
        hit: totalGoals <= 2,
        finalScore: score ? `${score.home} x ${score.away}` : "pendente",
        totalGoals,
        under25Odd,
        firstGoalMinute: null,
        firstGoalText: "",
        criteria
      };
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  return { results: analyzed.filter(Boolean), warnings };
}

async function runAsianHandicapSimulationForDate(date, sport) {
  const events = await fetchApiFootballEvents(date, sport);
  const finished = events
    .map(normalizeEvent)
    .filter(event => isFinishedEvent(event));
  const limited = finished.slice(0, 30);
  const warnings = [];
  if (finished.length > limited.length) {
    warnings.push(`Amostra limitada: ${limited.length} de ${finished.length} jogos finalizados foram analisados.`);
  }

  const analyzed = await mapWithConcurrency(limited, 3, async event => {
    try {
      const prediction = predictMatch(event);
      const favorite = handicapFavorite(event, prediction);

      const [homeLast, awayLast] = await Promise.all([
        fetchTeamLastFixtures(event.homeTeam?.id, 10),
        fetchTeamLastFixtures(event.awayTeam?.id, 10)
      ]);
      const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
      const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
      const [homeShotMetrics, awayShotMetrics] = await Promise.all([
        teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
        teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
      ]);
      const favoriteMetrics = favorite.side === "home" ? homeMetrics : awayMetrics;
      const opponentMetrics = favorite.side === "home" ? awayMetrics : homeMetrics;
      const favoriteShotMetrics = favorite.side === "home" ? homeShotMetrics : awayShotMetrics;
      const opponentShotMetrics = favorite.side === "home" ? awayShotMetrics : homeShotMetrics;
      const scoreInfo = handicapScore(event, favorite, favoriteMetrics, opponentMetrics, favoriteShotMetrics, opponentShotMetrics);
      const candidateLines = handicapCandidateLines(scoreInfo.score);
      if (!candidateLines.length) return null;

      let selected = null;
      for (const line of candidateLines) {
        const odd = await fetchFixtureAsianHandicapOdd(event.id, favorite.side, line).catch(() => null);
        if (odd !== null && odd >= 1.85 && odd <= 2.05) {
          selected = { line, odd };
          break;
        }
      }
      if (!selected) return null;

      const score = finalScore(event);
      const homeMargin = score ? score.home - score.away : 0;
      const margin = favorite.side === "home" ? homeMargin : -homeMargin;
      const result = handicapOutcome(margin, selected.line, selected.odd);

      return {
        date,
        event,
        hit: result.hit,
        outcome: result.outcome,
        profitUnits: Number(result.profitUnits.toFixed(2)),
        finalScore: score ? `${score.home} x ${score.away}` : "pendente",
        handicapLine: selected.line,
        handicapOdd: selected.odd,
        handicapSide: favorite.side,
        favoriteTeam: favorite.team,
        handicapScore: scoreInfo.score,
        totalGoals: score ? score.home + score.away : 0,
        firstGoalMinute: null,
        firstGoalText: "",
        criteria: {
          favoriteProbability: favorite.probability,
          favoriteScoredAvg: favoriteMetrics.scoredAvg,
          favoriteConcededAvg: favoriteMetrics.concededAvg,
          opponentConcededAvg: opponentMetrics.concededAvg,
          favoriteShotsAvg: favoriteShotMetrics.shotsAvg,
          checks: scoreInfo.checks
        }
      };
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  return { results: analyzed.filter(Boolean), warnings };
}

function preMatchSignalResult(event, market, data) {
  const prediction = predictMatch(event);
  const score = finalScore(event);
  const totalGoals = score ? score.home + score.away : 0;

  if (!isFinishedEvent(event) || !score) {
    return {
      status: "pending",
      hit: null,
      score: score ? `${score.home} x ${score.away}` : "pendente",
      detail: "Jogo ainda nao terminou."
    };
  }

  if (market === "match-over-goals") {
    const hit = totalGoals >= 3;
    return {
      status: "finished",
      hit,
      score: `${score.home} x ${score.away}`,
      detail: hit ? "Over 2.5 gols confirmado." : "A partida terminou abaixo de 3 gols."
    };
  }

  if (market === "match-under-goals") {
    const hit = totalGoals <= 2;
    return {
      status: "finished",
      hit,
      score: `${score.home} x ${score.away}`,
      detail: hit ? "Under 2.5 gols confirmado." : "A partida passou de 2 gols."
    };
  }

  if (market === "handicap") {
    const favorite = data?.favoriteSide
      ? { side: data.favoriteSide }
      : handicapFavorite(event, prediction);
    const line = Number(data?.line ?? -0.75);
    const odd = Number(data?.odd ?? 1.9);
    const homeMargin = score.home - score.away;
    const margin = favorite.side === "home" ? homeMargin : -homeMargin;
    const outcome = handicapOutcome(margin, line, odd);
    const labels = {
      "full-win": "Green completo",
      "half-win": "Meio green",
      push: "Devolvida",
      "half-loss": "Meio red",
      loss: "Red"
    };
    return {
      status: "finished",
      hit: outcome.hit,
      score: `${score.home} x ${score.away}`,
      detail: `${labels[outcome.outcome] || "Resultado"} no handicap ${line}.`,
      outcome: outcome.outcome,
      profitUnits: Number(outcome.profitUnits.toFixed(2))
    };
  }

  return {
    status: "finished",
    hit: null,
    score: `${score.home} x ${score.away}`,
    detail: "Mercado sem avaliacao automatica."
  };
}

async function buildOver25Signal(event, date) {
  const [homeLast, awayLast, over25Odd] = await Promise.all([
    fetchTeamLastFixtures(event.homeTeam?.id, 10),
    fetchTeamLastFixtures(event.awayTeam?.id, 10),
    fetchFixtureOver25Odd(event.id).catch(() => null)
  ]);
  const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
  const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
  const projected = projectedGoals(homeMetrics, awayMetrics);
  const prediction = predictMatch(event);
  const favoriteHome = prediction.probabilities.home >= prediction.probabilities.away
    && prediction.probabilities.home >= prediction.probabilities.draw;
  const bttsOk = homeMetrics.bttsRate >= 60 && awayMetrics.bttsRate >= 60;
  const goalsOk = projected > 2.8;
  const oddOk = over25Odd === null || (over25Odd >= 1.7 && over25Odd <= 2.1);
  if (!goalsOk || !favoriteHome || !bttsOk || !oddOk) return null;

  return {
    date,
    event,
    prediction,
    alert: {
      team: "Partida",
      label: "Over 2.5 gols",
      market: "Over gols",
      selection: "Over 2.5",
      marketOdd: over25Odd,
      fairOdd: over25Odd,
      minimumOdd: 1.7,
      probability: Math.min(88, Math.round(projected * 23)),
      minute: null,
      score: "pre-jogo",
      reason: `Media projetada ${projected}, favorito em casa e BTTS forte nos ultimos jogos.`,
      strategy: "over-25-pre-match",
      criteria: {
        projectedGoals: projected,
        favoriteHome,
        homeBttsRate: homeMetrics.bttsRate,
        awayBttsRate: awayMetrics.bttsRate,
        homeScoredAvg: homeMetrics.scoredAvg,
        awayScoredAvg: awayMetrics.scoredAvg,
        oddOk
      }
    }
  };
}

async function buildUnder25Signal(event, date) {
  const [homeLast, awayLast, under25Odd] = await Promise.all([
    fetchTeamLastFixtures(event.homeTeam?.id, 10),
    fetchTeamLastFixtures(event.awayTeam?.id, 10),
    fetchFixtureUnder25Odd(event.id).catch(() => null)
  ]);
  const [homeShotMetrics, awayShotMetrics] = await Promise.all([
    teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
    teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
  ]);
  const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
  const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
  const criteria = under25Criteria(event, homeMetrics, awayMetrics, homeShotMetrics, awayShotMetrics, under25Odd);
  if (criteria.score < 8) return null;
  const prediction = predictMatch(event);

  return {
    date,
    event,
    prediction,
    alert: {
      team: "Partida",
      label: "Under 2.5 gols",
      market: "Under gols",
      selection: "Under 2.5",
      marketOdd: under25Odd,
      fairOdd: under25Odd,
      minimumOdd: 1.7,
      probability: Math.min(86, criteria.score * 9),
      minute: null,
      score: "pre-jogo",
      reason: `Scanner Under ${criteria.grade}: ${criteria.score}/10 criterios aprovados.`,
      strategy: "under-25-score",
      criteria
    }
  };
}

async function buildHandicapSignal(event, date) {
  const prediction = predictMatch(event);
  const favorite = handicapFavorite(event, prediction);
  const [homeLast, awayLast] = await Promise.all([
    fetchTeamLastFixtures(event.homeTeam?.id, 10),
    fetchTeamLastFixtures(event.awayTeam?.id, 10)
  ]);
  const homeMetrics = teamRecentMetrics(event.homeTeam?.id, homeLast);
  const awayMetrics = teamRecentMetrics(event.awayTeam?.id, awayLast);
  const [homeShotMetrics, awayShotMetrics] = await Promise.all([
    teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
    teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
  ]);
  const favoriteMetrics = favorite.side === "home" ? homeMetrics : awayMetrics;
  const opponentMetrics = favorite.side === "home" ? awayMetrics : homeMetrics;
  const favoriteShotMetrics = favorite.side === "home" ? homeShotMetrics : awayShotMetrics;
  const opponentShotMetrics = favorite.side === "home" ? awayShotMetrics : homeShotMetrics;
  const scoreInfo = handicapScore(event, favorite, favoriteMetrics, opponentMetrics, favoriteShotMetrics, opponentShotMetrics);
  const candidateLines = handicapCandidateLines(scoreInfo.score);
  if (!candidateLines.length) return null;

  let selected = null;
  for (const line of candidateLines) {
    const odd = await fetchFixtureAsianHandicapOdd(event.id, favorite.side, line).catch(() => null);
    if (odd !== null && odd >= 1.85 && odd <= 2.05) {
      selected = { line, odd };
      break;
    }
  }
  if (!selected) return null;

  return {
    date,
    event,
    prediction,
    alert: {
      team: favorite.team,
      label: `${favorite.team} Handicap ${selected.line}`,
      market: "Handicap Asiatico",
      selection: `AH ${selected.line}`,
      marketOdd: selected.odd,
      fairOdd: selected.odd,
      probability: Math.min(88, scoreInfo.score * 9),
      minute: null,
      score: "pre-jogo",
      reason: `Favorito com nota ${scoreInfo.score}/10. Linha indicada: ${selected.line}.`,
      strategy: "asian-handicap-score",
      line: selected.line,
      favoriteSide: favorite.side,
      criteria: {
        favoriteProbability: favorite.probability,
        score: scoreInfo.score,
        checks: scoreInfo.checks
      }
    },
    key: String(selected.line).replace(".", "_")
  };
}

async function buildCornersSignals(event, date) {
  const prediction = predictMatch(event);
  const favoriteHome = prediction.probabilities.home >= prediction.probabilities.away
    && prediction.probabilities.home >= prediction.probabilities.draw;
  if (!favoriteHome) return [];

  const [homeLast, awayLast] = await Promise.all([
    fetchTeamLastFixtures(event.homeTeam?.id, 10),
    fetchTeamLastFixtures(event.awayTeam?.id, 10)
  ]);
  const [homeCorners, awayCorners] = await Promise.all([
    teamRecentCornerMetrics(event.homeTeam?.id, homeLast),
    teamRecentCornerMetrics(event.awayTeam?.id, awayLast)
  ]);
  const jointCornersAvg = homeCorners.cornersAvg !== null && awayCorners.cornersAvg !== null
    ? Number((homeCorners.cornersAvg + awayCorners.cornersAvg).toFixed(2))
    : null;
  const favoriteShotsAvg = homeCorners.shotsAvg;
  const cornersOk = jointCornersAvg !== null && jointCornersAvg > 10;
  const shotsOk = favoriteShotsAvg !== null && favoriteShotsAvg > 10;
  if (!cornersOk || !shotsOk) return [];

  return [8.5, 9.5, 10.5].map(line => ({
    date,
    event,
    prediction,
    alert: {
      team: "Partida",
      label: `Over ${line} escanteios`,
      market: "Escanteios",
      selection: `Over ${line}`,
      fairOdd: null,
      marketOdd: null,
      probability: Math.min(84, Math.round(jointCornersAvg * 7)),
      minute: null,
      score: "pre-jogo",
      reason: `Media conjunta ${jointCornersAvg} escanteios e favorito finaliza bastante.`,
      strategy: "corners-pre-match",
      line,
      criteria: {
        favoriteHome,
        jointCornersAvg,
        favoriteShotsAvg,
        cornersOk,
        shotsOk
      }
    },
    key: String(line).replace(".", "_")
  }));
}

async function buildMarketSignalsForDate(type, date, sport) {
  const config = marketSignalTypes[type];
  if (!config || type === "match-goal") {
    return { alerts: [], warnings: [] };
  }

  const events = await fetchApiFootballEvents(date, sport)
    .then(items => items.map(normalizeEvent).filter(event => !isFinishedEvent(event)));
  const analysisLimit = config.market === "corners" ? 6 : 25;
  const limited = events.slice(0, analysisLimit);
  const warnings = [];
  if (events.length > limited.length) {
    warnings.push(`Amostra limitada: ${limited.length} de ${events.length} jogos foram analisados.`);
  }

  const analyzed = await mapWithConcurrency(limited, 2, async event => {
    try {
      if (config.market === "match-over-goals") return await buildOver25Signal(event, date);
      if (config.market === "match-under-goals") return await buildUnder25Signal(event, date);
      if (config.market === "handicap") return await buildHandicapSignal(event, date);
      if (config.market === "corners") return await buildCornersSignals(event, date);
      return null;
    } catch (error) {
      warnings.push(`${event.id}: ${error.message}`);
      return null;
    }
  });

  const alerts = analyzed
    .flatMap(item => Array.isArray(item) ? item : item ? [item] : [])
    .sort((a, b) => Number(b.alert.probability || 0) - Number(a.alert.probability || 0))
    .map((item, index) => ({ rank: index + 1, ...item }));

  return { alerts, warnings };
}

async function savedMarketAlerts(date, type) {
  const records = await readSignals(date, type);
  return records
    .filter(record => record.event && record.alert)
    .map((record, index) => ({
      rank: record.rank || index + 1,
      event: record.event,
      prediction: record.prediction,
      alert: record.alert,
      result: record.result || null,
      createdAt: record.createdAt || record.alert?.sentAt || null,
      sentMinute: record.sentMinute ?? record.alert?.minute ?? null,
      saved: true
    }))
    .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999));
}

async function evaluateRecords(records, eventsById) {
  const fixtureEventsCache = new Map();
  const fixtureStatsCache = new Map();
  const results = [];

  for (const record of records) {
    const currentEvent = eventsById.get(String(record.event.id)) || record.event;
    let result = evaluateRecord(record, currentEvent);
    if (record.type === "match-goal" && result.hit && !result.greenMinute) {
      try {
        if (!fixtureEventsCache.has(String(record.event.id))) {
          fixtureEventsCache.set(String(record.event.id), await fetchFixtureEvents(record.event.id));
        }
        result = {
          ...result,
          greenMinute: greenMinuteFromEvents(record, fixtureEventsCache.get(String(record.event.id)))
        };
      } catch {
        result = { ...result, greenMinute: record.result?.greenMinute || null };
      }
    }
    if (record.type === "corners" && isFinishedEvent(currentEvent)) {
      try {
        if (!fixtureStatsCache.has(String(record.event.id))) {
          fixtureStatsCache.set(String(record.event.id), await fetchFixtureStatistics(record.event.id));
        }
        const corners = fixtureCornersFromStats(fixtureStatsCache.get(String(record.event.id)));
        const line = Number(record.alert?.line ?? 8.5);
        if (corners) {
          const hit = corners.total > line;
          result = {
            status: "finished",
            hit,
            score: `${corners.total} escanteios`,
            detail: hit ? `Over ${line} escanteios confirmado.` : `A partida ficou abaixo de Over ${line} escanteios.`
          };
        } else {
          result = {
            status: "finished",
            hit: null,
            score: result.score,
            detail: "Jogo finalizado, mas a API-Football nao forneceu as estatisticas de escanteios."
          };
        }
      } catch {
        result = record.result || result;
      }
    }
    results.push({ record, event: currentEvent, result });
  }

  return results;
}

async function reportResultsForDate(date, sport, type) {
  const records = await readSignals(date, type);
  if (!records.length) return { results: [], warning: "" };

  try {
    const events = await fetchApiFootballEvents(date, sport);
    const eventsById = new Map(events.map(event => [String(event.id), event]));
    const evaluatedResults = await evaluateRecords(records, eventsById);
    const results = evaluatedResults.map(item => ({
      ...item,
      result: isFinishedEvent(item.event)
        ? item.result
        : item.record.result || item.result
    }));
    await saveEvaluatedResults(results);
    return { results, warning: "" };
  } catch (error) {
    const results = records.map(record => ({
      record,
      event: record.event,
      result: record.result || {
        status: "pending",
        hit: null,
        score: "pendente",
        detail: "Aguardando atualização do jogo."
      }
    }));
    return {
      results,
      warning: `${date}: ${error.message}`
    };
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/firebase-status") {
    json(res, 200, {
      configured: firebaseStatus !== "não configurado",
      status: firebaseStatus,
      collection: "signals"
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/signal-counts") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const records = await readSignals(date);
    let finishedEventIds = new Set();
    try {
      const events = await fetchApiFootballEvents(date, "football");
      finishedEventIds = new Set(
        events.filter(event => isFinishedEvent(event)).map(event => String(event.id))
      );
    } catch {
      finishedEventIds = new Set();
    }
    const counts = Object.fromEntries(
      Object.keys(marketSignalTypes).map(type => {
        const marketRecords = records.filter(record => record.type === type);
        const finished = marketRecords.filter(record =>
          record.result?.status === "finished"
          || finishedEventIds.has(String(record.event?.id))
        ).length;
        return [type, { finished, total: marketRecords.length }];
      })
    );
    json(res, 200, { date, counts });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    const liveOnly = url.searchParams.get("live") === "all";
    try {
      const events = provider === "sofascore"
        ? await fetchSofascoreEvents(date, sport)
        : await fetchApiFootballEvents(date, sport, { liveOnly });
      let warning = "";
      if (sport === "football") {
        try {
          const liveOdds = await fetchLiveMatchGoalOdds();
          for (const event of events) {
            event.liveOver05 = liveOdds.get(String(event.id)) || null;
          }
        } catch (error) {
          warning = `Jogos carregados, mas não foi possível atualizar as odds: ${error.message}`;
        }
      }
      json(res, 200, { source: provider, date, sport, liveOnly, warning, events });
    } catch (error) {
      json(res, 200, {
        source: "demo",
        date,
        sport,
        warning: `${error.message}. Mostrando jogos de exemplo para manter o sistema operando.`,
        events: demoEvents.map(normalizeEvent)
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/favorite-goal-alerts") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    try {
      const events = provider === "sofascore"
        ? await fetchSofascoreEvents(date, sport)
        : await fetchApiFootballEvents(date, sport, { liveOnly: true });
      const alerts = events
        .map(normalizeEvent)
        .filter(event => isLiveEvent(event) && !isFinishedEvent(event))
        .map(event => {
          const prediction = predictMatch(event);
          const alert = liveFavoriteGoalAlert(event, prediction);
          return alert ? { event, prediction, alert } : null;
        })
        .filter(Boolean)
        .sort((a, b) => {
          const minuteDiff = b.alert.minute - a.alert.minute;
          return minuteDiff || a.alert.fairOdd - b.alert.fairOdd;
        })
        .map((item, index) => ({ rank: index + 1, ...item }));

      await recordPredictions("favorite-goal", date, provider, alerts);
      json(res, 200, { source: provider, date, sport, alerts });
    } catch (error) {
      const alerts = demoEvents
        .map(normalizeEvent)
        .map(event => {
          const prediction = predictMatch(event);
          const alert = liveFavoriteGoalAlert(event, prediction);
          return alert ? { event, prediction, alert } : null;
        })
        .filter(Boolean)
        .map((item, index) => ({ rank: index + 1, ...item }));

      await recordPredictions("favorite-goal", date, "demo", alerts);
      json(res, 200, {
        source: "demo",
        date,
        sport,
        warning: `${error.message}. Mostrando alertas de exemplo para manter o sistema operando.`,
        alerts
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/match-goal-alerts") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    try {
      const [events, liveOdds] = await Promise.all([
        provider === "sofascore"
          ? fetchSofascoreEvents(date, sport)
          : fetchApiFootballEvents(date, sport, { liveOnly: true }),
        fetchLiveMatchGoalOdds()
      ]);
      const alerts = await buildPremiumMatchGoalAlerts(events, liveOdds);

      await recordPredictions("match-goal", date, provider, alerts);
      json(res, 200, { source: provider, date, sport, alerts });
    } catch (error) {
      json(res, 200, {
        source: provider,
        date,
        sport,
        warning: `${error.message}. Nenhum sinal foi gerado sem a confirmação da odd real.`,
        alerts: []
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market-alerts") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    const type = url.searchParams.get("type") || "match-goal";
    const config = marketSignalTypes[type] || marketSignalTypes["match-goal"];

    if (type === "match-goal") {
      try {
        const [events, liveOdds] = await Promise.all([
          provider === "sofascore"
            ? fetchSofascoreEvents(date, sport)
            : fetchApiFootballEvents(date, sport, { liveOnly: true }),
          fetchLiveMatchGoalOdds()
        ]);
        const alerts = await buildPremiumMatchGoalAlerts(events, liveOdds);

        await recordPredictions("match-goal", date, provider, alerts);
        json(res, 200, { source: provider, date, sport, type, marketLabel: config.label, alerts });
      } catch (error) {
        json(res, 200, {
          source: provider,
          date,
          sport,
          type,
          marketLabel: config.label,
          warning: `${error.message}. Nenhum sinal foi gerado sem a confirmação da odd real.`,
          alerts: []
        });
      }
      return;
    }

    try {
      if (sport !== "football") {
        throw new Error("Sinais de mercado disponiveis apenas para futebol.");
      }
      const { alerts, warnings } = await buildMarketSignalsForDate(type, date, sport);
      await recordPredictions(type, date, provider, alerts);
      const storedAlerts = await savedMarketAlerts(date, type);
      const responseAlerts = storedAlerts.length ? storedAlerts : alerts;
      json(res, 200, {
        source: provider,
        date,
        sport,
        type,
        marketLabel: config.label,
        warning: warnings.length
          ? `Alguns jogos nao puderam ser analisados: ${warnings.slice(0, 5).join(" | ")}. Exibindo tambem os sinais ja salvos.`
          : "",
        alerts: responseAlerts
      });
    } catch (error) {
      const storedAlerts = await savedMarketAlerts(date, type).catch(() => []);
      json(res, 200, {
        source: provider,
        date,
        sport,
        type,
        marketLabel: config.label,
        warning: storedAlerts.length
          ? `${error.message}. Exibindo os sinais ja salvos.`
          : `${error.message}. Nenhum sinal foi salvo para este mercado.`,
        alerts: storedAlerts
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/minute-simulator") {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("date") || today;
    const endDate = url.searchParams.get("endDate") || startDate;
    const sport = url.searchParams.get("sport") || "football";
    const entryMinute = Math.max(1, Math.min(90, Number(url.searchParams.get("minute") || 80)));
    const market = url.searchParams.get("market") || "match-over-05";
    const marketConfig = simulatorMarkets[market] || simulatorMarkets["match-over-05"];

    try {
      if (sport !== "football") {
        throw new Error("Simulador por minuto disponivel apenas para futebol.");
      }
      const dates = reportDates(startDate, endDate);
      if (dates.length > 14) {
        throw new Error("Escolha um periodo de ate 14 dias por simulacao. Para meses, rode em blocos e depois consolidamos no banco.");
      }
      if (!marketConfig.strategy) {
        throw new Error(marketConfig.description);
      }

      const reports = [];
      for (const date of dates) {
        if (marketConfig.strategy === "over-25-pre-match") {
          reports.push(await runOver25SimulationForDate(date, sport));
        } else if (marketConfig.strategy === "under-25-score") {
          reports.push(await runUnder25SimulationForDate(date, sport));
        } else if (marketConfig.strategy === "asian-handicap-score") {
          reports.push(await runAsianHandicapSimulationForDate(date, sport));
        } else if (marketConfig.strategy === "corners-pre-match") {
          reports.push(await runCornersSimulationForDate(date, sport));
        } else {
          reports.push(await runMinuteSimulationForDate(date, sport, entryMinute));
        }
      }
      const results = reports.flatMap(report => report.results)
        .sort((a, b) => `${a.date}:${a.event.startTimestamp}`.localeCompare(`${b.date}:${b.event.startTimestamp}`));
      const warnings = reports.flatMap(report => report.warnings);
      if (marketConfig.strategy === "corners-pre-match" && !results.length) {
        warnings.unshift("Sem entradas porque a API nao retornou estatisticas de escanteios/finalizacoes suficientes para validar a estrategia.");
      }
      if (marketConfig.strategy === "under-25-score" && !results.length) {
        warnings.unshift("Sem entradas: nenhum jogo da amostra atingiu pelo menos 8 de 10 criterios do scanner Under 2.5.");
      }
      if (marketConfig.strategy === "asian-handicap-score" && !results.length) {
        warnings.unshift("Sem entradas: nenhum favorito passou pelos criterios de Handicap Asiatico com odds entre 1.85 e 2.05.");
      }

      json(res, 200, {
        source: "api-football",
        startDate,
        endDate,
        date: startDate,
        period: dates,
        market,
        marketLabel: marketConfig.label,
        description: marketConfig.description,
        entryMinute,
        warning: warnings.length ? `Alguns eventos nao puderam ser lidos: ${warnings.slice(0, 5).join(" | ")}` : "",
        summary: minuteSimulatorSummary(results),
        results
      });
    } catch (error) {
      json(res, 200, {
        source: "api-football",
        startDate,
        endDate,
        date: startDate,
        period: [],
        market,
        marketLabel: marketConfig.label,
        description: marketConfig.description,
        entryMinute,
        warning: error.message,
        summary: minuteSimulatorSummary([]),
        results: []
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/prediction-results") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const type = url.searchParams.get("type") || "match-goal";
    const sport = url.searchParams.get("sport") || "football";
    const records = await readSignals(date, type);

    try {
      const events = await fetchApiFootballEvents(date, sport);
      const eventsById = new Map(events.map(event => [String(event.id), event]));
      const results = await evaluateRecords(records, eventsById);
      await saveEvaluatedResults(results);

      json(res, 200, {
        source: "api-football",
        date,
        type,
        summary: accuracySummary(results),
        results
      });
    } catch (error) {
      const results = records.map(record => ({
        record,
        event: record.event,
        result: { status: "pending", hit: null, score: "pendente", detail: error.message }
      }));

      json(res, 200, {
        source: "historico-local",
        date,
        type,
        warning: `${error.message}. Mostrando apenas o histórico salvo.`,
        summary: accuracySummary(results),
        results
      });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/signals-report") {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("date") || today;
    const endDate = url.searchParams.get("endDate") || startDate;
    const sport = url.searchParams.get("sport") || "football";
    const type = url.searchParams.get("type") || "match-goal";

    try {
      const dates = reportDates(startDate, endDate);
      const reports = [];
      for (const date of dates) {
        reports.push(await reportResultsForDate(date, sport, type));
      }
      const results = reports.flatMap(report => report.results);
      const warnings = reports.map(report => report.warning).filter(Boolean);

      json(res, 200, {
        source: "firebase",
        date: startDate,
        startDate,
        endDate,
        period: dates,
        type,
        warning: warnings.length ? `Algumas datas usaram dados salvos: ${warnings.join(" | ")}` : "",
        summary: reportSummary(results),
        results
      });
    } catch (error) {
      const records = [];
      const date = startDate;
      const results = records.map(record => ({
        record,
        event: record.event,
        result: record.result || {
          status: "pending",
          hit: null,
          score: "pendente",
          detail: "Aguardando atualização do jogo."
        }
      }));

      json(res, 200, {
        source: firebaseConfig.projectId ? "firebase" : "historico-local",
        date,
        startDate,
        endDate,
        type,
        warning: `${error.message}. Exibindo os dados já salvos no banco.`,
        summary: reportSummary(results),
        results
      });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/predict") {
    try {
      const body = await parseBody(req);
      if (!body.event) {
        json(res, 400, { error: "Envie um jogo para analisar." });
        return;
      }
      json(res, 200, { prediction: predictMatch(normalizeEvent(body.event), body.inputs || {}) });
    } catch (error) {
      json(res, 400, { error: error.message });
    }
    return;
  }

  json(res, 404, { error: "Rota não encontrada." });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado.");
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(req, res, url);
}

if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Sistema de analise rodando em http://127.0.0.1:${port}`);
  });
}
