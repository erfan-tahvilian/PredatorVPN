// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
// Account sign-in: in-app email/password, unblock code, email/TOTP and OAuth.
// No external browser redirect, password persistence or automated OTP replay.
const crypto=require('node:crypto');
const PREFIX='identity.mozilla.com/picl/v1/';
const CLIENT='5882386c6d801776'; // Legacy compatibility with existing accounts
const SCOPE='profile https://identity.mozilla.com/apps/vpn';
const UNBLOCK_TTL=15*60*1000;
const SESSION_TOKEN_HEX=/^[a-f0-9]{64}$/i;
function hkdf(input,info,length,salt=Buffer.alloc(32)){
 return Buffer.from(crypto.hkdfSync('sha256',input,salt,info,length));
}
function authPW(email,password){
 // FxA's password-derived key uses a single zero-byte HKDF salt.
 // Session-token HAWK expansion intentionally retains the default zero-filled salt.
 return hkdf(crypto.pbkdf2Sync(password,PREFIX+'quickStretch:'+email,1000,32,'sha256'),
   PREFIX+'authPW',32,Buffer.from([0])).toString('hex');
}
function hawk(method,url,session,body,now=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(6).toString('hex')){
 if(!SESSION_TOKEN_HEX.test(session||''))throw Error('The account provider returned an invalid session token.');
 const expanded=hkdf(Buffer.from(session,'hex'),PREFIX+'sessionToken',64);
 const u=new URL(url);
 // Match FxA's hex-encoded HAWK MAC and payload hash. GET has no payload hash.
 const hash=body===undefined||body===''?'':crypto.createHash('sha256').update('hawk.1.payload\napplication/json\n'+body+'\n').digest('hex');
 const port=u.port||(u.protocol==='https:'?'443':'80');
 const normalized='hawk.1.header\n'+now+'\n'+nonce+'\n'+method.toUpperCase()+'\n'+u.pathname+u.search+'\n'+u.hostname+'\n'+port+'\n'+hash+'\n\n';
 const mac=crypto.createHmac('sha256',expanded.subarray(32)).update(normalized).digest('hex');
 return 'Hawk id="'+expanded.subarray(0,32).toString('hex')+'", ts="'+now+'", nonce="'+nonce+'", mac="'+mac+'"'+(hash?', hash="'+hash+'"':'');
}
function normalizeCode(value){
 return String(value||'').replace(/[۰-۹]/g,c=>String(c.codePointAt(0)-0x6f0))
  .replace(/[٠-٩]/g,c=>String(c.codePointAt(0)-0x660))
  .replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
}
function normalizeEmail(value){return String(value||'').replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');}
class Auth {
 constructor(http,store){this.http=http;this.store=store;this.pending=null;this.unblockTimer=null;this.generation=0;this.activeLogin=null;this.activeVerify=null;}
 cancel(){
  this.generation++;
  this.clearTimer();
  const session=this.pending?.session;
  this.pending=null;
  this.activeLogin=null;
  this.activeVerify=null;
  // Best-effort cleanup: cancelled sessions must never become saved accounts.
  if(session)void this.request('/session/destroy',{},session).catch(()=>{});
 }
 clearTimer(){if(this.unblockTimer)clearTimeout(this.unblockTimer);this.unblockTimer=null;}
 async request(path,data,session,{onNotAcceptable}={}){
  const url='https://api.accounts.firefox.com/v1'+path;
  const body=JSON.stringify(data);
  return (await this.http.json(url,{method:'POST',body,
   authorization:session?hawk('POST',url,session,body):undefined,
   onNotAcceptable})).data;
 }
 async sessionVerified(sessionToken){
  // A legacy FxA session is authenticated with HAWK, as in Arman's
  // SessionVerified implementation. Never expose this token to the renderer.
  if(!SESSION_TOKEN_HEX.test(sessionToken||''))throw Error('The account provider returned an invalid session token.');
  const url='https://api.accounts.firefox.com/v1/recovery_email/status';
  const response=await this.http.json(url,{
   method:'GET',authorization:hawk('GET',url,sessionToken)
  });
  if(typeof response?.data?.verified!=='boolean')throw Error('The account provider returned an unexpected verification status.');
  return response.data.verified;
 }
 async loginAttempt(email,password,originalEmail='',unblockCode='',generation=this.generation){
  const fields={email,authPW:authPW(email,password),verificationMethod:'email-2fa'};
  if(originalEmail)fields.originalLoginEmail=originalEmail;
  if(unblockCode)fields.unblockCode=unblockCode;
  try{return await this.request('/account/login',fields);}
  catch(error){
   if(error.errno!==107)throw error;
   if(this.generation!==generation)throw Error('The account sign-in was cancelled.');
   delete fields.verificationMethod;
   return this.request('/account/login',fields);
  }
 }
 async login(email,password){
  email=normalizeEmail(email);
  if(!email||!password)throw Error('Enter your service account email and password.');
  if(this.activeLogin!==null||this.activeVerify!==null)throw Error('An account sign-in is already in progress.');
  this.cancel();
  const generation=this.generation;
  this.activeLogin=generation;
  const ensureActive=()=>{if(this.generation!==generation)throw Error('The account sign-in was cancelled.');};
  try{
   let actualEmail=email,originalEmail='',response,error;
   try{response=await this.loginAttempt(email,password,'','',generation);}
   catch(err){error=err;}
   ensureActive();
   if(error?.errno===120&&typeof error.providerEmail==='string'
        &&error.providerEmail.toLowerCase()===email.toLowerCase()&&error.providerEmail!==email){
    actualEmail=error.providerEmail;originalEmail=email;error=null;
    try{response=await this.loginAttempt(actualEmail,password,originalEmail,'',generation);}catch(err){error=err;}
    ensureActive();
   }
   if(error?.errno===125){
    await this.request('/account/login/send_unblock_code',{email:actualEmail});
    ensureActive();
    this.pending={method:'unblock-code',email:actualEmail,originalEmail,password,attempts:0,
       expiresAt:Date.now()+UNBLOCK_TTL};
    this.unblockTimer=setTimeout(()=>this.cancel(),UNBLOCK_TTL);
    this.unblockTimer.unref?.();
    return {needsCode:true,verificationMethod:'unblock-code'};
   }
   if(error)throw error;
   return await this.startVerifiedSession(response,actualEmail);
  }finally{
   if(this.activeLogin===generation)this.activeLogin=null;
  }
 }
 async startVerifiedSession(response,email){
  if(!SESSION_TOKEN_HEX.test(response?.sessionToken||''))throw Error('The account provider did not return a valid sign-in session.');
  this.clearTimer();
  const method=response.verificationMethod||(response.verified===false?'email-2fa':'none');
  this.pending={session:response.sessionToken,email,method,verified:false,expiresAt:Date.now()+UNBLOCK_TTL};
  this.unblockTimer=setTimeout(()=>this.cancel(),UNBLOCK_TTL);
  this.unblockTimer.unref?.();
  if(response.verified===false||response.sessionVerified===false||
      response.emailVerified===false||(response.verified!==true&&response.verificationMethod)){
   return {needsCode:true,verificationMethod:method};
  }
  return this.complete();
 }
 async verify(value){
  if(!this.pending)throw Error('Start account sign-in again.');
  const pending=this.pending;
  if(this.activeVerify===pending)throw Error('Account verification is already in progress.');
  this.activeVerify=pending;
  const ensurePending=()=>{if(this.pending!==pending)throw Error('The account sign-in was cancelled.');};
  try{
   if(pending.expiresAt&&Date.now()>=pending.expiresAt){
    this.cancel();throw Error('The verification session expired. Start sign-in again.');
   }
   if(pending.method==='unblock-code'){
    if(pending.attempts>=5){this.cancel();throw Error('Too many incorrect unblock codes. Start sign-in again.');}
    const code=normalizeCode(value).toUpperCase();
    if(!code||code.length>32)throw Error('Enter the unblock code from the provider email.');
    pending.attempts++;
    let response,error;
    try{response=await this.loginAttempt(pending.email,pending.password,pending.originalEmail,code);}
    catch(err){error=err;}
    ensurePending();
    if(error?.errno===125||error?.errno===127)throw Error('The unblock code was not accepted. Check the latest email and try again.');
    if(error)throw error;
    return await this.startVerifiedSession(response,pending.email);
   }
   if(pending.method==='email'){ // confirmation link must be verified server-side
    const verified=await this.sessionVerified(pending.session);
    ensurePending();
    if(!verified)return {needsCode:true,verificationMethod:'email'};
    pending.verified=true;
    return await this.complete();
   }
   const code=normalizeCode(value);
   if(!code||code.length>32)throw Error('Enter the email or authenticator verification code.');
   if(!pending.verified){
    const totp=pending.method==='totp-2fa';
    const response=await this.request(totp?'/session/verify/totp':'/session/verify_code',{code},pending.session);
    ensurePending();
    if(totp&&response?.success===false)throw Error('The authenticator code was not accepted.');
    pending.verified=true; // never submit the already-consumed code twice
   }
   return await this.complete();
  }finally{
   if(this.activeVerify===pending)this.activeVerify=null;
  }
 }
 async complete(){
  const pending=this.pending;
  if(!pending?.session)throw Error('Start account sign-in again.');
  const session=pending.session;
  let token,alternateTried=false,alternateRejected406=false;
  try{
    token=await this.request('/oauth/token',{client_id:CLIENT,grant_type:'fxa-credentials',
      scope:SCOPE,access_type:'offline'},session,{onNotAcceptable:async()=>{
      alternateTried=true;
      const {exchangeSessionWithOAuthCode}=require('./fxa-session-code-grant.cjs');
      try{return await exchangeSessionWithOAuthCode({
        json:(url,options)=>this.http.json(url,{...options,challengeOn406:false})
      },session,hawk);}
      catch(error){
        if(error?.status===406){alternateRejected406=true;return null;}
        throw error;
      }
    }});
  }catch(error){
    // Preserve the actual failure point instead of showing a generic
    // challenge-page error after BOTH legitimate OAuth grants were refused.
    if(alternateRejected406&&error?.status===406){
      const blocked=Error('Sign-in reached OAuth token issuance, but Mozilla returned HTTP 406 for both the direct and authorization-code grants. No usable verification page was provided. No verification code was resubmitted automatically. Check authorization for this OAuth client with the account provider.');
      blocked.code='FXA_OAUTH_GRANTS_REJECTED';
      blocked.status=406;
      blocked.loginStage='oauth-token';
      throw blocked;
    }
    // Non-Control transports can still report 406 directly. Only retry
    // the alternate grant if the earlier fallback has not run already.
    if(error.status!==406||alternateTried)throw error;
    const {exchangeSessionWithOAuthCode}=require('./fxa-session-code-grant.cjs');
    token=await exchangeSessionWithOAuthCode(this.http,session,hawk);
  }
  // A late response from a cancelled, timed-out or replaced sign-in must
  // never create an account or be attributed to another pending email.
  if(this.pending!==pending)throw Error('The account sign-in was cancelled.');
  if(!token?.access_token)throw Error('The account provider did not return an access token.');
  this.store.setAuth({...token,email:pending.email,expiresAt:Date.now()+(token.expires_in||86400)*1000});
  this.pending=null;
  this.cancel();
  // A completed sign-in no longer needs the short-lived FxA session.
  try{await this.request('/session/destroy',{},session);}catch{/* OAuth credentials are already stored. */}
  return {needsCode:false};
 }
 async token(force=false){
  const auth=this.store.auth;
  if(!auth)throw Error('Sign in to your service account first.');
  // Preserve encrypted legacy credentials, but never activate or refresh
  // browser sessions once the browser-login feature has been removed.
  if(auth.provider==='guardian-browser'||auth.provider==='fxa-oidc')
    throw Error('This legacy browser session is no longer supported. Sign in again with email and password.');
  if(!force&&Date.now()+60000<(auth.expiresAt||0))return auth.access_token;
  if(this.refreshing)return this.refreshing;
  const pending=this.refresh(auth);this.refreshing=pending;
  try{return await pending;}finally{if(this.refreshing===pending)this.refreshing=null;}
 }
 async refresh(auth){
  if(!auth.refresh_token){this.store.setAuth(null);throw Error('Your session expired. Sign in again.');}
  let renewed;
  try{
   if(auth.provider==='mozilla-registered-oidc'||auth.provider==='mozilla-native-webchannel'){
    const native=auth.provider==='mozilla-native-webchannel';
    const clientId=native?CLIENT:auth.oauthClientId;
    if(!/^[0-9a-f]{16,64}$/i.test(clientId||'')||(!native&&clientId===CLIENT))
      throw Error('The OAuth client identity is missing or invalid.');
    renewed=(await this.http.json('https://oauth.accounts.firefox.com/v1/token',{
     method:'POST',body:JSON.stringify({client_id:clientId,grant_type:'refresh_token',
       refresh_token:auth.refresh_token})
    })).data;
   }else{
    renewed=await this.request('/oauth/token',{client_id:CLIENT,grant_type:'refresh_token',
      refresh_token:auth.refresh_token,scope:SCOPE});
   }
  }
  catch(err){if([400,401,403].includes(err.status)&&this.store.auth===auth)this.store.setAuth(null);throw err;}
  if(!renewed.access_token)throw Error('Token refresh returned no access token.');
  if(this.store.auth!==auth)throw Error('Account changed while refreshing the session.');
  this.store.setAuth({...auth,...renewed,refresh_token:renewed.refresh_token||auth.refresh_token,
    expiresAt:Date.now()+(renewed.expires_in||86400)*1000});
  return renewed.access_token;
 }
}
module.exports={Auth,hkdf,authPW,hawk,normalizeCode,normalizeEmail};
