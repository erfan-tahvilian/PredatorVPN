// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Persist only strictly allowlisted, non-secret OAuth failure metadata.
// This file is separate from browser history and contains no account details.
const fs=require('node:fs');
const path=require('node:path');
const {diagnosticLine}=require('./fxa-response-diagnostic.cjs');
const FILE_NAME='oauth-response-diagnostics.jsonl';
const MAX_RECORDS=40;
function persistOAuthRejection(userDataDir,error,options={}){
 if(error?.status!==406||typeof userDataDir!=='string'||!userDataDir)return null;
 const stage=/^(?:oauth-token|oauth-authorization|oauth-code-exchange|oauth-flow)$/.test(error.loginStage)
   ?error.loginStage:'oauth-flow';
 const responses=error.responseDiagnostics;
 const diagnostics={};
 if(responses&&typeof responses==='object'){
  for(const type of ['direct','authorization']){
   const clean=diagnosticLine(responses[type]);
   if(clean)diagnostics[type]=clean;
  }
 }else if(error.diagnostic){
  const clean=diagnosticLine(error.diagnostic);
  if(clean)diagnostics.provider=clean;
 }
 const record=JSON.stringify({time:new Date().toISOString(),stage,status:406,diagnostics});
 const target=path.join(userDataDir,FILE_NAME);
 const fileSystem=options.fs||fs;
 fileSystem.mkdirSync(userDataDir,{recursive:true,mode:0o700});
 let previous='';
 try{previous=fileSystem.readFileSync(target,'utf8');}
 catch(e){if(e?.code!=='ENOENT')throw e;}
 const recent=previous.split('\n').filter(Boolean).slice(-(MAX_RECORDS-1));
 recent.push(record);
 fileSystem.writeFileSync(target,recent.join('\n')+'\n',{encoding:'utf8',mode:0o600});
 return target;
}
module.exports={persistOAuthRejection,FILE_NAME};
