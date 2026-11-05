// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassRenewer,nextPassDelay}=require('../src/lib/pass-renewal.cjs');
const {WindowsEngine}=require('../src/lib/windows-engine.cjs');
function timerHarness(){
  const timers=[];
  return {timers,setTimer:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;},clearTimer:t=>{const index=timers.indexOf(t);if(index>=0)timers.splice(index,1);}};
}
function pass(expiry=600000){return {token:'fixture',expiresAt:expiry,quotaRemaining:'100'};}
test('pass refresh retains the VPN on transient service errors and retries with backoff',async()=>{
  const clock=timerHarness(),logs=[];let fetched=0,applied=0,rejected=0;
  const renewer=new PassRenewer({...clock,now:()=>0,
    getPass:async()=>{if(++fetched===1)throw Object.assign(Error('temporary'),{status:503});return pass();},
    applyPass:async()=>{applied++;},onRejected:async()=>{rejected++;},log:(level,message)=>logs.push(message)});
  renewer.start(pass());
  assert.equal(clock.timers.at(-1).delay,480000);
  await renewer.refresh(renewer.epoch);
  assert.equal(rejected,0);
  assert.equal(applied,0);
  assert.equal(clock.timers.at(-1).delay,5000);
  await renewer.refresh(renewer.epoch);
  assert.equal(applied,1);
  assert.equal(clock.timers.at(-1).delay,480000);
  assert(logs.some(message=>message.includes('Retrying without disconnecting')));
  renewer.stop();
});
test('a failed refresh after expiry keeps retrying without discarding the connection',async()=>{
  const clock=timerHarness(),logs=[];let rejected=0;
  const renewer=new PassRenewer({...clock,now:()=>650000,getPass:async()=>{throw Error('offline');},
    applyPass:async()=>{},onRejected:async()=>{rejected++;},log:(_level,message)=>logs.push(message)});
  renewer.start(pass());
  await renewer.refresh(renewer.epoch);
  assert.equal(rejected,0);assert.equal(clock.timers.at(-1).delay,5000);
  renewer.stop();
});
test('confirmed exhaustion and invalid account authorization remain hard failures',async()=>{
  for(const mode of ['exhausted','denied']){
    let rejected;
    const clock=timerHarness();
    const renewer=new PassRenewer({...clock,now:()=>0,getPass:async()=>{
      if(mode==='exhausted')return {...pass(),quotaRemaining:'0'};
      throw Object.assign(Error('Authorization rejected'),{status:401});
    },applyPass:async()=>{throw Error('must not apply');},onRejected:async error=>{rejected=error;},log:()=>{}});
    renewer.start(pass());await renewer.refresh(renewer.epoch);
    assert.equal(rejected.status,mode==='exhausted'?429:401);
    assert.equal(renewer.active,false);
  }
});
test('stopped renewals never apply a late response after disconnect',async()=>{
  const clock=timerHarness();let complete,applied=0;
  const renewer=new PassRenewer({...clock,now:()=>0,getPass:()=>new Promise(resolve=>{complete=resolve;}),
    applyPass:async()=>{applied++;},onRejected:async()=>{},log:()=>{}});
  renewer.start(pass());const pending=renewer.refresh(renewer.epoch);
  renewer.stop();complete(pass());await pending;
  assert.equal(applied,0);assert.equal(clock.timers.length,0);
});
test('expiration scheduling remains bounded and does not spin on missing dates',()=>{
  assert.equal(nextPassDelay(600000,0),480000);
  assert.equal(nextPassDelay(1000,0),30000);
  assert.equal(nextPassDelay(Number.NaN,0),3600000);
});
function fakeProcess(){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.kill=()=>{child.emit('exit',0);return true;};
  return child;
}
test('Windows engine ignores intermittent packet errors while the tunnel is alive, then restarts after exit',async()=>{
  const child=fakeProcess(),logs=[];let unexpected=0;
  const engine=new WindowsEngine({executable:'sing-box.exe',configPath:'test.json',cwd:'.',
    spawnFn:()=>child,log:(level,message)=>logs.push(message),onUnexpectedStop:()=>{unexpected++;}});
  const started=engine.start();
  child.stdout.emit('data',Buffer.from('INFO sing-'));
  child.stdout.emit('data',Buffer.from('box started\n'));
  await started;
  child.stderr.emit('data',Buffer.from('ERROR tun: private 192.0.2.1 destination\n'));
  child.stderr.emit('data',Buffer.from('ERROR tun: private 192.0.2.1 destination\n'));
  assert.equal(logs.length,1);assert(!logs[0].includes('192.0.2.1'));
  assert.equal(unexpected,0);
  child.emit('exit',3);
  assert.equal(unexpected,1);
});
test('intentional Windows engine shutdown does not request reconnection',async()=>{
  const child=fakeProcess();let unexpected=0;
  const engine=new WindowsEngine({executable:'sing-box.exe',configPath:'test.json',cwd:'.',
    spawnFn:()=>child,log:()=>{},onUnexpectedStop:()=>{unexpected++;}});
  const started=engine.start();child.stdout.emit('data',Buffer.from('sing-box started\n'));
  await started;await engine.stop();assert.equal(unexpected,0);
});
test('Windows engine exits during startup fail fast without reporting healthy',async()=>{
  const child=fakeProcess(),engine=new WindowsEngine({executable:'sing-box.exe',configPath:'test.json',cwd:'.',
    spawnFn:()=>child,log:()=>{},onUnexpectedStop:()=>{}});
  const started=engine.start();child.emit('exit',1);
  await assert.rejects(started,/stopped \(1\)/);
});
