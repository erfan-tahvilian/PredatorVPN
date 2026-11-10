// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {DEFAULTS,validate}=require('../src/lib/settings.cjs');
const {DEFAULT_SUB_URL,parseSubscription,loadNodes}=require('../src/lib/bootstrap-proxy.cjs');
const {prepareLatencyPass}=require('../src/lib/latency.cjs');
const {Guardian}=require('../src/lib/control.cjs');
const RAW='https://raw.githubusercontent.com/erfan-tahvilian/PredatorVPN/main/docs/bootstrap/working-nodes.txt';
const OTHER='https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/top100.txt';
const OLD='https://cdn.jsdelivr.net/gh/erfan-tahvilian/PredatorVPN@main/docs/bootstrap/working-nodes.txt';

test('two subscriptions default; old settings migrate and unlimited custom lists preserve order',()=>{
 assert.deepEqual(DEFAULTS.bootstrapSubUrls,[RAW,OTHER]);
 assert.equal(DEFAULT_SUB_URL,RAW);
 assert.deepEqual(validate({bootstrapSubUrl:OLD}).bootstrapSubUrls,[RAW,OTHER]);
 assert.deepEqual(validate({bootstrapSubUrl:''}).bootstrapSubUrls,[RAW,OTHER]);
 assert.deepEqual(validate({bootstrapSubUrl:'https://example.com/private-sub'}).bootstrapSubUrls,['https://example.com/private-sub',OTHER]);
 const many=Array.from({length:101},(_,i)=>'https://example.org/s'+i);
 assert.deepEqual(validate({bootstrapSubUrls:many}).bootstrapSubUrls,many);
 assert.deepEqual(validate({bootstrapSubUrls:[]}).bootstrapSubUrls,[]);
 assert.deepEqual(validate({bootstrapSubUrls:[RAW,RAW,OTHER,'']}).bootstrapSubUrls,[RAW,OTHER]);
 assert.throws(()=>validate({bootstrapSubUrls:['file:///etc/passwd']}),/http\(s\)/i);
});

