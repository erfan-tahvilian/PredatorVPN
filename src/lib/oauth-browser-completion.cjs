// SPDX-License-Identifier: GPL-3.0-or-later
// Finishes a provider-authorized OAuth code after strict callback validation.
// Keep access/refresh tokens in the privileged process; never return them to UI.
'use strict';
const {exchangeAuthorization,readAuthorizedProfile}=require('./provider-browser-auth.cjs');
function assertActive(active){
 if(active&&active()!==true)throw Error('Browser sign-in was cancelled.');
}
async function completeBrowserOAuth({fetcher,registration,flow,code,active,authorizeVpn,saveAccount,clock=Date.now}){
 if(typeof fetcher!=='function'||typeof authorizeVpn!=='function'||typeof saveAccount!=='function')
  throw Error('Browser OAuth completion requires a secure provider transport and account storage.');
 assertActive(active);
 const tokens=await exchangeAuthorization(fetcher,registration,flow,code);
 assertActive(active);
 const email=await readAuthorizedProfile(fetcher,tokens.access_token);
 assertActive(active);
 // This must succeed before a credential can become an application account.
 await authorizeVpn(tokens.access_token);
 assertActive(active);
 const lifetime=Number(tokens.expires_in);
 const expiresIn=Number.isFinite(lifetime)&&lifetime>60&&lifetime<86400
  ?lifetime:3600;
 const account={
  ...tokens,email,provider:'mozilla-registered-oidc',
  oauthClientId:registration.clientId,expiresAt:clock()+expiresIn*1000
 };
 return saveAccount(account);
}
module.exports={completeBrowserOAuth};
