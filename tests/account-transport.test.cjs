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
test('empty account-API 406 triggers verification on the site host before one retry',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let requests=0,challengeAttempts=0;
 const control=new Control({transport:async()=>{
   requests++;
   return requests===1?new Response('',{status:406}):
     new Response(JSON.stringify({errno:102,message:'Incorrect password'}),{status:400,headers:{'Content-Type':'application/json'}});
 }});
 control.challenge=async()=>{challengeAttempts++;};
 await assert.rejects(control.json(service,{method:'POST',body:'{}'}),error=>error.status===400&&error.errno===102);
 assert.equal(requests,2,'A rejected edge request is repeated only after completing provider verification');
 assert.equal(challengeAttempts,1);
});
test('challenge failure does not resubmit a blocked account password',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let requests=0,challengeAttempts=0;
 const control=new Control({transport:async()=>{requests++;return new Response('',{status:406});}});
 control.challenge=async()=>{challengeAttempts++;throw Error('Interactive challenge unavailable');};
 await assert.rejects(control.json(service,{method:'POST',body:'{}'}),error=>error.status===406&&error.code==='ACCOUNT_PROVIDER_CHALLENGE_FAILED');
 assert.equal(requests,1);
 assert.equal(challengeAttempts,1);
});
test('repeated empty HTTP 406 remains bounded and reports provider rejection',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let requests=0,challengeAttempts=0;
 const control=new Control({transport:async()=>{requests++;return new Response('',{status:406});}});
 control.challenge=async()=>{challengeAttempts++;};
 await assert.rejects(control.json(service,{method:'POST',body:'{}'}),error=>error.code==='ACCOUNT_PROVIDER_BLOCKED'&&error.status===406);
 assert.equal(requests,3);
 assert.equal(challengeAttempts,2);
});
test('structured HTTP 406 is not mistaken for a challenge and is not replayed',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let attempts=0,challengeAttempts=0;
 const control=new Control({transport:async()=>{
   attempts++;return new Response(JSON.stringify({message:'Rejected',errno:903}),{status:406,headers:{'Content-Type':'application/json'}});
 }});
 control.challenge=async()=>{challengeAttempts++;};
 await assert.rejects(control.json(service,{method:'POST',body:'{}'}),error=>error.status===406&&error.errno===903);
 assert.equal(attempts,1);
 assert.equal(challengeAttempts,0);
});
test('a provider-hosted browser Guardian session is returned unchanged without Firefox-specific token refresh',async()=>{
 const guardianToken='fixture-guardian-access-token';
 const store={auth:{email:'test@example.invalid',provider:'guardian-browser',access_token:guardianToken},setAuth(){throw Error('Browser session must not be overwritten');}};
 const auth=new Auth({async json(){throw Error('Firefox token API is not used for browser Guardian sessions');}},store);
 assert.equal(await auth.token(),guardianToken);
 await assert.rejects(auth.token(true),/sign in again using your browser/);
 assert.equal(store.auth.access_token,guardianToken);
});
test('FxA email-case error retries using provider canonical case',async()=>{
 const {authPW}=require('../src/lib/auth.cjs');
 const calls=[],store={auth:null,setAuth(){}};
 const auth=new Auth({async json(_url,{body}){
   const data=JSON.parse(body);calls.push(data);
   if(calls.length===1)throw Object.assign(Error('Incorrect email case'),{errno:120,providerEmail:'Alice@Example.com'});
   return {data:{sessionToken:'ab'.repeat(32),verified:false}};
 }},store);
 const result=await auth.login('alice@example.com','example-password-only');
 assert.deepEqual(result,{needsCode:true,verificationMethod:'email-2fa'});
 assert.equal(calls.length,2);
 assert.equal(calls[1].email,'Alice@Example.com');
 assert.equal(calls[1].originalLoginEmail,'alice@example.com');
 assert.equal(calls[1].authPW,authPW('Alice@Example.com','example-password-only'));
 assert.equal(auth.pending.email,'Alice@Example.com');
});
test('FxA unknown or mismatched email-case error never sends a second password',async()=>{
 let requests=0;const auth=new Auth({async json(){
   requests++;throw Object.assign(Error('Incorrect email case'),{errno:120,providerEmail:'Different@example.com'});
 }},{auth:null,setAuth(){}});
 await assert.rejects(auth.login('test@example.com','test-pass'),/Incorrect email case/);
 assert.equal(requests,1);
});
test('FxA unsupported email-code parameter retries without it only on errno 107',async()=>{
 const calls=[],auth=new Auth({async json(_url,{body}){
    const data=JSON.parse(body);calls.push(data);
    if(calls.length===1)throw Object.assign(Error('Invalid parameter'),{errno:107});
    return {data:{sessionToken:'ab'.repeat(32),verified:false}};
 }},{auth:null,setAuth(){}});
 const result=await auth.login('demo@example.com','test-only');
 assert(result.needsCode);
 assert.equal(calls.length,2);
 assert.equal(calls[0].verificationMethod,'email-2fa');
 assert(!('verificationMethod' in calls[1]));
});
test('email confirmation codes normalize Persian and Arabic digits before provider request',async()=>{
 let received='';
 const auth=new Auth({async json(url,{body}){
   if(url.endsWith('/session/verify_code')){received=JSON.parse(body).code;return {data:{verified:true}};}
   if(url.endsWith('/oauth/token'))return {data:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}};
   throw Error('Unexpected request');
 }},{auth:null,setAuth(){}});
 auth.pending={session:'ab'.repeat(32),email:'demo@example.com',method:'email-2fa'};
 await auth.verify('۱۲۳ ٤٥٦\u200c');
 assert.equal(received,'123456');
});
