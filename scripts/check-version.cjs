// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),assert=require('node:assert/strict');
const pkg=require('../package.json'),notes=require('../release-notes.json');
assert.match(pkg.version,/^\d+\.\d+\.\d+$/);assert.equal(require('../package-lock.json').version,pkg.version);assert.equal(require('../package-lock.json').packages[''].version,pkg.version);
assert.equal(notes.version,pkg.version);assert(notes.items.length);
for(const item of notes.items){assert(typeof item.title==='string'&&item.title.trim());assert(typeof item.description==='string'&&item.description.trim());assert(Array.isArray(item.platforms)&&item.platforms.every(p=>['win32','darwin','linux','android'].includes(p)));}
assert.equal(/const appVersion\s*=\s*"([^"]+)"/.exec(fs.readFileSync('android/core/mobile/updates.go','utf8'))?.[1],pkg.version);
const [major,minor,patch]=pkg.version.split('.').map(Number);assert(major<2000&&minor<1000&&patch<1000,'Android version-code components are out of range');
assert(major*1000000+minor*1000+patch>1);
for(const name of ['README.md','README.fa.md']){
  const readme=fs.readFileSync(name,'utf8');
  assert(readme.includes('/releases/tag/v'+pkg.version),`${name} must point to the current release`);
  assert(readme.includes('/releases/download/v'+pkg.version+'/PredatorVPN-'+pkg.version+'-Windows-x64.exe'),`${name} must link current Windows release`);
  assert(readme.includes('/releases/download/v'+pkg.version+'/PredatorVPN-'+pkg.version+'-Android-arm64-v8a.apk'),`${name} must link current Android release`);
}
assert(fs.readFileSync('docs/readme/badge-version.svg','utf8').includes(pkg.version),'README version badge is stale');
console.log(`Version ${pkg.version}, READMEs, Android metadata and release highlights agree.`);
