// SPDX-License-Identifier: GPL-3.0-or-later
// Bootstrap for geo-restricted Guardian API (HTTP 451).
'use strict';
const net=require('node:net');
const https=require('node:https');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {URL}=require('node:url');

const DEFAULT_SUB_URL='https://raw.githubusercontent.com/erfan-tahvilian/PredatorVPN/main/docs/bootstrap/working-nodes.txt';
const DEFAULT_MIRROR_URLS=['https://cdn.jsdelivr.net/gh/erfan-tahvilian/PredatorVPN@main/docs/bootstrap/working-nodes.txt'];
const MAX_CANDIDATES=20;
const CONNECT_TIMEOUT_MS=18000;
const GUARDIAN_HOST='vpn.mozilla.org';
const GUARDIAN_PATH='/api/v1/fpn/token';

function decodeMaybeBase64(text){
  const t=String(text||'').trim();
  if(!t)return '';
  try{const d=Buffer.from(t,'base64').toString('utf8');if(d.includes('://')||d.includes('\n'))return d;}catch{}
  return t;
}
function parseSubscription(body){
  const lines=decodeMaybeBase64(body).split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const nodes=[];
  for(const line of lines){if(line.startsWith('#'))continue;const n=parseNodeLine(line);if(n)nodes.push(n);}
  return nodes;
}
function guessName(line){try{const h=line.indexOf('#');if(h>=0)return decodeURIComponent(line.slice(h+1)).slice(0,64);}catch{}return line.slice(0,48);}
function qs(u){const o={};for(const [k,v] of u.searchParams.entries())o[k.toLowerCase()]=v;return o;}

