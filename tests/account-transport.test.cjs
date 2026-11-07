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
test('legacy browser credentials remain encrypted and intact but are not accepted by removed login',async()=>{
  const guardianToken='fixture-guardian-access-token';
  const saved={email:'test@example.invalid',provider:'guardian-browser',access_token:guardianToken};
  const store={auth:saved,setAuth(){throw Error('Stored legacy session must remain untouched');}};
  const auth=new Auth({async json(){throw Error('No network for removed browser authorization');}},store);
  await assert.rejects(auth.token(),/legacy browser session/);
  await assert.rejects(auth.token(true),/legacy browser session/);
  assert.equal(store.auth,saved);
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

test('provider HTTP 400 verification-script rejection is classified without leaking its response',async()=>{
 const {Control,describeVerificationFailure}=require('../src/lib/control.cjs');
 const detail=describeVerificationFailure({verificationStage:'challenge-script',verificationStatus:400,message:'secret-value'});
 assert.equal(detail.code,'ACCOUNT_VERIFICATION_SCRIPT_REJECTED');
 assert.match(detail.message,/HTTP 400/);
 assert(!detail.message.includes('secret-value'));
 const control=new Control({transport:async()=>new Response('',{status:406})});
 control.challenge=async()=>{const e=Error('opaque-provider-response');e.verificationStage='challenge-script';e.verificationStatus=400;throw e;};
 await assert.rejects(control.json('https://api.accounts.firefox.com/v1/account/login',{method:'POST',body:'{}'}),
   error=>error.code==='ACCOUNT_VERIFICATION_SCRIPT_REJECTED'&&error.status===406
     &&error.message.includes('HTTP 400')&&!error.message.includes('opaque-provider-response'));
});
test('verification failure diagnostics preserve provider boundaries and network errors',()=>{
 const {describeVerificationFailure}=require('../src/lib/control.cjs');
 assert.equal(describeVerificationFailure({verificationStage:'challenge-response',verificationStatus:403}).code,'ACCOUNT_VERIFICATION_RESPONSE_REJECTED');
 assert.equal(describeVerificationFailure({verificationStage:'challenge-discovery'}).code,'ACCOUNT_VERIFICATION_UNAVAILABLE');
 assert.equal(describeVerificationFailure({code:'ACCOUNT_NETWORK_INTERRUPTED'}).code,'ACCOUNT_VERIFICATION_NETWORK_ERROR');
 const other=describeVerificationFailure({message:'secret account password'});
 assert.equal(other.code,'ACCOUNT_PROVIDER_CHALLENGE_FAILED');
 assert(!other.message.includes('secret account password'));
});

test('old browser accounts are preserved but cannot trigger discontinued OAuth refresh',async()=>{
 const saved={provider:'fxa-oidc',oauthClientId:'0123456789abcdef',access_token:'fixture-old-token',
   refresh_token:'fixture-old-refresh',expiresAt:1,email:'test@example.invalid'};
 let networkRequests=0;
 const auth=new Auth({async json(){networkRequests++;throw Error('Unexpected OAuth access');}},
  {auth:saved,setAuth(){throw Error('Old account must not be discarded');}});
 await assert.rejects(auth.token(true),/legacy browser session/);
 assert.equal(networkRequests,0);
 assert.equal(saved.refresh_token,'fixture-old-refresh');
});

test('an Electron-backed provider session retains exclusive control of browser cookies',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 const requests=[];
 const client=new Control({
  browserManagedCookies:true,
  transport:async(url,options)=>{
   requests.push({url,options});
   return new Response('{}',{headers:{'Set-Cookie':'clearance=value; Domain=firefox.com; Path=/; Secure'}});
  }
 });
 client.cookies.set('firefox.com:old',{domain:'firefox.com',pair:'old=fixture'});
 await client.fetch('https://oauth.accounts.firefox.com/v1/token',{method:'POST'});
 assert.equal(requests.length,1);
 assert.equal(Object.hasOwn(requests[0].options.headers,'Cookie'),false,
  'Electron sessions should supply real browser cookies, not a manual Cookie header');
 assert.equal(client.cookies.size,1,
  'A browser-managed response must not be copied into the legacy manual cookie map');
});
test('provider-issued Firefox domain cookies stay in one Chromium session for account and OAuth requests',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let created=0,clearance=false;
 const requests=[];
 const session={
  setProxy:async({mode})=>{assert.equal(mode,'direct');},
  fetch:async(url,options)=>{
   const u=new URL(url);
   requests.push({host:u.hostname,method:options.method||'GET',credentials:options.credentials,headers:options.headers});
   assert.equal(options.credentials,'include','Main-process requests must use the session cookie jar');
   assert.equal(Object.keys(options.headers||{}).some(k=>k.toLowerCase()==='cookie'),false,
    'Application must never construct a Cookie header for a Chromium session');
   if(u.pathname==='/challenge-finished'){
    clearance=true;
    return new Response('verified',{headers:{'Set-Cookie':'test-clearance=issued-by-provider; Domain=firefox.com; Path=/; Secure; HttpOnly'}});
   }
   if(u.hostname==='api.accounts.firefox.com'||u.hostname==='oauth.accounts.firefox.com'){
    assert.equal(clearance,true,'Both FxA origins should be accessed after successful verification');
    return new Response('{}',{headers:{'Content-Type':'application/json'}});
   }
   throw Error('Unexpected test endpoint');
  }
 };
 const transport=createAccountTransport({createSession:()=>{created++;return session;},
  systemFetch:()=>{throw Error('Should never use a different cookie jar')}});
 const control=new Control({transport,browserManagedCookies:true});
 await control.fetch('https://accounts.firefox.com/challenge-finished');
 await control.json('https://api.accounts.firefox.com/v1/oauth/authorization',{method:'POST',body:'{}'});
 await control.json('https://oauth.accounts.firefox.com/v1/token',{method:'POST',body:'{}'});
 assert.equal(created,1,'Account and OAuth calls must share the same session');
 assert.deepEqual(requests.map(x=>x.host),[
  'accounts.firefox.com','api.accounts.firefox.com','oauth.accounts.firefox.com']);
 assert.equal(control.cookies.size,0,'Do not synthesize or duplicate provider cookies in a JS Map');
});
test('Chromium-managed FxA transport never forwards account cookies in a raw application header',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 const observed=[];
 const control=new Control({browserManagedCookies:true,transport:async(url,options)=>{
  observed.push({url,options});
  return new Response('{}',{headers:{'Set-Cookie':'clearance=provider-value; Domain=firefox.com; Path=/; Secure; HttpOnly'}});
 }});
 await control.fetch('https://accounts.firefox.com/');
 await control.fetch('https://api.accounts.firefox.com/v1/recovery_email/status');
 await control.fetch('https://oauth.accounts.firefox.com/v1/token');
 for(const call of observed)assert.equal(Object.keys(call.options.headers).some(k=>k.toLowerCase()==='cookie'),false);
 assert.equal(control.cookies.size,0);
});
