// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DEFAULTS,validate,engineConfig}=require('../src/lib/settings.cjs');
const {prepareFxARecovery}=require('../src/lib/fxa-account-recovery.cjs');

test('split tunneling switch preserves saved app rules and turns them off safely',()=>{
 const saved=validate({...DEFAULTS,splitTunnelingEnabled:false,splitMode:'include',excludedApps:['chrome.exe']},'win32');
 assert.deepEqual(saved.excludedApps,['chrome.exe']);
 const cfg=engineConfig(saved,'203.0.113.1',null,null,'win32');
 assert.equal(cfg.route.final,'fox');
 assert(!cfg.route.rules.some(r=>r.process_name?.includes('chrome.exe')));
 const enabled=engineConfig({...saved,splitTunnelingEnabled:true},null,null,null,'win32');
 assert.equal(enabled.route.final,'direct');
 assert(enabled.route.rules.some(r=>r.process_name?.includes('chrome.exe')&&r.outbound==='fox'));
 assert.throws(()=>validate({...DEFAULTS,splitTunnelingEnabled:'false'},'win32'),/Invalid setting/);
 assert.throws(()=>validate({...DEFAULTS,accountRecoveryEnabled:'true'},'linux'),/Invalid setting/);
});

test('optional Firefox recovery first probes without credentials and uses a temporary TLS-verified route',async()=>{
 const calls=[],proxy=[];let stopped=0;
 const transport=async(_url,opts)=>{
  const payload=JSON.parse(opts.body);calls.push(payload);
  if(!proxy.length)throw Object.assign(Error('Network timed out'),{code:'ERR_TIMED_OUT'});
  return new Response('',{status:406});
 };
 transport.setAccountRecoveryProxy=async rule=>{proxy.push(rule);};
 const session=await prepareFxARecovery({transport,options:{subUrls:['https://example.invalid/']},resolveUpstream:async()=>({upstream:{type:'socks5',host:'127.0.0.1',port:42355},stop:async()=>stopped++})});
 assert.equal(session.route,'subscription');
 assert.deepEqual(calls,[{},{}]);
 assert.match(proxy[0],/^socks5:\/\/127.0.0.1:/);
 await session.stop();await session.stop();
 assert.equal(stopped,1);assert.equal(proxy.at(-1),null);
});

test('HTTP 406 verification does not start account recovery or resend a password',async()=>{
 let upstreams=0,requests=0;
 const transport=async()=>{requests++;return new Response('',{status:406});};
 transport.setAccountRecoveryProxy=async()=>{};
 const session=await prepareFxARecovery({transport,options:{subUrls:['https://example.invalid/']},resolveUpstream:async()=>{upstreams++;throw Error('Must not run');}});
 assert.equal(session.route,'native');assert.equal(upstreams,0);assert.equal(requests,1);
});

test('failed verified subscription probe is rolled back without credential submission',async()=>{
 const changes=[];let stop=0;
 const transport=async()=>{throw Object.assign(Error('timeout'),{code:'ERR_TIMED_OUT'});};
 transport.setAccountRecoveryProxy=async rule=>changes.push(rule);
 await assert.rejects(prepareFxARecovery({transport,options:{subUrls:['https://example.invalid/']},resolveUpstream:async()=>({upstream:{type:'socks5',host:'127.0.0.1',port:45222},stop:async()=>stop++})}),/No login credentials were sent/);
 assert.equal(changes.at(-1),null);assert.equal(stop,1);
});