function vlessOutbound(line){
  const u=new URL(line),q=qs(u);
  const o={type:'vless',tag:'bootstrap',server:u.hostname,server_port:Number(u.port)||443,uuid:decodeURIComponent(u.username)};
  if(q.flow)o.flow=q.flow;
  const sec=(q.security||'').toLowerCase();
  if(sec==='tls'||sec==='reality'||q.sni||q.fp){
    o.tls={enabled:true,server_name:q.sni||q.host||u.hostname,insecure:q.allowinsecure==='1'||q.insecure==='1'};
    const fp=q.fp||(sec==='reality'?'chrome':undefined);
    if(fp)o.tls.utls={enabled:true,fingerprint:fp};
    if(sec==='reality'){
      o.tls.reality={enabled:true,public_key:q.pbk||q.publickey||''};
      if(q.sid)o.tls.reality.short_id=q.sid;
    }
  }
  const tr=(q.type||q.net||'tcp').toLowerCase();
  if(tr==='ws')o.transport={type:'ws',path:q.path||'/',headers:q.host?{Host:q.host}:undefined};
  else if(tr==='grpc')o.transport={type:'grpc',service_name:q.servicename||q.service_name||'TunService'};
  else if(tr==='xhttp'||tr==='splithttp')throw Error('XHTTP is not supported by the bundled sing-box engine');
  else if(tr==='httpupgrade'||tr==='http')o.transport={type:'httpupgrade',path:q.path||'/',host:q.host||q.sni||undefined};
  return o;
}
function vmessOutbound(line){
  const j=JSON.parse(Buffer.from(line.replace(/^vmess:\/\//i,''),'base64').toString('utf8'));
  const o={type:'vmess',tag:'bootstrap',server:j.add||j.host,server_port:Number(j.port)||443,uuid:j.id,security:j.scy||j.security||'auto',alter_id:Number(j.aid||0)};
  const tls=String(j.tls||'').toLowerCase();
  if(tls==='tls'||tls==='reality'){o.tls={enabled:true,server_name:j.sni||j.host||o.server,insecure:!!j.allowInsecure};if(j.fp)o.tls.utls={enabled:true,fingerprint:j.fp};}
  const n=String(j.net||'tcp').toLowerCase();
  if(n==='ws')o.transport={type:'ws',path:j.path||'/',headers:j.host?{Host:j.host}:undefined};
  else if(n==='grpc')o.transport={type:'grpc',service_name:j.path||''};
  return o;
}
function trojanOutbound(line){
  const u=new URL(line),q=qs(u);
  const o={type:'trojan',tag:'bootstrap',server:u.hostname,server_port:Number(u.port)||443,password:decodeURIComponent(u.username)};
  o.tls={enabled:true,server_name:q.sni||q.peer||u.hostname,insecure:q.allowinsecure==='1'||q.insecure==='1',utls:q.fp?{enabled:true,fingerprint:q.fp}:undefined};
  if((q.type||'tcp').toLowerCase()==='ws')o.transport={type:'ws',path:q.path||'/',headers:q.host?{Host:q.host}:undefined};
  return o;
}
function ssOutbound(line){
  let rest=line.replace(/^ss:\/\//i,'');const hash=rest.indexOf('#');if(hash>=0)rest=rest.slice(0,hash);
  let method,password,host,port;
  if(rest.includes('@')){
    const at=rest.lastIndexOf('@');let ui=rest.slice(0,at);const srv=rest.slice(at+1);
    if(!ui.includes(':'))ui=Buffer.from(ui,'base64').toString('utf8');
    const c=ui.indexOf(':');method=ui.slice(0,c);password=ui.slice(c+1);
    const sp=srv.split(':');host=sp[0];port=Number(sp[1])||8388;
  }else{
    const m=Buffer.from(rest,'base64').toString('utf8').match(/^(.+?):(.+)@(.+):(\d+)$/);if(!m)throw Error('bad ss');
    method=m[1];password=m[2];host=m[3];port=Number(m[4]);
  }
  return {type:'shadowsocks',tag:'bootstrap',server:host,server_port:port,method,password};
}
function parseNodeLine(line){
  try{
    if(line.startsWith('socks://')||line.startsWith('socks5://')){
      const u=new URL(line.replace(/^socks5?:\/\//,'socks5://'));
      return {protocol:'socks5',host:u.hostname,port:Number(u.port)||1080,username:decodeURIComponent(u.username||''),password:decodeURIComponent(u.password||''),name:u.hash?decodeURIComponent(u.hash.slice(1)):u.hostname,raw:line};
    }
    if(/^vless:\/\//i.test(line))return {protocol:'vless',name:guessName(line),raw:line,outbound:vlessOutbound(line)};
    if(/^vmess:\/\//i.test(line))return {protocol:'vmess',name:guessName(line),raw:line,outbound:vmessOutbound(line)};
    if(/^trojan:\/\//i.test(line))return {protocol:'trojan',name:guessName(line),raw:line,outbound:trojanOutbound(line)};
    if(/^ss:\/\//i.test(line))return {protocol:'shadowsocks',name:guessName(line),raw:line,outbound:ssOutbound(line)};
  }catch{}
  return null;
}

async function fetchText(url,timeoutMs=20000){
  return new Promise((resolve,reject)=>{
    const lib=url.startsWith('https:')?https:http;
    const req=lib.get(url,{timeout:timeoutMs,headers:{'User-Agent':'PredatorVPN-Bootstrap/1.1'}},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){res.resume();return fetchText(res.headers.location,timeoutMs).then(resolve,reject);}
      if(res.statusCode!==200){res.resume();return reject(Error('Subscription HTTP '+res.statusCode));}
      const c=[];res.on('data',x=>c.push(x));res.on('end',()=>resolve(Buffer.concat(c).toString('utf8')));
    });
    req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(Error('Subscription fetch timed out'));});
  });
}
function safeHost(url){try{return new URL(url).host;}catch{return 'subscription';}}
function sourceList({subUrls,subUrl,localPaths=[],mirrors=DEFAULT_MIRROR_URLS}={}){
  const urls=Array.isArray(subUrls)?subUrls:Array.isArray(subUrl)?subUrl:[subUrl||DEFAULT_SUB_URL];
  const sources=[],seen=new Set();
  for(const value of urls){
    if(typeof value!=="string"||!value.trim()||seen.has(value.trim()))continue;
    const url=value.trim();seen.add(url);sources.push({kind:"subscription",url});
  }
  for(const file of [].concat(localPaths||[]).filter(Boolean))sources.push({kind:"bundled",file});
  for(const url of mirrors||[]){if(!url||seen.has(url))continue;seen.add(url);sources.push({kind:"mirror",url});}
  return sources;
}
async function loadNodes(options={}){
  const sources=sourceList(options);
  const log=options.log||(()=>{});
  let last=null;
  let index=Math.max(0,Number(options.startIndex)||0);
  // Retain support for earlier diagnostic clients.
  if(options.fallbackStage==="bundled")index=Math.max(index,sources.findIndex(x=>x.kind==="bundled"));
  for(;index<sources.length;index++){
    const source=sources[index];
    try{
      let text;
      if(source.file){
        if(!fs.existsSync(source.file))continue;
        log("info","Bootstrap: reading bundled nodes from "+path.basename(source.file));
        text=fs.readFileSync(source.file,"utf8");
      }else{
        log("info","Bootstrap: loading subscription "+(index+1)+" from "+safeHost(source.url));
        text=await fetchText(source.url,8000);
      }
      const nodes=parseSubscription(text);
      if(!nodes.length){last=Error("No compatible nodes in source "+(index+1));continue;}
      Object.defineProperties(nodes,{sourceKind:{value:source.kind},sourceIndex:{value:index}});
      log("info","Bootstrap: source "+(index+1)+" loaded "+nodes.length+" nodes");
      return nodes;
    }catch(e){last=e;log("warn","Bootstrap: source "+(index+1)+" unavailable: "+(e.message||e));}
  }
  throw last||Error("No working bootstrap subscription or bundled list available");
}
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(e=>e?reject(e):resolve(port));});s.on('error',reject);});}
function writeSingBoxConfig(configPath,outbound,socksPort){
  fs.writeFileSync(configPath,JSON.stringify({log:{level:'warn'},inbounds:[{type:'socks',tag:'in',listen:'127.0.0.1',listen_port:socksPort}],outbounds:[outbound,{type:'direct',tag:'direct'}],route:{final:'bootstrap'}},null,2));
}
function startSingBox(executable,configPath,cwd,timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    let child;try{child=spawn(executable,['run','-c',configPath],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{reject(Error('Unable to start bootstrap engine.'));return;}
    let settled=false;
    const timer=setTimeout(()=>{if(!settled){settled=true;try{child.kill();}catch{}reject(Error('Bootstrap engine timed out'));}},timeoutMs);
    const done=err=>{if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve(child);};
    child.once('error',()=>done(Error('Unable to start bootstrap engine.')));
    child.once('exit',code=>{if(!settled)done(Error('Bootstrap engine exited ('+code+').'));});
    const onData=chunk=>{if(/sing-box started/i.test(String(chunk||'')))done();};
    child.stdout.on('data',onData);child.stderr.on('data',onData);
    setTimeout(()=>{if(!settled&&child.exitCode===null)done();},1500);
  });
}
async function stopChild(child){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{let d=false;const fin=()=>{if(d)return;d=true;clearTimeout(t);resolve();};child.once('exit',fin);const t=setTimeout(()=>{try{child.kill();}catch{}fin();},4000);try{if(!child.kill())fin();}catch{fin();}});
}
async function probeViaSocks(proxy,timeoutMs=CONNECT_TIMEOUT_MS){
  const {SocksClient}=require('socks');
  const tls=require('node:tls');
  // 1) quick liveness through the proxy
  {
    const {socket}=await SocksClient.createConnection({command:'connect',proxy,destination:{host:'1.1.1.1',port:443},timeout:Math.min(10000,timeoutMs)});
    socket.destroy();
  }
  // 2) TLS + HTTP GET to Mozilla Guardian via SOCKS (manual TLS avoids Node https parse quirks)
  const {socket:raw}=await SocksClient.createConnection({command:'connect',proxy,destination:{host:GUARDIAN_HOST,port:443},timeout:timeoutMs});
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(err,val)=>{if(settled)return;settled=true;clearTimeout(timer);try{secure.destroy();}catch{};try{raw.destroy();}catch{};err?reject(err):resolve(val);};
    const timer=setTimeout(()=>finish(Error('Guardian probe timed out')),timeoutMs);
    const secure=tls.connect({socket:raw,servername:GUARDIAN_HOST,ALPNProtocols:['http/1.1'],timeout:timeoutMs},()=>{
      secure.write('GET '+GUARDIAN_PATH+' HTTP/1.1\r\nHost: '+GUARDIAN_HOST+'\r\nUser-Agent: PredatorVPN-Bootstrap/1.1\r\nAccept: */*\r\nConnection: close\r\n\r\n');
    });
    let buf='';
    secure.on('data',chunk=>{
      buf+=chunk.toString('utf8');
      if(buf.includes('\r\n\r\n')||buf.length>4096){
        const m=buf.match(/^HTTP\/\d\.\d\s+(\d{3})/);
        if(!m)return finish(Error('Invalid HTTP response from Guardian'));
        const code=Number(m[1]);
        if(code===451)return finish(Object.assign(Error('Still region-blocked (HTTP 451)'),{status:451}));
        return finish(null,{status:code});
      }
    });
    secure.on('error',e=>finish(e));
    secure.on('timeout',()=>finish(Error('Guardian TLS timed out')));
  });
}

