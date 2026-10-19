import test from 'node:test';
import assert from 'node:assert/strict';
import { entryMinute, isEntryTimingAllowed, enforceEntryTiming, isScoreTied, isEntryAllowed } from './entryTiming.js';
import { analisarMercado } from './index.js';
import { analyzeFixtures, publicGame } from '../../api/_lib/scanner.js';
import signalsHandler from '../../api/signals.js';

function fixture(minute, status = 'LIVE', goals = {home:0,away:0}) {
  return { fixture:{id:1,date:'2026-10-13T12:00:00-03:00',status:{short:status,elapsed:minute}},teams:{home:{name:'Casa'},away:{name:'Fora'}},league:{name:'Liga'},goals,source:'TotalCorner',totalCorner:{},goalLine:3,handicapLine:-1,
    liveStats:[{statistics:[{type:'Corner Kicks',value:4}]},{statistics:[{type:'Corner Kicks',value:3}]}] };
}

test('Over 0.5 starts at 65 while ML still starts at 43', () => {
  for (const minute of [0,15,42,43,44,60,64,65,66]) {
    const games=analyzeFixtures({response:[fixture(minute)]});
    for (const market of ['over05','ml']) {
      const game=games.find(game=>game.market===market);
      const approved=minute>=(market==='over05'?65:43);
      assert.equal(game.status,approved?'Entrada':'Observar',`${market} at ${minute}`);
      assert.equal(game.generatedSignals.length>0,approved);
      assert.equal(analisarMercado(publicGame(game)).entrada,approved);
      assert.equal(publicGame(game).elapsed,minute);
    }
  }
});

test('timing never bypasses the 0x0 requirement, the Over 0.5 cutoff or a final status', () => {
  assert.equal(analyzeFixtures({response:[fixture(65,'LIVE',{home:1,away:0})]}).find(x=>x.market==='over05').status,'Observar');
  assert.equal(analyzeFixtures({response:[fixture(70)]}).find(x=>x.market==='over05').status,'Entrada');
  assert.equal(analyzeFixtures({response:[fixture(71)]}).find(x=>x.market==='over05').status,'Observar');
  for (const status of ['FT','NS','CANC','PST','SUSP','ABD']) {
    for (const market of ['over05','ml']) assert.equal(isEntryTimingAllowed({market,apiStatus:status,elapsed:90}),false);
  }
});

test('missing minutes fail closed; halftime and stoppage time have confirmed minutes', () => {
  for (const market of ['over05','ml']) {
    assert.equal(isEntryTimingAllowed({market,liveStatus:'LIVE'}),false);
    assert.equal(isEntryTimingAllowed({market,liveStatus:"42'"}),false);
    assert.equal(isEntryTimingAllowed({market,liveStatus:"43'"}),market==='ml');
    assert.equal(isEntryTimingAllowed({market,liveStatus:'HT'}),market==='ml');
    assert.equal(isEntryTimingAllowed({market,liveStatus:"45 + 2'"}),market==='ml');
    assert.equal(isEntryTimingAllowed({market,liveStatus:"64'"}),market==='ml');
    assert.equal(isEntryTimingAllowed({market,liveStatus:"65'"}),true);
    assert.equal(isEntryTimingAllowed({market,liveStatus:'Pre-jogo',elapsed:50}),false);
  }
  assert.equal(entryMinute({liveStatus:"45+2'"}),47);
});

test('Forebet and client-side approval cannot restore an early entry; other markets are unchanged', () => {
  for (const market of ['over05','ml']) {
    const early={market,status:'Entrada',confidence:90,liveStatus:market==='over05'?"64'":"42'",scoreText:'0x0',signals:['Previsao'],stats:[]};
    assert.equal(enforceEntryTiming(early).status,'Observar');
    assert.deepEqual(enforceEntryTiming(early).signals,[]);
    assert.equal(analisarMercado(early).entrada,false);
    assert.equal(enforceEntryTiming({...early,liveStatus:market==='over05'?"65'":"43'"}).status,'Entrada');
  }
  for (const market of ['over15','over25','under25','under35','corners','handicap']) {
    const game={market,status:'Entrada',liveStatus:"20'"};
    assert.equal(enforceEntryTiming(game),game);
    assert.equal(analisarMercado(game).entrada,true);
  }
});

test('ML accepts every tied score from 43 minutes and rejects either team leading', () => {
  for (const [home,away] of [[0,0],[1,1],[2,2],[3,3],[1,0],[0,1],[2,1],[1,2]]) {
    const game=analyzeFixtures({response:[fixture(43,'LIVE',{home,away})]}).find(game=>game.market==='ml');
    assert.equal(game.status,home===away?'Entrada':'Observar');
    assert.equal(game.generatedSignals.length>0,home===away);
    assert.equal(analisarMercado(publicGame(game)).entrada,home===away);
    assert.ok(game.scannerChecks.some(check=>check.label==='Placar empatado para ML'&&check.passed===(home===away)));
  }
  assert.equal(isEntryAllowed({market:'ml',liveStatus:"42'",scoreText:'1x1'}),false);
  assert.equal(isEntryAllowed({market:'ml',liveStatus:"43'",scoreText:'1x1'}),true);
});

test('ML score checks fail closed and cannot be bypassed by Forebet or cached approval', () => {
  for (const scoreText of [undefined,'','-','1x0','0x1','2x1','-1x-1','1.5x1.5']) {
    const game={market:'ml',liveStatus:"60'",status:'Entrada',scoreText,signals:['ML Casa']};
    assert.equal(isScoreTied(game),false);
    assert.equal(enforceEntryTiming(game).status,'Observar');
    assert.equal(analisarMercado(game).entrada,false);
  }
  assert.equal(isScoreTied({goals:{home:2,away:2}}),true);
  assert.equal(isScoreTied({goals:{home:null,away:null}}),false);
  assert.equal(isScoreTied({scoreText:'0x0',homeGoals:1,awayGoals:0}),false);
  assert.equal(isEntryAllowed({market:'over25',liveStatus:"60'",scoreText:'2x1'}),true);
});

test('save API refuses ML with a leading team or missing score without touching Firebase', async () => {
  for (const scoreText of ['1x0','0x1','2x1',undefined]) {
    let body;
    const res={setHeader(){},end(value){body=JSON.parse(value);}};
    await signalsHandler({method:'POST',body:{market:'ml',status:'Entrada',liveStatus:"60'",scoreText,sendTelegram:true}},res);
    assert.equal(res.statusCode,409);
    assert.match(body.error,/placar empatado/);
  }
  const res={setHeader(){},end(){}};
  await signalsHandler({method:'POST',body:{market:'over25',analise:{mercado:'ml',entrada:true},liveStatus:"60'",scoreText:'1x0'}},res);
  assert.equal(res.statusCode,409);
});

test('save API rejects premature or unknown-minute entries before consulting Firebase or Telegram', async () => {
  for (const market of ['over05','ml']) {
    for (const liveStatus of (market==='over05'?["42'","43'","60'","64'",'NS','LIVE']:["42'",'NS','LIVE'])) {
      let body;
      const res={setHeader(){},end(value){body=JSON.parse(value);}};
      await signalsHandler({method:'POST',body:{market,status:'Entrada',liveStatus,sendTelegram:true}},res);
      assert.equal(res.statusCode,409);
      assert.ok(body.error.includes(`${market==='over05'?65:43} minutos`));
    }
  }
});
