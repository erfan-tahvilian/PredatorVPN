// SPDX-License-Identifier: GPL-3.0-or-later
// Provider-hosted authorization and PKCE. Do not collect passwords or email OTPs.
// Accept ONLY local loopback redirects and never log authorization codes or tokens.
const http=require('node:http');
const {randomBytes,createHash}=require('node:crypto');
const BASE='https://vpn.mozilla.org';
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const HOSTS=new Set(['127.0.0.1','localhost','[::1]']);
const MAX_CODE_LENGTH=2048;
function isLocalCallback(req,port){
  if(!LOOPBACK.has(req.socket.remoteAddress)||req.method!=='GET')return false;
  const authority=String(req.headers.host||'');
  const last=authority.lastIndexOf(':');
  return last>0&&HOSTS.has(authority.slice(0,last))&&Number(authority.slice(last+1))===port;
}
function listen(server,port,host){
  return new Promise((resolve,reject)=>{
    const fail=error=>{server.removeListener('listening',done);reject(error);};
    const done=()=>{server.removeListener('error',fail);resolve();};
    server.once('error',fail);server.once('listening',done);server.listen(port,host);
  });
}
class BrowserAuth{
  constructor({openExternal,fetcher,timeoutMs=480000,platform=process.platform,onProgress=()=>{}}={}){
    if(typeof openExternal!=='function'||typeof fetcher!=='function'||typeof onProgress!=='function')throw Error('Browser authorization dependencies are missing.');
    const platformName={win32:'windows',darwin:'macos',linux:'linux'}[platform];
    if(!platformName)throw Error('Provider browser sign-in is unsupported on this platform.');
    Object.assign(this,{openExternal,fetcher,timeoutMs,platformName,onProgress});
    this.pending=null;
  }
  progress(stage){
    this.lastStage=stage;
    try{this.onProgress(stage);}catch{/* UI event handlers cannot interrupt authorization. */}
  }
  async start(){
    if(this.pending)throw Error('A browser sign-in is already in progress.');
    const verifier=randomBytes(48).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    let resolveCallback,rejectCallback;
    const callback=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});
    callback.catch(()=>{});
    const servers=[];
    let received=false,port=0,timer;
    const handle=(req,res)=>{
      const fail=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
      if(!isLocalCallback(req,port))return fail(403);
      let request;try{request=new URL(req.url,'http://127.0.0.1:'+port);}catch{return fail(400);}
      if(!['/','/callback'].includes(request.pathname))return fail(404);
      if(received)return fail(409);
      const error=request.searchParams.get('error');
      if(error){
        received=true;fail(400);rejectCallback(Error('The provider did not authorize browser sign-in. Please retry or check your account permissions.'));return;
      }
      const code=request.searchParams.get('code');
      if(!code||code.length<8||code.length>MAX_CODE_LENGTH||/[\x00-\x1f\x7f]/.test(code))return fail(400);
      received=true;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
      res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Predator VPN</title><body style="font:16px system-ui;padding:3rem;color:#222"><h1>Sign-in received</h1><p>Return to Predator VPN to complete authorization.</p></body></html>');
      this.progress('callback-received');
      resolveCallback(code);
    };
    const primary=http.createServer(handle);
    servers.push(primary);
    const current={cancelled:false,cancel(){this.cancelled=true;rejectCallback(Error('Browser sign-in cancelled.'));}};
    this.pending=current;
    try{
      await listen(primary,0,'127.0.0.1');
      port=primary.address().port;
      // Some Windows browsers resolve "localhost" to IPv6 ::1, while others
      // use IPv4. Bind both loopback families on the SAME ephemeral port.
      const ipv6=http.createServer(handle);
      try{await listen(ipv6,port,'::1');servers.push(ipv6);}catch{if(ipv6.listening)ipv6.close();}
      if(current.cancelled)throw Error('Browser sign-in cancelled.');
      const url=new URL(BASE+'/api/v2/vpn/login/'+this.platformName);
      url.searchParams.set('code_challenge',challenge);
      url.searchParams.set('code_challenge_method','S256');
      url.searchParams.set('port',String(port));
      url.searchParams.set('user_agent','PredatorVPN/2.0.0');
      // Required if an email code is delivered after opening the browser.
      timer=setTimeout(()=>{this.progress('timeout');const error=Error('The account provider did not return a sign-in code to Predator VPN. Check whether the browser displayed a completion page, and whether localhost access is blocked.');error.code='BROWSER_CALLBACK_TIMEOUT';rejectCallback(error);},this.timeoutMs);
      timer.unref?.();
      this.progress('browser-opening');
      this.progress('waiting-for-callback');
      await this.openExternal(url.toString());
      const code=await callback;
      if(current.cancelled)throw Error('Browser sign-in cancelled.');
      this.progress('verifying-code');
      const response=await this.fetcher(BASE+'/api/v2/vpn/login/verify',{
        method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({code,code_verifier:verifier}),redirect:'error',
        signal:AbortSignal.timeout(20000)
      });
      if(!response.ok)throw Error('The account provider rejected the authorization code (HTTP '+response.status+').');
      const raw=await response.text();
      if(raw.length>65536)throw Error('The provider sent an unexpected authentication response.');
      let data;try{data=JSON.parse(raw);}catch{throw Error('The provider sent an invalid authentication response.');}
      if(current.cancelled)throw Error('Browser sign-in cancelled.');
      if(typeof data?.token!=='string'||data.token.length<16||data.token.length>16384||typeof data?.user?.email!=='string'||!data.user.email.includes('@'))
        throw Error('The provider did not return a valid account session.');
      this.progress('provider-authorized');
      return {token:data.token,email:data.user.email};
    }catch(error){if(this.lastStage!=='timeout'&&this.lastStage!=='cancelled')this.progress('failed');throw error;}
    finally{
      if(timer)clearTimeout(timer);
      this.pending=null;
      for(const server of servers)if(server.listening)server.close();
    }
  }
  cancel(){if(this.pending){this.progress('cancelled');this.pending.cancel();}}
}
module.exports={BrowserAuth,isLocalCallback};
