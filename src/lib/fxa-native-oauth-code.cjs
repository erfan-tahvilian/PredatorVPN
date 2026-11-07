// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Firefox 134+ native OAuth WebChannel (fallback for legacy update prompts).
const crypto=require('node:crypto');
const {exchangeAuthorization,readAuthorizedProfile}=require('./provider-browser-auth.cjs');
const CLIENT='5882386c6d801776';
const REDIRECT='urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel';
const SCOPE='profile https://identity.mozilla.com/apps/vpn';
function createNativeOAuthFlow(){
 const verifier=crypto.randomBytes(32).toString('base64url');
 const state=crypto.randomBytes(32).toString('base64url');
 const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 const url=new URL('https://accounts.firefox.com/');
 for(const [key,value] of Object.entries({
   context:'oauth_webchannel_v1',service:'vpn',client_id:CLIENT,
   scope:SCOPE,state,redirect_uri:REDIRECT,
   code_challenge:challenge,code_challenge_method:'S256',access_type:'offline'
 }))url.searchParams.set(key,value);
 return {url:url.href,verifier,state,redirectUri:REDIRECT};
}
async function completeNativeOAuthCode({
 code,flow,fetcher,checkVpn,saveAccount,active=()=>true
}){
 if(!active())throw Error('Browser sign-in was cancelled.');
 const registration={clientId:CLIENT,redirectUri:REDIRECT,scope:SCOPE};
 const tokens=await exchangeAuthorization(fetcher,registration,flow,code);
 if(!active())throw Error('Browser sign-in was cancelled.');
 const email=await readAuthorizedProfile(fetcher,tokens.access_token);
 if(!active())throw Error('Browser sign-in was cancelled.');
 await checkVpn(tokens.access_token);
 if(!active())throw Error('Browser sign-in was cancelled.');
 if(!tokens.refresh_token)throw Error('Provider did not grant offline account access.');
 return saveAccount({
   ...tokens,email,provider:'mozilla-native-webchannel',
   expiresAt:Date.now()+(Number(tokens.expires_in)||3600)*1000
 });
}
module.exports={createNativeOAuthFlow,completeNativeOAuthCode,CLIENT,REDIRECT};
