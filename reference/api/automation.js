import { getDb } from './_lib/firebase.js';
import { readAutomationSettings, writeAutomationSettings, runAutomation, runResultAutomation } from './_lib/automation.js';
const send = (res,status,body) => {res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
export default async function handler(req,res) {
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if (path.endsWith('/settings')) {
      if(req.method==='GET')return send(res,200,await readAutomationSettings(getDb()));
      if(req.method==='POST')return send(res,200,await writeAutomationSettings(getDb(),req.body || {}));
    }
    if(path.endsWith('/run')&&req.method==='POST')return send(res,200,await runAutomation(getDb()));
    if(path.endsWith('/results')&&req.method==='POST')return send(res,200,await runResultAutomation(getDb()));
    return send(res,405,{error:'Metodo nao permitido.'});
  } catch(error) {
    send(res,error.status||503,{error:error.message||'Automacao indisponivel. Nenhum resultado foi inventado.'});
  }
}
