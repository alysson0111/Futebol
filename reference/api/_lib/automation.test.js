import test from 'node:test';
import assert from 'node:assert/strict';
import { readAutomationSettings, writeAutomationSettings, runAutomation, runResultAutomation, selectAutomationEntries, claimAutomationRun } from './automation.js';
import { persistApprovedSignal, settleSignalsFromTotalCorner } from '../signals.js';
import server from '../../../reference-server.mjs';

function fakeDb(settings={enabled:true,markets:['over05','ml']}) {
  const records = new Map(settings?[['central_config/telegram',settings]]:[]);
  let queue=Promise.resolve();
  const db={records,collection:collection=>({doc:id=>{
    const key=`${collection}/${id}`;
    return {id,key,get:async()=>({exists:records.has(key),data:()=>records.get(key)}),set:async(data)=>records.set(key,{...records.get(key),...data}),update:async(data)=>records.set(key,{...records.get(key),...data})};
  }}),getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get()))};
  db.runTransaction = callback => {
    const run = queue.then(()=>callback({get:ref=>ref.get(),getAll:(...refs)=>db.getAll(...refs),update:(ref,data)=>records.set(ref.key,{...records.get(ref.key),...data}),set:(ref,data)=>records.set(ref.key,{...records.get(ref.key),...data})}));
    queue=run.catch(()=>{});
    return run;
  };
  return db;
}
const game = (market='over05',minute=43,key=`a-${market}`)=>({key,market,marketLabel:market,sourceId:'a',home:'Casa',away:'Fora',league:'Liga',dateText:'13/10/2026',status:'Entrada',confidence:80,liveStatus:`${minute}'`,apiStatus:'LIVE',scoreText:'0x0',signals:market==='ml'?['ML Casa (Casa)']:['Over 0.5 gols'],mlPick:'home'});
const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});

test('results run independently of Telegram preferences and rotate pending pages',async()=>{
  const db=fakeDb({enabled:false,markets:[]});
  const result=await runResultAutomation(db,{
    readPending:async(_db,cursor)=>{assert.equal(cursor,'');return {signals:[game()],nextCursor:'next-id'};},
    settle:async(_db,signals,cursor)=>{assert.equal(signals.length,1);assert.equal(cursor,0);return {settlement:{updated:1,nextCursor:2,errors:[]}};}
  });
  assert.equal(result.updated,1);
  assert.equal(result.status,'complete');
  assert.equal(db.records.get('central_jobs/results').pendingCursor,'next-id');
  assert.equal(db.records.get('central_jobs/results').leaseUntil,0);
  assert.equal(db.records.has('central_jobs/telegram'),false);
});

test('results source failure releases its lease without advancing the cursor',async()=>{
  const db=fakeDb();
  await assert.rejects(runResultAutomation(db,{readPending:async()=>{throw new Error('source failed');}}),/source failed/);
  assert.equal(db.records.get('central_jobs/results').leaseUntil,0);
  assert.equal(db.records.get('central_jobs/results').pendingCursor,'');
});

test('mixed-date pages are not advanced until every date has been attempted',async()=>{
  const db=fakeDb(),seen=new Set();
  const signals=Array.from({length:7},(_,index)=>({...game(),dateText:`${String(index+10).padStart(2,'0')}/10/2026`}));
  for(let round=0;round<4;round++){
    const result=await runResultAutomation(db,{
      readPending:async(_db,cursor)=>{assert.equal(cursor,'');return {signals,nextCursor:'next-page'};},
      settle:async(_db,_signals,_cursor,options)=>{assert.ok(options.dates.length<=2);options.dates.forEach(date=>{assert.equal(seen.has(date),false);seen.add(date);});return {settlement:{updated:0,errors:[],pendingChecked:options.dates.length}};}
    });
    assert.ok(result.pendingChecked<=2);
    const job=db.records.get('central_jobs/results');
    assert.equal(job.pendingCursor,round<3?'':'next-page');
    job.lastStartedAtMs=Date.now()-300001;
  }
  assert.equal(seen.size,7);
});

