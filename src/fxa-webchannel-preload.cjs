// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {ipcRenderer}=require('electron');
const ORIGIN='https://accounts.firefox.com';
let lastToken='';
function handle(event){
  if(location.origin!==ORIGIN)return;
  let payload=event.detail;
  if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{return;}}
  if(!payload||typeof payload!=='object'||typeof payload.id!=='string'||!payload.message)return;
  const command=payload.message.command;
  if(!['fxaccounts:fxa_status','fxaccounts:can_link_account','fxaccounts:login','fxaccounts:oauth_login'].includes(command))return;
  const allowed={id:payload.id,message:{command,messageId:payload.message.messageId}};
  if(command==='fxaccounts:login'||command==='fxaccounts:oauth_login'){
    const data=payload.message.data;
    if(!data||typeof data!=='object')return;
    const token=data.sessionToken??data.token;
    if(typeof token==='string'&&/^[0-9a-f]{64}$/i.test(token)){
      if(token===lastToken)return;
      lastToken=token;
      allowed.message.data={sessionToken:token,email:typeof data.email==='string'?data.email:''};
    }else if(command==='fxaccounts:oauth_login'){
      allowed.message.data={code:data.code,state:data.state,redirect:data.redirect};
    }else return;
  }
  ipcRenderer.send('predator:fxa-webchannel',allowed);
}
// capture=true: catch events before the page stops propagation
window.addEventListener('WebChannelMessageToChrome',handle,true);
document.addEventListener('WebChannelMessageToChrome',handle,true);
ipcRenderer.on('predator:fxa-webchannel-reply',(_event,reply)=>{
  if(location.origin!==ORIGIN||!reply||typeof reply.id!=='string')return;
  if(!['fxaccounts:fxa_status','fxaccounts:can_link_account'].includes(reply.message?.command))return;
  // FxA content server expects a JSON string in detail (Firefox/Android do the same)
  const detail=JSON.stringify(reply);
  window.dispatchEvent(new CustomEvent('WebChannelMessageToContent',{detail}));
  document.dispatchEvent(new CustomEvent('WebChannelMessageToContent',{detail}));
});