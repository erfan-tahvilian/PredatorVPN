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
