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
test('OAuth 406 diagnostics persist safely across restarts, without secrets',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {persistOAuthRejection,FILE_NAME}=require('../src/lib/oauth-diagnostic-journal.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'predator-oauth-diagnostics-'));
 try{
  const error=Object.assign(new Error('secret=never-write-this'),{
   status:406,loginStage:'oauth-token',
   email:'person@example.invalid',password:'password-never-log',sessionToken:'session-never-log',
   responseDiagnostics:{
    direct:{status:406,'x-request-id':'direct-id-123',cookie:'secret-cookie'},
    authorization:{status:406,'x-request-id':'authorization-id-456',authorization:'secret-token'}
   }
  });
  assert.equal(persistOAuthRejection(dir,error),path.join(dir,FILE_NAME));
  const record=JSON.parse(fs.readFileSync(path.join(dir,FILE_NAME),'utf8').trim());
  assert.deepEqual(Object.keys(record),['time','stage','status','diagnostics']);
  assert.equal(record.stage,'oauth-token');
  assert.equal(record.diagnostics.direct,'HTTP 406 x-request-id=direct-id-123');
  assert.equal(record.diagnostics.authorization,'HTTP 406 x-request-id=authorization-id-456');
  const raw=fs.readFileSync(path.join(dir,FILE_NAME),'utf8');
  assert.doesNotMatch(raw,/never-write-this|person@example|password-never-log|session-never-log|secret-cookie|secret-token/i);
  for(let i=0;i<46;i++)persistOAuthRejection(dir,error);
  const lines=fs.readFileSync(path.join(dir,FILE_NAME),'utf8').trim().split('\n');
  assert.equal(lines.length,40,'Diagnostic journal must remain bounded');
  assert.equal(persistOAuthRejection(dir,{status:400,loginStage:'oauth-token'}),null);
  assert.equal(fs.readFileSync(path.join(dir,FILE_NAME),'utf8').trim().split('\n').length,40);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
