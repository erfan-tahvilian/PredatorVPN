// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const workflows={
  windows:'.github/workflows/windows.yml',
  linux:'.github/workflows/linux.yml',
  macos:'.github/workflows/macos.yml',
  android:'.github/workflows/android.yml',
  docs:'.github/workflows/docs-check.yml'
};
function pathsFor(name,event){
  const lines=fs.readFileSync(path.join(root,workflows[name]),'utf8').split(/\r?\n/);
  const index=lines.findIndex(line=>line==='  '+event+':');
  if(index<0)return null;
  const section=[];
  for(let i=index+1;i<lines.length;i++){
    if(lines[i]&&!lines[i].startsWith('    ')&&!lines[i].startsWith('      '))break;
    section.push(lines[i]);
  }
  const pathIndex=section.findIndex(line=>line.startsWith('    paths:'));
  if(pathIndex<0)return null;
  const inline=[...section[pathIndex].matchAll(/'([^']+)'/g)].map(match=>match[1]);
  if(inline.length)return inline;
  const block=[];
  for(let i=pathIndex+1;i<section.length;i++){
    const match=/^      - '([^']+)'$/.exec(section[i]);
    if(!match)break;
    block.push(match[1]);
  }
  return block;
}
function globMatches(pattern,file){
  let exp='^';
  for(let i=0;i<pattern.length;i++){
    const char=pattern[i];
    if(char==='*'&&pattern[i+1]==='*'){exp+='.*';i++;}
    else if(char==='*')exp+='[^/]*';
    else if(char==='?')exp+='[^/]';
    else exp+=('\\.^$|()[]{}+'.includes(char)?'\\':'')+char;
  }
  return new RegExp(exp+'$').test(file);
}
function triggers(name,event,files){
  const patterns=pathsFor(name,event);
  if(!patterns)return false;
  return files.some(file=>{
    let selected=false;
    for(const pattern of patterns){
      const excluded=pattern.startsWith('!');
      if(globMatches(excluded?pattern.slice(1):pattern,file))selected=!excluded;
    }
    return selected;
  });
}
test('all code-build workflows filter push and pull-request file changes',()=>{
  for(const name of ['windows','linux','macos','android']){
    assert(pathsFor(name,'push')?.length>0,name+' push paths missing');
    assert(pathsFor(name,'pull_request')?.length>0,name+' PR paths missing');
  }
});
test('a Japanese documentation PR triggers only the lightweight checks',()=>{
  const files=[
    'README.ja.md','README.md','README.fa.md',
    'scripts/check-version.cjs','tests/brand-name-case.test.cjs',
    'tests/branding.test.cjs','tests/readme-workspace.test.cjs'
  ];
  for(const event of ['push','pull_request']){
    assert(triggers('docs',event,files),event+': docs checks missing');
    for(const name of ['windows','linux','macos','android']){
      assert.equal(triggers(name,event,files),false,name+' erroneously rebuilds documentation changes');
    }
  }
});
test('standalone documentation, previews and metadata scripts avoid installer builds',()=>{
  const files=[
    'README.md','README.fa.md','README.ja.md','RELEASE_NOTES.md',
    'AGENTS.md','CONTRIBUTING.md',
    'docs/readme/workspace-v205-cinematic.png',
    'scripts/check-version.cjs','scripts/build-readme-workspace.py',
    'scripts/capture-readme-v205.cjs','scripts/readme-preview-preload.cjs',
    'tests/ci-workflow-paths.test.cjs'
  ];
  for(const file of files){
    assert(triggers('docs','push',[file]),file+' not covered by documentation checks');
    assert(triggers('docs','pull_request',[file]),file+' not covered on PR');
    for(const name of ['windows','linux','macos','android']){
      for(const event of ['push','pull_request']){
        assert.equal(triggers(name,event,[file]),false,
          name+' '+event+' should not rebuild after editing '+file);
      }
    }
  }
});
test('source, native dependencies and release version changes still build affected targets',()=>{
  const shared=['src/ui/app.js','assets/logo.png','package.json','release-notes.json'];
  for(const file of shared){
    for(const name of ['windows','linux','macos','android']){
      assert(triggers(name,'push',[file]),name+' lost build trigger on '+file);
      assert(triggers(name,'pull_request',[file]),name+' lost PR validation for '+file);
    }
  }
  for(const name of ['windows','linux','macos']){
    assert(triggers(name,'push',['desktop/h3/main.go']),name+' missed native transport');
    assert(triggers(name,'push',['scripts/validate-engine.cjs']),name+' missed shared build tools');
  }
  assert(triggers('android','push',['android/core/mobile/backend.go']));
  assert(triggers('android','pull_request',['android/core/mobile/backend.go']));
});
test('workflow changes remain eligible for their own build, and docs CI checks itself',()=>{
  for(const name of ['windows','linux','macos','android']){
    const file=workflows[name];
    assert(triggers(name,'push',[file]),name+' workflow must validate its own changes');
    assert(triggers('docs','push',[file]),'doc CI should validate modified workflow paths');
  }
  assert(triggers('docs','push',[workflows.docs]));
  assert(triggers('docs','pull_request',[workflows.docs]));
});
