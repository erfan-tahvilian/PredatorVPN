// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {target,machine,engineRoot}=require('./linux-target.cjs');const t=target();
if(process.platform!=='linux'||process.arch!==t.arch)throw Error('Build on a matching native Linux host');
for(const file of ['sing-box','fox-h3'])if(machine(path.join(engineRoot(),file))!==t.cpu)throw Error('Linux engine architecture mismatch');
const goArch={x64:'amd64',arm64:'arm64'}[t.arch];
const helper=path.resolve('tools/fxa-auth',`fxa-auth-linux-${goArch}`);
if(!fs.existsSync(helper))throw Error('Missing Firefox-TLS auth helper: '+helper);
const base=require('../package.json').build;
const config={
  ...base,
  artifactName:`PredatorVPN-\${version}-Linux-${t.arch}.\${ext}`,
  electronDist:'node_modules/electron/dist',
  // Static 20251108 runtime eliminates host libfuse2 for AppImage execution.
  toolsets:{...base.toolsets,appimage:'1.0.3'},
  extraResources:[
    {from:`engine/linux/${t.arch}`,to:'engine',filter:['sing-box','fox-h3','LICENSE*','*.txt']},
    {from:helper,to:'fxa-auth'},
  ],
  linux:{maintainer:'Erfan Tahvilian <erfan-tahvilian@users.noreply.github.com>',target:['AppImage','deb','rpm'],category:'Network',executableName:'predator-vpn',icon:'assets/logo-light.png',desktop:{entry:{Name:'Predator VPN',Comment:'Independent cross-platform VPN client',Categories:'Network;Security;'}}},
  afterPack:'scripts/capture-linux-payload.cjs',
  // AppImageHub's compatibility runtime cannot mount xz-compressed SquashFS.
  // Standard AppImage architecture names differ from deb/rpm asset names.
  appImage:{compression:'gzip',artifactName:'PredatorVPN-${version}-'+(t.arch==='x64'?'x86_64':'aarch64')+'.AppImage'},
  deb:{depends:['libgtk-3-0','libnotify4','libnss3','libxss1','libxtst6','xdg-utils','libatspi2.0-0','libuuid1','libsecret-1-0','pkexec | policykit-1']},
  rpm:{depends:['gtk3','libnotify','nss','libXScrnSaver','libXtst','xdg-utils','at-spi2-core','libuuid','libsecret','polkit']},
};
fs.mkdirSync('.tools',{recursive:true});const file=path.resolve('.tools/build-linux.json');
let text=JSON.stringify(config,null,2).replaceAll('\\${version}','${version}').replaceAll('\\${ext}','${ext}');
fs.writeFileSync(file,text);
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL='9';
execFileSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--linux','AppImage','deb','rpm','--'+t.arch,'--config',file,'--publish','never'],{stdio:'inherit'});
