import {now} from './firebase.js';
import {deliverResult} from './telegram.js';

const queueName='central_telegram_results';
export function enqueueResult(transaction,db,id,signal,update) {
  if(!update.finalConfirmed||!['green','red','push'].includes(update.result)||signal.finalConfirmed||signal.telegram?.status!=='enviado'||!Number.isInteger(signal.telegram.messageId))return false;
  transaction.set(db.collection(queueName).doc(id),{signalId:id,status:'pendente',attempts:0,nextAttemptAt:0,createdAt:now()});
  transaction.update(db.collection('central_sinais').doc(id),{telegramResult:{status:'pendente'}});
  return true;
}

export async function processResultNotifications(db,{cursor='',deliver=deliverResult,readPage,time=()=>Date.now()}={}) {
  const started=time();
  async function page(after) {
    let query=db.collection(queueName).where('status','==','pendente').orderBy('__name__').limit(100);
    if(after)query=query.startAfter(after);
    return query.get();
  }
  let snapshot=await (readPage||page)(cursor);
  if(!snapshot.size&&cursor)snapshot=await (readPage||page)('');
  const summary={sent:0,failed:0,uncertain:0,deferred:0,checked:0,nextCursor:''};
  for(const item of snapshot.docs) {
    if(time()-started>35000||summary.checked>=20){summary.deferred++;break;}
    summary.nextCursor=item.id;
    const queueRef=db.collection(queueName).doc(item.id),signalRef=db.collection('central_sinais').doc(item.id);
    const record=await db.runTransaction(async tx=>{
      const [queue,signal]=await tx.getAll(queueRef,signalRef);
      const job=queue.data(),data=signal.exists?signal.data():null;
      if(!queue.exists||job.status!=='pendente'||Number(job.nextAttemptAt)>time())return null;
      if(!data?.finalConfirmed||!['green','red','push'].includes(data.result)||data.telegram?.status!=='enviado'||!Number.isInteger(data.telegram.messageId)){
        tx.update(queueRef,{status:'ignorado',updatedAt:now()});return null;
      }
      tx.update(queueRef,{status:'enviando',attempts:Number(job.attempts||0)+1,startedAt:time(),updatedAt:now()});
      tx.update(signalRef,{telegramResult:{status:'enviando'},updatedAt:now()});
      return data;
    });
    if(!record)continue;
    summary.checked++;
    let delivery;
    try {delivery=await deliver(record);}catch{delivery={status:'incerto',error:'Envio sem confirmacao; confira o chat.'};}
    const retry=delivery.status==='pendente'||delivery.status==='falhou';
    await db.runTransaction(async tx=>{
      const [queue,signal]=await tx.getAll(queueRef,signalRef);
      if(queue.data()?.status!=='enviando')return;
      tx.update(queueRef,{...delivery,status:retry?'pendente':delivery.status,nextAttemptAt:retry?time()+Math.max(60,Number(delivery.retryAfter)||300)*1000:0,updatedAt:now()});
      if(signal.exists)tx.update(signalRef,{telegramResult:delivery,updatedAt:now()});
    });
    if(delivery.status==='enviado')summary.sent++;
    else if(delivery.status==='incerto')summary.uncertain++;
    else summary.failed++;
  }
  if(snapshot.size<100&&summary.nextCursor===snapshot.docs.at(-1)?.id)summary.nextCursor='';
  return summary;
}
