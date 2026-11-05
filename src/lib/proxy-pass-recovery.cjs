// SPDX-License-Identifier: GPL-3.0-or-later
// Isolate failed CONNECT authentication from a healthy system VPN.
const {knownEmpty,quotaFromPass}=require('./accounts.cjs');
class ProxyPassRecovery{
  constructor({getPass,applyPass,onExhausted,canApply,log}){
    Object.assign(this,{getPass,applyPass,onExhausted,canApply,log});
    this.pending=null;
  }
  async handle(error){
    if(![401,403,429].includes(Number(error?.status)))return false;
    if(knownEmpty(error.quota)){await this.onExhausted(error);return false;}
    if(this.pending)return this.pending;
    const pending=(async()=>{
      try{
        const fresh=await this.getPass();
        if(knownEmpty(quotaFromPass(fresh))){
          await this.onExhausted(Object.assign(Error('Account allowance exhausted.'),{status:429,quota:quotaFromPass(fresh)}));
          return false;
        }
        if(!this.canApply())return false;
        await this.applyPass(fresh);
        this.log('info','Proxy session credentials refreshed; retrying the interrupted request.');
        return true;
      }catch(e){
        // A temporary service denial or rate limit must not destroy the TUN.
        this.log('warn','Proxy authentication could not be refreshed. The VPN will retry on the next request.');
        return false;
      }
    })();
    this.pending=pending;
    try{return await pending;}finally{if(this.pending===pending)this.pending=null;}
  }
}
module.exports={ProxyPassRecovery};
