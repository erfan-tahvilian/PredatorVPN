// SPDX-License-Identifier: GPL-3.0-or-later
// Provider-hosted browser login using Guardian's published PKCE desktop flow.
// No passwords, OTPs, browser cookies, or authorization codes are persisted.
const http=require('node:http');
const {randomBytes,createHash}=require('node:crypto');
const BASE='https://vpn.mozilla.org';
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
class BrowserAuth {
 constructor({openExternal,fetcher,timeoutMs=180000,platform=process.platform}={}) {
  if(typeof openExternal!=='function'||typeof fetcher!=='function')throw Error('Browser authorization dependencies are missing.');
  const platformName={win32:'windows',darwin:'macos',linux:'linux'}[platform];
  if(!platformName)throw Error('Provider browser sign-in is unsupported on this platform.');
  Object.assign(this,{openExternal,fetcher,timeoutMs,platformName});this.pending=null;
 }
 async start(){
  if(this.pending)throw Error('A browser sign-in is already in progress.');
  const verifier=randomBytes(48).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  let acceptCode,rejectCode;
  const callback=new Promise((resolve,reject)=>{acceptCode=resolve;rejectCode=reject;});
  callback.catch(()=>{}); // Open-browser failures must not leak an unhandled rejection.
  const server=http.createServer((req,res)=>{
    const fail=status=>{res.writeHead(status,{'Cache-Control':'no-store'});res.end();};
    if(!LOOPBACK.has(req.socket.remoteAddress)||req.method!=='GET')return fail(403);
    const expectedHost='127.0.0.1:'+server.address().port;
    if(req.headers.host!==expectedHost)return fail(403);
    let request;try{request=new URL(req.url,'http://127.0.0.1');}catch{return fail(400);}
    if(!['/','/callback'].includes(request.pathname))return fail(404);
    const code=request.searchParams.get('code');
    // OAuth codes are opaque: accept the provider's URL-decoded value but
    // reject control characters and overlong input. Never interpolate into HTML.
    if(!code||code.length<8||code.length>2048||/[\x00-\x1f\x7f]/.test(code))return fail(400);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Predator VPN</title><body style="font:16px sans-serif;padding:3rem"><h1>Sign-in received</h1><p>Return to Predator VPN to complete account verification.</p></body></html>');
    acceptCode(code);
  });
  let timer;
  const current={cancelled:false,cancel(){this.cancelled=true;rejectCode(Error('Browser sign-in cancelled.'));}};
  this.pending=current;
  server.on('error',error=>rejectCode(error));
  try{
   await new Promise((resolve,reject)=>{
    const failed=error=>{server.removeListener('listening',resolve);reject(error);};
    server.once('error',failed);
    server.listen(0,'127.0.0.1',()=>{server.removeListener('error',failed);resolve();});
   });
   if(current.cancelled)throw Error('Browser sign-in cancelled.');
   const port=server.address().port;
   const url=new URL(BASE+'/api/v2/vpn/login/'+this.platformName);
   url.searchParams.set('code_challenge',challenge);
   url.searchParams.set('code_challenge_method','S256');
   url.searchParams.set('port',String(port));
   url.searchParams.set('user_agent','PredatorVPN/2.0.0');
   timer=setTimeout(()=>rejectCode(Error('Browser sign-in timed out. Please start again.')),this.timeoutMs);
   timer.unref?.();
   await this.openExternal(url.toString());
   const code=await callback;
   if(current.cancelled)throw Error('Browser sign-in cancelled.');
   const reply=await this.fetcher(BASE+'/api/v2/vpn/login/verify',{
    method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({code,code_verifier:verifier}),redirect:'error',
    signal:AbortSignal.timeout(20000)
   });
   if(!reply.ok)throw Error('The provider did not complete browser sign-in (HTTP '+reply.status+').');
   const raw=await reply.text();
   if(raw.length>65536)throw Error('The provider sent an unexpected authentication response.');
   let data;try{data=JSON.parse(raw);}catch{throw Error('The provider sent an invalid authentication response.');}
   if(current.cancelled)throw Error('Browser sign-in cancelled.');
   if(typeof data?.token!=='string'||data.token.length<16||data.token.length>16384||typeof data?.user?.email!=='string'||!data.user.email.includes('@'))
    throw Error('The provider did not return a valid account session.');
   return {token:data.token,email:data.user.email};
  }finally{
   if(timer)clearTimeout(timer);
   this.pending=null;
   if(server.listening)server.close();
  }
 }
 cancel(){this.pending?.cancel();}
}
module.exports={BrowserAuth};
