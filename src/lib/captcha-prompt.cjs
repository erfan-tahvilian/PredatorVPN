// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
// One transient in-app CAPTCHA prompt. Provider challenge images never go to disk.
const VALID_IMAGE=/^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=\s]+$/;
class CaptchaPrompt {
 constructor(onChange=()=>{},{timeoutMs=240000}={}){this.onChange=onChange;this.timeoutMs=timeoutMs;this.pending=null;}
 get image(){return this.pending?.image||null;}
 ask(image){
  if(typeof image!=='string'||image.length>600000||!VALID_IMAGE.test(image))throw Error('The provider returned an unsupported CAPTCHA image.');
  if(this.pending)throw Error('Another CAPTCHA verification is already open.');
  return new Promise((resolve,reject)=>{
   const current={image,resolve,reject,timer:null};
   current.timer=setTimeout(()=>{
    if(this.pending===current){this.pending=null;this.onChange();reject(Error('CAPTCHA verification timed out. Retry sign-in.'));}
   },this.timeoutMs);
   current.timer.unref?.();
   this.pending=current;this.onChange();
  });
 }
 submit(value){
  const text=String(value||'').trim();
  if(!this.pending)throw Error('There is no active CAPTCHA to answer.');
  if(!text||text.length>80)throw Error('Enter the characters shown in the CAPTCHA image.');
  const current=this.pending;this.pending=null;clearTimeout(current.timer);this.onChange();current.resolve(text);
  return true;
 }
 cancel(){
  if(!this.pending)return false;
  const current=this.pending;this.pending=null;clearTimeout(current.timer);this.onChange();
  current.reject(Error('CAPTCHA verification cancelled.'));
  return true;
 }
}
module.exports={CaptchaPrompt};
