// SPDX-License-Identifier: GPL-3.0-or-later
// Short-lived proxy authorization is required by the remote service.
// A denial must not tear down an otherwise healthy system VPN or cause
// one credential-service request per new client stream.
const {knownEmpty,quotaFromPass}=require('./accounts.cjs');
class ProxyPassRecovery {
  constructor({getPass,applyPass,onExhausted,canApply,log,now=Date.now,random=Math.random}){
    Object.assign(this,{getPass,applyPass,onExhausted,canApply,log,now,random});
    this.pending=null;this.failures=0;this.retryAfter=0;this.notified=false;
  }
  async handle(error){
    if(![401,403,429].includes(Number(error?.status)))return false;
    if(knownEmpty(error?.quota)){await this.onExhausted(error);return false;}
    if(!this.canApply())return false;
    if(this.pending)return this.pending;
    // Both auth-service failures and successful rotations get a short holdoff:
    // a noisy edge must not trigger dozens of fresh-pass calls in parallel.
    if(this.now()<this.retryAfter)return false;
    const pending=(async()=>{
      try{
        const fresh=await this.getPass();
        if(knownEmpty(quotaFromPass(fresh))){
          await this.onExhausted(Object.assign(Error('Account allowance exhausted.'),{status:429,quota:quotaFromPass(fresh)}));
          return false;
        }
        if(!fresh||typeof fresh.token!=='string'||!fresh.token)throw Error('No new proxy credentials available');
        if(!this.canApply())return false;
        await this.applyPass(fresh);
        const recovered=this.failures>0;
        this.failures=0;this.notified=false;
        this.retryAfter=this.now()+8000;
        if(recovered)this.log('info','VPN session credentials restored after a temporary outage.');
        return true;
      }catch(e){
        if(knownEmpty(e?.quota)){await this.onExhausted(e);return false;}
        if(!this.canApply())return false;
        this.failures++;
        const backoff=Math.min(60000,5000*2**Math.min(this.failures-1,4));
        this.retryAfter=this.now()+Math.round(backoff*(.85+.3*this.random()));
        if(!this.notified){
          this.log('warn','Credential service temporarily unavailable. Keeping the VPN active and limiting retries.');
          this.notified=true;
        }
        return false;
      }
    })();
    this.pending=pending;
    try{return await pending;}finally{if(this.pending===pending)this.pending=null;}
  }
}
module.exports={ProxyPassRecovery};
