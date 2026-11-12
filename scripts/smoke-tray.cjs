// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {TrayPopup}=require('../src/tray.cjs');
app.disableHardwareAcceleration();app.setPath('userData',path.resolve('test-results/tray-profile'));
app.whenReady().then(async()=>{
  let state={version:'2.0.0',connection:'disconnected',light:false,accent:'gold',signedIn:true,busy:false,location:''};
  const commands=[];
  const work=screen.getPrimaryDisplay().workArea;let anchor={x:work.x+100,y:work.y+work.height-20,width:20,height:20};
  const popup=new TrayPopup({state:()=>state,command:async action=>commands.push(action),bounds:()=>anchor});
  try{
    const firstOpening=popup.show(),secondOpening=popup.show();
    assert.strictEqual(firstOpening,secondOpening,'Fast right-click events must share the same opening');
    await firstOpening;
    await new Promise(r=>setTimeout(r,200));const rect=popup.window.getBounds();const visibleBottom=popup.window.getContentBounds().y+await popup.window.webContents.executeJavaScript("document.querySelector('main').getBoundingClientRect().bottom");assert(Math.abs(anchor.y-visibleBottom-9)<=3,'Visible tray menu must sit within a small gap of its anchor');
    assert(rect.height<272,'Tray should fit its visible menu without an empty lower area');
    const intermediate=[];popup.window.on('resize',()=>{if(popup.window.isVisible())intermediate.push(popup.window.getBounds());});
    const previousEpoch=popup.epoch;
    await popup.show();assert.equal(popup.epoch,previousEpoch,'Right-click on an open tray must not reopen or replay its animation');
    assert.equal(intermediate.length,0,'Repeated show must not resize or flicker the menu');
    const fadeOut=popup.toggle();
    await new Promise(r=>setTimeout(r,65));
    const midwayOut=popup.window.getOpacity();
    assert(midwayOut<.99&&midwayOut>.01,'Tray fade-out must contain intermediate opacity values');
    await fadeOut;
    assert.equal(popup.window.isVisible(),false,'Second native right-click must close menu with fade');
    assert(popup.window.getOpacity()<=.02,'After fade-out the tray opacity must approach zero');
    // Reopening can first await native window show and renderer sizing; a fixed
    // 65ms wall-clock sample may precede the fade entirely on a busy macOS VM.
    // Capture the actual opacity values the fade scheduler requests instead.
    const observedFadeIn=[];
    const setOpacity=popup.window.setOpacity.bind(popup.window);
    popup.window.setOpacity=value=>{observedFadeIn.push(value);return setOpacity(value);};
    try{
      await popup.toggle();
    }finally{popup.window.setOpacity=setOpacity;}
    assert(observedFadeIn.some(value=>value>.01&&value<.99),'Tray fade-in must contain intermediate opacity values');
    assert.equal(popup.window.isVisible(),true,'Third native right-click must reopen menu with fade');
    assert(popup.window.getOpacity()>=.99,'After fade-in the tray must reach full opacity');
    const interruptedClose=popup.toggle();
    await new Promise(r=>setTimeout(r,48));
    const interruptedOpen=popup.toggle();
    await Promise.all([interruptedClose,interruptedOpen]);
    assert.equal(popup.window.isVisible(),true,'A second click during fade-out must reverse smoothly without hiding afterward');
    assert(popup.window.getOpacity()>=.99,'Interrupted fade-out must finish fully opaque');
    await popup.hide('blur');
    await popup.toggle();assert.equal(popup.window.isVisible(),false,'Right-click after popup blur must not reopen the dismissed menu');
    popup.lastBlurAt-=1000;
    await popup.toggle();assert.equal(popup.window.isVisible(),true,'Later right-click must open normally after blur suppression expires');
    const js=code=>popup.window.webContents.executeJavaScript(code);
    assert.equal(await js(`document.getElementById('toggle-label').textContent`),'Connect');
    assert.equal(await js(`document.body.dataset.accent`),'gold');
    assert.equal(await js(`getComputedStyle(document.body).getPropertyValue('--accent').trim()`),'#f0ba43');
    assert.equal(await js(`typeof require`),'undefined');
    state={...state,connection:'connected',light:true,location:'Germany, Frankfurt'};popup.update();
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await js(`document.getElementById('toggle-label').textContent`),'Disconnect');
    assert(await js(`document.body.classList.contains('light')`));
    assert.equal(await js(`getComputedStyle(document.body).getPropertyValue('--accent').trim()`),'#996200');
    assert.equal(await js(`getComputedStyle(document.querySelector('button.primary')).color`),'rgb(153, 98, 0)');
    assert.equal(await js(`getComputedStyle(document.getElementById('status-dot')).backgroundColor`),'rgb(53, 189, 137)');
    assert.equal(await js(`document.getElementById('location').textContent`),'Germany, Frankfurt');
    fs.writeFileSync('test-results/tray-light.png',(await popup.window.webContents.capturePage()).toPNG());
    await assert.rejects(js(`window.trayUI.call('arbitrary-command')`),/Unsupported tray action/);
    const other=new BrowserWindow({show:false,webPreferences:{preload:path.resolve('src/tray-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true}});
    await other.loadURL('about:blank');
    await assert.rejects(other.webContents.executeJavaScript(`window.trayUI.call('state')`),/Invalid tray sender/);other.destroy();
    await js(`window.trayUI.call('toggle')`);assert.deepEqual(commands,['toggle']);
    state={...state,connection:'disconnected',light:false};await popup.show();
    fs.writeFileSync('test-results/tray-dark.png',(await popup.window.webContents.capturePage()).toPNG());
    fs.writeFileSync('test-results/tray-smoke-status.txt','PASS: real tray popup, connection labels, appearance, restricted IPC sender and command allowlist');
    popup.destroy();app.exit(0);
  }catch(error){fs.writeFileSync('test-results/tray-smoke-status.txt','FAIL: '+error.stack);popup.destroy();app.exit(1);}
});
