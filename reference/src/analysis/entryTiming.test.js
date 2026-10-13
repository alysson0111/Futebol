import test from 'node:test';
import assert from 'node:assert/strict';
import { entryMinute, isEntryTimingAllowed, enforceEntryTiming } from './entryTiming.js';
import { analisarMercado } from './index.js';
import { analyzeFixtures, publicGame } from '../../api/_lib/scanner.js';
import signalsHandler from '../../api/signals.js';

function fixture(minute, status = 'LIVE', goals = {home:0,away:0}) {
  return { fixture:{id:1,date:'2026-10-13T12:00:00-03:00',status:{short:status,elapsed:minute}},teams:{home:{name:'Casa'},away:{name:'Fora'}},league:{name:'Liga'},goals,source:'TotalCorner',totalCorner:{},goalLine:3,handicapLine:-1,
    liveStats:[{statistics:[{type:'Corner Kicks',value:4}]},{statistics:[{type:'Corner Kicks',value:3}]}] };
}

test('Over 0.5 and ML are blocked before 43 and approved at 43 when their other criteria pass', () => {
  for (const minute of [0,15,42,43,44,60]) {
    const games=analyzeFixtures({response:[fixture(minute)]});
    for (const market of ['over05','ml']) {
      const game=games.find(game=>game.market===market);
      assert.equal(game.status,minute>=43?'Entrada':'Observar',`${market} at ${minute}`);
      assert.equal(game.generatedSignals.length>0,minute>=43);
      assert.equal(analisarMercado(publicGame(game)).entrada,minute>=43);
      assert.equal(publicGame(game).elapsed,minute);
    }
  }
});

test('timing never bypasses the 0x0 requirement, the Over 0.5 cutoff or a final status', () => {
  assert.equal(analyzeFixtures({response:[fixture(43,'LIVE',{home:1,away:0})]}).find(x=>x.market==='over05').status,'Observar');
  assert.equal(analyzeFixtures({response:[fixture(71)]}).find(x=>x.market==='over05').status,'Observar');
  for (const status of ['FT','NS','CANC','PST','SUSP','ABD']) {
    for (const market of ['over05','ml']) assert.equal(isEntryTimingAllowed({market,apiStatus:status,elapsed:90}),false);
  }
});

test('missing minutes fail closed; halftime and stoppage time have confirmed minutes', () => {
  for (const market of ['over05','ml']) {
    assert.equal(isEntryTimingAllowed({market,liveStatus:'LIVE'}),false);
    assert.equal(isEntryTimingAllowed({market,liveStatus:"42'"}),false);
    assert.equal(isEntryTimingAllowed({market,liveStatus:"43'"}),true);
    assert.equal(isEntryTimingAllowed({market,liveStatus:'HT'}),true);
    assert.equal(isEntryTimingAllowed({market,liveStatus:"45 + 2'"}),true);
    assert.equal(isEntryTimingAllowed({market,liveStatus:'Pre-jogo',elapsed:50}),false);
  }
  assert.equal(entryMinute({liveStatus:"45+2'"}),47);
});

test('Forebet and client-side approval cannot restore an early entry; other markets are unchanged', () => {
  for (const market of ['over05','ml']) {
    const early={market,status:'Entrada',confidence:90,liveStatus:"42'",signals:['Previsao'],stats:[]};
    assert.equal(enforceEntryTiming(early).status,'Observar');
    assert.deepEqual(enforceEntryTiming(early).signals,[]);
    assert.equal(analisarMercado(early).entrada,false);
    assert.equal(enforceEntryTiming({...early,liveStatus:"43'"}).status,'Entrada');
  }
  for (const market of ['over15','over25','under25','under35','corners','handicap']) {
    const game={market,status:'Entrada',liveStatus:"20'"};
    assert.equal(enforceEntryTiming(game),game);
    assert.equal(analisarMercado(game).entrada,true);
  }
});

test('save API rejects premature or unknown-minute entries before consulting Firebase or Telegram', async () => {
  for (const market of ['over05','ml']) {
    for (const liveStatus of ["42'",'NS','LIVE']) {
      let body;
      const res={setHeader(){},end(value){body=JSON.parse(value);}};
      await signalsHandler({method:'POST',body:{market,status:'Entrada',liveStatus,sendTelegram:true}},res);
      assert.equal(res.statusCode,409);
      assert.match(body.error,/43 minutos/);
    }
  }
});
