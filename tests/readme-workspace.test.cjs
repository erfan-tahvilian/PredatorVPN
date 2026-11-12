// SPDX-License-Identifier: GPL-3.0-or-later
// Keep the README workspace faithful to the real app with anonymous screenshots.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mockups=['dark','light'].flatMap(theme=>[
  'docs/readme/workspace-v205-'+theme+'.webp',
  'docs/readme/workspace-v205-'+theme+'-mobile.webp'
]);
const screens=['dark','light'].flatMap(theme=>[
  'docs/screenshots/desktop-v205-overview-'+theme+'.png',
  'docs/screenshots/android-v205-overview-'+theme+'.png'
]);
test('English and Persian workspace sections use real v2.0.5 device mockups in both themes',()=>{
  for(const file of ['README.md','README.fa.md']){
    const source=read(file),start=source.indexOf('<a name="the-workspace"></a>');
    const end=source.indexOf('<a name="traffic-on-your-terms"></a>',start);
    assert(start>=0 && end>start,file+' missing workspace anchors');
    const section=source.slice(start,end);
    for(const asset of mockups)assert(section.includes(asset),file+' not referencing '+asset);
    assert.doesNotMatch(section,/docs\/screenshots\/desktop-v205-overview-dark\.png|docs\/screenshots\/android-v205-overview-dark\.png/,file+' still links raw screenshots below the showcase');
    assert.doesNotMatch(section,/<sub>|View original desktop screenshot|View Android screenshot|anonymized to <strong>Predator<\/strong>/i,file+' still includes removed captions');
    assert.match(section,/<picture>\s*<source media="\(prefers-color-scheme: dark\) and \(max-width: 700px\)"/);
    assert.match(section,/Predator/);
    assert.doesNotMatch(section,/docs\/screenshots\/android-overview\.png|docs\/screenshots\/desktop-overview-(dark|light)\.png/);
  }
});
test('device labels are only Desktop and Mobile and never overlap the screen mockups',()=>{
  const graphic=read('scripts/build-readme-workspace.py');
  assert.doesNotMatch(graphic,/DESKTOP\s+.*WINDOWS|MOBILE\s+.*ANDROID|ANONYMIZED ACCOUNT: PREDATOR/);
  assert.match(graphic,/badge\(canvas,149,321,'Desktop',dark\)/);
  assert.match(graphic,/badge\(canvas,1890,260,'Mobile',dark\)/);
  assert.match(graphic,/badge\(canvas,92,310,'Desktop',dark\)/);
  assert.match(graphic,/badge\(canvas,490,995,'Mobile',dark\)/);
  assert.match(graphic,/laptop\(canvas,desk,146,396,1638\)/);
  assert.match(graphic,/phone\(canvas,mob,1890,342,459\)/);
  assert.match(graphic,/laptop\(canvas,desk,91,382,1018\)/);
  assert.match(graphic,/phone\(canvas,mob,375,1066,420\)/);
});

test('published showcase files have valid image signatures and nontrivial dimensions',()=>{
  for(const file of mockups){
    const data=fs.readFileSync(path.join(root,file));
    assert(data.length>50000,file+' unexpectedly small');
    assert.equal(data.toString('ascii',0,4),'RIFF',file+' not RIFF');
    assert.equal(data.toString('ascii',8,12),'WEBP',file+' not WebP');
  }
  for(const file of screens){
    const data=fs.readFileSync(path.join(root,file));
    assert(data.length>100000,file+' unexpectedly small');
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' not PNG');
    const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
    assert(width>=1000&&height>=900,file+' wrong screenshot size');
  }
});
test('capture uses an isolated placeholder account, never the private user profile',()=>{
  const fixture=read('scripts/readme-preview-preload.cjs');
  const desktop=read('scripts/capture-readme-v205.cjs');
  const graphics=read('scripts/build-readme-workspace.py');
  assert.match(fixture,/Predator@example\.invalid/);
  assert.match(desktop,/setPath\('userData',scratch\)/);
  assert.match(desktop,/assert\.equal\(info\.account,'Predator'\)/);
  assert.match(graphics,/anonymize_android/);
  assert.match(graphics,/d\.text\(\(850,121\),'Predator'/);
  assert.doesNotMatch(fixture,/process\.env\.APPDATA|vault\.bin/);
});
