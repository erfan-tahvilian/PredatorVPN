// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const {Auth}=require('./auth.cjs');
const {readAuthorizedProfile}=require('./provider-browser-auth.cjs');
const HEX=/^[0-9a-f]{64}$/i;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function followNativeBrowserSession({
  sessionToken,email='',http,fetcher,checkVpn,saveAccount,
  active=()=>true,delay=sleep,maxChecks=280
}){
  if(typeof sessionToken!=='string'||!HEX.test(sessionToken))
    throw Error('The provider returned an invalid sign-in session.');
  if(email&&(!EMAIL.test(email)||email.length>320))throw Error('The provider returned an invalid account email.');
  const temporary={auth:null,setAuth(next){this.auth=next;}};
  const auth=new Auth(http,temporary);
  const pending={session:sessionToken,email,method:'email',verified:false,expiresAt:Date.now()+15*60*1000};
  auth.pending=pending;
  try{
    for(let i=0;i<maxChecks;i++){
      if(!active()||auth.pending!==pending)throw Error('The browser sign-in was cancelled.');
      if(Date.now()>=pending.expiresAt)throw Error('The provider sign-in expired.');
      const verified=await auth.sessionVerified(sessionToken);
      if(!active()||auth.pending!==pending)throw Error('The browser sign-in was cancelled.');
      if(verified){pending.verified=true;break;}
      if(i===maxChecks-1)throw Error('The provider did not confirm the browser session.');
      await delay(3000);
    }
    // The temporary sink is memory-only until the VPN entitlement is confirmed.
    await auth.complete();
    const credentials=temporary.auth;
    if(!active())throw Error('The browser sign-in was cancelled.');
    if(!credentials?.access_token||!credentials?.refresh_token)
      throw Error('The account provider did not issue reusable OAuth credentials.');
    const verifiedEmail=await readAuthorizedProfile(fetcher,credentials.access_token);
    if(!active())throw Error('The browser sign-in was cancelled.');
    if(email&&verifiedEmail.toLowerCase()!==email.toLowerCase())
      throw Error('The account provider returned a different account identity.');
    await checkVpn(credentials.access_token);
    if(!active())throw Error('The browser sign-in was cancelled.');
    return saveAccount({
      ...credentials,email:verifiedEmail,provider:'mozilla-native-webchannel',
      expiresAt:credentials.expiresAt||Date.now()+3600*1000
    });
  }finally{
    // Clear temporary credentials even on failure; never put raw sessions in logs.
    temporary.auth=null;
    if(auth.pending)auth.cancel();
  }
}
module.exports={followNativeBrowserSession};
