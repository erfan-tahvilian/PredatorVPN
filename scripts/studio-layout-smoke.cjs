// SPDX-License-Identifier: GPL-3.0-or-later
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DEFAULTS}=require('../src/lib/settings.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'studio-layout-profile'));
app.setPath('sessionData',path.join(out,'studio-layout-profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{}); // Keep Electron alive between desktop and Android geometry windows.
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function inspect(win,expression){return win.webContents.executeJavaScript(expression);}
async function desktop(){
 const errors=[],w=new BrowserWindow({width:1459,height:942,show:false,webPreferences:{preload:path.join(__dirname,'smoke-preload.cjs'),contextIsolation:true,sandbox:false,nodeIntegration:false}});
 w.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 try{
  await w.loadFile(path.join(root,'src/ui/index.html'));await wait(300);
  const hierarchy=await inspect(w,"(()=>{const h=document.querySelector('#home'),c=h.querySelector('.connection-card'),choice=h.querySelector('.server-selector'),dest=h.querySelector('.destination-grid'),ins=h.querySelector('.insights-grid');const d=[...dest.children].map(e=>e.getBoundingClientRect()),i=[...ins.children].map(e=>e.getBoundingClientRect());return {inside:!c.contains(choice),dest:dest.children.length,ins:ins.children.length,distance:d[1].left-d[0].right,insightGap:i[1].left-i[0].right,overflow:document.documentElement.scrollWidth>innerWidth+2}})()");
  assert(hierarchy.inside,'Server selector must live in a separate destination module');
  assert.equal(hierarchy.dest,2);assert.equal(hierarchy.ins,2);
  assert(hierarchy.distance>=11,'Desktop destination panels need distinct gutters');
  assert(hierarchy.insightGap>=11,'Desktop insight modules need distinct gutters');
  assert(!hierarchy.overflow,'Desktop must not overflow viewport horizontally');
  fs.writeFileSync(path.join(out,'studio-overview-dark.png'),(await w.webContents.capturePage()).toPNG());
  await inspect(w,"document.querySelector('[data-page=settings]').click()");
  await wait(150);
  const checks=await inspect(w,"(()=>{const s=document.querySelector('#settings'),layout=s.querySelector('.settings-layout'),nav=s.querySelector('.settings-section-nav'),cards=[...s.querySelectorAll('.settings-sections>.settings-card')],swatches=[...s.querySelectorAll('.accent-choice')],rs=swatches.map(e=>e.getBoundingClientRect()),box=swatches[0].parentElement.getBoundingClientRect(),toggle=s.querySelector('#proxyOnly'),rect=toggle.getBoundingClientRect();return {layout:getComputedStyle(layout).display,navWidth:nav.getBoundingClientRect().width,cards:cards.length,swatches:swatches.length,overflow:rs.some(r=>r.left<box.left-1||r.right>box.right+1),gap:rs[1].left-rs[0].right,switchWidth:rect.width,switchHeight:rect.height,navItems:nav.querySelectorAll('[data-settings-jump]').length}})()");
  assert.equal(checks.layout,'grid');assert(checks.navWidth>=130);assert(checks.cards>=6,'All live preference cards must remain available');
  assert.equal(checks.swatches,10);assert(!checks.overflow);assert(checks.gap>=9,'Accent cards must have visible gap');
  assert(checks.switchWidth>=46&&checks.switchHeight>=26,'Native switch geometry must remain stable');
  assert.equal(checks.navItems,6);
  fs.writeFileSync(path.join(out,'studio-settings-dark.png'),(await w.webContents.capturePage()).toPNG());
  await inspect(w,"document.querySelector('[data-accent=gold]').click()");
  await wait(75);
  const gold=await inspect(w,"(()=>{const b=document.body,s=document.querySelector('#connect'),sw=document.querySelector('#proxyOnly');return {accent:b.dataset.accent,power:getComputedStyle(s).borderTopColor,root:getComputedStyle(b).getPropertyValue('--accent').trim(),checked:getComputedStyle(sw).width}})()");
  assert.equal(gold.accent,'gold');assert(gold.root.startsWith('#'));assert(gold.power);
  await w.setSize(1024,820);await wait(125);
  const compact=await inspect(w,"(()=>{const b=document.querySelector('.settings-sections').getBoundingClientRect(),items=[...document.querySelectorAll('#settings .accent-choice')].map(e=>e.getBoundingClientRect());return {overflow:items.some(r=>r.right>b.right+2||r.left<b.left-2),gap:items[1].left-items[0].right,all:items.length}})()");
  assert(!compact.overflow,'Compact settings must keep all color tiles in bounds');
  assert(compact.gap>=8,'Compact settings accent gaps must remain visible');
  assert.deepEqual(errors,[],'Renderer must not emit console errors');
  console.log('PASS desktop studio layout: structural modules, gutters, settings navigation, palette, switches and 1024px responsive state');
 }finally{w.destroy();}
}
async function mobile(){
 const errors=[],w=new BrowserWindow({width:390,height:844,show:false,webPreferences:{preload:path.join(__dirname,'mobile-layout-preload.cjs'),contextIsolation:true,sandbox:false,nodeIntegration:false}});
 w.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
 try{
  await w.loadFile(path.join(root,'android/app/src/main/assets/src/ui/index.html'));await wait(200);
  const state={version:'2.0.0',platform:'android',latencies:{},pinging:false,pingingIds:[],activeServer:null,settings:structuredClone(DEFAULTS),signedIn:false,email:'',servers:[],logs:[],connection:'disconnected',startedAt:null,exit:null,quota:null,lastError:null,up:0,down:0,systemDark:true,busy:false};
  await inspect(w,'window.fox.receive('+JSON.stringify(state)+')');await wait(150);
  const result=await inspect(w,"(()=>{const home=document.querySelector('#home'),dest=home.querySelector('.destination-grid'),cards=[...dest.querySelectorAll('.destination-panel')],r=cards.map(e=>e.getBoundingClientRect()),nav=document.querySelector('.sidebar'),btn=document.getElementById('connect').getBoundingClientRect();return {dest:cards.length,grid:getComputedStyle(dest).display,stackGap:r[1].top-r[0].bottom,overflow:document.documentElement.scrollWidth-innerWidth,navBottom:Math.round(nav.getBoundingClientRect().bottom-innerHeight),powerSize:btn.width,quickTileSetting:!!document.querySelector('#quick-tile-setting')}})()");
  assert.equal(result.dest,2);assert.equal(result.grid,'flex');assert(result.stackGap>=8);
  assert(result.overflow<=2,'Mobile document may not overflow horizontally');
  assert(Math.abs(result.navBottom)<3,'Mobile navigation stays docked');
  assert(result.powerSize>=85,'Mobile connect tap target is usable');
  assert(!result.quickTileSetting);
  fs.writeFileSync(path.join(out,'studio-mobile-overview.png'),(await w.webContents.capturePage()).toPNG());
  await inspect(w,"document.querySelector('[data-page=settings]').click()");await wait(80);
  const settings=await inspect(w,"(()=>{const nav=document.querySelector('#settings .settings-section-nav'),section=document.querySelector('#settings .settings-sections'),tiles=[...document.querySelectorAll('#settings .accent-choice')].map(e=>e.getBoundingClientRect()),r=section.getBoundingClientRect(),sw=document.querySelector('#proxyOnly').getBoundingClientRect();return {hidden:getComputedStyle(nav).display==='none',cards:section.querySelectorAll('.settings-card').length,overflow:tiles.some(t=>t.left<r.left-2||t.right>r.right+2),gap:tiles[1].left-tiles[0].right,switchW:sw.width}})()");
  assert(settings.hidden);assert(settings.cards>=6);assert(!settings.overflow);assert(settings.gap>=6);assert(settings.switchW>=46);
  fs.writeFileSync(path.join(out,'studio-mobile-settings.png'),(await w.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[],'Mobile renderer must not emit errors');
  console.log('PASS mobile-first layout: bottom navigation, destination stack, no overflow, responsive palette, toggle geometry');
 }finally{w.destroy();}
}
app.whenReady().then(async()=>{
 try{await mobile();await desktop();fs.writeFileSync(path.join(out,'studio-layout-status.txt'),'PASS: desktop/mobile structural visual checks');app.exit(0);}
 catch(e){console.error(e);fs.writeFileSync(path.join(out,'studio-layout-status.txt'),'FAIL: '+e.stack);app.exit(1);}
});
