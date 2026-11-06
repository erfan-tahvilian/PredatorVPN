// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {BrowserAuth}=require('../src/lib/browser-auth.cjs');
test('provider browser sign-in completes PKCE callback and token exchange without exposing credentials',async()=>{
 let challenge=null,opened=0,verificationCalls=0;
 const auth=new BrowserAuth({
  openExternal:async value=>{
   opened++;
   const url=new URL(value);
   assert.equal(url.origin,'https://vpn.mozilla.org');
   assert.equal(url.pathname,'/api/v2/vpn/login/windows');
   assert.equal(url.searchParams.get('code_challenge_method'),'S256');
   challenge=url.searchParams.get('code_challenge');
   const port=Number(url.searchParams.get('port'));
   assert(port>0&&port<65536);
   const invalid=await fetch('http://127.0.0.1:'+port+'/wrong?code=fixture-valid-code');
   assert.equal(invalid.status,404);
   const callback=await fetch('http://127.0.0.1:'+port+'/?code=fixture-valid-code');
   assert.equal(callback.status,200);
  },
  fetcher:async(address,opts)=>{
   verificationCalls++;
   assert.equal(address,'https://vpn.mozilla.org/api/v2/vpn/login/verify');
   const body=JSON.parse(opts.body);
   assert.equal(body.code,'fixture-valid-code');
   assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);
   assert.equal(opts.method,'POST');
   return new Response(JSON.stringify({token:'guardian-fixture-session-token',user:{email:'fixture@example.invalid'}}),{status:200});
  }
 });
 const result=await auth.start();
 assert.equal(opened,1);
 assert.equal(verificationCalls,1);
 assert.deepEqual(result,{token:'guardian-fixture-session-token',email:'fixture@example.invalid'});
 assert.equal(auth.pending,null);
});
test('browser sign-in can be cancelled without leaving a local listener or accepting a token',async()=>{
 const auth=new BrowserAuth({openExternal:async()=>{},fetcher:async()=>{throw Error('Verify should not run');},timeoutMs:2000});
 const attempt=auth.start();
 auth.cancel();
 await assert.rejects(attempt,/cancelled/);
 assert.equal(auth.pending,null);
});
test('browser sign-in rejects incomplete provider responses and never stores them',async()=>{
 const auth=new BrowserAuth({
  openExternal:async url=>{
   const port=Number(new URL(url).searchParams.get('port'));
   const callback=await fetch('http://127.0.0.1:'+port+'/?code=fixture-valid-code');
   assert.equal(callback.status,200);
  },
  fetcher:async()=>new Response(JSON.stringify({user:{email:'fixture@example.invalid'}}),{status:200})
 });
 await assert.rejects(auth.start(),/valid account session/);
 assert.equal(auth.pending,null);
});

test('callback host is accepted only on real loopback interfaces and intended localhost authorities',()=>{
 const {isLocalCallback}=require('../src/lib/browser-auth.cjs');
 const req=(ip,host,method='GET')=>({socket:{remoteAddress:ip},headers:{host},method});
 assert(isLocalCallback(req('127.0.0.1','127.0.0.1:41234'),41234));
 assert(isLocalCallback(req('127.0.0.1','localhost:41234'),41234));
 assert(isLocalCallback(req('::1','[::1]:41234'),41234));
 assert(isLocalCallback(req('::ffff:127.0.0.1','localhost:41234'),41234));
 assert(!isLocalCallback(req('192.168.1.5','localhost:41234'),41234));
 assert(!isLocalCallback(req('127.0.0.1','evil.example:41234'),41234));
 assert(!isLocalCallback(req('127.0.0.1','localhost:41235'),41234));
 assert(!isLocalCallback(req('127.0.0.1','localhost:41234','POST'),41234));
});
test('browser authorization reports each step and accepts localhost redirects',async()=>{
 const stages=[];
 const auth=new BrowserAuth({
   onProgress:stage=>stages.push(stage),
   openExternal:async value=>{
     const port=Number(new URL(value).searchParams.get('port'));
     const target='http://localhost:'+port+'/?code=valid-local-browser-code';
     const response=await fetch(target);
     assert.equal(response.status,200);
   },
   fetcher:async()=>
     new Response(JSON.stringify({token:'valid-fixture-access-token',user:{email:'local@example.invalid'}}),{status:200})
 });
 await auth.start();
 assert(stages.includes('waiting-for-callback'));
 assert(stages.includes('callback-received'));
 assert(stages.includes('verifying-code'));
 assert(stages.includes('provider-authorized'));
 assert(stages.indexOf('callback-received')>stages.indexOf('waiting-for-callback'));
});
test('missing browser callback times out clearly and cleans up the listener',async()=>{
 let stages=[];
 const auth=new BrowserAuth({timeoutMs:90,onProgress:stage=>stages.push(stage),
   openExternal:async()=>{},fetcher:async()=>{throw Error('No callback should be exchanged');}});
 await assert.rejects(auth.start(),/did not return a sign-in code/);
 assert.equal(auth.pending,null);
 assert(stages.includes('timeout'));
});
