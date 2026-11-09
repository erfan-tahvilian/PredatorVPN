// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {target,machine,engineRoot}=require('./windows-target.cjs');
const t=target();
const electron=path.resolve('.tools/electron',t.arch);
for(const file of [path.join(electron,'electron.exe'),path.join(engineRoot(),'sing-box.exe'),path.join(engineRoot(),'wintun.dll')]){
  if(machine(file)!==t.machine)throw Error('Incorrect architecture: '+file);
}
const goArch={x64:'amd64',ia32:'386',arm64:'arm64'}[t.arch];
const helper=path.resolve('tools/fxa-auth',`fxa-auth-windows-${goArch}.exe`);
if(!fs.existsSync(helper))throw Error('Missing Firefox-TLS auth helper: '+helper);
const base=require('../package.json').build;
const config=path.resolve('.tools',`build-${t.arch}.json`);
fs.mkdirSync(path.dirname(config),{recursive:true});
fs.writeFileSync(config,JSON.stringify({
  ...base,
  afterPack:'scripts/capture-windows-payload.cjs',
  electronVersion:t.electron,
  electronDist:electron,
  artifactName:`PredatorVPN-\${version}-Windows-${t.label}.\${ext}`,
  extraResources:[
    ...(base.extraResources||[]),
    {from:helper,to:'fxa-auth.exe'},
  ],
},null,2));
// electron-builder needs literal ${version} / ${ext} in artifactName
fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace('\\${version}','${version}').replace('\\${ext}','${ext}'));
delete process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--win','nsis','zip','--'+t.arch,'--config',config,'--publish','never'],{stdio:'inherit'});