test('settlement reports only signals whose dates were actually queried',async()=>{
  const signals=Array.from({length:100},(_,index)=>({...game(),id:`test-${index}`,result:'pendente',dateText:index<23?'14/10/2026':'13/10/2026'}));
  const result=await settleSignalsFromTotalCorner(fakeDb(),signals,0,{dates:['2026-10-14'],fetchGames:async()=>[]});
  assert.equal(result.settlement.pendingChecked,23);
  assert.equal(result.settlement.pendingDeferred,77);
});

test('warm recovery can finish several mixed-date checks within the same execution',async()=>{
  const db=fakeDb(),seen=new Set();
  const signals=Array.from({length:7},(_,index)=>({...game(),dateText:`${String(index+10).padStart(2,'0')}/10/2026`}));
  const result=await runResultAutomation(db,{maxPasses:6,
    readPending:async()=>({signals,nextCursor:''}),
    settle:async(_db,_signals,_cursor,{dates,deadline})=>{assert.ok(deadline>Date.now());dates.forEach(date=>seen.add(date));return {settlement:{updated:0,errors:[],pendingChecked:dates.length}};}
  });
  assert.equal(seen.size,7);assert.equal(result.passes,4);assert.equal(result.pendingChecked,7);
  assert.equal(result.pageDatesRemaining,0);
});

test('confirmed recovery preserves results changed concurrently and commits only pending signals',async()=>{
  const db=fakeDb();
  const pending={...game(),id:'pending',result:'pendente',telegram:{status:'enviado',messageId:123}};
  const manual={...pending,id:'manual'};
  db.records.set('central_sinais/pending',pending);
  db.records.set('central_sinais/manual',{...manual,result:'red',finalConfirmed:true});
  const final={...game(),apiStatus:'FT',scoreText:'1x0'};
  const result=await settleSignalsFromTotalCorner(db,[pending,manual],0,{fetchGames:async()=>[final]});
  assert.equal(result.settlement.updated,1);
  assert.equal(db.records.get('central_sinais/pending').result,'green');
  assert.equal(db.records.get('central_sinais/manual').result,'red');
  assert.equal(db.records.get('central_telegram_results/pending').status,'pendente');
  assert.equal(db.records.has('central_telegram_results/manual'),false);
});

test('settings default disabled and validate every selected market',async()=>{
  const db=fakeDb(null);
  assert.deepEqual(await readAutomationSettings(db),{configured:false,enabled:false,markets:[]});
  await assert.rejects(writeAutomationSettings(db,{enabled:true,markets:['unknown']}),/validos/);
  await writeAutomationSettings(db,{enabled:true,markets:['ml','over05','ml']});
  assert.deepEqual((await readAutomationSettings(db)).markets,['over05','ml']);
});

test('worker uses only enabled markets, confirmed timing, approved and unfinished entries',()=>{
  const entries=selectAutomationEntries([game('over05',42),game('ml',42),game('over05'),game('ml'),game('over25'),{...game('ml',50,'final'),apiStatus:'FT'},{...game('ml',50,'wait'),status:'Observar'},game()],['over05','ml']);
  assert.deepEqual(entries.map(x=>x.market),['over05','ml']);
});

test('disabled automation does not read a source or send a message',async()=>{
  const db=fakeDb({enabled:false,markets:['over05']});
  const result=await runAutomation(db,{fetchGames:()=>{throw new Error('must not fetch');},deliver:()=>{throw new Error('must not send');}});
  assert.equal(result.status,'disabled');
  assert.equal(db.records.has('central_jobs/telegram'),false);
});

test('background ML selects only ties, never already-approved non-tied or unknown scores',()=>{
  const entries=selectAutomationEntries([
    {...game('ml',60,'tied'),scoreText:'2x2'},
    {...game('ml',60,'home-leads'),scoreText:'1x0'},
    {...game('ml',60,'away-leads'),scoreText:'0x1'},
    {...game('ml',60,'missing'),scoreText:undefined}
  ],['ml']);
  assert.deepEqual(entries.map(entry=>entry.key),['tied']);
});

