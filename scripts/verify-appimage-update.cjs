// SPDX-License-Identifier: GPL-3.0-or-later
// Validate x86_64 and aarch64 AppImages on any Linux host without executing
// a foreign-architecture executable.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {descriptor,sectionInfo}=require('./embed-appimage-update.cjs');
const version=require('../package.json').version;
function check(dir,cpu){
 const name=`PredatorVPN-${version}-${cpu}.AppImage`;
 const image=path.join(dir,name),zsync=image+'.zsync';
 assert(fs.statSync(image).size>0);
 assert(fs.statSync(zsync).size>0);
 const elf=execFileSync('readelf',['--wide','--sections',image],{encoding:'utf8'});
 const {offset,size}=sectionInfo(elf),buf=Buffer.alloc(size);
 const fd=fs.openSync(image,'r');
 try{assert.equal(fs.readSync(fd,buf,0,size,offset),size);}finally{fs.closeSync(fd);}
 const actual=buf.toString('ascii').split('\0',1)[0];
 assert.equal(actual,descriptor(cpu),`AppImageUpdate descriptor mismatch for ${cpu}`);
 const ph=execFileSync('readelf',['--wide','--program-headers',image],{encoding:'utf8'});
 assert(!/^\s*INTERP\s/m.test(ph),`Host dynamic linker dependency in AppImage runtime for ${cpu}`);
 const url=`https://github.com/erfan-tahvilian/PredatorVPN/releases/download/v${version}/${name}`;
 assert(fs.readFileSync(zsync).includes(Buffer.from(`URL: ${url}`)),`Invalid zsync target for ${cpu}`);
 return {name,descriptor:actual,zsync:path.basename(zsync),runtime:'static'};
}
function main(){const dir=path.resolve(process.argv[2]||'dist');for(const cpu of ['x86_64','aarch64'])console.log(JSON.stringify(check(dir,cpu)));}
if(require.main===module)main();
module.exports={check};
