import { createRemoteJWKSet, jwtVerify } from 'jose';
const issuer='https://token.actions.githubusercontent.com';
const keys=createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`),{timeoutDuration:5000});
const repo='alysson0111/Futebol';
const subjects=[`repo:${repo}:ref:refs/heads/main`,'repo:alysson0111@264236450/Futebol@1267531610:ref:refs/heads/main'];

export async function authorizedScheduler(req, keySet=keys) {
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token||token.length>16000||token.split('.').length!==3)return false;
  try {
    const {payload}=await jwtVerify(token,keySet,{
      issuer,audience:process.env.AUTOMATION_AUDIENCE||'https://futebol-jet.vercel.app',
      algorithms:['RS256'],maxTokenAge:'10m',clockTolerance:5,
      requiredClaims:['exp','iat','sub','jti','repository_id','repository_owner_id','workflow_ref']
    });
    return payload.repository===repo && payload.repository_id==='1267531610' && payload.repository_owner_id==='264236450'
      && subjects.includes(payload.sub) && payload.ref==='refs/heads/main'
      && payload.workflow_ref===`${repo}/.github/workflows/telegram-signals.yml@refs/heads/main`
      && ['schedule','workflow_dispatch','push'].includes(payload.event_name)
      && payload.runner_environment==='github-hosted';
  } catch {return false;}
}
