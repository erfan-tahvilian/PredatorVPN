// SPDX-License-Identifier: GPL-3.0-or-later
// Opt-in temporary subscription route for Firefox Accounts sign-in.
// Never replay credentials after an ambiguous POST timeout.
'use strict';
const {resolveBootstrapUpstream}=require('./bootstrap-proxy.cjs');
const ENDPOINT='https://api.accounts.firefox.com/v1/account/login';
const ALLOWED_TIMEOUT=9000;
const request=transport=>transport(ENDPOINT,{
 method:'POST',body:'{}',headers:{'Content-Type':'application/json'},
 signal:AbortSignal.timeout(ALLOWED_TIMEOUT)
});
function networkInterrupted(error){
 const message=[error?.message,error?.code,error?.cause?.message,error?.cause?.code].filter(Boolean).join(' ');
 return /timeout|timed.out|ERR_TIMED_OUT|ERR_CONNECTION_RESET|ECONNRESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_CHANGED|network.interrupted/i.test(message);
}
async function prepareFxARecovery({transport,options,resolveUpstream=resolveBootstrapUpstream}){
 if(typeof transport?.setAccountRecoveryProxy!=='function')throw Error('Firefox account recovery transport is unavailable.');
 if(!options?.subUrls?.length)throw Error('Enable Subscriptions and configure sources to allow Firefox account recovery.');
 // Probe the native session without sending a password. A 406 is reachable and
 // must be handled as provider verification; it is not a network timeout.
 try{await request(transport);return {route:'native',stop:async()=>{}};}
 catch(error){if(!networkInterrupted(error))throw error;}
 let session;
 try{
  session=await resolveUpstream({...options,max:8});
  const upstream=session.upstream;
  if(!upstream||upstream.type!=='socks5'||upstream.username||upstream.password)
    throw Error('Account recovery requires a local subscription tunnel without proxy credentials.');
  const rules=`socks5://${upstream.host}:${upstream.port}`;
  await transport.setAccountRecoveryProxy(rules);
  await request(transport);
  let stopped=false;
  const stop=async()=>{
   if(stopped)return;stopped=true;
   try{await transport.setAccountRecoveryProxy(null);}finally{await session.stop?.();}
  };
  return {route:'subscription',stop};
 }catch(error){
  await transport.setAccountRecoveryProxy(null).catch(()=>{});
  await session?.stop?.().catch(()=>{});
  const e=Error('Firefox account recovery could not establish a verified HTTPS route. No login credentials were sent.');
  e.code='FXA_RECOVERY_UNAVAILABLE';e.cause=error;throw e;
 }
}
module.exports={prepareFxARecovery,networkInterrupted};
