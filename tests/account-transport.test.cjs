// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAccountTransport,isTransient}=require('../src/lib/account-transport.cjs');
const {Auth}=require('../src/lib/auth.cjs');
const service='https://api.accounts.firefox.com/v1/account/login';
test('account transport does not use the application proxy or persist Chromium auth sessions',async()=>{
  const events=[];let accept;
  const transport=createAccountTransport({
    createSession:()=>({setProxy:opts=>{events.push(['proxy',opts]);return new Promise(resolve=>{accept=resolve;});},
      fetch:async(url,opts)=>{events.push(['direct',url,opts.method]);return new Response('{}');}}),
    systemFetch:async()=>{events.push(['system']);return new Response('{}');}
  });
  const result=transport(service,{method:'POST',body:'{}'});
  assert.deepEqual(events,[['proxy',{mode:'direct'}]]);
  accept();await result;
  assert.equal(events.length,2);
  assert.equal(events[1][0],'direct');
});
test('transient network failure retries only idempotent account-service reads',async()=>{
  const events=[],reset=Object.assign(new Error('net::ERR_CONNECTION_RESET'),{code:'ERR_CONNECTION_RESET'});
  const transport=createAccountTransport({
    createSession:()=>({setProxy:async()=>{},fetch:async(_url,{method='GET'}={})=>{events.push('isolated:'+method);throw reset;}}),
    systemFetch:async(_url,{method='GET'}={})=>{events.push('default:'+method);return new Response('{}');}
  });
  await transport(service,{method:'GET'});
  assert.deepEqual(events,['isolated:GET','default:GET']);
  await assert.rejects(transport(service,{method:'POST',body:'{}'}),error=>
    error.code==='ACCOUNT_NETWORK_INTERRUPTED'&&/verification requests are never automatically resubmitted/i.test(error.message));
  assert.deepEqual(events,['isolated:GET','default:GET','isolated:POST']);
  assert(isTransient(reset));
});
test('certificate and permanent errors never trigger transport fallback',async()=>{
 let fallback=0;
 const transport=createAccountTransport({
   createSession:()=>({setProxy:async()=>{},fetch:async()=>{throw Error('net::ERR_CERT_AUTHORITY_INVALID');}}),
   systemFetch:async()=>{fallback++;return new Response('{}');}
 });
 await assert.rejects(transport(service),/ERR_CERT_AUTHORITY_INVALID/);
 assert.equal(fallback,0);
 await assert.rejects(transport('http://api.accounts.firefox.com/v1/account/login'),/Unapproved account-service/);
 await assert.rejects(transport('https://not-approved.invalid/path'),/Unapproved account-service/);
});
test('verification code is not re-sent automatically when the network resets',async()=>{
 const session='ab'.repeat(32);let calls=0;
 const auth=new Auth({async json(){calls++;const e=new Error('The account service connection was interrupted.');e.code='ACCOUNT_NETWORK_INTERRUPTED';throw e;}},{auth:null,setAuth(){}});
 auth.pending={session,email:'test@example.com',method:'email-2fa'};
 await assert.rejects(auth.verify('123456'),/connection was interrupted/);
 assert.equal(calls,1,'Verification POST must never be automatically replayed');
 assert(auth.pending,'A recoverable network error must not destroy the pending verification context');
});

test('after an accepted email code, a failed OAuth step is retried without resubmitting the code',async()=>{
  const requests=[];let tokenAttempts=0;
  const auth=new Auth({async json(url,opts){
    requests.push(url);
    if(url.endsWith('/session/verify_code'))return {data:{verified:true}};
    if(url.endsWith('/oauth/token')){
      if(++tokenAttempts===1)throw Object.assign(new Error('net::ERR_CONNECTION_RESET'),{code:'ACCOUNT_NETWORK_INTERRUPTED'});
      return {data:{access_token:'access',refresh_token:'refresh',expires_in:3600}};
    }
    throw new Error('Unexpected account-service request');
  }},{auth:null,setAuth(value){this.auth=value;}});
  auth.pending={session:'ab'.repeat(32),email:'example@example.com',method:'email-2fa'};
  await assert.rejects(auth.verify('123456'),/ERR_CONNECTION_RESET/);
  assert.equal(auth.pending.verified,true);
  const result=await auth.verify('123456');
  assert.deepEqual(result,{needsCode:false});
  assert.equal(requests.filter(url=>url.endsWith('/session/verify_code')).length,1);
  assert.equal(requests.filter(url=>url.endsWith('/oauth/token')).length,2);
  assert.equal(auth.pending,null);
});
