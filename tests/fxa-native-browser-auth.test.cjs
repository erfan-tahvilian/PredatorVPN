// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {followNativeBrowserSession}=require('../src/lib/fxa-native-browser-auth.cjs');
const {exchangeSessionWithOAuthCode}=require('../src/lib/fxa-session-code-grant.cjs');
const token='ab'.repeat(32);
function provider(){
  let status=0,exchanges=0;
  return {http:{async json(url,request){
    const pathname=new URL(url).pathname;
    if(pathname.endsWith('/recovery_email/status')){
      assert.equal(request.method,'GET');
      assert.match(request.authorization,/^Hawk /);
      return {data:{verified:++status>1}};
    }
    if(pathname.endsWith('/oauth/token')){
      exchanges++;
      return {data:{access_token:'access',refresh_token:'refresh',expires_in:3600}};
    }
    if(pathname.endsWith('/session/destroy'))return {data:{}};
    throw Error('Unexpected '+pathname);
  }},get exchanges(){return exchanges;},get status(){return status;}};
}
const fetcher=async()=>({ok:true,json:async()=>({email:'person@example.invalid'})});
test('WebChannel sign-in verifies session, obtains refresh token and VPN entitlement before save',async()=>{
 const p=provider(),steps=[];let account;
 const result=await followNativeBrowserSession({
   sessionToken:token,email:'person@example.invalid',http:p.http,fetcher,
   checkVpn:async accessToken=>{steps.push('vpn');assert.equal(accessToken,'access');},
   saveAccount:value=>{steps.push('save');account=value;return 'id-1';},
   delay:async()=>{}
 });
 assert.equal(result,'id-1');assert.deepEqual(steps,['vpn','save']);
 assert.equal(p.status,2);assert.equal(p.exchanges,1);
 assert.equal(account.email,'person@example.invalid');
 assert.equal(account.provider,'mozilla-native-webchannel');
 assert.equal(account.refresh_token,'refresh');
});
test('No OAuth token is requested before provider verifies sign-in',async()=>{
 const p=provider();let saved=0;
 const result=followNativeBrowserSession({sessionToken:token,email:'person@example.invalid',
   http:p.http,fetcher,checkVpn:async()=>{},saveAccount:()=>{saved++},delay:async()=>{},maxChecks:1});
 await assert.rejects(result,/did not confirm/);
 assert.equal(p.exchanges,0);assert.equal(saved,0);
});
test('Cancelled browser sign-in cannot add an account',async()=>{
 const p=provider();let saved=0;
 await assert.rejects(followNativeBrowserSession({sessionToken:token,email:'person@example.invalid',
   http:p.http,fetcher,checkVpn:async()=>{},saveAccount:()=>{saved++},
   active:()=>false}),/cancelled/);
 assert.equal(p.exchanges,0);assert.equal(saved,0);
});
test('Provider profile identity mismatch prevents account creation',async()=>{
 const p=provider();let saved=0;
 await assert.rejects(followNativeBrowserSession({sessionToken:token,email:'wrong@example.invalid',
   http:p.http,fetcher,checkVpn:async()=>{},saveAccount:()=>{saved++},delay:async()=>{}}),/different account identity/);
 assert.equal(saved,0);
});
test('Session-authenticated OAuth authorization code fallback validates PKCE and state',async()=>{
 let authorize=0,exchange=0;
 const result=await exchangeSessionWithOAuthCode({async json(url,request){
  const data=JSON.parse(request.body);
  if(url.endsWith('/oauth/authorization')){
   authorize++;assert.equal(data.client_id,'5882386c6d801776');
   assert.equal(data.code_challenge_method,'S256');
   assert.match(request.authorization,/^Hawk /);
   return {data:{code:'fixture-code',state:data.state}};
  }
  assert.equal(url,'https://oauth.accounts.firefox.com/v1/token');
  exchange++;assert.equal(data.grant_type,'authorization_code');
  assert.ok(data.code_verifier);
  return {data:{access_token:'fallback-access',refresh_token:'fallback-refresh'}};
 }},token,()=> 'Hawk fixture');
 assert.equal(result.access_token,'fallback-access');
 assert.equal(authorize,1);assert.equal(exchange,1);
});
test('Code fallback rejects invalid provider state before exchanging token',async()=>{
 let exchanges=0;
 await assert.rejects(exchangeSessionWithOAuthCode({async json(url,request){
  if(url.endsWith('/oauth/authorization'))return {data:{code:'fixture-code',state:'incorrect'}};
  exchanges++;throw Error('Should not exchange code');
 }},token,()=> 'Hawk fixture'),/invalid OAuth authorization response/);
 assert.equal(exchanges,0);
});

