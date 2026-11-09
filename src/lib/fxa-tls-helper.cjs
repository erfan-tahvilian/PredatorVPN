// SPDX-License-Identifier: GPL-3.0-or-later
// Bridge to the Firefox-TLS (utls) FxA helper shipped beside the app.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

function helperCandidates(){
  const resources=process.resourcesPath||'';
  const execDir=path.dirname(process.execPath||'');
  const names=[];
  if(process.platform==='win32'){
    names.push('fxa-auth.exe','fxa-auth-windows-amd64.exe','fxa-auth-windows-arm64.exe','fxa-auth-windows-386.exe');
  }else if(process.platform==='darwin'){
    names.push('fxa-auth','fxa-auth-darwin-arm64','fxa-auth-darwin-amd64');
  }else{
    names.push('fxa-auth','fxa-auth-linux-amd64','fxa-auth-linux-arm64');
  }
  const dirs=[resources,execDir,path.join(resources,'engine'),path.join(__dirname,'..','..','tools','fxa-auth'),path.join(__dirname,'..','..','tools','bin')];
  const out=[];
  for(const dir of dirs){
    for(const name of names){
      if(dir&&name)out.push(path.join(dir,name));
    }
  }
  // Development fallback on the workstation that built the helper.
  out.push('D:\\GitHub\\FoxVPN\\tools\\fxa-auth\\fxa-auth-windows-amd64.exe');
  out.push('D:\\GitHub\\FoxVPN\\tools\\bin\\fxa-auth.exe');
  return out;
}

function helperPath(){
  for(const p of helperCandidates()){
    try{if(p&&fs.existsSync(p))return p;}catch{}
  }
  return null;
}

/** Prefer the Firefox-TLS helper only in packaged desktop builds (or when forced). */
function useFirefoxTlsHelper(){
  if(process.env.FOX_USE_FXA_HELPER==='0')return false;
  if(process.env.FOX_USE_FXA_HELPER==='1')return !!helperPath();
  try{
    const {app}=require('electron');
    return !!(app&&app.isPackaged&&helperPath());
  }catch{
    return false;
  }
}

function runHelper(payload,timeoutMs=180000){
  return new Promise((resolve,reject)=>{
    const bin=helperPath();
    if(!bin)return reject(Object.assign(Error('Firefox-TLS auth helper is missing.'),{code:'FXA_HELPER_MISSING'}));
    const child=spawn(bin,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>{try{child.kill();}catch{} reject(Error('Firefox-TLS auth helper timed out.'));},timeoutMs);
    child.stdout.on('data',d=>stdout+=d);
    child.stderr.on('data',d=>stderr+=d);
    child.on('error',err=>{clearTimeout(timer);reject(err);});
    child.on('close',code=>{
      clearTimeout(timer);
      let data=null;
      try{data=JSON.parse((stdout||'').trim().split(/\r?\n/).filter(Boolean).pop()||'null');}catch{}
      if(!data){
        const err=Error(stderr.trim()||stdout.trim()||'Firefox-TLS auth helper returned no data.');
        err.code='FXA_HELPER_BAD_OUTPUT';err.exitCode=code;
        return reject(err);
      }
      if(!data.ok){
        const err=Error(data.error||'Firefox-TLS auth helper failed.');
        err.code=data.code;err.errno=data.errno;err.status=data.status;err.exitCode=code;
        return reject(err);
      }
      resolve(data);
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

module.exports={helperPath,runHelper,useFirefoxTlsHelper};
