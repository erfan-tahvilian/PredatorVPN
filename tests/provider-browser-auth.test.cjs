// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
 readProviderRegistration,createAuthorization,redirectResult,signInNavigationAllowed,
 exchangeAuthorization,readAuthorizedProfile,FIREFOX_NATIVE_CLIENT
}=require('../src/lib/provider-browser-auth.cjs');
const registration={clientId:'f39a73e381a1b52f',redirectUri:'https://login.predator.example/callback',scope:'profile https://identity.mozilla.com/apps/vpn'};
test('registered-client browser flow uses PKCE and an opaque state',()=>{
 const a=createAuthorization(registration),b=createAuthorization(registration);
 const u=new URL(a.url);
 assert.equal(u.origin,'https://accounts.firefox.com');
 assert.equal(u.searchParams.get('client_id'),registration.clientId);
 assert.equal(u.searchParams.get('redirect_uri'),registration.redirectUri);
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.notEqual(a.state,b.state);assert.notEqual(a.verifier,b.verifier);
 assert(a.verifier.length>=43);
 assert(!a.url.includes(a.verifier));
});
test('callback never accepts wrong state, different host, path or duplicate codes',()=>{
 const flow=createAuthorization(registration);
 const target=registration.redirectUri+'?code=fixture-code&state='+flow.state;
 assert.equal(redirectResult(target,registration,flow),'fixture-code');
 assert.equal(redirectResult('https://evil.example/callback?code=stolen&state='+flow.state,registration,flow),null);
 assert.equal(redirectResult('https://login.predator.example/callback-extra?code=stolen&state='+flow.state,registration,flow),null);
 assert.throws(()=>redirectResult(registration.redirectUri+'?code=x&state=wrong',registration,flow),/state/);
 assert.throws(()=>redirectResult(target+'&code=duplicate',registration,flow),/valid code/);
 assert.throws(()=>redirectResult(registration.redirectUri+'?error=access_denied&state='+flow.state,registration,flow),/declined/);
 assert.equal(signInNavigationAllowed('javascript:alert(1)',registration),false);
 assert.equal(signInNavigationAllowed('http://accounts.firefox.com/',registration),false);
 assert.equal(signInNavigationAllowed('https://accounts.firefox.com/',registration),true);
});
test('Firefox native OAuth client is refused and missing registration is explicit',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'predator-rp-'));
 try{
  const file=path.join(dir,'client.json');
  assert.equal(readProviderRegistration(file),null);
  fs.writeFileSync(file,JSON.stringify({clientId:FIREFOX_NATIVE_CLIENT,redirectUri:registration.redirectUri}));
  assert.throws(()=>readProviderRegistration(file),/separately registered/);
  fs.writeFileSync(file,JSON.stringify({clientId:registration.clientId,redirectUri:'http://example.com/callback'}));
  assert.throws(()=>readProviderRegistration(file),/HTTPS/);
  fs.writeFileSync(file,JSON.stringify(registration));
  const loaded=readProviderRegistration(file);
  assert.equal(loaded.clientId,registration.clientId);
  assert.equal(loaded.scope,registration.scope);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('OAuth exchange never sends code verifier to the renderer and rejects provider failures',async()=>{
 const flow=createAuthorization(registration);let observed=0;
 const token=await exchangeAuthorization(async(url,options)=>{
  observed++;
  assert.equal(url,'https://oauth.accounts.firefox.com/v1/token');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers['Content-Type'],'application/json');
  const body=JSON.parse(options.body);
  assert.equal(body.client_id,registration.clientId);
  assert.equal(body.code_verifier,flow.verifier);
  assert.equal(body.code,'fixture-code');
  return {ok:true,json:async()=>({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600})};
 },registration,flow,'fixture-code');
 assert.equal(token.access_token,'fixture-access');assert.equal(observed,1);
 await assert.rejects(exchangeAuthorization(async()=>({ok:false,status:406,arrayBuffer:async()=>new ArrayBuffer(0)}),registration,flow,'fixture-code'),/HTTP 406/);
 await assert.rejects(exchangeAuthorization(async()=>({ok:true,json:async()=>({access_token:'only-access'})}),registration,flow,'fixture-code'),/offline access/);
});
test('provider profile must supply an authenticated email',async()=>{
 const address=await readAuthorizedProfile(async(url,options)=>{
  assert.equal(url,'https://profile.accounts.firefox.com/v1/profile');
  assert.equal(options.headers.Authorization,'Bearer fixture-access');
  return {ok:true,json:async()=>({email:'sample@example.invalid'})};
 },'fixture-access');
 assert.equal(address,'sample@example.invalid');
 await assert.rejects(readAuthorizedProfile(async()=>({ok:true,json:async()=>({})}),'fixture-access'),/verified account email/);
});

test('registered browser accounts refresh under their own client, not Firefox native',async()=>{
 const {Auth}=require('../src/lib/auth.cjs');
 const old={provider:'mozilla-registered-oidc',oauthClientId:registration.clientId,
   email:'sample@example.invalid',refresh_token:'fixture-old',access_token:'fixture-expired',expiresAt:0};
 const store={auth:old,setAuth(next){this.auth=next;}};
 let requested=0;
 const auth=new Auth({async json(url,options){
  requested++;
  assert.equal(url,'https://oauth.accounts.firefox.com/v1/token');
  assert.equal(options.authorization,undefined);
  const body=JSON.parse(options.body);
  assert.equal(body.client_id,registration.clientId);
  assert.notEqual(body.client_id,FIREFOX_NATIVE_CLIENT);
  assert.equal(body.grant_type,'refresh_token');
  assert.equal(body.refresh_token,'fixture-old');
  return {data:{access_token:'fixture-new',expires_in:3600}};
 }},store);
 assert.equal(await auth.token(true),'fixture-new');
 assert.equal(store.auth.refresh_token,'fixture-old');
 assert.equal(store.auth.provider,'mozilla-registered-oidc');
 assert.equal(requested,1);
});