const {createNativeOAuthFlow,completeNativeOAuthCode,CLIENT,REDIRECT}=require('../src/lib/fxa-native-oauth-code.cjs');
test('Desktop browser login starts with the same FxA entry point as Arman',()=>{
 const {createLegacyBrowserSignInUrl}=require('../src/lib/fxa-native-oauth-code.cjs');
 const url=new URL(createLegacyBrowserSignInUrl('person@example.invalid'));
 assert.equal(url.origin,'https://accounts.firefox.com');
 assert.equal(url.searchParams.get('context'),'fx_desktop_v3');
 assert.equal(url.searchParams.get('service'),'sync');
 assert.equal(url.searchParams.get('action'),'email');
 assert.equal(url.searchParams.get('email'),'person@example.invalid');
});
test('Modern Firefox OAuth WebChannel URL uses native client and PKCE',()=>{
 const flow=createNativeOAuthFlow();
 const url=new URL(flow.url);
 assert.equal(url.searchParams.get('context'),'oauth_webchannel_v1');
 assert.equal(url.searchParams.get('client_id'),CLIENT);
 assert.equal(url.searchParams.get('service'),'vpn');
 assert.equal(url.searchParams.get('state'),flow.state);
 assert.equal(url.searchParams.has('redirect_uri'),false,
   'Native WebChannel redirect URN must not be passed through FxA query validation');
 assert.equal(flow.redirectUri,REDIRECT,
   'The native WebChannel callback remains available for OAuth code exchange');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.notEqual(url.searchParams.get('code_challenge'),flow.verifier);
});
test('Modern WebChannel code can be exchanged and saved only after VPN authorization',async()=>{
 const flow=createNativeOAuthFlow();
 const events=[];
 const id=await completeNativeOAuthCode({
  code:'fixture-code',flow,active:()=>true,
  fetcher:async(url,options)=>{
    if(url.endsWith('/v1/token')){
      const body=JSON.parse(options.body);
      assert.equal(body.client_id,CLIENT);
      assert.equal(body.redirect_uri,REDIRECT);
      assert.equal(body.code_verifier,flow.verifier);
      events.push('token');
      return {ok:true,json:async()=>({access_token:'valid-access',refresh_token:'valid-refresh',expires_in:3600})};
    }
    events.push('profile');
    return {ok:true,json:async()=>({email:'person@example.invalid'})};
  },
  checkVpn:async token=>{assert.equal(token,'valid-access');events.push('vpn');},
  saveAccount:auth=>{assert.equal(auth.provider,'mozilla-native-webchannel');events.push('save');return 'saved-id';}
 });
 assert.equal(id,'saved-id');
 assert.deepEqual(events,['token','profile','vpn','save']);
});

test('Native OAuth refresh uses the native client ID and OAuth token endpoint',async()=>{
 const {Auth}=require('../src/lib/auth.cjs');
 const saved={
  provider:'mozilla-native-webchannel',email:'person@example.invalid',
  access_token:'access-expired',refresh_token:'refresh-existing',expiresAt:0
 };
 const store={auth:saved,setAuth(next){this.auth=next;}};
 const seen=[];
 const auth=new Auth({async json(url,options){
  seen.push({url,body:JSON.parse(options.body)});
  return {data:{access_token:'access-renewed',expires_in:3600}};
 }},store);
 assert.equal(await auth.token(true),'access-renewed');
 assert.equal(seen.length,1);
 assert.equal(seen[0].url,'https://oauth.accounts.firefox.com/v1/token');
 assert.equal(seen[0].body.client_id,'5882386c6d801776');
 assert.equal(seen[0].body.grant_type,'refresh_token');
 assert.equal(seen[0].body.refresh_token,'refresh-existing');
 assert.equal(store.auth.refresh_token,'refresh-existing');
});
test('Native OAuth labels a rejected token exchange without exposing secrets',async()=>{
 const flow=createNativeOAuthFlow();
 let saved=0,checked=0;
 await assert.rejects(completeNativeOAuthCode({
  flow,code:'fixture',active:()=>true,
  fetcher:async()=>({ok:false,status:406,arrayBuffer:async()=>new ArrayBuffer(0)}),
  checkVpn:async()=>{checked++},saveAccount:()=>{saved++}
 }),error=>/OAuth code exchange/.test(error.message)&&/HTTP 406/.test(error.message)&&error.loginStage==='oauth-token-exchange');
 assert.equal(checked,0);assert.equal(saved,0);
});

