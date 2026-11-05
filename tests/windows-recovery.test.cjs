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
  const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,
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
  assert(logs.some(message=>message.includes('Keeping the VPN active')));
  renewer.stop();
});
test('a failed refresh after expiry keeps retrying without discarding the connection',async()=>{
  const clock=timerHarness(),logs=[];let rejected=0;
  const renewer=new PassRenewer({...clock,now:()=>650000,random:()=>0.5,getPass:async()=>{throw Error('offline');},
    applyPass:async()=>{},onRejected:async()=>{rejected++;},log:(_level,message)=>logs.push(message)});
  renewer.start(pass());
  await renewer.refresh(renewer.epoch);
  assert.equal(rejected,0);assert.equal(clock.timers.at(-1).delay,5000);
  renewer.stop();
});
test('confirmed exhaustion is terminal but isolated 401/403 renewals back off',async()=>{
  for(const status of [401,403]){
    const clock=timerHarness(),logs=[];let rejected=0;
    const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,getPass:async()=>{throw Object.assign(Error('Auth temporarily unavailable'),{status});},applyPass:async()=>{},onRejected:async()=>{rejected++;},log:(_level,msg)=>logs.push(msg)});
    renewer.start(pass());await renewer.refresh(renewer.epoch);
    assert.equal(renewer.active,true);assert.equal(rejected,0);
    assert.equal(clock.timers.at(-1).delay,5000);
    assert(logs.some(line=>line.includes('Keeping the VPN active')));renewer.stop();
  }
  const clock=timerHarness();let rejected;
  const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,getPass:async()=>({...pass(),quotaRemaining:'0'}),applyPass:async()=>{throw Error('must not apply');},onRejected:async error=>{rejected=error;},log:()=>{}});
  renewer.start(pass());await renewer.refresh(renewer.epoch);
  assert.equal(rejected.status,429);assert.equal(renewer.active,false);
});
test('stopped renewals never apply a late response after disconnect',async()=>{
  const clock=timerHarness();let complete,applied=0;
  const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,getPass:()=>new Promise(resolve=>{complete=resolve;}),
    applyPass:async()=>{applied++;},onRejected:async()=>{},log:()=>{}});
  renewer.start(pass());const pending=renewer.refresh(renewer.epoch);
  renewer.stop();complete(pass());await pending;
  assert.equal(applied,0);assert.equal(clock.timers.length,0);
});
test('expiration scheduling remains bounded and does not spin on missing dates',()=>{
  assert.equal(nextPassDelay(600000,0),480000);
  assert.equal(nextPassDelay(1000,0),1000);
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

test('simultaneous scheduled and reactive pass refreshes share one request and one successor timer',async()=>{
 const clock=timerHarness();let finish,calls=0,applied=0;
 const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,
  getPass:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},
  applyPass:async fresh=>{applied++;assert.equal(fresh.token,'rotated');},
  onRejected:async()=>{throw Error('Unexpected rejection');},log:()=>{}});
 renewer.start(pass());
 assert.equal(clock.timers.length,1);
 const p1=renewer.refresh(renewer.epoch);
 const p2=renewer.refresh(renewer.epoch);
 assert.strictEqual(p1,p2,'Concurrent calls to the same session must share a promise');
 assert.equal(clock.timers.length,0,'Old scheduled timer must be cleared before manual refresh');
 assert.equal(calls,1);
 finish({...pass(),token:'rotated'});
 await Promise.all([p1,p2]);
 assert.equal(applied,1);
 assert.equal(clock.timers.length,1,'Exactly one new timer must be scheduled');
 const next=renewer.refresh(renewer.epoch);
 // A new request can finish independently, but no duplicate timers remain.
 finish({...pass(),token:'rotated'});
 await next;
 assert.equal(clock.timers.length,1);
 renewer.stop();
 assert.equal(clock.timers.length,0);
});
test('a stale refresh from the old session never replaces the token or timer of a new session',async()=>{
 const clock=timerHarness();const resolutions=[];let applied=0;
 const renewer=new PassRenewer({...clock,now:()=>0,random:()=>0.5,
  getPass:()=>new Promise(resolve=>{resolutions.push(resolve);}),
  applyPass:async()=>{applied++;},onRejected:async()=>{},log:()=>{}});
 renewer.start(pass());
 const first=renewer.refresh(renewer.epoch);
 renewer.stop();
 renewer.start({...pass(),token:'new-session'});
 assert.equal(clock.timers.length,1);
 resolutions[0]({...pass(),token:'stale'});
 await first;
 assert.equal(applied,0);
 assert.equal(clock.timers.length,1);
 const second=renewer.refresh(renewer.epoch);
 resolutions[1]({...pass(),token:'valid'});
 await second;
 assert.equal(applied,1);
 assert.equal(clock.timers.length,1);
 renewer.stop();
});
