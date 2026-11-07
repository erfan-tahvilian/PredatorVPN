// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const crypto = require('node:crypto');
const {parseChallengeInit} = require('./service-challenge.cjs');
const UA = 'MozillaVPN/2.35.0 (sys:linux; iap:true)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Translate only locally classified provider verification failures. Never return
// raw third-party challenge contents, cookies, tokens or URLs to the renderer.
function describeVerificationFailure(cause) {
  const stage=cause?.verificationStage;
  const status=cause?.verificationStatus;
  if(stage==='challenge-script' && Number.isInteger(status)) {
    return {
      code:'ACCOUNT_VERIFICATION_SCRIPT_REJECTED',
      message:'The account provider refused its verification script (HTTP '+status+'). The account site is reachable, but the provider did not accept this verification session. Re-entering your password will not resolve this; try again later or contact the account provider.'
    };
  }
  if(stage==='challenge-response' && Number.isInteger(status)) {
    return {
      code:'ACCOUNT_VERIFICATION_RESPONSE_REJECTED',
      message:'The account provider rejected the verification response (HTTP '+status+'). No further password attempts were made. Please retry later or contact the account provider.'
    };
  }
  if(stage==='challenge-discovery') {
    return {
      code:'ACCOUNT_VERIFICATION_UNAVAILABLE',
      message:'The account provider rejected an account API request (HTTP 406) and did not supply a usable verification page. Browser sign-in may already have succeeded; the separate session or token request was not accepted.'
    };
  }
  if(cause?.code==='ACCOUNT_NETWORK_INTERRUPTED' || cause?.name==='TimeoutError' || cause?.name==='AbortError') {
    return {
      code:'ACCOUNT_VERIFICATION_NETWORK_ERROR',
      message:'The account provider verification request was interrupted or timed out. Please check the network connection and retry once.'
    };
  }
  return {
    code:'ACCOUNT_PROVIDER_CHALLENGE_FAILED',
    message:'The account provider could not complete its verification step. This may be a provider policy or unsupported verification method; no password retry was attempted.'
  };
}
function solvePow(base, hash) {
  for (const a of ALPHABET) for (const b of ALPHABET) {
    if (crypto.createHash('sha256').update(base+a+b).digest('hex') === hash) return a+b;
  }
  throw Error('Unable to complete the server proof-of-work challenge.');
}
class Control {
  constructor({transport = (...args)=>fetch(...args),captchaSolver=null,browserManagedCookies=false} = {}) { this.cookies = new Map(); this.transport=transport;this.captchaSolver=captchaSolver;this.browserManagedCookies=browserManagedCookies; }
  async fetch(url, options = {}) {
    const u = new URL(url);
    // When using a real Electron session, let Chromium enforce cookie domain,
    // path, expiry and SameSite rules. Do not override its Cookie header.
    const cookies = this.browserManagedCookies ? '' : [...this.cookies.values()].filter(c => u.hostname === c.domain || u.hostname.endsWith('.'+c.domain)).map(c => c.pair).join('; ');
    // Keep account API and verification requests on a consistent client profile.
    const agent = ['api.accounts.firefox.com','accounts.firefox.com'].includes(u.hostname) ? BROWSER_UA : UA;
    const response = await this.transport(url, {...options, redirect:'error', signal:AbortSignal.timeout(30000), headers:{'User-Agent':agent, Accept:'application/json', ...(cookies ? {Cookie:cookies} : {}), ...options.headers}});
    if(!this.browserManagedCookies)for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const domain = (raw.match(/;\s*domain=([^;]+)/i)?.[1] || u.hostname).replace(/^\./,'');
      if (u.hostname === domain || u.hostname.endsWith('.'+domain)) this.cookies.set(domain+':'+pair.split('=')[0], {domain,pair});
    }
    return response;
  }
  async json(url, {method = 'GET', body, authorization, onNotAcceptable, challengeOn406=true} = {}) {
    const options = {method,body,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}), ...(authorization ? {Authorization:authorization}: {})}};
    let response = await this.fetch(url, options);
    // Fastly returns an EMPTY HTTP 406 from the account API while hosting its
    // interactive verification page on accounts.firefox.com. Checking only
    // the POST response body misses the real challenge entirely.
    // Never replay non-406 failures or network errors; only retry a confirmed
    // edge rejection after the provider's challenge has completed.
    for(let attempt=0; response.status===406 && attempt<2; attempt++){
      const responseType=String(response.headers.get('content-type')||'').toLowerCase();
      const blockedBody=await response.text();
      if(responseType.includes('application/json') && blockedBody.trim()){
        let data=null;
        try{data=JSON.parse(blockedBody);}catch{}
        const error=Error(data?.message||'The account service rejected this request (HTTP 406).');
        error.status=406;error.errno=data?.errno;
        throw error;
      }
      // FxA permits a session-authenticated authorization-code grant as an
      // alternative when its direct credentials grant receives an empty 406.
      // Try that authorized grant once, before interacting with a challenge.
      if(!challengeOn406){
        const error=Error('The account provider refused the OAuth request (HTTP 406).');
        error.status=406;throw error;
      }
      if(attempt===0&&typeof onNotAcceptable==='function'){
        const alternative=await onNotAcceptable();
        if(alternative?.access_token)return {data:alternative,headers:response.headers};
      }
      try{await this.challenge();}
      catch(cause){
        const detail=describeVerificationFailure(cause);
        const error=Error(detail.message);
        error.code=detail.code;error.status=406;error.cause=cause;
        throw error;
      }
      response=await this.fetch(url,options);
    }
    if(response.status===406){
      await response.arrayBuffer();
      const error=Error('The account service still rejects sign-in after successful verification (HTTP 406). Try again later or contact the provider.');
      error.code='ACCOUNT_PROVIDER_BLOCKED';error.status=406;
      throw error;
    }
    const raw = await response.text();
    let data; try { data = JSON.parse(raw || '{}'); } catch { throw Error(`The service returned an invalid response (HTTP ${response.status}).`); }
    if (!response.ok) { const e = Error(data.message || `Service request failed (HTTP ${response.status}).`); e.status = response.status; e.errno = data.errno; if(typeof data.email==='string'&&data.email.length<320)e.providerEmail=data.email; e.quota={limit:response.headers.get('x-quota-limit'),remaining:response.headers.get('x-quota-remaining'),reset:response.headers.get('x-quota-reset')}; throw e; }
    return {data, headers:response.headers};
  }
  async challenge() {
    if (this.verifying) return this.verifying;
    this.verifying = (async()=>{
      // A previous clearance can hide the challenge page even when the API
      // rejects that clearance. Keep the main session while verifying afresh.
      const solver = new Control({transport:this.transport,captchaSolver:this.captchaSolver,browserManagedCookies:this.browserManagedCookies});
      await solver.solveChallenge();
      if(!this.browserManagedCookies)for (const [key,cookie] of solver.cookies) this.cookies.set(key,cookie);
    })();
    try { return await this.verifying; } finally { this.verifying=null; }
  }
  async solveChallenge() {
    for(const base of ['https://api.accounts.firefox.com', 'https://accounts.firefox.com']) {
      const headers = {'User-Agent':BROWSER_UA, Accept:'text/html'};
      const page = await (await this.fetch(base+'/', {headers})).text();
      const prefix = page.match(/\/_fs-ch-[A-Za-z0-9]+/)?.[0];
      if (!prefix || !page.includes('Client Challenge')) continue;
      const root = base+prefix;
      const scriptResponse = await this.fetch(root+'/script.js?reload=true', {headers});
      if (!scriptResponse.ok) { await scriptResponse.arrayBuffer(); const error=Error(`Service verification could not load (HTTP ${scriptResponse.status}). Try again.`);error.verificationStage='challenge-script';error.verificationStatus=scriptResponse.status;throw error; }
      const script = await scriptResponse.text();
      let {challenges,token} = parseChallengeInit(script,prefix);
      for(let round=0; round<3; round++) {
        const answers = [];
        for(const c of challenges) {
          if(c.ty==='pow') answers.push({ty:'pow', base:c.data.base, answer:solvePow(c.data.base,c.data.hash), hmac:c.data.hmac, expires:c.data.expires});
          else if(c.ty==='pat') {
            const r = await this.fetch(`${root}/pat?token=${encodeURIComponent(token)}`, {method:'POST', headers:{...headers,Origin:base,'Content-Type':'application/json'}});
            answers.push({ty:'pat', auth:[400,401].includes(r.status) ? '' : (await r.json()).auth});
          } else if(c.ty==='clientmetrics') answers.push({ty:'clientmetrics', webdriver:false, bot_detection_result:{bot_detected:false,bot_kind:null},browser_metrics:{client_data:'{}',error_trace:null},detector_results:{},v:2});
          else if(c.ty==='captcha') {
            if(!this.captchaSolver)throw Error('The account provider requires a human CAPTCHA response. Sign in again from the account screen.');
            const image=c.data?.image_b64;
            const answer=await this.captchaSolver(image);
            answers.push({ty:'captcha',answer});
          } else throw Error('The service requires an unsupported verification step.');
        }
        const r = await this.fetch(root+'/fst-post-back', {method:'POST', headers:{...headers,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token,data:answers})});
        if(!r.ok) {const error=Error('Service verification failed.');error.verificationStage='challenge-response';error.verificationStatus=r.status;throw error;}
        const data = await r.json();
        if(data.status==='success') return;
        challenges=data.ch; token=data.tok;
        if(!Array.isArray(challenges) || !token) throw Error('Service verification did not complete.');
      }
    }
    const error=Error('Provider verification page unavailable');error.verificationStage='challenge-discovery';throw error;
  }
}
function candidates(records) {
  const output = [];
  for(const record of records) {
    const country = record.country || record;
    if (!country.code || country.name === 'CatchAll Anycast') continue;
    for(const city of country.cities || []) for(const server of city.servers || []) {
      if(server.quarantined) continue;
      const connect = (server.protocols || []).find(p=>p.name==='connect');
      if(server.protocols?.length && !connect) continue;
      const host=connect?.host || server.hostname, port=connect?.port || server.port || 443;
      if(host) output.push({id:`${country.code}/${city.code}/${host}:${port}`, country:country.name, code:country.code, city:String(city.name||'').trim().toLowerCase()===String(country.name||'').trim().toLowerCase()?'':String(city.name||'').trim(), cityCode:city.code,host,port});
    }
  }
  return output;
}
class Guardian {
  constructor(control, auth) { this.http = control; this.auth = auth; }
  async request(path, method = 'GET', retry = true) {
    try { return await this.http.json('https://vpn.mozilla.org/api/v1/fpn/'+path, {method, authorization:'Bearer '+await this.auth.token()}); }
    catch(e) { if (e.status === 401 && retry) { await this.auth.token(true); return this.request(path,method,false); } throw e; }
  }
  async pass() {
    let r;
    try { r = await this.request('token'); } catch(e) { if(e.status!==403) throw e; await this.request('activate','POST'); r = await this.request('token'); }
    if(!r.data.token) throw Error('Guardian returned no proxy pass.');
    const expiry = (()=>{try{return JSON.parse(Buffer.from(r.data.token.split('.')[1],'base64url')).exp;}catch{return undefined;}})();
    return {token:r.data.token, expiresAt:(r.data.expires_at || expiry || Math.floor(Date.now()/1000)+3600)*1000,quotaLimit:r.headers.get('x-quota-limit'),quotaRemaining:r.headers.get('x-quota-remaining'),quotaReset:r.headers.get('x-quota-reset')};
  }
  async servers() { return candidates((await this.http.json('https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/vpn-serverlist/records')).data.data || []); }
  async account() {
    const data=(await this.request('status')).data;
    if(data.limited_bandwidth)try{const pass=await this.pass();data.quotaRemaining=pass.quotaRemaining;data.quotaLimit=pass.quotaLimit;data.quotaReset=pass.quotaReset;}catch{/* Entitlement can still be shown while quota is unavailable. */}
    return data;
  }
}
module.exports = {Control, Guardian, candidates, solvePow, describeVerificationFailure};
