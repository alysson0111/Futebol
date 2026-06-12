import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const root = fileURLToPath(new URL(".", import.meta.url));
loadLocalEnv(".env");
loadLocalEnv(".env.local");

const port = Number(process.env.PORT || 4173);
const apiFootballKey = process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || "";
const historyFile = join(root, "data", "prediction-history.json");
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
let firestore = null;
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

async function readHistory() {
  try {
    return JSON.parse(await readFile(historyFile, "utf8"));
  } catch {
    return { records: [] };
  }
}

async function saveHistory(history) {
  await mkdir(join(root, "data"), { recursive: true });
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

async function recordPredictions(type, date, source, items) {
  const history = await readHistory();
  const now = new Date().toISOString();
  const incoming = items.map(item => ({
    id: `${type}:${date}:${item.event.id}`,
    type,
    date,
    source,
    createdAt: now,
    rank: item.rank,
    event: item.event,
    prediction: item.prediction,
    alert: item.alert || null
  }));

  const byId = new Map(history.records.map(record => [record.id, record]));
  for (const record of incoming) {
    byId.set(record.id, { ...byId.get(record.id), ...record });
  }
  history.records = [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  await saveHistory(history);
  await saveSignalsToFirebase(incoming);
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
  const finishedTypes = ["ft", "aet", "aot", "pen", "finished", "afterpen", "canc", "abd", "awd", "wo"];
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
  return ["1h", "2h", "ht", "et", "p", "q1", "q2", "q3", "q4", "ot", "bt", "live", "inprogress"].includes(type)
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

function normalizeApiBasketballGame(item) {
  return {
    id: item.id,
    sport: "basketball",
    startTimestamp: item.timestamp || Math.floor(Date.parse(item.date || "") / 1000),
    tournament: {
      id: item.league?.id,
      name: item.league?.name,
      category: { name: countryPtBr(item.country?.name) },
      season: item.league?.season,
      type: item.league?.type,
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
      description: item.status?.long,
      type: item.status?.short === "NS" ? "notstarted" : item.status?.short,
      clock: item.status?.timer || null
    },
    score: {
      home: item.scores?.home?.total,
      away: item.scores?.away?.total,
      quarters: {
        home: item.scores?.home || null,
        away: item.scores?.away || null
      }
    },
    venue: null,
    source: "api-basketball"
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

function liveMatchGoalAlert(event, prediction) {
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

  if (!isSecondHalfWindow || !isNilNil || fairOdd < 1.6) {
    return null;
  }

  return {
    team: "Partida",
    label: "Partida +0.5 gol ao vivo",
    fairOdd,
    minimumOdd: 1.6,
    probability: Math.round(estimatedProbability * 100),
    minute: elapsed,
    score: `${homeScore} x ${awayScore}`,
    totalGoals,
    reason: "placar 0 x 0 no segundo tempo, buscando o primeiro gol da partida"
  };
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

function evaluateRecord(record, currentEvent) {
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

  if (record.type === "top10") {
    const predicted = predictedWinner(record);
    const actual = matchWinner(score);
    const hit = predicted !== null && predicted === actual;
    return {
      status: "finished",
      hit,
      score: scoreText,
      detail: hit ? "Palpite principal acertou o resultado." : "Palpite principal não bateu com o resultado final."
    };
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

  return { status: "finished", hit: null, score: scoreText, detail: "Tipo de previsão não reconhecido." };
}

function accuracySummary(results) {
  const finished = results.filter(item => item.result.status === "finished" && item.result.hit !== null);
  const hits = finished.filter(item => item.result.hit).length;
  return {
    total: results.length,
    finished: finished.length,
    pending: results.length - finished.length,
    hits,
    misses: finished.length - hits,
    accuracy: finished.length ? Math.round((hits / finished.length) * 100) : 0
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

  const response = await fetch(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  });

  if (!response.ok) {
    throw new Error(`API-Football respondeu ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`API-Football: ${payload.errors.join(", ")}`);
  }
  if (payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length) {
    throw new Error(`API-Football: ${Object.values(payload.errors).join(", ")}`);
  }

  return Array.isArray(payload.response) ? payload.response.map(normalizeApiFootballFixture).filter(event => event.id) : [];
}

async function fetchApiBasketballEvents(date) {
  if (!apiFootballKey) {
    throw new Error("Configure API_FOOTBALL_KEY para usar a API-Basketball gratuita");
  }

  const requestUrl = new URL("https://v1.basketball.api-sports.io/games");
  requestUrl.searchParams.set("date", date);
  requestUrl.searchParams.set("timezone", "America/Sao_Paulo");

  const response = await fetch(requestUrl, {
    headers: {
      "accept": "application/json",
      "x-apisports-key": apiFootballKey
    }
  });

  if (!response.ok) {
    throw new Error(`API-Basketball respondeu ${response.status}`);
  }

  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`API-Basketball: ${payload.errors.join(", ")}`);
  }
  if (payload.errors && typeof payload.errors === "object" && Object.keys(payload.errors).length) {
    throw new Error(`API-Basketball: ${Object.values(payload.errors).join(", ")}`);
  }

  return Array.isArray(payload.response)
    ? payload.response.map(normalizeApiBasketballGame).filter(event => event.id)
    : [];
}

async function fetchApiSportsEvents(date, sport, options = {}) {
  if (sport === "basketball") {
    return fetchApiBasketballEvents(date);
  }
  return fetchApiFootballEvents(date, sport, options);
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

  if (req.method === "GET" && url.pathname === "/api/events") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    const liveOnly = url.searchParams.get("live") === "all";
    try {
      const events = provider === "sofascore"
        ? await fetchSofascoreEvents(date, sport)
        : await fetchApiSportsEvents(date, sport, { liveOnly });
      const source = provider === "sofascore"
        ? provider
        : sport === "basketball" ? "api-basketball" : "api-football";
      json(res, 200, { source, date, sport, liveOnly, events });
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

  if (req.method === "GET" && url.pathname === "/api/top-predictions") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const sport = url.searchParams.get("sport") || "football";
    const provider = url.searchParams.get("provider") || "api-football";
    try {
      const events = provider === "sofascore"
        ? await fetchSofascoreEvents(date, sport)
        : await fetchApiFootballEvents(date, sport);
      const predictions = events
        .map(normalizeEvent)
        .filter(event => !isFinishedEvent(event))
        .map(event => {
          const prediction = predictMatch(event);
          const strongestProbability = Math.max(
            prediction.probabilities.home,
            prediction.probabilities.draw,
            prediction.probabilities.away
          );
          return { event, prediction, rankScore: prediction.confidence * 1.4 + strongestProbability };
        })
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 10)
        .map(({ event, prediction }, index) => ({ rank: index + 1, event, prediction }));

      await recordPredictions("top10", date, provider, predictions);
      json(res, 200, { source: provider, date, sport, predictions });
    } catch (error) {
      const predictions = demoEvents
        .map(normalizeEvent)
        .map(event => ({ event, prediction: predictMatch(event) }))
        .sort((a, b) => b.prediction.confidence - a.prediction.confidence)
        .slice(0, 10)
        .map(({ event, prediction }, index) => ({ rank: index + 1, event, prediction }));

      await recordPredictions("top10", date, "demo", predictions);
      json(res, 200, {
        source: "demo",
        date,
        sport,
        warning: `${error.message}. Mostrando previsões de exemplo para manter o sistema operando.`,
        predictions
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
      const events = provider === "sofascore"
        ? await fetchSofascoreEvents(date, sport)
        : await fetchApiFootballEvents(date, sport, { liveOnly: true });
      const alerts = events
        .map(normalizeEvent)
        .filter(event => isLiveEvent(event) && !isFinishedEvent(event))
        .map(event => {
          const prediction = predictMatch(event);
          const alert = liveMatchGoalAlert(event, prediction);
          return alert ? { event, prediction, alert } : null;
        })
        .filter(Boolean)
        .sort((a, b) => {
          const minuteDiff = b.alert.minute - a.alert.minute;
          return minuteDiff || a.alert.fairOdd - b.alert.fairOdd;
        })
        .map((item, index) => ({ rank: index + 1, ...item }));

      await recordPredictions("match-goal", date, provider, alerts);
      json(res, 200, { source: provider, date, sport, alerts });
    } catch (error) {
      const alerts = demoEvents
        .map(normalizeEvent)
        .map(event => {
          const prediction = predictMatch(event);
          const alert = liveMatchGoalAlert(event, prediction);
          return alert ? { event, prediction, alert } : null;
        })
        .filter(Boolean)
        .map((item, index) => ({ rank: index + 1, ...item }));

      await recordPredictions("match-goal", date, "demo", alerts);
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

  if (req.method === "GET" && url.pathname === "/api/prediction-results") {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const type = url.searchParams.get("type") || "top10";
    const sport = url.searchParams.get("sport") || "football";
    const history = await readHistory();
    const records = history.records
      .filter(record => record.date === date && record.type === type)
      .sort((a, b) => (a.rank || 999) - (b.rank || 999));

    try {
      const events = await fetchApiFootballEvents(date, sport);
      const eventsById = new Map(events.map(event => [String(event.id), event]));
      const results = records.map(record => {
        const currentEvent = eventsById.get(String(record.event.id)) || record.event;
        return {
          record,
          event: currentEvent,
          result: evaluateRecord(record, currentEvent)
        };
      });
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  await serveStatic(req, res, url);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sistema de analise rodando em http://127.0.0.1:${port}`);
});
