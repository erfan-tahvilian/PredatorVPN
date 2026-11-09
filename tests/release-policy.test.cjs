// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ReleaseNotes}=require('../src/lib/release-notes.cjs');
const {binaries,validateRelease,olderTags,archivedNotes,archiveRelease}=require('../.github/scripts/release-tools.cjs');
const {compare}=require('../.github/scripts/release-size-report.cjs');
test('a newly created release is polled with bounded retries until GitHub exposes it',async()=>{
  const {pollRelease}=require('../.github/scripts/release-tools.cjs');let reads=0,waits=0;const draft={id:123,draft:true};
  assert.equal(await pollRelease(()=>++reads===3?draft:null,async()=>{waits++;}),draft);assert.equal(reads,3);assert.equal(waits,2);
  reads=0;waits=0;assert.equal(await pollRelease(()=>{reads++;return null;},async()=>{waits++;}),null);assert.equal(reads,10);assert.equal(waits,9);
});
test('size report covers every architecture and separates compression from a retired source duplicate',()=>{
  const before={tag_name:'v1.0.1',assets:binaries('1.0.1').map(name=>({name,size:1000})).concat({name:'PredatorVPN-1.0.1-source.tar.gz',size:500})};
  const after={tag_name:'v1.0.2',assets:binaries('1.0.2').map(name=>({name,size:900}))};
  const result=compare(before,after);assert.equal(result.rows.length,21);assert.equal(result.totals.savedBytes,2100);assert.equal(result.releaseTotals.savedBytes,2600);assert.equal(result.auxiliary[0].status,'retired');
  assert.throws(()=>compare(before,{...after,assets:after.assets.slice(1)}),/Missing comparable asset/);
});
test('release highlights are acknowledged once per version and filtered for the installed platform',()=>{
  const stateFile=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'fox-notes-')),'state.json'),notes={version:'1.0.1',items:[{platforms:['win32'],title:'Windows improvement',description:'Fixture'},{platforms:['android'],title:'Android improvement',description:'Fixture'}]};
  const store=new ReleaseNotes({notes,version:'1.0.1',platform:'win32',stateFile});assert.equal(store.read().seen,false);assert.deepEqual(store.read().items,[{title:'Windows improvement',description:'Fixture'}]);store.acknowledge();assert.equal(store.read().seen,true);
  const next=new ReleaseNotes({notes:{...notes,version:'1.0.2'},version:'1.0.2',platform:'win32',stateFile});assert.equal(next.read().seen,false);assert.throws(()=>new ReleaseNotes({notes,version:'1.0.2',platform:'win32',stateFile}));
});
test('release publication requires every supported binary and rejects temporary or stale assets',()=>{
  const names=[...binaries('1.0.1'),'sing-box-1.12.0-source.tar.gz','SHA256SUMS-Android.txt'];
  const release={tag_name:'v1.0.1',draft:true,prerelease:false,assets:names.map(name=>({name,state:'uploaded',size:1024,digest:'sha256:'+'ab'.repeat(32)}))};
  assert.equal(validateRelease(release,'1.0.1').trim().split('\n').length,23);
  assert.throws(()=>validateRelease({...release,assets:release.assets.slice(1)},'1.0.1'));
  assert.throws(()=>validateRelease({...release,assets:[...release.assets,{name:'android-signing-envelope.json'}]},'1.0.1'));
  assert.throws(()=>validateRelease({...release,tag_name:'v1.0.0'},'1.0.1'));
  assert.throws(()=>validateRelease({...release,assets:[...release.assets,{name:'PredatorVPN-1.0.1-source.tar.gz'}]},'1.0.1'));
});
test('release cleanup selects only older versioned releases and preserves newer releases',()=>{
  assert.deepEqual(olderTags([{tag_name:'v1.0.0'},{tag_name:'v1.0.1'},{tag_name:'v1.0.2'},{tag_name:'v2.0.0'},{tag_name:'development'}],'1.0.1'),['v1.0.0']);
});
test('older releases lose downloadable installers while keeping historical notes',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'predator-rollback-')),calls=[];
  const old={id:17,tag_name:'v1.0.3',draft:false,body:'# Predator VPN v1.0.3\n\n## Downloads\n\n- file.exe',assets:[{id:31,name:'PredatorVPN-1.0.3-Windows-x64.exe'},{id:32,name:'SHA256SUMS.txt'}]};
  const outcome=archiveRelease('erfan-tahvilian/PredatorVPN',old,temp,(...args)=>calls.push(args));
  assert.deepEqual(outcome,{stripped:true,tag:'v1.0.3'});
  assert.equal(calls.filter(args=>args[0]==='release'&&args[1]==='delete-asset').length,2);
  const bodyCall=calls.find(args=>args[0]==='api'&&args[1]==='--method'&&args[2]==='PATCH');
  assert(bodyCall);
  assert.match(String(bodyCall[3]),/\/releases\/17$/);
  const body=JSON.parse(fs.readFileSync(bodyCall[bodyCall.length-1],'utf8'));
  assert.match(body.body,/Installers for older versions are no longer distributed/);
  assert(!body.body.includes('## Downloads'));
});
