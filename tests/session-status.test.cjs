// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Auth}=require('../src/lib/auth.cjs');

test('email confirmation link does not exchange OAuth until provider marks session verified',async()=>{
 const session='ab'.repeat(32);
 let statusChecks=0,oauthExchanges=0;const saved=[];
 const auth=new Auth({async json(url,request){
   const p=new URL(url).pathname;
   if(p==='/v1/recovery_email/status'){
     assert.equal(request.method,'GET');
     assert.equal(request.authorization,'Bearer fxs_'+session);
     assert.equal(Object.hasOwn(request,'body'),false);
     statusChecks++;
     return {data:{verified:statusChecks>=2}};
   }
   if(p==='/v1/oauth/token'){
     oauthExchanges++;
     assert.equal(request.method,'POST');
     return {data:{access_token:'test-access',refresh_token:'test-refresh',expires_in:3600}};
   }
   if(p==='/v1/session/destroy')return {data:{}};
   throw Error('Unexpected request '+p);
 }},{setAuth:credentials=>saved.push(credentials)});
 auth.pending={method:'email',session,email:'test@example.invalid',verified:false};
 assert.deepEqual(await auth.verify(''),{needsCode:true,verificationMethod:'email'});
 assert.equal(oauthExchanges,0);
 assert.equal(saved.length,0);
 assert.equal(auth.pending.verified,false);
 assert.deepEqual(await auth.verify(''),{needsCode:false});
 assert.equal(statusChecks,2);
 assert.equal(oauthExchanges,1);
 assert.equal(saved.length,1);
 assert.equal(auth.pending,null);
});
test('invalid or malformed provider verification status never issues OAuth tokens',async()=>{
 for(const result of [null,{}, {verified:'true'}, {verified:undefined}]){
   let oauthExchanges=0;
   const auth=new Auth({async json(url){
     if(url.endsWith('/recovery_email/status'))return {data:result};
     oauthExchanges++;throw Error('Unexpected OAuth call');
   }},{setAuth(){throw Error('Unexpected account save')}});
   auth.pending={method:'email',session:'ab'.repeat(32),email:'test@example.invalid'};
   await assert.rejects(auth.verify(''),/unexpected verification status/i);
   assert.equal(oauthExchanges,0);
   assert(auth.pending);
   auth.cancel();
 }
 const bad=new Auth({async json(){throw Error('Must never contact provider')}},{setAuth(){}});
 await assert.rejects(bad.sessionVerified('invalid'),/invalid session token/);
});
test('read-only session status uses an authenticated GET without a JSON request body',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 let captured;
 const control=new Control({transport:async(_url,opts)=>{
   captured=opts;
   return new Response(JSON.stringify({verified:false}),{
     status:200,headers:{'content-type':'application/json'}
   });
 }});
 const auth=new Auth(control,{setAuth(){}});
 assert.equal(await auth.sessionVerified('ab'.repeat(32)),false);
 assert.equal(captured.method,'GET');
 assert.equal(captured.body,undefined);
 assert.equal(captured.headers.Authorization,'Bearer fxs_'+'ab'.repeat(32));
 assert.equal(Object.hasOwn(captured.headers,'Content-Type'),false);
});

test('cancelling a pending account login rejects its late response without saving credentials',async()=>{
 let resolveLogin;let saved=0;
 const auth=new Auth({async json(url){
   if(url.endsWith('/account/login'))return new Promise(resolve=>{resolveLogin=resolve;});
   if(url.endsWith('/session/destroy'))return {data:{}};
   throw Error('Unexpected request: '+new URL(url).pathname);
 }},{setAuth(){saved++;}});
 const attempt=auth.login('test@example.invalid','fixture-password');
 assert.equal(typeof resolveLogin,'function');
 auth.cancel();
 resolveLogin({data:{sessionToken:'ab'.repeat(32),verified:true}});
 await assert.rejects(attempt,/cancelled/);
 assert.equal(auth.pending,null);
 assert.equal(saved,0);
});

test('cancelled OAuth exchange cannot save a token under a newer or removed account',async()=>{
 let resolveToken;let saved=0,destroyed=0;
 const session='ab'.repeat(32);
 const auth=new Auth({async json(url){
   if(url.endsWith('/oauth/token'))return new Promise(resolve=>{resolveToken=resolve;});
   if(url.endsWith('/session/destroy')){destroyed++;return {data:{}};}
   throw Error('Unexpected request: '+new URL(url).pathname);
 }},{setAuth(){saved++;}});
 const pending={session,email:'test@example.invalid',method:'email-2fa',verified:true};
 auth.pending=pending;
 const attempt=auth.complete();
 assert.equal(typeof resolveToken,'function');
 auth.cancel();
 auth.pending={session:'cd'.repeat(32),email:'other@example.invalid',method:'email'};
 resolveToken({data:{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_in:3600}});
 await assert.rejects(attempt,/cancelled/);
 assert.equal(saved,0);
 assert.equal(auth.pending.email,'other@example.invalid');
 assert.equal(destroyed,1);
 auth.cancel();
});

test('concurrent verification is rejected and an expired session cannot become logged in',async()=>{
 let resolveStatus;let tokenRequests=0,saved=0;
 const auth=new Auth({async json(url){
   if(url.endsWith('/recovery_email/status'))return new Promise(resolve=>{resolveStatus=resolve;});
   if(url.endsWith('/session/destroy'))return {data:{}};
   tokenRequests++;
   throw Error('Unexpected token request');
 }},{setAuth(){saved++;}});
 auth.pending={session:'ab'.repeat(32),email:'test@example.invalid',method:'email',expiresAt:Date.now()+20000};
 const first=auth.verify('');
 await assert.rejects(auth.verify(''),/already in progress/);
 auth.cancel();
 resolveStatus({data:{verified:true}});
 await assert.rejects(first,/cancelled/);
 assert.equal(tokenRequests,0);
 auth.pending={session:'cd'.repeat(32),email:'test@example.invalid',method:'email',expiresAt:Date.now()-1};
 await assert.rejects(auth.verify(''),/expired/);
 assert.equal(tokenRequests,0);
 assert.equal(saved,0);
});

test('verification remains exclusive while authorized token exchange is in flight',async()=>{
 let resolveToken;let count=0,saved=0;
 const auth=new Auth({async json(url){
   if(url.endsWith('/oauth/token')){count++;return new Promise(resolve=>{resolveToken=resolve;});}
   if(url.endsWith('/session/destroy'))return {data:{}};
   throw Error('Unexpected request');
 }},{setAuth(){saved++;}});
 auth.pending={session:'ab'.repeat(32),email:'test@example.invalid',method:'totp-2fa',verified:true};
 const first=auth.verify('123456');
 assert.equal(typeof resolveToken,'function');
 await assert.rejects(auth.verify('123456'),/already in progress/);
 resolveToken({data:{access_token:'fixture-token',expires_in:300}});
 assert.deepEqual(await first,{needsCode:false});
 assert.equal(count,1);
 assert.equal(saved,1);
});
