// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const crypto = require('node:crypto');
const {parseChallengeInit} = require('./service-challenge.cjs');
const UA = 'MozillaVPN/2.35.0 (sys:linux; iap:true)';
// Match desktop Firefox UA used by Mozilla VPN .
// Fastly's edge check is sensitive to UA + fetch-metadata consistency.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0';
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
      message:'The account provider did not offer a usable verification page. The login request was blocked by the provider (HTTP 406), before credentials could be checked.'
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
  constructor({transport = (...args)=>fetch(...args),captchaSolver=null,createTransport=null,browserChallenge=null} = {}) {
    this.cookies = new Map();
    this.transport=transport;
    this.captchaSolver=captchaSolver;
    // Optional factory for a fresh network session (tests / fallback).
    this.createTransport=typeof createTransport==='function'?createTransport:null;
    // Preferred: run Fastly's own script.js inside a hidden BrowserWindow bound to
    // the same Electron session the API uses (see challenge-browser.cjs).
    this.browserChallenge=typeof browserChallenge==='function'?browserChallenge:null;
  }
  async fetch(url, options = {}) {
    const u = new URL(url);
    const cookies = [...this.cookies.values()].filter(c => u.hostname === c.domain || u.hostname.endsWith('.'+c.domain)).map(c => c.pair).join('; ');
    // Match desktop Firefox control-plane headers: UA + Accept + identity encoding.
    // Do NOT invent Sec-Fetch defaults on API calls; challenge stages set them explicitly.
    // Accept-Encoding:identity avoids the gzip-only fingerprint linked to HTTP 406.
    const isFxA = ['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com'].includes(u.hostname);
    // Prefer the Chromium session UA when available so TLS/JA3 (Chrome) matches the
    // User-Agent string. Claiming Firefox while speaking Chrome TLS is a Fastly signal.
    const sessionUA = typeof this.transport?.session?.getUserAgent==='function'
      ? this.transport.session.getUserAgent()
      : null;
    // Always use desktop Firefox UA for FxA (Firefox-TLS). Session UA is Chrome/Electron
    // and mismatches the challenge answers Fastly expects for this API.
    const agent = isFxA ? BROWSER_UA : UA;
    const incoming = options.headers || {};
    const baseHeaders = {
      'User-Agent': agent,
      Accept: incoming.Accept || incoming.accept || (isFxA ? '*/*' : 'application/json'),
      'Accept-Encoding': incoming['Accept-Encoding'] || incoming['accept-encoding'] || 'identity',
      ...(cookies ? {Cookie: cookies} : {}),
    };
    // Challenge assets (script.js) return 400 under redirect:'error' but succeed when
    // redirects are followed. Keep non-GET account API calls strict.
    const method = String(options.method || 'GET').toUpperCase();
    const redirect = options.redirect || ((method === 'GET' || method === 'HEAD') ? 'follow' : 'error');
    const response = await this.transport(url, {...options, redirect, signal:AbortSignal.timeout(30000), headers:{...baseHeaders, ...incoming}});
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const domain = (raw.match(/;\s*domain=([^;]+)/i)?.[1] || u.hostname).replace(/^\./,'');
      // Propagate challenge cookies across all relevant FxA hosts so a clearance
      // obtained on accounts.firefox.com is also sent to api/oauth endpoints.
      const hosts = isFxA
        ? ['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com', domain]
        : [domain];
      for (const host of new Set(hosts)) {
        if (u.hostname === host || u.hostname.endsWith('.'+host) || host.endsWith('.'+domain) || host === domain) {
          this.cookies.set(host+':'+pair.split('=')[0], {domain: host, pair});
        }
      }
    }
    return response;
  }
  async json(url, {method = 'GET', body, authorization, maxChallengeAttempts=5} = {}) {
    // authorization may be a string or a zero-arg function. Functions are
    // evaluated per attempt so Hawk timestamps stay valid after a multi-second
    // challenge solve (OTP path).
    const buildOptions=()=>({
      method,
      body,
      headers:{
        'Content-Type':'application/json',
        ...(authorization?{Authorization:typeof authorization==='function'?authorization():authorization}:{}),
      },
    });
    let response = await this.fetch(url, buildOptions());
    // Fastly returns an EMPTY HTTP 406 from the account API while hosting its
    // interactive verification page on accounts.firefox.com. Checking only
    // the POST response body misses the real challenge entirely.
    // Never replay non-406 failures or network errors; only retry a confirmed
    // edge rejection after the provider's challenge has completed.
    // Challenge recovery retries up to 5 solved challenges: a clearance can still be rejected
    // when the follow-up request is treated as a new client by the edge.
    // OAuth token uses maxChallengeAttempts=1 then falls back to page-context fetch.
    const limit=Math.max(0, Number(maxChallengeAttempts)||0);
    for(let attempt=0; response.status===406 && attempt<limit; attempt++){
      const responseType=String(response.headers.get('content-type')||'').toLowerCase();
      const blockedBody=await response.text();
      if(responseType.includes('application/json') && blockedBody.trim()){
        let data=null;
        try{data=JSON.parse(blockedBody);}catch{}
        const error=Error(data?.message||'The account service rejected this request (HTTP 406).');
        error.status=406;error.errno=data?.errno;
        throw error;
      }
      try{await this.challenge();}
      catch(cause){
        const detail=describeVerificationFailure(cause);
        const error=Error(detail.message);
        error.code=detail.code;error.status=406;error.cause=cause;
        throw error;
      }
      // Prefer Chromium session jar for the retry (no manual Cookie header).
      // An explicit Cookie built from a partially synced Map can override the
      // jar and reintroduce HTTP 406 right after a successful solve.
      if(typeof this.transport.clearFxACookies==='function')this.cookies.clear();
      else await this.syncCookiesFromSession();
      response=await this.fetch(url,buildOptions());
    }
    if(response.status===406){
      await response.arrayBuffer();
      const isOauth=/\/oauth\/(token|authorization)\b/i.test(String(url));
      const error=Error(isOauth
        ? 'Mozilla blocked the OAuth token exchange (HTTP 406) after verification. The login challenge succeeded, but the token endpoint rejects this client profile. Retry later or use a Firefox-TLS capable build.'
        : 'The account service still rejects sign-in after successful verification (HTTP 406). Try again later or contact the provider.');
      error.code='ACCOUNT_PROVIDER_BLOCKED';error.status=406;
      throw error;
    }
    const raw = await response.text();
    let data; try { data = JSON.parse(raw || '{}'); } catch { throw Error(`The service returned an invalid response (HTTP ${response.status}).`); }
    if (!response.ok) { const e = Error(data.message || `Service request failed (HTTP ${response.status}).`); e.status = response.status; e.errno = data.errno; if(typeof data.email==='string'&&data.email.length<320)e.providerEmail=data.email; e.quota={limit:response.headers.get('x-quota-limit'),remaining:response.headers.get('x-quota-remaining'),reset:response.headers.get('x-quota-reset')}; throw e; }
    return {data, headers:response.headers};
  }
  async syncCookiesFromSession() {
    const ses=this.transport?.session;
    if(!ses?.cookies?.get)return;
    const urls=['https://api.accounts.firefox.com/','https://accounts.firefox.com/','https://oauth.accounts.firefox.com/','https://firefox.com/'];
    for(const url of urls){
      let list=[];
      try{list=await ses.cookies.get({url});}catch{continue;}
      for(const c of list){
        if(!c?.name)continue;
        const pair=`${c.name}=${c.value}`;
        const domain=String(c.domain||new URL(url).hostname).replace(/^\./,'');
        for(const host of ['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com',domain]){
          this.cookies.set(host+':'+c.name,{domain:host,pair});
        }
      }
    }
  }
  /** Ensure Fastly clearance before OTP / OAuth. Reuse a live _fs_ch_cp_ cookie
   *  from the session jar when present; only re-solve when missing. */
  async ensureFxAClearance() {
    const ses=this.transport?.session;
    if(ses?.cookies?.get){
      try{
        const list=await ses.cookies.get({domain:'firefox.com'});
        if(list.some(c=>String(c.name||'').startsWith('_fs_ch_cp_'))){
          // Session jar is authoritative; avoid Cookie-header overrides.
          this.cookies.clear();
          return;
        }
      }catch{/* fall through to solve */}
    }
    await this.challenge();
  }
  async challenge() {
    if (this.verifying) return this.verifying;
    this.verifying = (async()=>{
      // Same session as the API (shared-session model). Clear stale Fastly cookies, solve,
      // then pull every cookie Chromium stored back into the Map so the follow-up
      // API request sends a complete Cookie header (session jar alone has been
      // insufficient when an explicit partial Cookie header is also present).
      this.cookies.clear();
      if (typeof this.transport.clearFxACookies==='function') {
        await this.transport.clearFxACookies();
      }
      await this.solveChallenge();
      // Pull whatever the solver stored (Map + Chromium jar), then force-install
      // clearance onto every FxA origin in the session jar (multi-origin cookie install).
      await this.syncCookiesFromSession();
      if(typeof this.transport.installFxACookies==='function'){
        const pairs=[...new Map([...this.cookies.values()].map(c=>[c.pair.split('=')[0],c.pair])).values()];
        await this.transport.installFxACookies(pairs);
        // Prefer session jar alone for the follow-up API call.
        this.cookies.clear();
      }else{
        for (const cookie of [...this.cookies.values()]) {
          for (const host of ['api.accounts.firefox.com','accounts.firefox.com','oauth.accounts.firefox.com']) {
            this.cookies.set(host+':'+cookie.pair.split('=')[0], {domain:host, pair:cookie.pair});
          }
        }
      }
    })();
    try { return await this.verifying; } finally { this.verifying=null; }
  }
  async solveChallenge() {
    let lastResponseError=null;
    outer: for(let outer=0; outer<3; outer++) {
    // Clear prior short-lived challenge cookies before a fresh attempt on the
    // SAME session the API uses (Firefox-TLS: shared transport, fresh jar).
    this.cookies.clear();
    if (typeof this.transport.clearFxACookies==='function') {
      await this.transport.clearFxACookies();
    }
    // Prefer the API host (where 406 was seen); fall back to the site host.
    // Matches Firefox-TLS: API usually has no challenge page, but when it does the
    // cookie is issued with Domain=firefox.com for all FxA origins.
    for(const base of ['https://api.accounts.firefox.com', 'https://accounts.firefox.com']) {
      // Fastly serves the interactive challenge page for navigations, but returns
      // HTTP 400 when script.js is requested with navigation Sec-Fetch metadata.
      // Use browser-accurate headers per resource type.
      const pageHeaders = {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      };
      // script.js rejects Sec-Fetch-Dest:script with HTTP 400. Accept:*/* is required.
      // Challenge state cookies are short-lived (Max-Age≈10s); keep this path tight.
      const scriptHeaders = {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        Origin: base,
        Referer: base+'/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      };
      const apiHeaders = {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json',
        Origin: base,
        Referer: base+'/',
        'Content-Type': 'application/json',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      };
      const page = await (await this.fetch(base+'/', {headers:pageHeaders})).text();
      const prefix = page.match(/\/_fs-ch-[A-Za-z0-9]+/)?.[0];
      if (!prefix || !page.includes('Client Challenge')) continue;
      const root = base+prefix;
      // Fastly often answers the first script.js request with an empty HTTP 400
      // immediately after the challenge page; a quick retry with the same state cookie succeeds.
      let scriptResponse=null, script='';
      for (let attempt=0; attempt<3; attempt++) {
        scriptResponse = await this.fetch(root+'/script.js?reload=true', {headers:scriptHeaders});
        if (scriptResponse.ok) { script = await scriptResponse.text(); break; }
        await scriptResponse.arrayBuffer();
        scriptResponse=null;
      }
      if (!scriptResponse) continue;
      let {challenges,token} = parseChallengeInit(script,prefix);
      for(let round=0; round<5; round++) {
        const answers = [];
        for(const c of challenges) {
          if(c.ty==='pow') answers.push({ty:'pow', base:c.data.base, answer:solvePow(c.data.base,c.data.hash), hmac:c.data.hmac, expires:c.data.expires});
          else if(c.ty==='pat') {
            const r = await this.fetch(`${root}/pat?token=${encodeURIComponent(token)}`, {method:'POST', headers:{...apiHeaders, Accept:'text/plain'}});
            // 400/401 = platform cannot mint a Private Access Token; empty auth triggers PoW fallback.
            if ([400,401].includes(r.status)) { await r.arrayBuffer(); answers.push({ty:'pat', auth:''}); }
            else answers.push({ty:'pat', auth:(await r.json()).auth || ''});
          } else if(c.ty==='clientmetrics') answers.push({ty:'clientmetrics', webdriver:false, bot_detection_result:{bot_detected:false,bot_kind:null},browser_metrics:{client_data:'{}',error_trace:null},detector_results:{},v:2});
          else if(c.ty==='captcha') {
            if(!this.captchaSolver)throw Error('The account provider requires a human CAPTCHA response. Sign in again from the account screen.');
            const image=c.data?.image_b64;
            const answer=await this.captchaSolver(image);
            answers.push({ty:'captcha',answer});
          } else throw Error('The service requires an unsupported verification step.');
        }
        const r = await this.fetch(root+'/fst-post-back', {method:'POST', headers:apiHeaders, body:JSON.stringify({token,data:answers})});
        if(!r.ok) {
          lastResponseError=Error('Service verification failed.');
          lastResponseError.verificationStage='challenge-response';
          lastResponseError.verificationStatus=r.status;
          await r.arrayBuffer();
          continue outer; // refresh challenge state on next outer attempt
        }
        const data = await r.json();
        // Trust post-back success immediately. An extra probe request races the
        // short-lived clearance cookie (Max-Age often ~10s) and can clear a good
        // jar via continue-outer before the caller retries the API.
        if(data.status==='success') return;
        challenges=data.ch; token=data.tok;
        if(!Array.isArray(challenges) || !token) throw Error('Service verification did not complete.');
      }
    }
    } // outer
    if (lastResponseError) throw lastResponseError;
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
