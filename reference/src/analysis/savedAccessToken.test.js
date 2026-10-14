import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSavedAccessToken,persistAccessToken} from './savedAccessToken.js';

function storage(){const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}

test('tokens are saved only with explicit opt-in and restored after a reload',()=>{
  const store=storage();
  assert.deepEqual(loadSavedAccessToken(store),{token:'',remember:false});
  persistAccessToken(store,'test-credential',false);assert.equal(store.values.size,0);
  persistAccessToken(store,'test-credential',true);
  assert.deepEqual(loadSavedAccessToken(store),{token:'test-credential',remember:true});
  persistAccessToken(store,'updated-test',true);assert.equal(loadSavedAccessToken(store).token,'updated-test');
});

test('unchecking remember or clearing the input removes the saved token',()=>{
  const store=storage();persistAccessToken(store,'test',true);
  persistAccessToken(store,'test',false);assert.equal(store.values.size,0);
  persistAccessToken(store,'test',true);persistAccessToken(store,'',true);assert.equal(store.values.size,0);
});

test('malformed, unapproved and unavailable storage never restores a credential',()=>{
  for(const value of ['invalid','{"token":"test","remember":false}','{"remember":true,"token":42}'])assert.deepEqual(loadSavedAccessToken({getItem:()=>value}),{token:'',remember:false});
  assert.deepEqual(loadSavedAccessToken({getItem(){throw new Error('blocked');}}),{token:'',remember:false});
  assert.throws(()=>persistAccessToken({setItem(){throw new Error('blocked');}},'test',true),/blocked/);
});
