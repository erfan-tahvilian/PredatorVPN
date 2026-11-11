// SPDX-License-Identifier: GPL-3.0-or-later
// Embed AppImageUpdate metadata into the static AppImage runtime's reserved ELF
// section, then generate the matching zsync control file.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const version=require('../package.json').version;
const {target}=require('./linux-target.cjs');

function descriptor(cpu){
 assert(['x86_64','aarch64'].includes(cpu),'Unsupported AppImage architecture');
 return `gh-releases-zsync|erfan-tahvilian|PredatorVPN|latest|PredatorVPN-*-${cpu}.AppImage.zsync`;
}
function sectionInfo(readelfOutput){
 const line=readelfOutput.split(/\r?\n/).find(line=>/^\s*\[\s*\d+\]\s+\.upd_info\s+/.test(line));
 assert(line,'Static AppImage runtime does not expose an ELF .upd_info section');
 const parts=line.trim().replace(/^\[\s*\d+\]\s+/, '').split(/\s+/);
 assert.equal(parts[0],'.upd_info');
 assert(parts.length>=5,'Incomplete ELF .upd_info section details');
 const offset=Number.parseInt(parts[3],16),size=Number.parseInt(parts[4],16);
 assert(Number.isSafeInteger(offset)&&offset>0&&Number.isSafeInteger(size)&&size>=64,'Unsafe ELF metadata bounds');
 return {offset,size};
}
function embed(imageFile,info,readelfOutput){
 const {offset,size}=sectionInfo(readelfOutput),payload=Buffer.from(info,'ascii'),stat=fs.statSync(imageFile);
 assert(payload.length>0&&payload.length<size,'AppImage update information exceeds reserved ELF section');
 assert(offset+size<stat.size,'AppImage metadata bounds exceed file size');
 const file=fs.openSync(imageFile,'r+');
 try{
  const before=Buffer.alloc(size);
  assert.equal(fs.readSync(file,before,0,size,offset),size);
  assert(!before.includes(0x7f),'Unexpected binary content in AppImage update information');
  const data=Buffer.alloc(size);payload.copy(data);
  assert.equal(fs.writeSync(file,data,0,data.length,offset),data.length);
 }finally{fs.closeSync(file);}
 return {offset,size};
}
function main(){
 const cpu=target().arch==='x64'?'x86_64':'aarch64';
 const name=`PredatorVPN-${version}-${cpu}.AppImage`,image=path.resolve('dist',name);
 assert(fs.existsSync(image),`Missing AppImage ${name}`);
 const info=descriptor(cpu);
 const output=execFileSync('readelf',['--wide','--sections',image],{encoding:'utf8'});
 const metadata=embed(image,info,output);
 const actual=execFileSync(image,['--appimage-updateinformation'],{encoding:'utf8'}).replace(/\x00/g,'').trim();
 assert.equal(actual,info,'Embedded AppImageUpdate descriptor verification failed');
 const programHeaders=execFileSync('readelf',['--wide','--program-headers',image],{encoding:'utf8'});
 assert(!/\bINTERP\b/.test(programHeaders),'AppImage launcher must be statically linked to avoid host libfuse/glibc requirements');
 const base=`https://github.com/erfan-tahvilian/PredatorVPN/releases/download/v${version}/${name}`;
 execFileSync('zsyncmake',['-u',base,'-o',`${image}.zsync`,image],{stdio:'pipe'});
 const zsync=fs.readFileSync(`${image}.zsync`);
 assert(zsync.includes(Buffer.from(`URL: ${base}`)),'zsync must point to the exact matching AppImage asset');
 console.log(JSON.stringify({image:name,descriptor:info,metadata,zsync:path.basename(image)+'.zsync',runtime:'static',zsyncSize:zsync.length}));
}
if(require.main===module)main();
module.exports={descriptor,sectionInfo,embed};
