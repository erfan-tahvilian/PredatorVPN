// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Auth}=require('../src/lib/auth.cjs');
const {CaptchaPrompt}=require('../src/lib/captcha-prompt.cjs');
const {Control}=require('../src/lib/control.cjs');

test('unusual sign-in asks for unblock code then an email verification code',async()=>{
 const paths=[],saved=[];
 const auth=new Auth({async json(url,opts){
  const path=new URL(url).pathname;
  const data=JSON.parse(opts.body);paths.push(path);
  if(path==='/v1/account/login'&&!data.unblockCode)throw Object.assign(Error('Blocked'),{errno:125});
  if(path==='/v1/account/login/send_unblock_code')return {data:{}};
  if(path==='/v1/account/login'&&data.unblockCode)return {data:{sessionToken:'ab'.repeat(32),verified:false,verificationMethod:'email-2fa'}};
  if(path==='/v1/session/verify_code'){assert.equal(data.code,'123456');return {data:{}};}
  if(path==='/v1/oauth/token')return {data:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}};
  if(path==='/v1/session/destroy')return {data:{}};
  throw Error('Unknown route '+path);
 }},{setAuth:record=>saved.push(record)});
 try{
  assert.deepEqual(await auth.login('test@example.invalid','fixture-only'),{needsCode:true,verificationMethod:'unblock-code'});
  assert.equal(auth.pending.method,'unblock-code');
  assert.deepEqual(await auth.verify('a-b1c2'),{needsCode:true,verificationMethod:'email-2fa'});
  assert.equal(auth.pending.method,'email-2fa');
  assert.deepEqual(await auth.verify('۱۲۳۴۵۶'),{needsCode:false});
  assert.equal(saved.length,1);
  assert.equal(paths.filter(p=>p==='/v1/account/login/send_unblock_code').length,1);
  assert.equal(paths.filter(p=>p==='/v1/session/verify_code').length,1);
  assert.equal(paths.filter(p=>p==='/v1/session/destroy').length,1);
  assert.equal(auth.pending,null);
 }finally{auth.cancel();}
});
test('unblock codes are capped and invalid code leaves pending sign-in intact',async()=>{
 let count=0;
 const auth=new Auth({async json(url,opts){
  const p=new URL(url).pathname;
  if(p.endsWith('/send_unblock_code'))return {data:{}};
  if(p.endsWith('/account/login')){if(!JSON.parse(opts.body).unblockCode)throw Object.assign(Error('Blocked'),{errno:125});count++;throw Object.assign(Error('Code invalid'),{errno:127});}
 }},{setAuth(){}});
 try{
  await auth.login('test@example.invalid','fixture-only');
  for(let i=0;i<5;i++)await assert.rejects(auth.verify('abcdef'),/unblock code was not accepted/);
  assert.equal(count,5);
  await assert.rejects(auth.verify('abcdef'),/Too many incorrect/);
  assert.equal(auth.pending,null);
 }finally{auth.cancel();}
});
test('authenticator verification follows TOTP endpoint and rejects false success',async()=>{
 const requested=[];
 const auth=new Auth({async json(url,opts){
  const path=new URL(url).pathname;requested.push(path);
  if(path.endsWith('/session/verify/totp'))return {data:{success:false}};
  throw Error('Unexpected token request');
 }},{setAuth(){}});
 auth.pending={method:'totp-2fa',session:'ab'.repeat(32),email:'test@example.invalid'};
 await assert.rejects(auth.verify('123456'),/authenticator code was not accepted/);
 assert.equal(auth.pending.verified,undefined);
 assert.deepEqual(requested,['/v1/session/verify/totp']);
 auth.cancel();
});
test('captcha prompt resolves only supplied human text and rejects invalid images',async()=>{
 let updates=0;
 const broker=new CaptchaPrompt(()=>updates++,{timeoutMs:300});
 assert.throws(()=>broker.ask('data:text/html;base64,AA=='),/unsupported CAPTCHA/);
 const image='data:image/png;base64,aGVsbG8=';
 const awaiting=broker.ask(image);
 assert.equal(broker.image,image);
 assert.equal(broker.submit('  HELLO7  '),true);
 assert.equal(await awaiting,'HELLO7');
 assert.equal(broker.image,null);
 assert(updates>=2);
 const cancelled=broker.ask(image);
 assert.equal(broker.cancel(),true);
 await assert.rejects(cancelled,/cancelled/);
});
test('captcha image and response can be exchanged within Control without a browser window',async()=>{
 const prefix='/_fs-ch-test123',img='data:image/png;base64,aGVsbG8=';
 let sent=false;
 const control=new Control({captchaSolver:async received=>{assert.equal(received,img);return 'CODE7';},
 transport:async(url,options={})=>{
   const req=new URL(url);
   if(req.pathname==='/'&&req.host==='https.accounts.firefox.com')throw Error('Invalid expected host');
   if(req.pathname==='/')return new Response(sent?'<html>Verified</html>':'<html>Client Challenge '+prefix+'</html>');
   if(req.pathname.endsWith('/script.js'))return new Response('init('+JSON.stringify([{ty:'captcha',data:{image_b64:img}}])+',"token",'+JSON.stringify(prefix)+');');
   if(req.pathname.endsWith('/fst-post-back')){
     const data=JSON.parse(options.body);assert.equal(data.data[0].answer,'CODE7');sent=true;
     return new Response(JSON.stringify({status:'success'}),{headers:{'Content-Type':'application/json'}});
   }
   throw Error('Unexpected mock challenge request: '+req.pathname);
 }});
 await control.solveChallenge();
 assert(sent);
});
