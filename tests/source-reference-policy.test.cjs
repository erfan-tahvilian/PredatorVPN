// SPDX-License-Identifier: GPL-3.0-or-later
// Keep third-party names and comparison references out of tracked source,
// documentation, release metadata, and installable text assets.
// Binary login helpers are deliberately unchanged and excluded from text scans.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Encode disallowed identifiers so the guard itself contains no public name.
const blockedIdentifiers=[
 String.fromCharCode(97,114,109,97,110),
 String.fromCharCode(118,97,117,116,104),
];
const banned=new RegExp(blockedIdentifiers.join('|'),'i');
const binaryExtensions=new Set(['.exe','.dll','.dylib','.so','.a','.o','.obj','.aar','.jar','.zip','.apk','.png','.jpg','.jpeg','.ico','.webp','.gif','.pdf','.woff','.woff2','.ttf','.otf','.gz','.bin','.mp4','.mp3','.AppImage']);
const files=()=>execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,maxBuffer:16*1024*1024}).toString('utf8').split('\0').filter(Boolean);

test('tracked and newly created source paths contain no disallowed third-party name',()=>{
 const hits=[];
 for(const file of files()){
  const full=path.join(root,file);
  if(!fs.existsSync(full))continue;
  if(banned.test(file))hits.push(file);
 }
 assert.deepEqual(hits,[]);
});

test('source, documentation and license text contain no disallowed third-party reference',()=>{
 const hits=[];
 for(const file of files()){
  const full=path.join(root,file);
  if(!fs.existsSync(full)||!fs.statSync(full).isFile()||binaryExtensions.has(path.extname(file)))continue;
  const content=fs.readFileSync(full);
  // Read only genuine text files; do not rewrite or search binary build helpers.
  if(content.includes(0))continue;
  if(banned.test(content.toString('utf8')))hits.push(file);
 }
 assert.deepEqual(hits,[]);
});

test('reachable commit messages, authors and committers contain no disallowed references',()=>{
 const log=execFileSync('git',['log','--all','--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B'],{
  cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,
 });
 assert.equal(banned.test(log),false);
});
