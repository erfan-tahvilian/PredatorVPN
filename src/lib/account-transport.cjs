// SPDX-License-Identifier: GPL-3.0-or-later
// Account API requests use isolated, in-memory Chromium sessions rather than
// inheriting any proxy applied to the application window. An OS-level VPN route
// is not bypassed by this setting; direct here means "no Chromium proxy".
const TRANSIENT=/\b(?:ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ETIMEDOUT|ECONNRESET|EPIPE)\b/i;
const APPROVED=new Set(['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com','vpn.mozilla.org','firefox.settings.services.mozilla.com']);
const FXA_COOKIE_URLS=[
  'https://api.accounts.firefox.com/',
  'https://accounts.firefox.com/',
  'https://oauth.accounts.firefox.com/',
  'https://firefox.com/',
];
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
async function clearFxACookies(ses){
  if(!ses?.cookies?.get||!ses?.cookies?.remove)return;
  for(const url of FXA_COOKIE_URLS){
    try{
      const list=await ses.cookies.get({url});
      for(const c of list){
        try{await ses.cookies.remove(url,c.name);}catch{/* best-effort */}
      }
    }catch{/* best-effort */}
  }
  try{
    const domainCookies=await ses.cookies.get({domain:'firefox.com'});
    for(const c of domainCookies){
      const host=(c.domain||'firefox.com').replace(/^\./,'');
      const url=`https://${host}${c.path||'/'}`;
      try{await ses.cookies.remove(url,c.name);}catch{/* best-effort */}
    }
  }catch{/* best-effort */}
}
function createAccountTransport({createSession,systemFetch,fxaProxyMode='direct'}){
  if(!['direct','system'].includes(fxaProxyMode))throw Error('Invalid FxA proxy mode');
  const isolated=createSession();
  if(!isolated||typeof isolated.setProxy!=='function'||typeof isolated.fetch!=='function')throw Error('Isolated account session is unavailable');
  const ready=isolated.setProxy({mode:'direct'});
  let bootstrapProxyRules=null;
  async function accountFetch(url,options={}){
    const target=new URL(url);
    if(target.protocol!=='https:'||!APPROVED.has(target.hostname))throw Error('Unapproved account-service endpoint');
    await ready;
    // The temporary proxy is for Guardian only. FxA token refresh remains direct.
    // Await Chromium's proxy change before starting the request; otherwise the
    // first Guardian call may escape through the previous direct route (HTTP 451).
    const useBootstrap=Boolean(bootstrapProxyRules)&&['vpn.mozilla.org','firefox.settings.services.mozilla.com'].includes(target.hostname);
    await isolated.setProxy(useBootstrap
      ? {mode:'fixed_servers',proxyRules:bootstrapProxyRules}
      : {mode:target.hostname==='vpn.mozilla.org'||(
          fxaProxyMode==='system'&&['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com'].includes(target.hostname)
        )?'system':'direct'});
    const method=(options.method||'GET').toUpperCase();
    try {return await isolated.fetch(url,options);}
    catch(error){
      if(!useBootstrap&&isTransient(error)&&(method==='GET'||method==='HEAD')){
        try{return await systemFetch(url,options);}
        catch(fallback){throw friendlyAccountNetworkError(fallback);}
      }
      throw friendlyAccountNetworkError(error);
    }
  }
  // Shared jar helpers: challenge must clear stale Fastly cookies on the SAME
  // session the API uses (shared-session model: shared transport, fresh jar).
  accountFetch.setBootstrapProxy=async(proxyRules)=>{
    bootstrapProxyRules=proxyRules||null;
    if(!isolated?.setProxy)return;
    if(bootstrapProxyRules)await isolated.setProxy({mode:'fixed_servers',proxyRules:bootstrapProxyRules});
    else await isolated.setProxy({mode:'direct'});
  };
  accountFetch.clearFxACookies=()=>clearFxACookies(isolated);
  accountFetch.session=isolated;
  /** Install name=value pairs onto every FxA origin (Domain=.firefox.com style). */
  accountFetch.installFxACookies=async(pairs=[])=>{
    if(!isolated?.cookies?.set||!pairs.length)return;
    const expires=Math.floor(Date.now()/1000)+3600;
    for(const pair of pairs){
      const eq=pair.indexOf('=');
      if(eq<=0)continue;
      const name=pair.slice(0,eq);
      const value=pair.slice(eq+1);
      for(const url of FXA_COOKIE_URLS){
        try{
          await isolated.cookies.set({
            url,
            name,
            value,
            path:'/',
            domain:'.firefox.com',
            secure:true,
            httpOnly:true,
            sameSite:'no_restriction',
            expirationDate:expires,
          });
        }catch{/* best-effort per origin */}
      }
    }
  };
  return accountFetch;
}
module.exports={createAccountTransport,isTransient,friendlyAccountNetworkError};
