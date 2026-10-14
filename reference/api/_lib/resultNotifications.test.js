import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueResult,processResultNotifications} from './resultNotifications.js';
import {deliverResult,resultMessage} from './telegram.js';
import {runNotificationAutomation} from './automation.js';
import server from '../../../reference-server.mjs';

function fakeDb() {
  const records=new Map();let queue=Promise.resolve();
  const db={records,collection:name=>({doc:id=>{
    const key=`${name}/${id}`;
    return {id,key,get:async()=>({exists:records.has(key),data:()=>records.get(key)})};
  }})};
  db.runTransaction=callback=>{
    const run=queue.then(()=>callback({get:ref=>ref.get(),getAll:(...refs)=>Promise.all(refs.map(ref=>ref.get())),
      set:(ref,data)=>records.set(ref.key,{...records.get(ref.key),...data}),update:(ref,data)=>records.set(ref.key,{...records.get(ref.key),...data})}));
    queue=run.catch(()=>{});return run;
  };
  return db;
}
const signal=(extra={})=>({home:'Casa',away:'Fora',market:'over25',marketLabel:'+2.5 gols',signalLines:['Over 2.5 gols'],finalScoreText:'2x1',result:'green',settlementFactor:1,finalConfirmed:true,telegram:{status:'enviado',messageId:123,chatId:'-100456'},...extra});
function seed(db,id='a',record=signal()) {
  db.records.set(`central_sinais/${id}`,record);
  db.records.set(`central_telegram_results/${id}`,{status:'pendente',attempts:0,nextAttemptAt:0});
}
const readPage=db=>async()=>{
  const docs=[...db.records].filter(([key,value])=>key.startsWith('central_telegram_results/')&&value.status==='pendente').map(([key,value])=>({id:key.split('/')[1],data:()=>value}));
  return {size:docs.length,docs};
};

test('result text distinguishes full and partial wins, losses and refunds',()=>{
  assert.match(resultMessage(signal()),/RESULTADO: GREEN/);
  assert.match(resultMessage(signal({result:'red'})),/RESULTADO: RED/);
  assert.match(resultMessage(signal({result:'push'})),/RESULTADO: REEMBOLSO/);
  assert.match(resultMessage(signal({settlementFactor:0.5})),/GREEN PARCIAL/);
  assert.match(resultMessage(signal({result:'red',settlementFactor:0.5})),/RED PARCIAL/);
  assert.match(resultMessage(signal({market:'corners',liveCorners:11})),/Escanteios: 11/);
});

test('result delivery edits the original message without replying or creating another message',async()=>{
  const fetchBefore=globalThis.fetch,tokenBefore=process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN='test-only';
  try {
    globalThis.fetch=async(url,options)=>{
      assert.ok(url.endsWith('/editMessageText'));
      const body=JSON.parse(options.body);
      assert.equal(body.chat_id,'-100456');
      assert.equal(body.message_id,123);
      assert.equal(body.reply_parameters,undefined);
      assert.match(body.text,/Placar final: 2x1/);
      return {ok:true,status:200,json:async()=>({ok:true,result:{message_id:123}})};
    };
    assert.equal((await deliverResult(signal())).messageId,123);
    assert.equal((await deliverResult(signal({finalConfirmed:false}))).status,'ignorado');
    assert.equal((await deliverResult(signal({telegram:{status:'falhou'}}))).status,'ignorado');
    globalThis.fetch=async()=>({ok:false,status:429,json:async()=>({ok:false,error_code:429,parameters:{retry_after:120}})});
    assert.equal((await deliverResult(signal())).retryAfter,120);
    globalThis.fetch=async()=>{throw new Error('timeout with test-only secret');};
    const uncertain=await deliverResult(signal());
    assert.equal(uncertain.status,'pendente');assert.doesNotMatch(JSON.stringify(uncertain),/test-only/);
    globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({ok:false,error_code:400,description:'Bad Request: message is not modified'})});
    assert.equal((await deliverResult(signal())).status,'enviado');
    globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({ok:false,error_code:400,description:'message to edit not found'})});
    assert.equal((await deliverResult(signal())).status,'falhou');
  } finally {globalThis.fetch=fetchBefore;if(tokenBefore===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=tokenBefore;}
});

