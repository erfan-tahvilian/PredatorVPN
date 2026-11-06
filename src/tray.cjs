// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const {BrowserWindow,ipcMain,screen}=require('electron');
const path=require('node:path');
const FADE_MS=190, BLUR_DEBOUNCE_MS=110;
function bindTrayActions(tray,popup,open,onError,platform=process.platform){
  const menu=()=>Promise.resolve(popup.toggle()).catch(onError);
  const show=()=>{void popup.hide();open();};
  tray.on('right-click',menu);
  tray.on('click',event=>{
    if(platform==='darwin'&&event?.ctrlKey){menu();return;}
    if(event?.button!==undefined&&event.button!==0)return;
    show();
  });
  tray.on('double-click',show);
}
class TrayPopup{
  constructor({state,command,bounds}){
    this.state=state;this.command=command;this.bounds=bounds;
    this.epoch=0;this.targetVisible=false;this.phase='closed';this.fade=null;
    this.opening=null;this.closing=null;this.blurTimer=null;this.lastBlurAt=0;this.lastHideReason='';
    ipcMain.handle('fox:tray',async(event,action)=>{
      if(!this.window||event.sender!==this.window.webContents||event.senderFrame!==this.window.webContents.mainFrame)throw Error('Invalid tray sender');
      if(action==='state')return this.state();
      if(!['open','toggle','quit','dismiss'].includes(action))throw Error('Unsupported tray action');
      await this.hide();
      if(action!=='dismiss')await this.command(action);
    });
  }
  clearBlur(){if(this.blurTimer){clearTimeout(this.blurTimer);this.blurTimer=null;}}
  stopFade(){
    if(!this.fade)return;
    const current=this.fade;this.fade=null;clearInterval(current.timer);current.resolve();
  }
  opacity(to){
    const w=this.window;
    if(!w||w.isDestroyed())return Promise.resolve();
    this.stopFade();
    if(typeof w.setOpacity!=='function'||typeof w.getOpacity!=='function')return Promise.resolve();
    const from=Math.max(0,Math.min(1,w.getOpacity()));
    if(Math.abs(from-to)<.005){w.setOpacity(to);return Promise.resolve();}
    return new Promise(resolve=>{
      const started=Date.now(),fade={timer:null,resolve};
      const step=()=>{
        if(this.fade!==fade||!this.window||this.window.isDestroyed())return;
        const ratio=Math.min(1,(Date.now()-started)/FADE_MS);
        const eased=ratio*ratio*(3-2*ratio);
        try{this.window.setOpacity(from+(to-from)*eased);}catch{
          clearInterval(fade.timer);this.fade=null;resolve();return;
        }
        if(ratio>=1){clearInterval(fade.timer);this.fade=null;resolve();}
      };
      this.fade=fade;fade.timer=setInterval(step,16);step();
    });
  }
  toggle(){
    // The target state, not isVisible(), handles clicks during fade transitions.
    if(this.targetVisible)return this.hide('toggle');
    // A blur can precede the Windows tray click event by a few milliseconds.
    if(this.lastHideReason==='blur'&&Date.now()-this.lastBlurAt<300)return Promise.resolve();
    return this.show();
  }
  show(){
    if(this.targetVisible)return this.opening||Promise.resolve();
    this.targetVisible=true;this.lastHideReason='';this.clearBlur();
    const epoch=++this.epoch;
    const pending=this.showOnce(epoch);
    const tracked=pending.finally(()=>{if(this.opening===tracked)this.opening=null;});
    this.opening=tracked;return tracked;
  }
  async showOnce(epoch){
    if(!this.window||this.window.isDestroyed()){
      this.window=new BrowserWindow({
        width:306,height:244,show:false,frame:false,transparent:true,
        resizable:false,movable:false,alwaysOnTop:true,skipTaskbar:true,
        hasShadow:true,roundedCorners:true,
        webPreferences:{preload:path.join(__dirname,'tray-preload.cjs'),
          sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}
      });
      this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      this.window.webContents.on('will-navigate',event=>event.preventDefault());
      this.window.on('focus',()=>this.clearBlur());
      this.window.on('blur',()=>{
        this.clearBlur();
        const elapsed=Date.now()-(this.visibleSince||0);
        this.blurTimer=setTimeout(()=>{
          this.blurTimer=null;
          if(!this.targetVisible||!this.window||this.window.isDestroyed()||!this.window.isVisible())return;
          if(!this.window.isFocused())void this.hide('blur');
        },Math.max(BLUR_DEBOUNCE_MS,260-elapsed));
      });
      this.ready=this.window.loadFile(path.join(__dirname,'ui/tray.html'));
    }
    await this.ready;
    if(!this.targetVisible||epoch!==this.epoch||this.window.isDestroyed())return;
    // Size and position once, before the native transparent window is visible.
    // Never measure a CSS-transformed element or resize a visible popup.
    if(!this.window.isVisible()){
      const height=await this.window.webContents.executeJavaScript(
        'render('+JSON.stringify(this.state())+');Math.ceil(document.querySelector("main").offsetTop+document.querySelector("main").offsetHeight+5)'
      );
      if(!this.targetVisible||epoch!==this.epoch||this.window.isDestroyed())return;
      const anchor=this.bounds();
      const point={x:Math.round(anchor.x+anchor.width/2),y:Math.round(anchor.y+anchor.height/2)};
      const work=screen.getDisplayNearestPoint(point).workArea;
      const x=Math.max(work.x,Math.min(work.x+work.width-306,point.x-153));
      const proposed=point.y>work.y+work.height/2?anchor.y-height-4:anchor.y+anchor.height+4;
      const y=Math.max(work.y,Math.min(work.y+work.height-height,proposed));
      this.window.setBounds({x:Math.round(x),y:Math.round(y),width:306,height},false);
      this.window.setOpacity(0);
      this.window.show();
      this.window.focus();
    }
    this.phase='opening';this.visibleSince=Date.now();
    await this.opacity(1);
    if(this.targetVisible&&epoch===this.epoch)this.phase='open';
  }
  update(){
    if(this.window&&!this.window.isDestroyed())this.window.webContents.send('fox:tray-state',this.state());
  }
  hide(reason='manual'){
    this.clearBlur();
    if(reason==='blur'){this.lastBlurAt=Date.now();this.lastHideReason='blur';}
    else this.lastHideReason=reason;
    if(!this.targetVisible&&this.phase==='closing')return this.closing||Promise.resolve();
    this.targetVisible=false;
    const epoch=++this.epoch;
    if(!this.window||this.window.isDestroyed()||!this.window.isVisible()){
      this.stopFade();this.phase='closed';return Promise.resolve();
    }
    this.phase='closing';
    const pending=this.opacity(0).then(()=>{
      if(epoch===this.epoch&&!this.targetVisible&&this.window&&!this.window.isDestroyed()){
        this.window.hide();this.phase='closed';
      }
    });
    const tracked=pending.finally(()=>{if(this.closing===tracked)this.closing=null;});
    this.closing=tracked;return tracked;
  }
  destroy(){
    this.clearBlur();this.epoch++;this.targetVisible=false;this.stopFade();
    ipcMain.removeHandler('fox:tray');
    if(this.window&&!this.window.isDestroyed())this.window.destroy();
    this.window=null;this.phase='closed';
  }
}
module.exports={TrayPopup,bindTrayActions};
