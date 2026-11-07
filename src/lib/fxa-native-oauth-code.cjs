// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Firefox 134+ native OAuth WebChannel (fallback for legacy update prompts).
const crypto=require('node:crypto');
const {exchangeAuthorization,readAuthorizedProfile}=require('./provider-browser-auth.cjs');
const CLIENT='5882386c6d801776';
const REDIRECT='urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel';
const SCOPE='profile https://identity.mozilla.com/apps/vpn';
// Matches the provider-hosted desktop sign-in used by Arman's browser flow.
// The user's password, MFA and challenges remain on the provider's page.
function createLegacyBrowserSignInUrl(email=''){
 const url=new URL('https://accounts.firefox.com/');
 url.searchParams.set('context','fx_desktop_v3');
 url.searchParams.set('service','sync');
 url.searchParams.set('action','email');
 if(email)url.searchParams.set('email',email);
 return url.href;
}
function createNativeOAuthFlow(){
 const verifier=crypto.randomBytes(32).toString('base64url');
 const state=crypto.randomBytes(32).toString('base64url');
 const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
 const url=new URL('https://accounts.firefox.com/');
 for(const [key,value] of Object.entries({
   context:'oauth_webchannel_v1',service:'vpn',client_id:CLIENT,
   // Native WebChannel receives the code in a message rather than a URL redirect.
   // FxA's current query validator rejects the WebChannel URN when sent as
   // redirect_uri; the native client's registered callback applies server-side.
   scope:SCOPE,state,
   code_challenge:challenge,code_challenge_method:'S256',access_type:'offline'
 }))url.searchParams.set(key,value);
 return {url:url.href,verifier,state,redirectUri:REDIRECT};
}
async function completeNativeOAuthCode({
 code,flow,fetcher,checkVpn,saveAccount,active=()=>true
}){
 if(!active())throw Error('Browser sign-in was cancelled.');
 const registration={clientId:CLIENT,redirectUri:REDIRECT,scope:SCOPE};
 let tokens;
 try{tokens=await exchangeAuthorization(fetcher,registration,flow,code);}
 catch(error){const failure=Error('OAuth code exchange: '+error.message);failure.loginStage='oauth-token-exchange';throw failure;}
 if(!active())throw Error('Browser sign-in was cancelled.');
 let email;
 try{email=await readAuthorizedProfile(fetcher,tokens.access_token);}
 catch(error){const failure=Error('Authorized account profile: '+error.message);failure.loginStage='account-profile';throw failure;}
 if(!active())throw Error('Browser sign-in was cancelled.');
 try{await checkVpn(tokens.access_token);}
 catch(error){const failure=Error('VPN entitlement verification: '+error.message);failure.loginStage='vpn-entitlement';throw failure;}
 if(!active())throw Error('Browser sign-in was cancelled.');
 if(!tokens.refresh_token)throw Error('Provider did not grant offline account access.');
 return saveAccount({
   ...tokens,email,provider:'mozilla-native-webchannel',
   expiresAt:Date.now()+(Number(tokens.expires_in)||3600)*1000
 });
}
module.exports={createLegacyBrowserSignInUrl,createNativeOAuthFlow,completeNativeOAuthCode,CLIENT,REDIRECT};
