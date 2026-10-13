import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { authorizedScheduler } from './schedulerAuth.js';

test('scheduler verifies signature, issuer, audience, repository, workflow and branch',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const base={repository:'alysson0111/Futebol',repository_id:'1267531610',repository_owner_id:'264236450',ref:'refs/heads/main',workflow_ref:'alysson0111/Futebol/.github/workflows/telegram-signals.yml@refs/heads/main',event_name:'schedule',runner_environment:'github-hosted'};
  const sign=(patch={},aud='https://futebol-jet.vercel.app',expiry='5m')=>new SignJWT({...base,...patch}).setProtectedHeader({alg:'RS256'}).setIssuer('https://token.actions.githubusercontent.com').setAudience(aud).setSubject('repo:alysson0111/Futebol:ref:refs/heads/main').setIssuedAt().setJti('test-only').setExpirationTime(expiry).sign(privateKey);
  const request=token=>({headers:{authorization:`Bearer ${token}`}});
  assert.equal(await authorizedScheduler(request(await sign()),publicKey),true);
  for(const patch of [{repository_id:'other'},{repository_owner_id:'other'},{ref:'refs/heads/other'},{workflow_ref:'alysson0111/Futebol/.github/workflows/other.yml@refs/heads/main'},{event_name:'pull_request'},{runner_environment:'self-hosted'}])assert.equal(await authorizedScheduler(request(await sign(patch)),publicKey),false);
  assert.equal(await authorizedScheduler(request(await sign({},'https://other.test')),publicKey),false);
  assert.equal(await authorizedScheduler(request(await sign({},undefined,'-1m')),publicKey),false);
  const other=await generateKeyPair('RS256');
  assert.equal(await authorizedScheduler(request(await sign()),other.publicKey),false);
  assert.equal(await authorizedScheduler(request('malformed'),publicKey),false);
});
