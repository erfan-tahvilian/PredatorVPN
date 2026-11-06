// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
// OAuth authorization-code + PKCE for a provider-registered, public native client.
// No Firefox Desktop client ID, opaque browser cookies, external login passwords,
// provider WAF bypass or implicit/fragment token grants are accepted.
const http=require('node:http');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const AUTH_URL='https://accounts.firefox.com/authorization';
const TOKEN_URL='https://oauth.accounts.firefox.com/v1/token';
const FORBIDDEN_CLIENT_IDS=new Set(['5882386c6d801776','1b1a3e44c54fbb58','a2270f727f45f648','8269bacd7bbc7f80']);
function configForBrowserOAuth(value){
 if(!value||typeof value!=='object')return null;
 const clientId=String(value.clientId||'');
 const scope=String(value.scope||'');
 if(!/^[a-f0-9]{16,64}$/i.test(clientId)||FORBIDDEN_CLIENT_IDS.has(clientId.toLowerCase()))
   throw Error('Browser sign-in requires a provider-issued OAuth client ID registered for Predator VPN.');
 if(!scope||scope.length>400||!/^[a-zA-Z0-9:/._ -]+$/.test(scope)||!scope.split(' ').includes('profile'))
   throw Error('The provider must authorize a profile scope and the required FPN entitlement scopes.');
 const uri=String(value.redirectUri||'');
 let redirect;try{redirect=new URL(uri);}catch{throw Error('Provider registration must include a valid local redirect URI.');}
 if(redirect.protocol!=='http:'||redirect.hostname!=='127.0.0.1'||!redirect.port||Number(redirect.port)<1025||
   redirect.pathname!=='/callback'||redirect.search||redirect.hash||redirect.username||redirect.password)
   throw Error('The provider-registered native redirect must be http://127.0.0.1:<port>/callback with an unprivileged port.');
 return Object.freeze({clientId,scope,redirectUri:redirect.href,port:Number(redirect.port)});
}
function sameState(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
function providerError(text){
 const allowable=new Set(['access_denied','invalid_request','unauthorized_client','server_error','temporarily_unavailable','login_required','interaction_required']);
 return allowable.has(text)?text:'authorization_failed';
}
class BrowserOAuth {
 constructor({config,openExternal,fetcher,onProgress=()=>{},timeoutMs=480000}={}){
  this.config=configForBrowserOAuth(config);
  if(!this.config||typeof openExternal!=='function'||typeof fetcher!=='function')
   throw Error('Provider-approved browser authorization is not configured.');
  this.openExternal=openExternal;this.fetcher=fetcher;this.onProgress=onProgress;this.timeoutMs=timeoutMs;this.pending=null;
 }
 stage(value){try{this.onProgress(value);}catch{}}
 cancel(){
  if(!this.pending)return false;
  this.pending.cancelled=true;this.pending.abort.abort();this.pending.reject(Error('Browser sign-in was cancelled.'));return true;
 }
 async start(){
  if(this.pending)throw Error('A browser sign-in is already in progress.');
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const state=randomBytes(24).toString('base64url');
  let accept,reject;
  const callback=new Promise((resolve,fail)=>{accept=resolve;reject=fail;});
  callback.catch(()=>{});
  const attempt={reject,cancelled:false,abort:new AbortController()};
  this.pending=attempt;
  let received=false,timer=null;
  const expected=new URL(this.config.redirectUri);
  const server=http.createServer((req,res)=>{
   const fail=status=>{res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end();};
   if(req.method!=='GET'||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||
      req.headers.host!=='127.0.0.1:'+this.config.port)return fail(403);
   let uri;try{uri=new URL(req.url,this.config.redirectUri);}catch{return fail(400);}
   if(uri.pathname!==expected.pathname)return fail(404);
   if(!sameState(uri.searchParams.get('state'),state))return fail(403);
   if(received)return fail(409);
   const denied=uri.searchParams.get('error');
   if(denied){received=true;reject(Error('The account provider declined authorization ('+providerError(denied)+').'));return fail(400);}
   const code=uri.searchParams.get('code');
   if(!code||code.length<8||code.length>2048||/[\x00-\x1f\x7f]/.test(code))return fail(400);
   received=true;
   this.stage('callback');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'X-Content-Type-Options':'nosniff'});
   res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Predator VPN</title><body style="font:16px system-ui;padding:3rem;color:#222"><h1>Authorization received</h1><p>Return to Predator VPN to finish checking your account.</p></body></html>');
   accept(code);
  });
  try{
   await new Promise((resolve,fail)=>{
    const onError=error=>{server.removeListener('listening',onReady);fail(error);};
    const onReady=()=>{server.removeListener('error',onError);resolve();};
    server.once('error',onError);server.once('listening',onReady);
    server.listen(this.config.port,'127.0.0.1');
   }).catch(error=>{
    if(error.code==='EADDRINUSE')throw Error('Browser sign-in callback port is already in use. Close the application using that port or ask the provider to register another redirect.');
    throw error;
   });
   const u=new URL(AUTH_URL);
   for(const [key,val] of Object.entries({
     client_id:this.config.clientId,redirect_uri:this.config.redirectUri,scope:this.config.scope,
     response_type:'code',access_type:'offline',state,code_challenge:challenge,code_challenge_method:'S256'
   }))u.searchParams.set(key,val);
   timer=setTimeout(()=>reject(Error('Browser authorization did not return to the registered callback address before timeout.')),this.timeoutMs);
   timer.unref?.();
   this.stage('waiting');
   await this.openExternal(u.href);
   const code=await callback;
   this.stage('exchanging');
   const response=await this.fetcher(TOKEN_URL,{method:'POST',redirect:'error',
     headers:{'Content-Type':'application/json',Accept:'application/json'},
     body:JSON.stringify({client_id:this.config.clientId,grant_type:'authorization_code',
       redirect_uri:this.config.redirectUri,code,code_verifier:verifier}),
     signal:AbortSignal.any([attempt.abort.signal,AbortSignal.timeout(25000)])});
   if(!response.ok)throw Error('The account provider declined the authorization code exchange (HTTP '+response.status+').');
   const payload=await response.text();
   if(payload.length>65536)throw Error('Unexpectedly large OAuth response.');
   let data;try{data=JSON.parse(payload);}catch{throw Error('Invalid OAuth response.');}
   if(typeof data.access_token!=='string'||data.access_token.length<16||data.access_token.length>16384||
     (data.refresh_token!==undefined&&typeof data.refresh_token!=='string'))
     throw Error('The account provider did not issue a valid access token.');
   if(attempt.cancelled)throw Error('Browser sign-in was cancelled.');
   this.stage('authorized');
   return {...data,oauthClientId:this.config.clientId};
  }catch(error){
   if(attempt.cancelled)throw Error('Browser sign-in was cancelled.');
   throw error;
  }finally{
   if(timer)clearTimeout(timer);
   if(this.pending===attempt)this.pending=null;
   if(server.listening)server.close();
   this.stage('idle');
  }
 }
}
module.exports={BrowserOAuth,configForBrowserOAuth,AUTH_URL,TOKEN_URL};
