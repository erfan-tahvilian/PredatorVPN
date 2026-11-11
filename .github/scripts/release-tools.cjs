// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {assetName,newer}=require('../../src/lib/updates.cjs');
const version=require('../../package.json').version,tag='v'+version;
function binaries(v){const result=[];for(const [platform,arches,formats]of[['win32',['x64','ia32','arm64'],['exe','zip']],['darwin',['x64','arm64'],['dmg','zip']],['linux',['x64','arm64'],['AppImage','deb','rpm']],['android',['arm64-v8a','armeabi-v7a','x86_64','x86','universal'],['apk']]])for(const arch of arches)for(const format of formats)result.push(assetName(v,{platform,arch,format}));return result;}
function validateRelease(release,v){
  assert.equal(release.tag_name,'v'+v);assert.equal(release.prerelease,false);
  // Predator VPN source is provided by GitHub's version-tag archives. Keep the
  // separately bundled GPL dependency source and all installation variants.
  const appImageUpdateAssets=newer(v,'2.0.4')?binaries(v).filter(name=>name.endsWith('.AppImage')).map(name=>name+'.zsync'):[];
  const required=[...binaries(v),...appImageUpdateAssets,'sing-box-1.12.0-source.tar.gz','SHA256SUMS-Android.txt'];
  const allowed=new Set([...required,'SHA256SUMS.txt']);
  assert.equal(new Set(release.assets.map(a=>a.name)).size,release.assets.length,'Duplicate release asset');
  for(const name of required)assert(release.assets.some(a=>a.name===name),`Missing release asset: ${name}`);
  for(const a of release.assets){assert(allowed.has(a.name),`Unexpected or transient asset: ${a.name}`);assert.equal(a.state,'uploaded');assert(a.size>0);assert.match(a.digest,/^sha256:[a-f0-9]{64}$/);}
  return release.assets.filter(a=>a.name!=='SHA256SUMS.txt').sort((a,b)=>a.name.localeCompare(b.name)).map(a=>`${a.digest.slice(7)}  ${a.name}`).join('\n')+'\n';
}
function gh(...args){return execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function api(endpoint){return JSON.parse(gh('api',endpoint));}
// GitHub can omit an unpublished draft from the tag endpoint until its tag
// exists. The authenticated release list includes drafts and their release ID.
function findRelease(repo){return api(`repos/${repo}/releases?per_page=100`).find(release=>release.tag_name===tag)||null;}
async function pollRelease(read,wait=()=>new Promise(resolve=>setTimeout(resolve,1000))){
  for(let attempt=0;attempt<10;attempt++){const release=read();if(release)return release;if(attempt<9)await wait();}
  return null;
}
async function main(){
  const mode=process.argv[2],repo=process.env.GITHUB_REPOSITORY||'erfan-tahvilian/PredatorVPN';assert.equal(repo,'erfan-tahvilian/PredatorVPN');
  if(mode==='metadata'){console.log(`FOX_VERSION=${version}\nFOX_TAG=${tag}`);return;}
  if(mode==='ensure-draft'){
    try{const latest=api(`repos/${repo}/releases/latest`);assert(newer(version,latest.tag_name.replace(/^v/,'')),'Use a version newer than the published stable release');}catch(error){if(!String(error.stderr).includes('HTTP 404'))throw error;}
    let release=findRelease(repo);
    if(!release){
      let creationError;
      try{gh('release','create',tag,'--repo',repo,'--draft','--target',process.env.GITHUB_SHA||gh('api',`repos/${repo}/commits/main`,'--jq','.sha'),'--title',`Predator VPN ${tag}`,'--notes-file','RELEASE_NOTES.md');}catch(error){creationError=error;}
      // A newly created draft can briefly be absent from the release list.
      // Poll without issuing another create or touching any published release.
      release=await pollRelease(()=>findRelease(repo));
      if(!release&&creationError)throw creationError;
    }
    assert(release,'The new draft is not yet visible; no packages were published');
    assert(release.draft,'Published versions cannot be overwritten. Increase the application version.');
    assert.equal(release.target_commitish,process.env.GITHUB_SHA||gh('api',`repos/${repo}/commits/main`,'--jq','.sha'),'Draft source must match the release commit');
    return;
  }
  if(mode!=='finalize')throw Error('Unsupported release operation');
  const release=findRelease(repo);assert(release,'Stage the complete release first');
  const manifest=validateRelease(release,version);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fox-release-'));
  gh('release','download',tag,'--repo',repo,'--pattern','SHA256SUMS-Android.txt','--dir',temporary);
  const android=fs.readFileSync(path.join(temporary,'SHA256SUMS-Android.txt'),'utf8').trim().split(/\r?\n/);
  assert.equal(android.length,5);
  for(const line of android){const match=/^([a-f0-9]{64})\s+(.+\.apk)$/.exec(line);assert(match);assert(release.assets.some(a=>a.name===match[2]&&a.digest==='sha256:'+match[1]),'Android checksum differs');}
  if(release.draft){
    const checksum=path.join(temporary,'SHA256SUMS.txt');fs.writeFileSync(checksum,manifest);gh('release','upload',tag,checksum,'--repo',repo,'--clobber');
    const body=path.join(temporary,'publish.json');fs.writeFileSync(body,JSON.stringify({draft:false,prerelease:false,make_latest:'true',name:`Predator VPN ${tag} - Windows, macOS, Linux & Android`,body:fs.readFileSync('RELEASE_NOTES.md','utf8')}));
    gh('api','--method','PATCH',`repos/${repo}/releases/${release.id}`,'--input',body);
  }
  let latest;
  for(let attempt=0;attempt<6;attempt++){latest=api(`repos/${repo}/releases/latest`);if(latest.id===release.id)break;await new Promise(resolve=>setTimeout(resolve,2000));}
  assert.equal(latest.id,release.id,'The new release is not latest; older downloads were preserved');
  validateRelease(latest,version);
  // Preserve every historical Release, tag, asset and release note unchanged.
  // Existing versions remain independently downloadable after new publication.
  console.log(`Published and verified ${tag}; all older Releases and assets preserved.`);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={binaries,validateRelease,pollRelease};