test('Browser session OAuth tries the verified authorization-code grant before HTTP 406 challenge handling',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 const {Auth}=require('../src/lib/auth.cjs');
 const events=[];
 const reply=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 const http=new Control({browserManagedCookies:true,transport:async(url,options={})=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/oauth/token')){
   events.push('direct-406');
   return new Response('',{status:406});
  }
  if(u.pathname.endsWith('/oauth/authorization')){
   events.push('authorized-code');
   assert.match(options.headers.Authorization,/^Hawk /);
   const body=JSON.parse(options.body);
   assert.equal(body.code_challenge_method,'S256');
   return reply({code:'fixture-code',state:body.state});
  }
  if(u.pathname==='/v1/token'&&u.hostname==='oauth.accounts.firefox.com'){
   events.push('code-exchange');
   assert.equal(JSON.parse(options.body).grant_type,'authorization_code');
   return reply({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
  }
  if(u.pathname.endsWith('/session/destroy')){events.push('destroy');return reply({});}
  throw Error('Unexpected endpoint: '+u.pathname);
 }});
 let saved;
 const auth=new Auth(http,{setAuth:record=>{saved=record;}});
 auth.pending={session:'ab'.repeat(32),email:'person@example.invalid',verified:true};
 try{
  assert.deepEqual(await auth.complete(),{needsCode:false});
  assert.deepEqual(events,['direct-406','authorized-code','code-exchange','destroy']);
  assert.equal(saved.email,'person@example.invalid');
  assert.equal(saved.refresh_token,'fixture-refresh');
 }finally{auth.cancel();}
});

test('Second empty 406 does not replay an already attempted OAuth authorization fallback',async()=>{
 const {Control}=require('../src/lib/control.cjs');
 const {Auth}=require('../src/lib/auth.cjs');
 let direct=0,alternate=0,challenge=0,saved=0;
 const http=new Control({browserManagedCookies:true,transport:async url=>{
  const route=new URL(url).pathname;
  if(route.endsWith('/oauth/token'))direct++;
  if(route.endsWith('/oauth/authorization'))alternate++;
  return new Response('',{status:406});
 }});
 http.challenge=async()=>{challenge++;throw Error('Provider verification could not complete');};
 const auth=new Auth(http,{setAuth:()=>saved++});
 auth.pending={session:'ab'.repeat(32),email:'person@example.invalid',verified:true};
 try{
  await assert.rejects(auth.complete(),error=>error.code==='FXA_OAUTH_GRANTS_REJECTED'&&error.loginStage==='oauth-token'&&error.status===406&&/both the direct and authorization-code grants/i.test(error.message)&&!error.message.includes('ab'.repeat(32)));
  assert.equal(direct,1);assert.equal(alternate,1);assert.equal(challenge,1);assert.equal(saved,0);
 }finally{auth.cancel();}
});

test('Browser sign-in retains the same session across a transient status error',async()=>{
 let status=0,exchanged=0,record;
 const http={async json(url){
  const path=new URL(url).pathname;
  if(path.endsWith('/recovery_email/status')){
   status++;
   if(status===1)throw Object.assign(Error('Temporary transport failure'),{status:406});
   return {data:{verified:true}};
  }
  if(path.endsWith('/oauth/token')){exchanged++;return {data:{access_token:'a',refresh_token:'r',expires_in:3600}};}
  if(path.endsWith('/session/destroy'))return {data:{}};
  throw Error('Unexpected route');
 }};
 const delays=[];
 const output=await followNativeBrowserSession({sessionToken:token,email:'person@example.invalid',
  http,fetcher,checkVpn:async()=>{},saveAccount:v=>{record=v;return 'ok';},
  delay:async ms=>delays.push(ms)});
 assert.equal(output,'ok');assert.equal(status,2);assert.equal(exchanged,1);
 assert.deepEqual(delays,[3000]);assert.equal(record.email,'person@example.invalid');
});

test('Provider unverified-session errno 138 after confirmation retries the OAuth grant only',async()=>{
 let status=0,grant=0,account;
 const http={async json(url){
  const path=new URL(url).pathname;
  if(path.endsWith('/recovery_email/status')){status++;return {data:{verified:true}};}
  if(path.endsWith('/oauth/token')){
   grant++;
   if(grant===1)throw Object.assign(Error('Session confirmation not propagated'),{status:400,errno:138});
   return {data:{access_token:'a',refresh_token:'r',expires_in:3600}};
  }
  if(path.endsWith('/session/destroy'))return {data:{}};
  throw Error('Unexpected route');
 }};
 const res=await followNativeBrowserSession({sessionToken:token,email:'person@example.invalid',http,fetcher,
  checkVpn:async()=>{},saveAccount:v=>{account=v;return 'ok';},delay:async()=>{}});
 assert.equal(res,'ok');assert.equal(status,1);assert.equal(grant,2);
 assert.equal(account.refresh_token,'r');
});
