// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAuthorization}=require('../src/lib/provider-browser-auth.cjs');
const {completeBrowserOAuth}=require('../src/lib/oauth-browser-completion.cjs');
const registration={clientId:'f39a73e381a1b52f',redirectUri:'https://login.predator.example/callback',scope:'profile https://identity.mozilla.com/apps/vpn'};
function fixtures(){
 const flow=createAuthorization(registration);
 const seen=[];
 const fetcher=async(url,opts)=>{
  const data={url,method:opts.method};seen.push(data);
  if(url.endsWith('/v1/token'))return {ok:true,json:async()=>({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600})};
  if(url.endsWith('/v1/profile'))return {ok:true,json:async()=>({email:'owner@example.invalid',email_verified:true})};
  throw Error('Unexpected provider URL');
 };
 return {flow,seen,fetcher};
}
test('full registered OAuth code flow validates both provider calls and authorizes VPN before storing',async()=>{
 const f=fixtures();let passes=0;let saved=null;
 const id=await completeBrowserOAuth({
  fetcher:f.fetcher,registration,flow:f.flow,code:'test-code',
  active:()=>true,clock:()=>1_000_000,
  authorizeVpn:async token=>{assert.equal(token,'fixture-access');passes++;},
  saveAccount:credentials=>{assert.equal(passes,1);saved=credentials;return 'stored-account-1';}
 });
 assert.equal(id,'stored-account-1');
 assert.equal(saved.email,'owner@example.invalid');
 assert.equal(saved.oauthClientId,registration.clientId);
 assert.equal(saved.provider,'mozilla-registered-oidc');
 assert.equal(saved.expiresAt,4_600_000);
 assert.deepEqual(f.seen.map(x=>new URL(x.url).pathname),['/v1/token','/v1/profile']);
});
test('VPN entitlement rejection prevents account creation after successful OAuth',async()=>{
 const f=fixtures();let saved=0;
 await assert.rejects(completeBrowserOAuth({
  fetcher:f.fetcher,registration,flow:f.flow,code:'test-code',
  active:()=>true,authorizeVpn:async()=>{throw Error('VPN access denied');},
  saveAccount:()=>{saved++;},
 }),/VPN access denied/);
 assert.equal(saved,0);
});
test('Cancelled or replaced OAuth attempts cannot save credentials',async()=>{
 const f=fixtures();let current=true,saved=0;
 await assert.rejects(completeBrowserOAuth({
  fetcher:async(url,opts)=>{const result=await f.fetcher(url,opts);current=false;return result;},
  registration,flow:f.flow,code:'test-code',active:()=>current,
  authorizeVpn:async()=>{throw Error('Unexpected VPN request');},
  saveAccount:()=>{saved++;}
 }),/cancelled/);
 assert.equal(saved,0);
});
test('Invalid profile cannot create an account or run entitlement checks',async()=>{
 const f=fixtures();let passes=0,saved=0;
 await assert.rejects(completeBrowserOAuth({
  fetcher:async(url,opts)=>url.endsWith('/v1/profile')?
   {ok:true,json:async()=>({})}:f.fetcher(url,opts),
  registration,flow:f.flow,code:'test-code',active:()=>true,
  authorizeVpn:async()=>{passes++;},saveAccount:()=>{saved++;}
 }),/verified account email/);
 assert.equal(passes,0);assert.equal(saved,0);
});
test('Invalid expiry is bounded to one hour rather than an untrusted provider value',async()=>{
 const f=fixtures();let saved;
 await completeBrowserOAuth({
  fetcher:async(url,opts)=>url.endsWith('/v1/token')?
   {ok:true,json:async()=>({access_token:'fixture',refresh_token:'refresh',expires_in:Infinity})}:
   f.fetcher(url,opts),
  registration,flow:f.flow,code:'test-code',
  active:()=>true,clock:()=>1_000,authorizeVpn:async()=>{},
  saveAccount:x=>{saved=x;}
 });
 assert.equal(saved.expiresAt,3_601_000);
});
