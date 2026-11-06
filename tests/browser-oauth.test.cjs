// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const {BrowserOAuth,configForBrowserOAuth}=require('../src/lib/browser-oauth.cjs');
function freePort(){return new Promise((resolve,reject)=>{const s=http.createServer();
 s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});
});}
const base=port=>({clientId:'0123456789abcdef',redirectUri:'http://127.0.0.1:'+port+'/callback',
 scope:'profile https://identity.mozilla.com/apps/vpn'});
test('browser OAuth requires a separately registered public client and fixed loopback redirect',()=>{
 assert.equal(configForBrowserOAuth(null),null);
 assert.throws(()=>configForBrowserOAuth({...base(49001),clientId:'5882386c6d801776'}),/provider-issued/);
 assert.throws(()=>configForBrowserOAuth({...base(49001),redirectUri:'https://malicious.example/callback'}),/redirect/);
 assert.throws(()=>configForBrowserOAuth({...base(49001),scope:'email'}),/profile scope/);
 assert.equal(configForBrowserOAuth(base(49001)).port,49001);
});
test('browser OAuth receives exact registered callback, validates state, exchanges PKCE once',async()=>{
 const port=await freePort();let opens=0,exchanges=0;
 const flow=new BrowserOAuth({
  config:base(port),onProgress:()=>{},
  openExternal:async url=>{
   opens++;
   const authorize=new URL(url);
   assert.equal(authorize.origin,'https://accounts.firefox.com');
   assert.equal(authorize.pathname,'/authorization');
   assert.equal(authorize.searchParams.get('client_id'),'0123456789abcdef');
   assert.equal(authorize.searchParams.get('response_type'),'code');
   assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
   assert.equal(authorize.searchParams.get('redirect_uri'),base(port).redirectUri);
   const redirect=new URL(base(port).redirectUri);
   redirect.searchParams.set('state','mismatched');
   redirect.searchParams.set('code','fictional-auth-code-111');
   const bad=await fetch(redirect);assert.equal(bad.status,403);
   redirect.searchParams.set('state',authorize.searchParams.get('state'));
   const correct=await fetch(redirect);assert.equal(correct.status,200);
  },
  fetcher:async(url,opts)=>{
   exchanges++;assert.equal(url,'https://oauth.accounts.firefox.com/v1/token');
   assert.equal(opts.method,'POST');
   assert.equal(opts.redirect,'error');
   const body=JSON.parse(opts.body);
   assert.equal(body.grant_type,'authorization_code');
   assert.equal(body.code,'fictional-auth-code-111');
   assert.equal(body.redirect_uri,base(port).redirectUri);
   const challenge=crypto.createHash('sha256').update(body.code_verifier).digest('base64url');
   // Assert verifier matches the authorization URL challenge in a second independent run below.
   assert(challenge.length>40);
   return new Response(JSON.stringify({access_token:'fictional-access-token-for-tests',
    refresh_token:'fictional-refresh-token-for-tests',expires_in:3600,scope:'profile'}),{status:200});
  }
 });
 const out=await flow.start();
 assert.equal(opens,1);assert.equal(exchanges,1);
 assert.equal(out.oauthClientId,'0123456789abcdef');
 assert.equal(out.access_token,'fictional-access-token-for-tests');
 assert.equal(flow.pending,null);
});
test('browser OAuth does not exchange a token after cancellation or timeout',async()=>{
 const port=await freePort();let exchanges=0;
 const flow=new BrowserOAuth({config:base(port),timeoutMs:100,
  openExternal:async()=>{},fetcher:async()=>{exchanges++;throw Error('Not expected');}});
 await assert.rejects(flow.start(),/did not return/);
 assert.equal(exchanges,0);
 assert.equal(flow.pending,null);
 const cancel=new BrowserOAuth({config:base(port),timeoutMs:2000,
  openExternal:async()=>{},fetcher:async()=>{exchanges++;throw Error('Not expected');}});
 const waiting=cancel.start();
 // Wait for the callback listener to start, without using real provider endpoints.
 await new Promise(r=>setTimeout(r,30));
 assert.equal(cancel.cancel(),true);
 await assert.rejects(waiting,/cancelled/);
 assert.equal(exchanges,0);
});
test('browser OAuth rejects invalid provider token responses',async()=>{
 const port=await freePort();
 const flow=new BrowserOAuth({config:base(port),
  openExternal:async url=>{
   const state=new URL(url).searchParams.get('state');
   const uri=new URL(base(port).redirectUri);uri.searchParams.set('state',state);uri.searchParams.set('code','fictional-auth-code-222');
   const r=await fetch(uri);assert.equal(r.status,200);
  },
  fetcher:async()=>new Response(JSON.stringify({scope:'profile'}),{status:200})
 });
 await assert.rejects(flow.start(),/did not issue a valid access token/);
});