test('hundred-signal pages rotate so large lists do not permanently hide later candidates',()=>{
  const games=Array.from({length:230},(_,index)=>game('over05',43,`game-${index}`));
  let cursor=0;
  const seen=new Set();
  for(let run=0;run<3;run++) {
    const entries=selectAutomationEntries(games,['over05'],cursor);
    assert.equal(entries.length,100);
    entries.forEach(entry=>seen.add(entry.key));
    cursor=entries.nextOffset;
  }
  assert.equal(seen.size,230);
});

test('worker runs without a browser, persists before sending and never resends old signals',async()=>{
  const db=fakeDb();
  let sent=0;
  const options={fetchGames:async()=>[game('over05'),game('ml'),game('over25')],deliver:async record=>{
    assert.ok([...db.records.keys()].some(key=>key.startsWith('central_sinais/')));
    sent++;return {status:'enviado'};
  }};
  const first=await runAutomation(db,options);
  assert.equal(first.sent,2);
  assert.equal(first.saved,2);
  assert.equal(db.records.get('central_jobs/telegram').leaseUntil,0);
  db.records.get('central_jobs/telegram').lastStartedAtMs=Date.now()-300001;
  const second=await runAutomation(db,options);
  assert.equal(second.existing,2);
  assert.equal(second.saved,0);
  assert.equal(sent,2);
  const duplicate=await persistApprovedSignal(db,{...game(),sendTelegram:true},options.deliver);
  assert.equal(duplicate.duplicate,true);
  assert.equal(sent,2);
});

test('concurrent workers acquire one lease and pauses take effect before the next signal',async()=>{
  const db=fakeDb();
  const leases=await Promise.all([claimAutomationRun(db),claimAutomationRun(db)]);
  assert.equal(leases.filter(Boolean).length,1);
  db.records.delete('central_jobs/telegram');
  let sent=0;
  const result=await runAutomation(db,{fetchGames:async()=>[game(),game('ml')],deliver:async()=>{
    sent++;await writeAutomationSettings(db,{enabled:false,markets:['over05','ml']});return {status:'enviado'};
  }});
  assert.equal(sent,1);
  assert.equal(result.status,'paused');
  assert.equal(result.deferred,1);
});

test('source failures release the lease, do not generate signals and remain visible as failures',async()=>{
  const db=fakeDb();
  await assert.rejects(runAutomation(db,{fetchGames:async()=>{throw new Error('TotalCorner 401');}}),/401/);
  assert.equal(db.records.get('central_jobs/telegram').status,'failed');
  assert.equal(db.records.get('central_jobs/telegram').leaseUntil,0);
  assert.equal([...db.records.keys()].some(key=>key.startsWith('central_sinais/')),false);
});

test('every settings operation requires scanner auth, and the job requires a separate token',async()=>{
  const previous=process.env.SCANNER_ACCESS_TOKEN,oldAutomation=process.env.AUTOMATION_TOKEN;
  process.env.SCANNER_ACCESS_TOKEN='test-scanner';process.env.AUTOMATION_TOKEN='test-scheduler';
  try {
    for(const method of ['GET','POST']) {
      const res=response();await server({method,url:'/api/automation/settings',headers:{}},res);
      assert.equal(res.statusCode,401);
    }
    const res=response();await server({method:'POST',url:'/api/automation/run',headers:{authorization:'Bearer test-scanner'}},res);
    assert.equal(res.statusCode,401);
    const results=response();await server({method:'POST',url:'/api/automation/results',headers:{authorization:'Bearer test-scanner'}},results);
    assert.equal(results.statusCode,401);
  } finally {
    if(previous===undefined)delete process.env.SCANNER_ACCESS_TOKEN;else process.env.SCANNER_ACCESS_TOKEN=previous;
    if(oldAutomation===undefined)delete process.env.AUTOMATION_TOKEN;else process.env.AUTOMATION_TOKEN=oldAutomation;
  }
});
