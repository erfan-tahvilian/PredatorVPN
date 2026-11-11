// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {descriptor,sectionInfo,embed}=require('../scripts/embed-appimage-update.cjs');

test('AppImageUpdate points to latest matching GitHub architecture-specific zsync',()=>{
 assert.equal(descriptor('x86_64'),'gh-releases-zsync|erfan-tahvilian|PredatorVPN|latest|PredatorVPN-*-x86_64.AppImage.zsync');
 assert.equal(descriptor('aarch64'),'gh-releases-zsync|erfan-tahvilian|PredatorVPN|latest|PredatorVPN-*-aarch64.AppImage.zsync');
 assert.throws(()=>descriptor('armhf'),/Unsupported/);
});

test('ELF section is parsed and update info is written strictly in its reserved bytes',()=>{
 const listing='  [12] .upd_info PROGBITS 0000000000000000 000080 000100 00 A 0 0 16';
 assert.deepEqual(sectionInfo(listing),{offset:128,size:256});
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'appimage-upd-'));
 try{
  const image=path.join(directory,'test.AppImage');
  fs.writeFileSync(image,Buffer.alloc(900));
  const info=descriptor('x86_64');
  embed(image,info,listing);
  const actual=fs.readFileSync(image);
  assert.equal(actual.subarray(128,128+info.length).toString('ascii'),info);
  assert(actual.subarray(128+info.length,384).every(b=>b===0));
  assert(actual.subarray(384).every(b=>b===0));
  assert.throws(()=>embed(image,'X'.repeat(256),listing),/exceeds reserved/);
  assert.throws(()=>sectionInfo('no update metadata'),/does not expose/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Linux recipe uses static FUSE-free runtime and produces zsync files',()=>{
 const recipe=fs.readFileSync(path.join(__dirname,'../scripts/build-linux.cjs'),'utf8');
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/linux.yml'),'utf8');
 assert.match(recipe,/appimage:'1\.0\.3'/);
 assert.match(workflow,/node scripts\/embed-appimage-update\.cjs/);
 assert.match(workflow,/dist\/\*\.AppImage\.zsync/);
 assert(!workflow.includes('libfuse2t64'));
});
