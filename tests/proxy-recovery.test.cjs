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