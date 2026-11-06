// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
// Account sign-in: in-app email/password, unblock code, email/TOTP and OAuth.
// No external browser redirect, password persistence or automated OTP replay.
const crypto=require('node:crypto');
const PREFIX='identity.mozilla.com/picl/v1/';
const CLIENT='5882386c6d801776'; // Legacy compatibility with existing accounts
const SCOPE='profile https://identity.mozilla.com/apps/vpn';
const UNBLOCK_TTL=15*60*1000;
function hkdf(input,info,length){return Buffer.from(crypto.hkdfSync('sha256',input,Buffer.alloc(32),info,length));}
function authPW(email,password){
 return hkdf(crypto.pbkdf2Sync(password,PREFIX+'quickStretch:'+email,1000,32,'sha256'),PREFIX+'authPW',32).toString('hex');
}
function hawk(method,url,session,body,now=Math.floor(Date.now()/1000),nonce=crypto.randomBytes(6).toString('base64url')){
 const expanded=hkdf(Buffer.from(session,'hex'),PREFIX+'sessionToken',64);
 const u=new URL(url);
 const hash=crypto.createHash('sha256').update('hawk.1.payload\napplication/json\n'+body+'\n').digest('base64');
 const normalized='hawk.1.header\n'+now+'\n'+nonce+'\n'+method+'\n'+u.pathname+u.search+'\n'+u.hostname+'\n'+(u.port||443)+'\n'+hash+'\n\n';
 const mac=crypto.createHmac('sha256',expanded.subarray(32)).update(normalized).digest('base64');
 return 'Hawk id="'+expanded.subarray(0,32).toString('hex')+'", ts="'+now+'", nonce="'+nonce+'", mac="'+mac+'", hash="'+hash+'"';
}
function normalizeCode(value){
 return String(value||'').replace(/[۰-۹]/g,c=>String(c.codePointAt(0)-0x6f0))
  .replace(/[٠-٩]/g,c=>String(c.codePointAt(0)-0x660))
  .replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
}
function normalizeEmail(value){return String(value||'').replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');}
class Auth {
 constructor(http,store){this.http=http;this.store=store;this.pending=null;this.unblockTimer=null;}
 cancel(){this.clearTimer();this.pending=null;}
 clearTimer(){if(this.unblockTimer)clearTimeout(this.unblockTimer);this.unblockTimer=null;}
 async request(path,data,session){
  const url='https://api.accounts.firefox.com/v1'+path;
  const body=JSON.stringify(data);
  return (await this.http.json(url,{method:'POST',body,authorization:session?hawk('POST',url,session,body):undefined})).data;
 }
 async loginAttempt(email,password,originalEmail='',unblockCode=''){
  const fields={email,authPW:authPW(email,password),verificationMethod:'email-2fa'};
  if(originalEmail)fields.originalLoginEmail=originalEmail;
  if(unblockCode)fields.unblockCode=unblockCode;
  try{return await this.request('/account/login',fields);}
  catch(error){
   if(error.errno!==107)throw error;
   delete fields.verificationMethod;
   return this.request('/account/login',fields);
  }
 }
 async login(email,password){
  email=normalizeEmail(email);
  if(!email||!password)throw Error('Enter your service account email and password.');
  this.cancel();
  let actualEmail=email,originalEmail='',response,error;
  try{response=await this.loginAttempt(email,password);}
  catch(err){error=err;}
  if(error?.errno===120&&typeof error.providerEmail==='string'
       &&error.providerEmail.toLowerCase()===email.toLowerCase()&&error.providerEmail!==email){
   actualEmail=error.providerEmail;originalEmail=email;error=null;
   try{response=await this.loginAttempt(actualEmail,password,originalEmail);}catch(err){error=err;}
  }
  if(error?.errno===125){
   await this.request('/account/login/send_unblock_code',{email:actualEmail});
   this.pending={method:'unblock-code',email:actualEmail,originalEmail,password,attempts:0,
      expiresAt:Date.now()+UNBLOCK_TTL};
   this.unblockTimer=setTimeout(()=>this.cancel(),UNBLOCK_TTL);
   this.unblockTimer.unref?.();
   return {needsCode:true,verificationMethod:'unblock-code'};
  }
  if(error)throw error;
  return this.startVerifiedSession(response,actualEmail);
 }
 async startVerifiedSession(response,email){
  if(!response?.sessionToken)throw Error('The account provider did not return a sign-in session.');
  this.clearTimer();
  const method=response.verificationMethod||(response.verified===false?'email-2fa':'none');
  this.pending={session:response.sessionToken,email,method,verified:false};
  if(response.verified===false||response.sessionVerified===false||
      response.emailVerified===false||(response.verified!==true&&response.verificationMethod)){
   return {needsCode:true,verificationMethod:method};
  }
  return this.complete();
 }
 async verify(value){
  if(!this.pending)throw Error('Start account sign-in again.');
  const pending=this.pending;
  if(pending.method==='unblock-code'){
   if(Date.now()>=pending.expiresAt){this.cancel();throw Error('The unblock code expired. Start sign-in again.');}
   if(pending.attempts>=5) {this.cancel();throw Error('Too many incorrect unblock codes. Start sign-in again.');}
   const code=normalizeCode(value).toUpperCase();
   if(!code||code.length>32)throw Error('Enter the unblock code from the provider email.');
   pending.attempts++;
   let response;
   try{response=await this.loginAttempt(pending.email,pending.password,pending.originalEmail,code);}
   catch(err){
    if(err.errno===125||err.errno===127)throw Error('The unblock code was not accepted. Check the latest email and try again.');
    throw err;
   }
   return this.startVerifiedSession(response,pending.email);
  }
  if(pending.method==='email'){ // legacy email confirmation link
   return this.complete();
  }
  const code=normalizeCode(value);
  if(!code||code.length>32)throw Error('Enter the email or authenticator verification code.');
  if(!pending.verified){
   const totp=pending.method==='totp-2fa';
   const response=await this.request(totp?'/session/verify/totp':'/session/verify_code',{code},pending.session);
   if(totp&&response?.success===false)throw Error('The authenticator code was not accepted.');
   pending.verified=true; // never submit the already-consumed code twice
  }
  return this.complete();
 }
 async complete(){
  if(!this.pending?.session)throw Error('Start account sign-in again.');
  const session=this.pending.session;
  const token=await this.request('/oauth/token',{client_id:CLIENT,grant_type:'fxa-credentials',
    scope:SCOPE,access_type:'offline'},session);
  if(!token?.access_token)throw Error('The account provider did not return an access token.');
  this.store.setAuth({...token,email:this.pending.email,expiresAt:Date.now()+(token.expires_in||86400)*1000});
  this.cancel();
  // A completed sign-in no longer needs the short-lived FxA session.
  try{await this.request('/session/destroy',{},session);}catch{/* OAuth credentials are already stored. */}
  return {needsCode:false};
 }
 async token(force=false){
  const auth=this.store.auth;
  if(!auth)throw Error('Sign in to your service account first.');
  // Legacy stored browser sessions are never created by current builds.
  if(auth.provider==='guardian-browser'){
   if(force)throw Error('The old session was rejected. Sign in again using email and password.');
   return auth.access_token;
  }
  if(!force&&Date.now()+60000<(auth.expiresAt||0))return auth.access_token;
  if(this.refreshing)return this.refreshing;
  const pending=this.refresh(auth);this.refreshing=pending;
  try{return await pending;}finally{if(this.refreshing===pending)this.refreshing=null;}
 }
 async refresh(auth){
  if(!auth.refresh_token){this.store.setAuth(null);throw Error('Your session expired. Sign in again.');}
  let renewed;
  try{
   if(auth.provider==='fxa-oidc'){
     if(!/^[a-f0-9]{16,64}$/i.test(auth.oauthClientId||''))throw Error('Browser sign-in client registration is unavailable. Sign in again.');
     renewed=(await this.http.json('https://oauth.accounts.firefox.com/v1/token',{
       method:'POST',body:JSON.stringify({client_id:auth.oauthClientId,
         grant_type:'refresh_token',refresh_token:auth.refresh_token})
     })).data;
   } else renewed=await this.request('/oauth/token',{client_id:CLIENT,grant_type:'refresh_token',
     refresh_token:auth.refresh_token,scope:SCOPE});
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
