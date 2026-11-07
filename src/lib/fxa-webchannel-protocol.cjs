// SPDX-License-Identifier: GPL-3.0-or-later
// Validate account-provider WebChannel events before any OAuth exchange.
// This module does not impersonate a browser or bypass provider authorization.
'use strict';
const ORIGIN='https://accounts.firefox.com';
const OAUTH_CODE=/^[A-Za-z0-9._~+\/-]{8,2048}$/;
const SESSION_TOKEN=/^[0-9a-f]{64}$/i;
function readMessage(origin,value){
 if(origin!==ORIGIN)return null;
 let data=value;
 if(typeof data==='string'){try{data=JSON.parse(data);}catch{return null;}}
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const id=data.id,message=data.message;
 if(typeof id!=='string'||!id||id.length>256||!message||typeof message!=='object')return null;
 if(typeof message.command!=='string'||message.command.length>100)return null;
 return {id,message};
}
function parseWebChannel(origin,value,expectedState){
 const raw=readMessage(origin,value);
 if(!raw)return null;
 const {id,message}=raw;
 const command=message.command;
 if(command==='fxaccounts:fxa_status'||command==='fxaccounts:can_link_account')
  return {kind:'query',id,messageId:message.messageId,command};
 if(command==='fxaccounts:oauth_login'){
  const data=message.data;
  if(!data||typeof data!=='object'||typeof expectedState!=='string'||expectedState.length<16)return null;
  if(data.state!==expectedState||typeof data.code!=='string'||!OAUTH_CODE.test(data.code))return null;
  if(data.redirect!==undefined&&data.redirect!=='urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel')return null;
  return {kind:'oauth-code',code:data.code,state:data.state};
 }
 if(command==='fxaccounts:login'){
  const data=message.data,token=data?.sessionToken??data?.token;
  if(typeof token!=='string'||!SESSION_TOKEN.test(token))return null;
  const email=typeof data?.email==='string'?data.email.trim():'';
  if(email.length>320||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return null;
  return {kind:'legacy-session',sessionToken:token.toLowerCase(),email};
 }
 return null;
}
module.exports={ORIGIN,parseWebChannel};
