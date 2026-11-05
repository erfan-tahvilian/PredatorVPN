// SPDX-License-Identifier: GPL-3.0-or-later
// Keep a working VPN session during temporary pass-service outages.
const {knownEmpty,quotaFromPass}=require('./accounts.cjs');
const MAX_TIMER=2147483647;
function nextPassDelay(expiresAt,now){
  const remaining=Number(expiresAt)-now-120000;
  return Math.max(30000,Math.min(MAX_TIMER,Number.isFinite(remaining)?remaining:3600000));
}
class PassRenewer {
  constructor({getPass,applyPass,onRejected,log,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{getPass,applyPass,onRejected,log,now,setTimer,clearTimer});
    this.active=false;this.epoch=0;this.timer=null;this.failures=0;this.expiresAt=0;
  }
  stop(){
    this.active=false;this.epoch++;
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
  }
  start(pass){
    this.stop();this.active=true;this.failures=0;this.expiresAt=pass.expiresAt;
    this.schedule(nextPassDelay(this.expiresAt,this.now()));
  }
  schedule(delay){
    if(!this.active)return;
    const epoch=this.epoch;
    this.timer=this.setTimer(()=>{this.timer=null;void this.refresh(epoch);},delay);
    this.timer?.unref?.();
  }
  async reject(error){
    this.stop();
    await this.onRejected(error);
  }
  async refresh(epoch){
    if(!this.active||this.epoch!==epoch)return;
    try {
      const pass=await this.getPass();
      if(!this.active||this.epoch!==epoch)return;
      const quota=quotaFromPass(pass);
      if(knownEmpty(quota)){
        await this.reject(Object.assign(Error('Account allowance exhausted.'),{status:429,quota}));
        return;
      }
      await this.applyPass(pass);
      if(!this.active||this.epoch!==epoch)return;
      this.expiresAt=pass.expiresAt;this.failures=0;
      this.log('info','Proxy pass renewed');
      this.schedule(nextPassDelay(this.expiresAt,this.now()));
    } catch(error){
      if(!this.active||this.epoch!==epoch)return;
      if(knownEmpty(error.quota)){
        await this.reject(error);
        return;
      }
      // Auth-service 401/403 can occur while rotating tokens or after an
      // expired pass. A single response is not evidence of exhausted quota.
      // Keep the VPN adapter alive and retry with bounded backoff.
      this.failures++;
      const expired=this.now()>=this.expiresAt;
      if(this.failures===1||expired&&this.failures%5===0){
        this.log('warn',expired?'Proxy pass renewal unavailable after expiry. Retrying automatically.':'Proxy pass renewal temporarily unavailable. Retrying without disconnecting.');
      }
      this.schedule(Math.min(60000,5000*2**Math.min(this.failures-1,4)));
    }
  }
}
module.exports={PassRenewer,nextPassDelay};