test('subscriptions tried in order; unreachable sources skipped and bundle retained as fallback',async()=>{
 const bundled=path.join(__dirname,'../assets/bootstrap-nodes.txt');
 const links=fs.readFileSync(bundled,'utf8').split(/\r?\n/).filter(x=>x.startsWith('vless://')&&x.includes('type=grpc'));
 assert(links.length>=2);assert.equal(parseSubscription(links[0]).length,1);
 const server=http.createServer((req,res)=>{
   if(req.url==='/first'){res.writeHead(200);res.end(links[0]+'\n');}
   else if(req.url==='/second'){res.writeHead(200);res.end(links[1]+'\n');}
   else{res.writeHead(503);res.end('offline');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
   const sources=[base+'/bad',base+'/first',base+'/second'];
   const first=await loadNodes({subUrls:sources,localPaths:[bundled],mirrors:[]});
   assert.equal(first.sourceIndex,1);assert.equal(first.sourceKind,'subscription');
   assert.equal(first[0].raw,links[0]);
   const next=await loadNodes({subUrls:sources,localPaths:[bundled],mirrors:[],startIndex:2});
   assert.equal(next.sourceIndex,2);assert.equal(next[0].raw,links[1]);
   const fallback=await loadNodes({subUrls:sources,localPaths:[bundled],mirrors:[],startIndex:3});
   assert.equal(fallback.sourceKind,'bundled');assert(fallback.length>=2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('initial ping shares same pass-acquisition path as Connect',async()=>{
 const coordinator={async prepare(){return {pass:{token:'fixture-pass'}};}};
 assert.equal((await prepareLatencyPass({coordinator,guardian:{},bootstrap:()=>{throw Error('unexpected');}})).token,'fixture-pass');
 let target;
 const single=await prepareLatencyPass({coordinator:null,guardian:{id:'test'},bootstrap:g=>{target=g.id;return {token:'fixture-single'};}});
 assert.equal(target,'test');assert.equal(single.token,'fixture-single');
});

function guardianFixture({blockStatus=true,blockToken=true,limited=true}={}){
 let proxied=false,start=0,stopped=0,cleared=0;
 const header=new Headers({'x-quota-limit':'1000','x-quota-remaining':'410','x-quota-reset':'2030-01-01'});
 const requests=[];
 const g=new Guardian({json:async(url)=>{
   const endpoint=url.split('/').at(-1);
   requests.push({endpoint,proxied});
   if(((endpoint==='status'&&blockStatus)||(endpoint==='token'&&blockToken))&&!proxied){
     const e=Error('Region-blocked');e.status=451;throw e;
   }
   if(endpoint==='status')return {data:{limited_bandwidth:limited,maxBytes:1000,uid:'fixture'}};
   if(endpoint==='token')return {data:{token:'header.payload.signature'},headers:header};
   if(endpoint==='activate')return {data:{ok:true}};
   throw Error('Unexpected '+endpoint);
 }},{token:async()=> 'fixture-token'});
 g.getBootstrapOptions=()=>({
   resolveUpstream:async()=>{start++;return {upstream:{enabled:true,host:'127.0.0.1',port:44444},stop:async()=>{stopped++;}};},
   applyUpstream:async()=>{proxied=true;},
   clearUpstream:async()=>{proxied=false;cleared++;},
   log:()=>{}
 });
 return {g,requests,stats:()=>({start,stopped,cleared,proxied})};
}

test('Data Allowance status 451 starts one bootstrap, returns quota and cleans up',async()=>{
 const {g,requests,stats}=guardianFixture({blockStatus:true,blockToken:true});
 const data=await g.account();
 assert.equal(data.quotaRemaining,'410');
 assert.equal(data.quotaLimit,'1000');
 assert.equal(stats().start,1);assert.equal(stats().stopped,1);
 assert.equal(stats().cleared,1);assert.equal(stats().proxied,false);
 assert.deepEqual(requests.map(x=>x.endpoint),['status','status','token']);
});

test('Data Allowance token-only 451 also retries entire status/quota transaction',async()=>{
 const {g,requests,stats}=guardianFixture({blockStatus:false,blockToken:true});
 const data=await g.account();
 assert.equal(data.quotaRemaining,'410');
 assert.equal(stats().start,1);assert.equal(stats().cleared,1);
 assert.deepEqual(requests.map(x=>x.endpoint),['status','token','status','token']);
});

test('Pass refresh and account activation use shared 451 recovery and cleanup',async()=>{
 const {g,stats}=guardianFixture({blockStatus:true,blockToken:true});
 const pass=await g.pass();
 assert.equal(pass.quotaRemaining,'410');
 assert.equal(stats().start,1);
 const status=await g.request('status');
 assert.equal(status.data.uid,'fixture');
 assert.equal(stats().start,2);
 assert.equal(stats().stopped,2);
});

test('concurrent Guardian operations serialize Bootstrap sessions',async()=>{
 let active=0,peak=0;
 const make=()=>{
   const g=new Guardian({json:async(url)=>{
     const endpoint=url.split('/').at(-1);
     if(!active){const e=Error('Region blocked');e.status=451;throw e;}
     return {data:endpoint==='status'?{limited_bandwidth:false}:{}};
   }},{token:async()=> 'fixture'});
   g.getBootstrapOptions=()=>({
     resolveUpstream:async()=>({upstream:{enabled:true},stop:async()=>{active--;}}),
     applyUpstream:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));},
     clearUpstream:async()=>{}
   });
   return g;
 };
 const [a,b]=await Promise.all([make().account(),make().account()]);
 assert.equal(a.limited_bandwidth,false);assert.equal(b.limited_bandwidth,false);
 assert.equal(peak,1);assert.equal(active,0);
});
