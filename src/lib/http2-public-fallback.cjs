// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Standards-based HTTP/2 fallback for public Remote Settings reads only.
// Never replay account sign-ins, verification, OAuth grants or 406 rejections.
const http2=require('node:http2');
const PUBLIC_ORIGIN='https://firefox.settings.services.mozilla.com';
const PUBLIC_PATH='/v1/buckets/main/collections/vpn-serverlist/records';
const MAX_BYTES=2*1024*1024;
function fetchPublicH2(url,{method='GET',timeoutMs=8000,connect=http2.connect}={}){
 const target=new URL(url);
 if(target.origin!==PUBLIC_ORIGIN||target.pathname!==PUBLIC_PATH||target.search||
    !['GET','HEAD'].includes(method.toUpperCase()))
   return Promise.reject(Error('HTTP/2 fallback is restricted to approved public GET/HEAD reads.'));
 return new Promise((resolve,reject)=>{
  let finished=false,stream,responseHeaders,bytes=0;
  const session=connect(target.origin,{ALPNProtocols:['h2'],rejectUnauthorized:true});
  const done=(error,result)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   try{stream?.close?.();}catch{}
   try{session.close();}catch{}
   if(error)reject(error);else resolve(result);
  };
  const timer=setTimeout(()=>done(Error('Public HTTP/2 request timed out.')),timeoutMs);
  session.on('error',done);
  session.on('connect',()=>{
   if(finished)return;
   const selected=session.socket?.alpnProtocol;
   if(selected&&selected!=='h2')return done(Error('Server did not negotiate HTTP/2.'));
   const chunks=[];
   stream=session.request({
    ':method':method.toUpperCase(),':path':target.pathname,':authority':target.host,
    'accept':'application/json','accept-encoding':'identity'
   });
   stream.on('error',done);
   stream.on('response',headers=>{responseHeaders=headers;});
   stream.on('data',chunk=>{
    bytes+=chunk.length;
    if(bytes>MAX_BYTES)return done(Error('Public HTTP/2 response exceeded size limit.'));
    chunks.push(chunk);
   });
   stream.on('end',()=>{
    const status=Number(responseHeaders?.[':status']);
    if(!Number.isInteger(status)||status<200||status>599)
     return done(Error('Invalid HTTP/2 response status.'));
    const payload=method.toUpperCase()==='HEAD'?null:Buffer.concat(chunks);
    done(null,new Response(payload,{status,headers:{
      'content-type':String(responseHeaders['content-type']||'application/json')
    }}));
   });
   stream.end();
  });
 });
}
module.exports={fetchPublicH2,PUBLIC_ORIGIN,PUBLIC_PATH};
