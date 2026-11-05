// SPDX-License-Identifier: GPL-3.0-or-later
// Keep a working VPN session during temporary pass-service outages.
const {knownEmpty,quotaFromPass}=require('./accounts.cjs');
const MAX_TIMER=2147483647;
function nextPassDelay(expiresAt,now){
  const ttl=Number(expiresAt)-now;
  if(!Number.isFinite(ttl))return 3600000;
  if(ttl<=0)return 1000;
  const margin=Math.min(120000,Math.max(5000,ttl*.2));
  return Math.max(1000,Math.min(MAX_TIMER,ttl-margin));
}
class PassRenewer {
  constructor({getPass,applyPass,onRejected,log,now=Date.now,random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{getPass,applyPass,onRejected,log,now,random,setTimer,clearTimer});
    this.active=false;this.epoch=0;this.timer=null;this.failures=0;this.expiresAt=0;
    this.pending=null;this.pendingEpoch=null;
  }
  stop(){
    this.active=false;this.epoch++;
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    // An in-flight request may still finish, but it must not change this
    // session's credentials or timers after a stop / account switch.
    this.pending=null;this.pendingEpoch=null;
  }
  start(pass){
    this.stop();this.active=true;this.failures=0;this.expiresAt=pass.expiresAt;
    this.schedule(nextPassDelay(this.expiresAt,this.now()));
  }
  schedule(delay){
    if(!this.active)return;
    // A manual or reactive refresh can race the scheduled refresh. Never
    // leave more than one timer scheduled for the same session.
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    const epoch=this.epoch;
    const timer=this.timer=this.setTimer(()=>{
      if(this.timer===timer)this.timer=null;
      void this.refresh(epoch).catch(()=>{
        // Never crash the process from an unobserved asynchronous timer.
        if(this.active&&this.epoch===epoch)this.log('warn','Credential renewal requires attention; connection recovery is being monitored.');
      });
    },delay);
    timer?.unref?.();
  }
  async reject(error){
    this.stop();
    await this.onRejected(error);
  }
  refresh(epoch){
    if(!this.active||this.epoch!==epoch)return Promise.resolve();
    if(this.pending&&this.pendingEpoch===epoch)return this.pending;
    // Clear the scheduled timer when starting a manual refresh. The new
    // result (or retry) will schedule exactly one successor timer.
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    const pending=(async()=>{
      try {
        const pass=await this.getPass();
        if(!this.active||this.epoch!==epoch)return;
        const quota=quotaFromPass(pass);
        if(knownEmpty(quota)){
          await this.reject(Object.assign(Error('Account allowance exhausted.'),{status:429,quota}));
          return;
        }
        if(typeof pass?.token!=='string'||!pass.token)throw Error('No new proxy credentials available');
        await this.applyPass(pass);
        if(!this.active||this.epoch!==epoch)return;
        const recovered=this.failures>0;
        this.expiresAt=pass.expiresAt;this.failures=0;
        if(recovered)this.log('info','VPN credentials restored after a temporary outage.');
        this.schedule(nextPassDelay(this.expiresAt,this.now()));
      } catch(error){
        if(!this.active||this.epoch!==epoch)return;
        if(knownEmpty(error?.quota)){
          await this.reject(error);
          return;
        }
        // A temporary 401/403 during OAuth or pass rotation is not verified
        // exhaustion. Keep the existing VPN session and retry with backoff.
        this.failures++;
        if(this.failures===1)this.log('warn','Credential renewal is temporarily unavailable. Keeping the VPN active while retrying.');
        const backoff=Math.min(60000,5000*2**Math.min(this.failures-1,4));
        this.schedule(Math.round(backoff*(.85+.3*this.random())));
      }
    })();
    this.pending=pending;this.pendingEpoch=epoch;
    void pending.finally(()=>{
      if(this.pending===pending){this.pending=null;this.pendingEpoch=null;}
    }).catch(()=>{}); // The caller owns the returned promise's error.
    return pending;
  }
}
module.exports={PassRenewer,nextPassDelay};
