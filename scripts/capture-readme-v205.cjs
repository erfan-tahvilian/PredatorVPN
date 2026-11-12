// SPDX-License-Identifier: GPL-3.0-or-later
// Capture the real v2.0.5 desktop renderer with anonymous local demo data.
// The user's real login/profile is never loaded.
'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'docs/screenshots');
const scratch=path.join(root,'test-results/readme-screenshot-profile');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',scratch);
app.setPath('sessionData',scratch);
app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({width:1480,height:920,show:false,backgroundColor:'#111219',webPreferences:{preload:path.join(__dirname,'readme-preview-preload.cjs'),contextIsolation:true,sandbox:false,nodeIntegration:false}});
 const errors=[];
 w.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
 try{
  await w.loadFile(path.join(root,'src/ui/index.html'));
  // Keep the app's release number hidden in documentation screenshots,
  // including if the renderer updates its footer asynchronously.
  await w.webContents.insertCSS('[data-app-version]{display:none!important}');
  await pause(1300);
  for(const theme of ['light','dark']){
   const info=await w.webContents.executeJavaScript(`(()=>{
    if(typeof render!=='function'||!currentState)throw Error('Real renderer not initialized');
    const account={id:'readme-preview',email:'Predator@example.invalid',active:true,status:'ready',quota:null};
    const newSettings={...currentState.settings,theme:'${theme}',proxyOnly:false,
      serverId:'REC',splitTunnelingEnabled:false};
    const state={...currentState,version:'2.0.5',platform:'win32',signedIn:true,
      email:account.email,accounts:[account],activeAccountId:account.id,
      accountPreferences:{autoSwitch:false},settings:newSettings,
      connection:'disconnected',activeServer:null,
      servers:[{id:'REC',code:'REC',country:'Recommended location',city:'',host:'localhost',port:443}],
      latencies:{},pinging:false,pingingIds:[],logs:[],busy:false,
      quota:null,lastError:null,up:0,down:0,sessionDuration:0,startedAt:null,exit:null,systemDark:true};
    render(state);
    document.querySelectorAll('[data-app-version]').forEach(element=>{element.textContent='';});
    document.querySelector('[data-page=home]').click();
    return {version:state.version, account:document.getElementById('account-name').textContent,
      accountAvatar:document.querySelector('#account-shortcut .avatar').textContent,
      isDisconnected:document.getElementById('status-label').textContent.trim()==='Disconnected',
      isLight:document.body.classList.contains('light'),appTitle:document.title,
      overflow:document.documentElement.scrollWidth>innerWidth+3};
   })()`);
   assert.equal(info.account,'Predator');
   assert.equal(info.accountAvatar,'P');
   assert.equal(info.isDisconnected,true);
   assert.equal(info.overflow,false);
   assert.equal(info.isLight,theme==='light');
   await pause(350);
   const audit=await w.webContents.executeJavaScript(`(()=>{document.querySelectorAll('[data-app-version]').forEach(e=>e.textContent='');return {name:document.getElementById('account-name').textContent,footer:document.querySelector('[data-app-version]')?.textContent,theme:document.body.classList.contains('light')?'light':'dark',toastHidden:document.getElementById('toast').hidden};})()`);
   assert.deepEqual(audit,{name:'Predator',footer:'',theme,toastHidden:true});
   await w.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
   const file=path.join(output,'desktop-v205-overview-'+theme+'.png');
   fs.writeFileSync(file,(await w.webContents.capturePage()).toPNG());
   console.log(JSON.stringify({theme,file,...info}));
  }
  assert.deepEqual(errors,[],'Renderer emitted console errors');
  fs.writeFileSync(path.join(root,'.tools','readme-capture-complete.json'),JSON.stringify({capturedAt:new Date().toISOString(),themes:['dark','light'],account:'Predator',versionHidden:true}));
  w.destroy();app.exit(0);
 }catch(error){console.error(error.stack||error);w.destroy();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1)});
