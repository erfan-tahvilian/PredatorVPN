// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {target,machine,engineRoot}=require('./mac-target.cjs');
const t=target();
if(machine(path.join(engineRoot(),'sing-box'))!==t.cpu)throw Error('Engine architecture mismatch');
const goArch={x64:'amd64',arm64:'arm64'}[t.arch];
const helper=path.resolve('tools/fxa-auth',`fxa-auth-darwin-${goArch}`);
if(!fs.existsSync(helper))throw Error('Missing Firefox-TLS auth helper: '+helper);
const base=require('../package.json').build;
const config={
  ...base,
  electronDist:'node_modules/electron/dist',
  artifactName:`PredatorVPN-\${version}-macOS-${t.arch}.\${ext}`,
  extraResources:[
    {from:`engine/darwin/${t.arch}`,to:'engine',filter:['sing-box','fox-h3','LICENSE*','*.txt']},
    {from:helper,to:'fxa-auth'},
  ],
  mac:{target:['dmg','zip'],category:'public.app-category.utilities',icon:'assets/logo-light.png',minimumSystemVersion:'13.0.0',identity:'-',signIgnore:['/engine/(sing-box|fox-h3)$','/fxa-auth$'],hardenedRuntime:false,notarize:false},
  dmg:{format:'UDBZ',sign:false,title:'Predator VPN',contents:[{x:140,y:180},{x:420,y:180,type:'link',path:'/Applications'}]},
};
fs.mkdirSync('.tools',{recursive:true});const file=path.resolve('.tools/build-mac.json');
let text=JSON.stringify(config,null,2).replaceAll('\\${version}','${version}').replaceAll('\\${ext}','${ext}');
fs.writeFileSync(file,text);
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--mac','dmg','zip','--'+t.arch,'--config',file,'--publish','never'],{stdio:'inherit'});
