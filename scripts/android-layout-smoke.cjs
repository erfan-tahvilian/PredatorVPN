// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic layout geometry checks for Android WebView. No credentials/network.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DEFAULTS}=require('../src/lib/settings.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'android-layout-smoke-profile'));
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:390,height:844,show:false,webPreferences:{
  preload:path.join(__dirname,'mobile-layout-preload.cjs'),contextIsolation:true,sandbox:false,nodeIntegration:false}});
 const errors=[];
 win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 const evaluate=(fn,...args)=>win.webContents.executeJavaScript('('+fn.toString()+')('+args.map(JSON.stringify).join(',')+')');
 try{
  await win.loadFile(path.join(root,'android/app/src/main/assets/src/ui/index.html'));
  await delay(100);
  const state={version:'2.0.0',platform:'android',latencies:{},pinging:false,pingingIds:[],
   activeServer:null,settings:structuredClone(DEFAULTS),signedIn:false,email:'',
   servers:[],logs:[],connection:'disconnected',startedAt:null,exit:null,quota:null,
   lastError:null,up:0,down:0,systemDark:true,busy:false};
  await win.webContents.executeJavaScript('window.fox.receive('+JSON.stringify(state)+')');
  await delay(120);
  for(const width of [320,360,390,430,768]){
   await win.setSize(width,844);await delay(100);
   const result=await evaluate(()=>{
    const home=document.querySelector('#home');
    const hero=home.querySelector('.connection-card').getBoundingClientRect();
    const selected=home.querySelector('.selected-panel').getBoundingClientRect();
    const details=home.querySelector('.network-card').getBoundingClientRect();
    const recommended=home.querySelector('.recommended-panel').getBoundingClientRect();
    const metrics=document.getElementById('traffic-metrics');
    const themeButton=document.getElementById('theme-toggle').getBoundingClientRect();
    const themeIcon=document.querySelector('#theme-toggle svg').getBoundingClientRect();
    const nav=document.querySelector('.sidebar').getBoundingClientRect();
    const offsets=[...document.querySelectorAll('.sidebar .nav-item')].map(item=>{
     const b=item.getBoundingClientRect(),i=item.querySelector('svg').getBoundingClientRect();
     return Math.abs(b.left+b.width/2-i.left-i.width/2);
    });
    const shield=document.querySelector('#connection-health .health-emblem svg').getBoundingClientRect();
    const emblem=document.querySelector('#connection-health .health-emblem').getBoundingClientRect();
    const recArrow=getComputedStyle(document.querySelector('#locations .recommended>span'),'::after').content;
    return {
     width:innerWidth,selectedGap:selected.top-hero.bottom,
     detailGap:details.top-selected.bottom,recGap:recommended.top-details.bottom,
     locLayout:getComputedStyle(home.querySelector('.destination-grid')).display,
     overflow:document.documentElement.scrollWidth-innerWidth,
     themeDX:Math.abs(themeButton.left+themeButton.width/2-themeIcon.left-themeIcon.width/2),
     themeDY:Math.abs(themeButton.top+themeButton.height/2-themeIcon.top-themeIcon.height/2),
     navIconsDX:Math.max(...offsets),navBottom:nav.bottom-innerHeight,
     shieldDX:Math.abs(shield.left+shield.width/2-emblem.left-emblem.width/2),
     shieldDY:Math.abs(shield.top+shield.height/2-emblem.top-emblem.height/2),
     statusDisplay:getComputedStyle(document.getElementById('connection-health')).display,
     columns:getComputedStyle(metrics).gridTemplateColumns.trim().split(/\s+/).length,recArrow
    };
   });
   assert.equal(result.locLayout,'contents',JSON.stringify(result));
   assert(result.selectedGap>=8&&result.selectedGap<=28,'Selected location must immediately follow hero: '+JSON.stringify(result));
   assert(result.detailGap>=8,'Connection details must follow location: '+JSON.stringify(result));
   assert(result.recGap>=8,'Recommended location must follow details: '+JSON.stringify(result));
   assert(result.overflow<=2,'No horizontal overflow: '+JSON.stringify(result));
   assert(Math.abs(result.navBottom)<3,'Bottom navigation must stay fixed: '+JSON.stringify(result));
   assert(result.themeDX<=1&&result.themeDY<=1,'Theme icon must be centered: '+JSON.stringify(result));
   assert(result.navIconsDX<=1,'Navigation icons must be centered: '+JSON.stringify(result));
   assert(result.shieldDX<=1&&result.shieldDY<=1,'Connection shield must be centered: '+JSON.stringify(result));
   assert.equal(result.statusDisplay,'grid','Connection status must use horizontal grid');
   assert.equal(result.columns,2,'Metrics must use two columns');
   assert(['normal','none'].includes(result.recArrow),'Automatic arrow must not be doubled');
   if(width===390||width===320)fs.writeFileSync(path.join(out,'android-v2-overview-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   console.log('PASS Android '+width+'px: correct card order, centered icons, balanced metrics, no overflow');
  }
  await win.setSize(390,844);await delay(100);
  for(const theme of ['dark','light'])for(const accent of ['orange','gold','blue','teal','emerald','red','purple','pink','indigo','cyan']){
   const offsets=await evaluate((theme,accent)=>{
    document.body.classList.toggle('light',theme==='light');document.body.dataset.accent=accent;
    const b=document.getElementById('theme-toggle').getBoundingClientRect(),i=document.querySelector('#theme-toggle svg').getBoundingClientRect();
    return [Math.abs(b.left+b.width/2-i.left-i.width/2),Math.abs(b.top+b.height/2-i.top-i.height/2)];
   },theme,accent);
   assert(offsets.every(o=>o<=1),'Theme icon center must be independent of theme and accent: '+theme+'/'+accent);
  }
  await evaluate(()=>{
   document.body.classList.remove('light');document.body.dataset.accent='orange';
   document.getElementById('connection-health').dataset.status='connected';
   document.getElementById('recent-activity-list').innerHTML='<div class="recent-row"><time>18:02</time><span class="recent-severity info">INFO</span><span>Connected to a synthetic test endpoint</span></div>';
  });
  await delay(100);
  fs.writeFileSync(path.join(out,'android-v2-connected-390.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('[data-page=locations]').click()");
  await delay(100);
  const after=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#locations .recommended>span'),'::after').content");
  assert(['none','normal'].includes(after),'Location arrow must not duplicate');
  fs.writeFileSync(path.join(out,'android-v2-locations-390.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[],'No unexpected renderer errors');
  const message='PASS: Android v2.0.0 card order, icon centering, statuses and responsive layouts';
  fs.writeFileSync(path.join(out,'android-layout-status.txt'),message);
  console.log(message);
 }finally{win.destroy();app.exit(0);}
}).catch(err=>{console.error(err);fs.writeFileSync(path.join(out,'android-layout-status.txt'),'FAIL: '+err.stack);app.exit(1);});
