// SPDX-License-Identifier: GPL-3.0-or-later
// Account API requests use isolated, in-memory Chromium sessions rather than
// inheriting any proxy applied to the application window. An OS-level VPN route
// is not bypassed by this setting; direct here means "no Chromium proxy".
const {fetchPublicH2,PUBLIC_ORIGIN,PUBLIC_PATH}=require('./http2-public-fallback.cjs');
const TRANSIENT=/\b(?:ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ETIMEDOUT|ECONNRESET|EPIPE)\b/i;
const APPROVED=new Set(['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com','vpn.mozilla.org','firefox.settings.services.mozilla.com']);
function isTransient(error) {
  const candidate=[error?.code,error?.message,error?.cause?.code,error?.cause?.message].filter(Boolean).join(' ');
  return TRANSIENT.test(candidate);
}
function friendlyAccountNetworkError(error) {
  if(!isTransient(error))return error;
  const e=new Error('The account service connection was interrupted. Check your network and retry. Verification requests are never automatically resubmitted.');
  e.code='ACCOUNT_NETWORK_INTERRUPTED';
  e.cause=error;
  return e;
}
function createAccountTransport({createSession,systemFetch,publicH2=fetchPublicH2}){
  const isolated=createSession();
  if(!isolated||typeof isolated.setProxy!=='function'||typeof isolated.fetch!=='function')throw Error('Isolated account session is unavailable');
  const ready=isolated.setProxy({mode:'direct'});
  return async function accountFetch(url,options={}){
    const target=new URL(url);
    if(target.protocol!=='https:'||!APPROVED.has(target.hostname))throw Error('Unapproved account-service endpoint');
    await ready;
    const method=(options.method||'GET').toUpperCase();
    // Chromium owns Set-Cookie and Cookie for every FxA origin. Explicit
    // credentials are required for the shared, domain-scoped cookie jar on
    // network requests initiated in Electron's main process.
    try {return await isolated.fetch(url,{...options,credentials:'include'});}
    catch(error){
      // Only idempotent reads can safely be retried on another network stack.
      // POST (verification codes, sign-in, token refresh) must NOT be replayed.
      if(isTransient(error)&&(method==='GET'||method==='HEAD')){
        // Independent, standards-based HTTP/2 is reserved for public Remote
        // Settings reads. Never use it to retry sign-in, OAuth or HTTP 406.
        if(target.origin===PUBLIC_ORIGIN&&target.pathname===PUBLIC_PATH&&!target.search){
          try{return await publicH2(url,{method});}catch{/* Keep existing safe read fallback. */}
        }
        try{return await systemFetch(url,{...options,credentials:'include'});}
        catch(fallback){throw friendlyAccountNetworkError(fallback);}
      }
      throw friendlyAccountNetworkError(error);
    }
  };
}
module.exports={createAccountTransport,isTransient,friendlyAccountNetworkError};
