// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {responseDiagnostic,diagnosticLine}=require('../src/lib/fxa-response-diagnostic.cjs');
const {Control}=require('../src/lib/control.cjs');
const {Auth}=require('../src/lib/auth.cjs');
test('OAuth rejection diagnostics use a strict header allowlist',()=>{
 const headers=new Headers({
  'x-request-id':'fxa-406-a1',
  'x-cache':'MISS, MISS',
  'server':'Fastly',
  'set-cookie':'secret-clearance=super-secret; HttpOnly',
  'authorization':'Bearer super-secret',
  'cookie':'secret-clearance=super-secret',
  'x-custom-token':'super-secret'
 });
 const safe=responseDiagnostic({status:406,headers});
 assert.deepEqual(safe,{status:406,'x-request-id':'fxa-406-a1','x-cache':'MISS, MISS',server:'Fastly'});
 const line=diagnosticLine(safe);
 assert.match(line,/HTTP 406/);
 assert.match(line,/x-request-id=fxa-406-a1/);
 assert.doesNotMatch(line,/super-secret|cookie|authorization|token/i);
});
test('unsafe upstream request IDs are dropped from the diagnostic',()=>{
 const headers={get:name=>name==='x-request-id'?'malicious\nCookie: secret':null};
 const safe=responseDiagnostic({status:406,headers});
 assert.equal('x-request-id' in safe,false);
 assert.equal(diagnosticLine(safe),'HTTP 406');
});
test('both rejected OAuth requests retain separate, non-sensitive correlation IDs',async()=>{
 const status=406,events=[];
 const http=new Control({browserManagedCookies:true,transport:async(url,options)=>{
  const path=new URL(url).pathname;
  const stage=path.endsWith('/oauth/token')?'direct':
    path.endsWith('/oauth/authorization')?'authorization':
    path==='/'?'challenge-page':null;
  if(!stage)throw Error('Unexpected route '+path);
  events.push(stage);
  if(stage==='challenge-page')return new Response('<html>No interactive challenge offered</html>');
  return new Response('',{status,headers:{
   'x-request-id':stage+'-fixture-123',
   'set-cookie':'provider-session=do-not-log',
   'content-type':'text/html'
  }});
 }});
 const auth=new Auth(http,{setAuth(){throw Error('No token must be saved');}});
 auth.pending={session:'ab'.repeat(32),email:'example@example.invalid',verified:true};
 try{
  await assert.rejects(auth.complete(),error=>{
   assert.equal(error.code,'FXA_OAUTH_GRANTS_REJECTED');
   assert.equal(error.status,406);
   assert.equal(error.responseDiagnostics.direct['x-request-id'],'direct-fixture-123');
   assert.equal(error.responseDiagnostics.authorization['x-request-id'],'authorization-fixture-123');
   const lines=Object.values(error.responseDiagnostics).map(diagnosticLine).join(' ');
   assert.doesNotMatch(lines,/provider-session|do-not-log/i);
   return true;
  });
  assert.deepEqual(events,['direct','authorization','challenge-page','challenge-page']);
 }finally{auth.cancel();}
});
