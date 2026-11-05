// SPDX-License-Identifier: GPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mixedCase='Predator'+'Vpn';
test('canonical repository case is PredatorVPN everywhere in release-bound files',()=>{
 const files=['AGENTS.md','README.md','README.fa.md','RELEASE_NOTES.md','package.json','src/lib/updates.cjs','android/core/mobile/updates.go','scripts/build-windows.cjs','.github/scripts/release-tools.cjs'];
 for(const file of files)assert.doesNotMatch(read(file),new RegExp(mixedCase),file);
 assert.match(read('AGENTS.md'),/erfan-tahvilian\/PredatorVPN/);
 assert.match(read('src/lib/updates.cjs'),/erfan-tahvilian\/PredatorVPN/);
 assert.match(read('scripts/build-windows.cjs'),/PredatorVPN-/);
 assert.match(read('package.json'),/PredatorVPN-/);
});
test('tracked source has no mixed-case brand spelling',()=>{
 let result='';
 try{result=execFileSync('git',['grep','-I','-l',mixedCase],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();}
 catch(error){if(error.status!==1)throw error;}
 assert.equal(result,'');
});
