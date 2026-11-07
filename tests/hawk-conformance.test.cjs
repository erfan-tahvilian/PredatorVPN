// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {hawk,hkdf}=require('../src/lib/auth.cjs');
const PREFIX='identity.mozilla.com/picl/v1/';
const token='ab'.repeat(32);
const url='https://api.accounts.firefox.com/v1/oauth/token';
test('FxA HAWK POST matches hex-encoded upstream MAC and payload hash',()=>{
 const body='{"client_id":"fixture"}',nonce='010203040506',time=1712345678;
 const material=hkdf(Buffer.from(token,'hex'),PREFIX+'sessionToken',64);
 const id=material.subarray(0,32).toString('hex');
 const hash=crypto.createHash('sha256')
  .update('hawk.1.payload\napplication/json\n'+body+'\n').digest('hex');
 const normalized=['hawk.1.header',String(time),nonce,'POST','/v1/oauth/token',
  'api.accounts.firefox.com','443',hash,'',''].join('\n');
 const mac=crypto.createHmac('sha256',material.subarray(32)).update(normalized).digest('hex');
 assert.equal(hawk('POST',url,token,body,time,nonce),
  'Hawk id="'+id+'", ts="'+time+'", nonce="'+nonce+'", mac="'+mac+'", hash="'+hash+'"');
});
test('FxA HAWK GET has no hash attribute or JSON content body',()=>{
 const nonce='010203040506',time=1712345678;
 const material=hkdf(Buffer.from(token,'hex'),PREFIX+'sessionToken',64);
 const id=material.subarray(0,32).toString('hex');
 const normalized=['hawk.1.header',String(time),nonce,'GET','/v1/recovery_email/status',
  'api.accounts.firefox.com','443','','',''].join('\n');
 const mac=crypto.createHmac('sha256',material.subarray(32)).update(normalized).digest('hex');
 assert.equal(hawk('GET','https://api.accounts.firefox.com/v1/recovery_email/status',
  token,undefined,time,nonce),'Hawk id="'+id+'", ts="'+time+'", nonce="'+nonce+'", mac="'+mac+'"');
});
test('Invalid session token is rejected locally before signing a request',()=>{
 assert.throws(()=>hawk('POST',url,'not-a-session','{}'),/invalid session token/);
});
