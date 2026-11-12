// SPDX-License-Identifier: GPL-3.0-or-later
// Anonymous screenshot profile. Real account data is never accessed.
'use strict';
const {contextBridge}=require('electron');
const {DEFAULTS}=require('../src/lib/settings.cjs');
const state={
 version:'2.0.5',platform:'win32',settings:{...structuredClone(DEFAULTS),theme:'dark',
   proxyOnly:false,splitTunnelingEnabled:false},latencies:{},pinging:false,pingingIds:[],
 activeServer:null,signedIn:true,email:'Predator@example.invalid',
 accounts:[{id:'preview',email:'Predator@example.invalid',active:true,status:'ready',quota:null}],
 activeAccountId:'preview',accountPreferences:{autoSwitch:false},
 servers:[{id:'REC',code:'REC',country:'Recommended location',city:'',host:'localhost',port:443}],
 logs:[],connection:'disconnected',startedAt:null,sessionDuration:0,exit:null,
 quota:null,lastError:null,up:0,down:0,systemDark:true,busy:false
};
contextBridge.exposeInMainWorld('fox',{
  onState:()=>()=>{},
  call:async channel=>{
    if(channel==='state')return {ok:true,data:state};
    if(channel==='account')return {ok:true,data:{limited_bandwidth:false,maxBytes:null,quotaRemaining:null,uid:'demo'}};
    if(channel==='releaseNotes')return {ok:true,data:{seen:true,items:[]}};
    if(channel==='checkUpdates')return {ok:true,data:{available:false,currentVersion:'2.0.5',latestVersion:'2.0.5'}};
    if(channel==='apps')return {ok:true,data:[]};
    return {ok:true,data:state};
  }
});