test('editing preserves the entry text, confidence, entry score and minute',()=>{
  const original='SINAL ORIGINAL\nConfiabilidade: 80%\nPlacar: 0x0 | Minuto: 43\nData: 14/10/2026';
  const text=resultMessage(signal({telegram:{text:original}}));
  assert.ok(text.startsWith(original+'\n\nRESULTADO: GREEN'));
  assert.match(text,/Placar final: 2x1/);
  const legacy=resultMessage(signal({confidence:80,entryScoreText:'0x0',entryLiveStatus:"43'"}));
  assert.match(legacy,/Confiabilidade do scanner: 80%/);
  assert.match(legacy,/Placar: 0x0 \| Minuto: 43'/);
});

test('enqueue only a newly confirmed result of an actually delivered entry',async()=>{
  const db=fakeDb(),entry=signal({finalConfirmed:false,result:'pendente'});
  await db.runTransaction(tx=>{
    assert.equal(enqueueResult(tx,db,'a',entry,{finalConfirmed:true,result:'green'}),true);
    assert.equal(enqueueResult(tx,db,'b',signal(),{finalConfirmed:true,result:'green'}),false);
    assert.equal(enqueueResult(tx,db,'c',{...entry,telegram:{status:'desativado'}},{finalConfirmed:true,result:'green'}),false);
  });
  assert.equal(db.records.get('central_telegram_results/a').status,'pendente');
  assert.equal(db.records.has('central_telegram_results/b'),false);
});

test('concurrent workers notify once and finished queue records never resend',async()=>{
  const db=fakeDb();seed(db);let sends=0;
  const options={readPage:readPage(db),deliver:async()=>{sends++;return {status:'enviado',messageId:456};}};
  await Promise.all([processResultNotifications(db,options),processResultNotifications(db,options)]);
  await processResultNotifications(db,options);
  assert.equal(sends,1);
  assert.equal(db.records.get('central_sinais/a').telegramResult.messageId,456);
});

test('explicit rejection retries later, while uncertain sends are never retried blindly',async()=>{
  const db=fakeDb();seed(db);let current=1000,sends=0;
  const options={readPage:readPage(db),time:()=>current,deliver:async()=>{sends++;return sends===1?{status:'falhou',retryAfter:300}:{status:'enviado',messageId:456};}};
  await processResultNotifications(db,options);
  await processResultNotifications(db,options);assert.equal(sends,1);
  current+=300001;await processResultNotifications(db,options);assert.equal(sends,2);
  seed(db,'b');
  const uncertain={readPage:readPage(db),deliver:async()=>({status:'incerto'})};
  await processResultNotifications(db,uncertain);await processResultNotifications(db,uncertain);
  assert.equal(db.records.get('central_telegram_results/b').status,'incerto');
});

test('worker skips deleted or unconfirmed signals and still works when new entries are disabled',async()=>{
  const db=fakeDb();seed(db,'a',signal({finalConfirmed:false}));seed(db,'b');db.records.delete('central_sinais/b');seed(db,'c');
  db.records.set('central_config/telegram',{enabled:false,markets:[]});
  let sends=0;
  const result=await runNotificationAutomation(db,{readPage:readPage(db),deliver:async()=>{sends++;return {status:'enviado'};}});
  assert.equal(result.sent,1);assert.equal(sends,1);
  assert.equal(db.records.get('central_jobs/telegram-results').leaseUntil,0);
});

test('notifications endpoint rejects scanner credentials and unauthenticated callers',async()=>{
  const old=process.env.SCANNER_ACCESS_TOKEN,auto=process.env.AUTOMATION_TOKEN;
  process.env.SCANNER_ACCESS_TOKEN='scanner';process.env.AUTOMATION_TOKEN='scheduler';
  try {
    for(const headers of [{},{authorization:'Bearer scanner'}]){
      const res={setHeader(){},end(){}};
      await server({method:'POST',url:'/api/automation/notify-results',headers},res);
      assert.equal(res.statusCode,401);
    }
  }finally{if(old===undefined)delete process.env.SCANNER_ACCESS_TOKEN;else process.env.SCANNER_ACCESS_TOKEN=old;if(auto===undefined)delete process.env.AUTOMATION_TOKEN;else process.env.AUTOMATION_TOKEN=auto;}
});
