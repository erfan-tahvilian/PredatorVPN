const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ProxyPassRecovery}=require('../src/lib/proxy-pass-recovery.cjs');
test('401 CONNECT rejection refreshes the pass without disconnecting',async()=>{
  let fetched=0,applied=0,disconnected=0;
  const recovery=new ProxyPassRecovery({
    getPass:async()=>{fetched++;await new Promise(r=>setTimeout(r,5));return {token:'fresh',quotaRemaining:'10'};},
    applyPass:async pass=>{assert.equal(pass.token,'fresh');applied++;},
    onExhausted:()=>{disconnected++;},canApply:()=>true,log:()=>{}
  });
  assert.deepEqual(await Promise.all([
    recovery.handle({status:401,quota:{remaining:null}}),
    recovery.handle({status:401,quota:{remaining:null}})
  ]),[true,true]);
  assert.equal(fetched,1);assert.equal(applied,1);assert.equal(disconnected,0);
});
test('verified exhaustion stops retry but a temporary service failure does not',async()=>{
  let failed=0,disconnected=0,warnings=0;
  const recovery=new ProxyPassRecovery({
    getPass:async()=>{failed++;throw Object.assign(Error('Offline'),{status:503});},
    applyPass:()=>{throw Error('Unexpected token update');},
    onExhausted:()=>{disconnected++;},canApply:()=>true,
    log:()=>{warnings++;}
  });
  assert.equal(await recovery.handle({status:429,quota:{remaining:null}}),false);
  assert.equal(disconnected,0);assert.equal(failed,1);assert.equal(warnings,1);
  assert.equal(await recovery.handle({status:429,quota:{remaining:0}}),false);
  assert.equal(disconnected,1);assert.equal(failed,1);
});
test('an obsolete connection cannot accept late renewed credentials',async()=>{
  let valid=true,applied=0;
  const recovery=new ProxyPassRecovery({
    getPass:async()=>{valid=false;return {token:'late',quotaRemaining:100};},
    applyPass:()=>{applied++;},onExhausted:()=>{},canApply:()=>valid,log:()=>{}
  });
  assert.equal(await recovery.handle({status:403}),false);
  assert.equal(applied,0);
});
test('proxy pass retries use exponential cooldown and never flood the credential service',async()=>{
 let tick=1000,calls=0,applied=0,disconnected=0;
 const logs=[];
 const recovery=new ProxyPassRecovery({
   getPass:async()=>{calls++;if(calls===1)throw Object.assign(Error('Service temporarily unavailable'),{status:503});return {token:'fresh',quotaRemaining:10};},
   applyPass:()=>{applied++;},onExhausted:()=>{disconnected++;},
   canApply:()=>true,now:()=>tick,random:()=>0.5,log:(severity,message)=>logs.push({severity,message})
 });
 assert.equal(await recovery.handle({status:401}),false);
 assert.equal(calls,1);assert.equal(logs.length,1);
 for(let i=0;i<200;i++)assert.equal(await recovery.handle({status:401}),false);
 assert.equal(calls,1,'Repeated failures within cooldown must never cause new service requests');
 tick+=5001;
 assert.equal(await recovery.handle({status:401}),true);
 assert.equal(calls,2);assert.equal(applied,1);assert.equal(disconnected,0);
 assert.equal(logs.length,2,'Only one outage warning and one recovery notice');
 tick+=1000;
 assert.equal(await recovery.handle({status:401}),false);
 assert.equal(calls,2,'Successful rotation also creates a short cooldown');
 tick+=8001;
 assert.equal(await recovery.handle({status:401}),true);
 assert.equal(calls,3);
});
test('known exhausted quota overrides cooldown and stale sessions never change token',async()=>{
 let tick=0,exhausted=0,applied=0,valid=true,called=0;
 const recovery=new ProxyPassRecovery({
   now:()=>tick,random:()=>0.5,log:()=>{},
   getPass:async()=>{called++;valid=false;return {token:'stale',quotaRemaining:40};},
   canApply:()=>valid,
   applyPass:()=>{applied++;},onExhausted:()=>{exhausted++;}
 });
 assert.equal(await recovery.handle({status:403,quota:{remaining:40}}),false);
 assert.equal(called,1);assert.equal(applied,0);
 assert.equal(await recovery.handle({status:403,quota:{remaining:0}}),false);
 assert.equal(exhausted,1);
});
test('adaptive HTTP2 does not lose the one-retry authorization budget',async()=>{
 const {Tunnel}=require('../src/lib/tunnel.cjs');
 const {AdaptiveTunnel}=require('../src/lib/h3-tunnel.cjs');
 const original=Tunnel.prototype.open;
 try{
   Tunnel.prototype.open=async(host,port,retryAuth)=>({host,port,retryAuth});
   const session=new AdaptiveTunnel({transport:'h2',upstream:{enabled:false}},()=>{},()=>{},'');
   session.active=true;session.protocol='h2';session.session=async()=>({});
   const result=await session.open('example.org',443,false);
   assert.deepEqual(result,{host:'example.org',port:443,retryAuth:false});
 }finally{Tunnel.prototype.open=original;}
});
