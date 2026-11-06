// SPDX-License-Identifier: GPL-3.0-or-later
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {bindTrayActions}=require('../src/tray.cjs');
test('right-click toggles the tray menu, while left-click opens the app',()=>{
 for(const platform of ['win32','darwin','linux']){
  const tray=new EventEmitter();let opened=0,toggles=0,hidden=0,visible=false;
  bindTrayActions(tray,{async toggle(){visible=!visible;toggles++;},hide(){visible=false;hidden++;}},()=>opened++,()=>{},platform);
  tray.emit('right-click',{});assert.equal(toggles,1);assert.equal(visible,true);
  tray.emit('right-click',{});assert.equal(toggles,2);assert.equal(visible,false);
  tray.emit('right-click',{});assert.equal(toggles,3);assert.equal(visible,true);
  tray.emit('click',{button:2});assert.equal(opened,0);assert.equal(toggles,3);
  tray.emit('click',{button:0});assert.equal(opened,1);assert.equal(hidden,1);assert.equal(visible,false);
  if(platform==='darwin'){tray.emit('click',{ctrlKey:true});assert.equal(toggles,4);assert.equal(visible,true);}
 }
});