let activeSession=null;
async function stopBootstrapSession(){
  const s=activeSession;activeSession=null;if(!s)return;
  await stopChild(s.child);try{if(s.configPath)fs.unlinkSync(s.configPath);}catch{}
}

async function resolveBootstrapUpstream(options={}){
  const log=options.log||(()=>{});
  let nodes;
  try{nodes=await loadNodes(options);}catch(e){const err=Error("No working bootstrap subscription or bundled list available");err.code="BOOTSTRAP_NO_WORKING_NODE";err.cause=e;throw err;}
  const seen=new Set(options.skipRaw||[]);
  nodes.sort((a,b)=>{
    const score=n=>{const r=String(n.raw||'');if(/type=grpc/i.test(r))return 0;if(/type=xhttp/i.test(r))return 2;return 1;};
    return score(a)-score(b);
  });
  const max=options.max||MAX_CANDIDATES;
  const enginePath=options.enginePath;
  const engineCwd=options.engineCwd||(enginePath?path.dirname(enginePath):undefined);
  await stopBootstrapSession();
  let tried=0;
  for(const node of nodes){
    if(seen.has(node.raw))continue;
    if(tried>=max)break;tried++;seen.add(node.raw);
    try{
      if(node.protocol==='socks5'){
        log('info','Bootstrap: probing SOCKS5 · '+node.name);
        await probeViaSocks({host:node.host,port:node.port,type:5,userId:node.username||undefined,password:node.password||undefined});
        log('info','Bootstrap: working SOCKS5 · '+node.name);
        return {node,upstream:{enabled:true,type:'socks5',host:node.host,port:node.port,username:node.username||'',password:node.password||''},stop:async()=>{}};
      }
      if(!node.outbound){log('warn','Bootstrap: skip · '+node.name);continue;}
      if(!enginePath||!fs.existsSync(enginePath)){log('warn','Bootstrap: sing-box engine missing');break;}
      log('info','Bootstrap: probing '+node.protocol+' · '+node.name);
      const socksPort=await freePort();
      const configPath=path.join(os.tmpdir(),'predator-bootstrap-'+process.pid+'-'+socksPort+'.json');
      writeSingBoxConfig(configPath,node.outbound,socksPort);
      const child=await startSingBox(enginePath,configPath,engineCwd);
      await new Promise(r=>setTimeout(r,900));
      try{await probeViaSocks({host:'127.0.0.1',port:socksPort,type:5});}
      catch(e){await stopChild(child);try{fs.unlinkSync(configPath);}catch{}throw e;}
      log('info','Bootstrap: working node · '+node.name);
      activeSession={child,configPath,socksPort,node};
      return {node,upstream:{enabled:true,type:'socks5',host:'127.0.0.1',port:socksPort,username:'',password:''},stop:stopBootstrapSession};
    }catch(e){log('warn','Bootstrap: node failed · '+node.name+' · '+(e.message||e));}
  }
  log("warn","Bootstrap: source "+(nodes.sourceIndex+1)+" exhausted; trying next source");
  try{return await resolveBootstrapUpstream({...options,startIndex:nodes.sourceIndex+1,skipRaw:[...seen]});}
  catch(error){if(error.code!=="BOOTSTRAP_NO_WORKING_NODE"&& !/No working bootstrap subscription/.test(error.message))throw error;}
  const err=Error('No working bootstrap proxy found for the Mozilla VPN API.');err.code='BOOTSTRAP_NO_WORKING_NODE';throw err;
}

module.exports={DEFAULT_SUB_URL,DEFAULT_MIRROR_URLS,loadNodes,parseSubscription,parseNodeLine,resolveBootstrapUpstream,stopBootstrapSession};
