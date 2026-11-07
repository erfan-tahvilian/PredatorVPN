// SPDX-License-Identifier: GPL-3.0-or-later
// Browser-based, registered Mozilla Accounts OAuth authorization-code + PKCE.
// Never impersonate Firefox, collect page credentials or accept WebChannel tokens.
'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const {URL,URLSearchParams}=require('node:url');

const AUTHORIZATION_URL='https://accounts.firefox.com/authorization';
const TOKEN_URL='https://oauth.accounts.firefox.com/v1/token';
const PROFILE_URL='https://profile.accounts.firefox.com/v1/profile';
const VPN_SCOPE='profile https://identity.mozilla.com/apps/vpn';
const FIREFOX_NATIVE_CLIENT='5882386c6d801776';
const ID=/^[0-9a-f]{16,64}$/i;
const random=()=>crypto.randomBytes(32).toString('base64url');
function readProviderRegistration(file){
  if(!fs.existsSync(file))return null;
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  const clientId=String(data.clientId||'').trim();
  if(!ID.test(clientId)||clientId.toLowerCase()===FIREFOX_NATIVE_CLIENT)throw Error('A separately registered provider OAuth client ID is required.');
  const redirectUri=String(data.redirectUri||'').trim();
  let uri;
  try{uri=new URL(redirectUri);}catch{throw Error('Provider OAuth redirect URI is invalid.');}
  if(uri.protocol!=='https:'||uri.username||uri.password||uri.hash||uri.search||!uri.hostname)throw Error('Provider OAuth redirect must be a registered HTTPS URI without query or fragment.');
  return Object.freeze({clientId,redirectUri:uri.href,scope:VPN_SCOPE});
}
function createAuthorization(registration){
  const verifier=random();
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const state=random(),nonce=random();
  const url=new URL(AUTHORIZATION_URL);
  for(const [name,value] of Object.entries({
    client_id:registration.clientId,redirect_uri:registration.redirectUri,
    response_type:'code',scope:registration.scope,state,nonce,
    code_challenge:challenge,code_challenge_method:'S256',access_type:'offline'
  }))url.searchParams.set(name,value);
  return Object.freeze({url:url.href,verifier,state,nonce});
}
function redirectResult(url,registration,flow){
  let actual;try{actual=new URL(url);}catch{return null;}
  const expected=new URL(registration.redirectUri);
  if(actual.protocol!==expected.protocol||actual.host!==expected.host||
      actual.pathname!==expected.pathname||actual.username||actual.password)return null;
  // Registered callback endpoints are compared exactly (never prefix-matched).
  if(actual.searchParams.getAll('state').length!==1||
     actual.searchParams.get('state')!==flow.state)throw Error('The account provider returned an invalid OAuth state.');
  if(actual.searchParams.has('error'))throw Error('Provider authorization was declined or cancelled.');
  const codes=actual.searchParams.getAll('code');
  if(codes.length!==1||!codes[0]||codes[0].length>2048)throw Error('Provider authorization did not return a valid code.');
  return codes[0];
}
function signInNavigationAllowed(url,registration){
  let u;try{u=new URL(url);}catch{return false;}
  if(u.protocol!=='https:'||u.username||u.password)return false;
  const h=u.hostname.toLowerCase();
  return h==='accounts.firefox.com'||h==='oauth.accounts.firefox.com'||
         h==='accounts.google.com'||h==='appleid.apple.com'||
         h==='accounts.googleusercontent.com'||h==='www.google.com'||
         h==='content.accounts.firefox.com';
}
async function exchangeAuthorization(fetcher,registration,flow,code){
  const body=JSON.stringify({
    grant_type:'authorization_code',client_id:registration.clientId,
    redirect_uri:registration.redirectUri,code,code_verifier:flow.verifier
  });
  const response=await fetcher(TOKEN_URL,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body,redirect:'error',signal:AbortSignal.timeout(30000)
  });
  if(!response.ok){await response.arrayBuffer();throw Error('The provider declined OAuth token exchange (HTTP '+response.status+').');}
  const data=await response.json();
  if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token)
    throw Error('The provider did not authorize offline access for this client.');
  return data;
}
async function readAuthorizedProfile(fetcher,token){
  const response=await fetcher(PROFILE_URL,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.arrayBuffer();throw Error('The provider rejected the authorized account profile (HTTP '+response.status+').');}
  const profile=await response.json();
  if(typeof profile.email!=='string'||!/^\S+@\S+\.\S+$/.test(profile.email))throw Error('The provider did not return a verified account email.');
  return profile.email;
}
module.exports={readProviderRegistration,createAuthorization,redirectResult,
  signInNavigationAllowed,exchangeAuthorization,readAuthorizedProfile,
  FIREFOX_NATIVE_CLIENT,AUTHORIZATION_URL,TOKEN_URL,PROFILE_URL};
