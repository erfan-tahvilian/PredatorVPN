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
test('both READMEs show the exact user-approved cinematic image',()=>{
  const crypto=require('node:crypto');
  const asset='docs/readme/workspace-v205-cinematic.png';
  const bytes=fs.readFileSync(path.join(root,asset));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'a9a9038b6e44cbfda680cd2465bf37b9246a502d7909cf652ab29aa82b661cb2');
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16),1688);
  assert.equal(bytes.readUInt32BE(20),932);
  for(const file of ['README.md','README.fa.md']){
    const text=read(file),i=text.indexOf('<a name="the-workspace"></a>'),j=text.indexOf('<a name="traffic-on-your-terms"></a>',i);
    assert(i>=0&&j>i,'Workspace anchor missing '+file);
    const section=text.slice(i,j);
    assert(section.includes('<img src="'+asset+'"'));
    assert.doesNotMatch(section,/workspace-v205-(dark|light)(-mobile)?\.webp/);
    assert.doesNotMatch(section,/<picture>|<sub>|View original desktop screenshot|View Android screenshot/);
  }
});

test('desktop and mobile labels have exactly equal vertical clearance',()=>{
  const graphic=read('scripts/build-readme-workspace.py');
  assert.doesNotMatch(graphic,/DESKTOP\s+.*WINDOWS|MOBILE\s+.*ANDROID|ANONYMIZED ACCOUNT: PREDATOR/);
  assert.match(graphic,/desktop_gap=badge_above_device\(canvas,149,desktop_top,'Desktop',dark,gap\)/);
  assert.match(graphic,/mobile_gap=badge_above_device\(canvas,1950,mobile_top,'Mobile',dark,gap\)/);
  assert.match(graphic,/desktop_gap==mobile_gap/);
  assert.match(graphic,/measured == gap/);
  assert.match(graphic,/gap=50/);
  assert.match(graphic,/gap=44/);
  assert.match(graphic,/phone\(canvas,mob,375,1200,420\)/);
  assert.match(graphic,/phone\(canvas,mob,1950,360,459\)/);
  assert.doesNotMatch(graphic,/PREDATOR VPN\s+\/\s+v2\.0\.5/);
  const capture=read('scripts/capture-readme-v205.cjs');
  assert.match(capture,/footer:''/);
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
