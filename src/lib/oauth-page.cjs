// SPDX-License-Identifier: GPL-3.0-or-later
// Exchange an FxA sessionToken for OAuth tokens by issuing the request from a
// real document context on accounts.firefox.com. session.fetch to /oauth/token
// is answered HTTP 406 by Fastly even after a solved challenge.
const {BrowserWindow,screen}=require('electron');

async function oauthTokenFromPage(ses, {authorization, body, timeoutMs=45000}={}){
  if(!ses)throw Error('OAuth page session is unavailable');
  if(!authorization||!body)throw Error('OAuth page request is incomplete');

  // Allow the isolated auth partition to call api.accounts from a document on
  // accounts.firefox.com (otherwise Chromium enforces CORS and fetch fails).
  try{
    ses.webRequest.onHeadersReceived({urls:['https://api.accounts.firefox.com/*']}, (details, callback)=>{
      const headers={...details.responseHeaders};
      headers['Access-Control-Allow-Origin']=['https://accounts.firefox.com'];
      headers['Access-Control-Allow-Credentials']=['true'];
      headers['Access-Control-Allow-Headers']=['Content-Type','Authorization','Accept','Accept-Language'];
      headers['Access-Control-Allow-Methods']=['POST','OPTIONS','GET'];
      callback({responseHeaders:headers});
    });
  }catch{/* best-effort */}

  const display=screen.getPrimaryDisplay();
  const {width:sw,height:sh}=display.bounds;
  const win=new BrowserWindow({
    show:true,
    width:64,
    height:64,
    x:sw+120,
    y:sh+120,
    skipTaskbar:true,
    focusable:false,
    frame:false,
    resizable:false,
    webPreferences:{
      session:ses,
      nodeIntegration:false,
      contextIsolation:true,
      sandbox:false,
      backgroundThrottling:false,
      webSecurity:false,
    },
  });
  try{win.webContents.setBackgroundThrottling(false);}catch{/* ignore */}
  try{
    await Promise.race([
      win.loadURL('https://accounts.firefox.com/'),
      new Promise((_,rej)=>setTimeout(()=>rej(Error('OAuth page load timed out')),timeoutMs)),
    ]);
    const result=await Promise.race([
      win.webContents.executeJavaScript(
        `(async()=>{
          try{
            const r=await fetch('https://api.accounts.firefox.com/v1/oauth/token',{
              method:'POST',
              headers:{
                'Content-Type':'application/json',
                'Authorization':${JSON.stringify(authorization)}
              },
              body:${JSON.stringify(body)},
              credentials:'include'
            });
            const text=await r.text();
            return {status:r.status, text};
          }catch(e){
            return {status:0, text:String(e&&e.message||e)};
          }
        })()`,
        true
      ),
      new Promise((_,rej)=>setTimeout(()=>rej(Error('OAuth page fetch timed out')),timeoutMs)),
    ]);
    return result;
  }finally{
    try{if(!win.isDestroyed())win.destroy();}catch{/* ignore */}
  }
}

module.exports={oauthTokenFromPage};
