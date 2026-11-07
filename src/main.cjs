// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const {app,BrowserWindow,ipcMain,safeStorage,nativeTheme,dialog,Tray,Menu,shell,screen}=require('electron');
const {nativeImage}=require('electron');
const {net:electronNet}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const dns=require('node:dns').promises;
const net=require('node:net');
const {spawn,execFile}=require('node:child_process');
const {Store}=require('./lib/store.cjs');
const {TrafficLedger}=require('./lib/traffic.cjs');
const {AccountCoordinator,knownEmpty,quotaFromPass}=require('./lib/accounts.cjs');
const {Control,Guardian}=require('./lib/control.cjs');
const {profileMigration,verifyMigratedProfile,NEW_DIR}=require('./lib/profile-migration.cjs');
// Chromium uses the operating system's network/proxy stack consistently for
// account verification, sign-in and token renewal. Do not mix it with Node fetch.
const {session}=require('electron');
const {createAccountTransport}=require('./lib/account-transport.cjs');
let authSessionSequence=0,captchaPrompt=null;
function makeControl({interactive=false}={}){
  const transport=createAccountTransport({
    createSession:()=>session.fromPartition('predator-auth-'+(++authSessionSequence)),
    systemFetch:(...args)=>electronNet.fetch(...args)
  });
  return new Control({transport,captchaSolver:interactive?image=>captchaPrompt.ask(image):null});
}
const {Auth}=require('./lib/auth.cjs');
const {readProviderRegistration,createAuthorization,redirectResult,signInNavigationAllowed}=require('./lib/provider-browser-auth.cjs');
const {completeBrowserOAuth}=require('./lib/oauth-browser-completion.cjs');
const {parseWebChannel}=require('./lib/fxa-webchannel-protocol.cjs');
const {followNativeBrowserSession}=require('./lib/fxa-native-browser-auth.cjs');
const {createNativeOAuthFlow,completeNativeOAuthCode}=require('./lib/fxa-native-oauth-code.cjs');
const {CaptchaPrompt}=require('./lib/captcha-prompt.cjs');
const APP_VERSION=require('../package.json').version;
// Adopt the new product name for all new Electron profile directories.
// Preserve explicit test/CLI overrides and migrate the legacy profile atomically
// before Chromium can write to either location. No accounts are decrypted here.
const configuredUserData=app.getPath('userData');
const appDataRoot=app.getPath('appData');
const standardProfile=path.resolve(configuredUserData)===path.resolve(path.join(appDataRoot,app.getName()));
let profileMove=null;
if(standardProfile)profileMove=profileMigration(appDataRoot);
app.setName('Predator VPN');
if(standardProfile)app.setPath('userData',path.join(appDataRoot,NEW_DIR));
const {Updates}=require('./lib/updates.cjs');
const {updateTarget}=require('./lib/update-target.cjs');
const {ReleaseNotes}=require('./lib/release-notes.cjs');
const {Tunnel}=require('./lib/tunnel.cjs');
const {AdaptiveTunnel}=require('./lib/h3-tunnel.cjs');
const {PassRenewer}=require('./lib/pass-renewal.cjs');
const {ProxyPassRecovery}=require('./lib/proxy-pass-recovery.cjs');
const {WindowsEngine}=require('./lib/windows-engine.cjs');
function makeTunnel(settings,log,onFatal){return new AdaptiveTunnel(settings,log,onFatal,path.join(engineDir(),process.platform==='win32'?'fox-h3.exe':'fox-h3'));}
const {measure,measureAll}=require('./lib/latency.cjs');
const {engineConfig}=require('./lib/settings.cjs');
const {MacEngine,networkDns:macNetworkDns}=require('./lib/mac-engine.cjs');
const {LinuxEngine,networkDns:linuxNetworkDns}=require('./lib/linux-engine.cjs');
const {ApplicationCatalog}=require('./lib/applications.cjs');
const {TrayPopup,bindTrayActions}=require('./tray.cjs');
const applications=new ApplicationCatalog(app);
const mac=process.platform==='darwin',linux=process.platform==='linux';
const osName=mac?'macOS':linux?'Linux':'Windows';
const multiAccount=true;
let accountCoordinator,traffic,loginGuardian,loginAccountId,switchingAccount=false,trafficSaveWarning=false;
let providerBrowserWindow=null,providerBrowserAttempt=0;const accountGuardians=new Map();
function accountGuardian(id){if(!accountGuardians.has(id)){const http=makeControl();accountGuardians.set(id,new Guardian(http,new Auth(http,store.accountStore(id))));}return accountGuardians.get(id);}
function syncGuardian(){if(multiAccount&&store.activeAccountId)guardian=accountGuardian(store.activeAccountId);}
function observeTraffic(){if(multiAccount&&traffic&&tunnel)traffic.observe(tunnel.up,tunnel.down);}
async function refreshAccount(id){const data=await accountCoordinator.refresh(id);if(store.activeAccountId===id)quota=store.activeAccount?.quota||null;emit();return data;}
function beginLogin(){loginAccountId=null;const http=makeControl({interactive:true}),sink={auth:null,setAuth(auth){if(!auth)return;loginAccountId=store.addAccount(auth,connection==='disconnected');this.auth=auth;}};loginGuardian=new Guardian(http,new Auth(http,sink));return loginGuardian.auth;}
function completeLogin(result){if(loginAccountId){syncGuardian();if(connection==='disconnected')quota=store.activeAccount?.quota||null;const id=loginAccountId;loginGuardian=null;loginAccountId=null;if(store.activeAccountId!==id)void refreshAccount(id).catch(()=>{});}return result;}

// Native Mozilla Accounts browser sign-in with isolated WebChannel mediation.
// The user enters credentials only into the identity provider's own page.
async function signInViaNativeBrowser(){
  if(busy||providerBrowserWindow)throw Error('Another account operation is already running.');
  const attempt=++providerBrowserAttempt;
  const nativeOAuth=createNativeOAuthFlow();
  // Firefox 134+ returns an OAuth authorization code directly via WebChannel.
  // Avoid the old session-token verification round-trip as the default path.
  const loginUrl=nativeOAuth.url;
  const browserUA='Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
  const permitted=new Set(['accounts.firefox.com','content.accounts.firefox.com','oauth.accounts.firefox.com',
    'accounts.google.com','appleid.apple.com']);
  busy=true;emit();
  try{
    await new Promise((resolve,reject)=>{
      let settled=false,sessionSeq=0,lastToken='',usingModern=true;
      const popup=new BrowserWindow({
        parent:window,modal:true,width:560,height:760,minWidth:460,minHeight:550,
        show:true,title:'Mozilla account sign-in - Predator VPN',autoHideMenuBar:true,
        webPreferences:{preload:path.join(__dirname,'fxa-webchannel-preload.cjs'),
          nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,
          partition:'predator-native-fxa-'+attempt+'-'+require('node:crypto').randomBytes(8).toString('hex')}
      });
      providerBrowserWindow=popup;
      popup.webContents.setUserAgent(browserUA);
      const timer=setTimeout(()=>finish(Error('Browser sign-in timed out.')),15*60*1000);
      timer.unref?.();
      function active(sequence){
        return !settled&&providerBrowserAttempt===attempt&&sessionSeq===sequence;
      }
      function finish(error){
        if(settled)return;
        settled=true;sessionSeq++;clearTimeout(timer);
        ipcMain.off('predator:fxa-webchannel',onWebChannel);
        if(providerBrowserWindow===popup)providerBrowserWindow=null;
        if(!popup.isDestroyed())popup.close();
        if(error)reject(error);else resolve();
      }
      function onWebChannel(event,detail){
        if(settled||event.sender!==popup.webContents)return;
        let origin;
        try{origin=new URL(event.senderFrame?.url||'').origin;}catch{return;}
        const message=parseWebChannel(origin,detail,nativeOAuth.state);
        if(!message)return;
        if(message.kind==='query'){
          const data=message.command==='fxaccounts:fxa_status'
            ?{capabilities:{},signedInUser:null}:{ok:true};
          popup.webContents.send('predator:fxa-webchannel-reply',{
            id:message.id,message:{messageId:message.messageId,command:message.command,data}
          });
          return;
        }
        if(message.kind==='oauth-code'){
          const sequence=++sessionSeq;
          void completeNativeOAuthCode({
            code:message.code,flow:nativeOAuth,
            fetcher:(url,options)=>popup.webContents.session.fetch(url,{...options,credentials:'include'}),
            checkVpn:async accessToken=>{
              const entitlement=new Guardian(makeControl(),{token:async()=>accessToken});
              await entitlement.pass();
            },
            saveAccount:credentials=>{
              if(!active(sequence))throw Error('Browser sign-in was cancelled.');
              const id=store.addAccount(credentials,connection==='disconnected');
              syncGuardian();
              if(connection==='disconnected')quota=store.activeAccount?.quota||null;
              emit();
              if(store.activeAccountId!==id)void refreshAccount(id).catch(()=>{});
              return id;
            },
            active:()=>active(sequence)
          }).then(()=>{if(active(sequence))finish(null);},
            error=>{if(active(sequence))finish(error);});
          return;
        }
        if(message.kind!=='legacy-session'||message.sessionToken===lastToken)return;
        lastToken=message.sessionToken;
        const sequence=++sessionSeq;
        void followNativeBrowserSession({
          sessionToken:message.sessionToken,email:message.email,
          // Use the same isolated Chromium cookie jar as the hosted sign-in.
          http:new Control({transport:(url,options)=>popup.webContents.session.fetch(url,{...options,credentials:'include'}),
            captchaSolver:image=>captchaPrompt.ask(image)}),
          fetcher:(...args)=>electronNet.fetch(...args),
          checkVpn:async accessToken=>{
            const entitlement=new Guardian(makeControl(),{token:async()=>accessToken});
            await entitlement.pass();
          },
          saveAccount:credentials=>{
            if(!active(sequence))throw Error('Browser sign-in was cancelled.');
            const id=store.addAccount(credentials,connection==='disconnected');
            syncGuardian();
            if(connection==='disconnected')quota=store.activeAccount?.quota||null;
            emit();
            if(store.activeAccountId!==id)void refreshAccount(id).catch(()=>{});
            return id;
          },
          active:()=>active(sequence)
        }).then(()=>{if(active(sequence))finish(null);},
          error=>{if(active(sequence))finish(error);});
      }
      ipcMain.on('predator:fxa-webchannel',onWebChannel);
      popup.on('close',()=>finish(Error('Browser sign-in was cancelled.')));
      popup.on('closed',()=>finish(Error('Browser sign-in was cancelled.')));
      popup.webContents.on('will-navigate',(event,url)=>{
        try{
          const u=new URL(url);
          if(u.protocol==='https:'&&permitted.has(u.hostname))return;
        }catch{}
        event.preventDefault();finish(Error('The provider attempted to leave approved sign-in domains.'));
      });
      popup.webContents.on('will-redirect',(event,url)=>{
        try{const u=new URL(url);if(u.protocol==='https:'&&permitted.has(u.hostname))return;}catch{}
        event.preventDefault();finish(Error('The provider redirected outside approved sign-in domains.'));
      });
      popup.webContents.on('did-navigate',(_event,url)=>{
        if(settled)return;
        try{
          const u=new URL(url);
          if(u.origin==='https://accounts.firefox.com'&&u.pathname.startsWith('/update_firefox')){
            // A rejected native-client entry mode is not a successful sign-in.
            finish(Error('The provider does not support this native OAuth sign-in flow. Use a registered OAuth client or contact the account provider.'));
          }
        }catch{}
      });
      popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      popup.webContents.on('did-fail-load',(_event,code,_desc,_url,mainFrame)=>{
        if(mainFrame&&code!==-3)finish(Error('The account provider sign-in page could not be loaded.'));
      });
      popup.loadURL(loginUrl).catch(()=>finish(Error('The account provider sign-in page could not be loaded.')));
    });
    return {needsCode:false};
  }finally{busy=false;emit();}
}

// Provider-hosted login with a separately registered OAuth application.
// If no registration exists, use the native WebChannel flow.
async function signInViaProviderBrowser(){
  if(busy||providerBrowserWindow)throw Error('Another account operation is already running.');
  const registration=readProviderRegistration(path.join(app.getPath('userData'),'mozilla-client-registration.json'));
  if(!registration)return signInViaNativeBrowser();
  const attempt=++providerBrowserAttempt,flow=createAuthorization(registration);
  busy=true;emit();
  try{
    const code=await new Promise((resolve,reject)=>{
      let settled=false;
      const popup=new BrowserWindow({
        parent:window,modal:true,width:560,height:760,minWidth:460,minHeight:550,
        show:true,title:'Provider sign-in - Predator VPN',autoHideMenuBar:true,
        webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,
          webSecurity:true,partition:'predator-provider-login-'+attempt+'-'+require('node:crypto').randomBytes(8).toString('hex')}
      });
      providerBrowserWindow=popup;
      const timer=setTimeout(()=>finish(Error('Browser sign-in timed out. Start again.')),15*60*1000);
      timer.unref?.();
      function finish(error,result){
        if(settled)return;
        settled=true;clearTimeout(timer);
        if(providerBrowserWindow===popup)providerBrowserWindow=null;
        if(!popup.isDestroyed())popup.close();
        if(error)reject(error);else resolve(result);
      }
      function navigation(event,url){
        try{
          const code=redirectResult(url,registration,flow);
          if(code){event.preventDefault();finish(null,code);return;}
          if(!signInNavigationAllowed(url,registration)){
            event.preventDefault();
            finish(Error('The provider sign-in attempted to leave the approved identity-provider domains.'));
          }
        }catch(error){event.preventDefault();finish(error);}
      }
      popup.webContents.on('will-redirect',navigation);
      popup.webContents.on('will-navigate',navigation);
      popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      popup.on('closed',()=>finish(Error('Browser sign-in was cancelled.')));
      popup.webContents.on('did-fail-load',(_event,errorCode,_description,_url,isMainFrame)=>{
        if(isMainFrame&&errorCode!==-3)finish(Error('The provider sign-in page could not be loaded.'));
      });
      popup.loadURL(flow.url).catch(()=>finish(Error('The provider sign-in page could not be loaded.')));
    });
    if(providerBrowserAttempt!==attempt)throw Error('Browser sign-in was cancelled.');
    const id=await completeBrowserOAuth({
      fetcher:(...args)=>electronNet.fetch(...args),registration,flow,code,
      active:()=>providerBrowserAttempt===attempt,
      authorizeVpn:async accessToken=>{
        const entitlement=new Guardian(makeControl(),{token:async()=>accessToken});
        await entitlement.pass();
      },
      saveAccount:account=>store.addAccount(account,connection==='disconnected')
    });
    syncGuardian();
    if(connection==='disconnected')quota=store.activeAccount?.quota||null;
    emit();
    if(store.activeAccountId!==id)void refreshAccount(id).catch(()=>{});
    return {needsCode:false};
  }finally{busy=false;emit();}
}
let macEngine;
let window,tray,trayPopup,store,guardian,tunnel,pendingTunnel,engine,passRenewer,recoveryController,busy=false,quitting=false,generation=0;
let latencies={},pinging=false;const pingingIds=new Set();
let servers=[],logs=[],connection='disconnected',startedAt=null,exit=null,quota=null,lastError=null;
const icon=path.join(__dirname,mac||linux?'../assets/logo-light.png':'../assets/icon.ico');
function log(level,message) {
  // Do not write service responses, tokens, credentials or destination traffic to logs.
  const entry={time:new Date().toISOString(),level,message:String(message).slice(0,1000)};
  logs.push(entry);if(logs.length>1000)logs.shift();emit();
}
function state() {observeTraffic();return {...(multiAccount?{accounts:store.publicAccounts(),activeAccountId:store.activeAccountId,accountPreferences:store.accountPreferences,totalTraffic:traffic?.snapshot(),sessionDuration:traffic?.session.duration||0}:{}),version:APP_VERSION,platform:process.platform,settings:store.publicSettings(),signedIn:!!store.auth,email:store.auth?.email || '',servers,latencies,pinging,pingingIds:[...pingingIds],activeServer:connection==='connected'?tunnel?.candidate:null,logs,connection,startedAt,exit,quota,protocol:connection==='connected'?(tunnel?.protocol||'h2'):null,lastError,up:multiAccount?traffic?.session.up||0:tunnel?.up||0,down:multiAccount?traffic?.session.down||0:tunnel?.down||0,systemDark:nativeTheme.shouldUseDarkColors,signinCaptcha:captchaPrompt?.image||null,busy};}
function emit() {if(quitting)return;if(store&&nativeTheme.themeSource!==store.settings.theme)nativeTheme.themeSource=store.settings.theme;if(window&&!window.isDestroyed())window.webContents.send('fox:state',state());trayPopup?.update();}
function trayState(){
  const server=tunnel?.candidate;
  const country=exit?.country?new Intl.DisplayNames(['en'],{type:'region'}).of(exit.country):server?.country;
  const city=server&&(!exit?.country||exit.country===server.code)?server.city:'';
  return {version:APP_VERSION,connection,signedIn:!!store.auth,busy,light:!nativeTheme.shouldUseDarkColors,accent:store.settings.accentColor||'orange',location:[country,city].filter((v,i,a)=>v&&a.indexOf(v)===i).join(', ')};
}
async function trayCommand(action){
  if(action==='open'){showWindow();return;}
  if(action==='quit'){app.quit();return;}
  if(connection==='connecting'){await disconnect();return;}
  if(busy||connection==='disconnecting')return;
  if(connection==='connected'){await disconnect();return;}
  busy=true;emit();try{await connect();}finally{busy=false;emit();}
}

function showWindow() {
  if(quitting)return;
  if(!window||window.isDestroyed())createWindow();
  if(window.isMinimized())window.restore();
  window.show();window.focus();
}
function engineDir() {return app.isPackaged?path.join(process.resourcesPath,'engine'):path.join(__dirname,mac?'../engine/darwin':linux?'../engine/linux':'../engine',process.arch);}
async function admin() {
  return new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{windowsHide:true},(e,out)=>resolve(!e&&out.trim()==='True')));
}
async function refreshServers() {const next=await guardian.servers();store.setServers(next);servers=store.servers;log('info',`Updated server list · ${servers.length} available endpoints`);return servers;}
async function launchEngine(candidate, epoch) {
  const executable=path.join(engineDir(),mac||linux?'sing-box':'sing-box.exe');
  if(!fs.existsSync(executable)||(!mac&&!linux&&!fs.existsSync(path.join(engineDir(),'wintun.dll'))))throw Error('The tunnel engine is missing. Reinstall Predator VPN.');
  if(!mac&&!linux&&!await admin())throw Error('System VPN mode requires Administrator access. Close Predator VPN and run it as administrator, or enable proxy-only mode.');
  const edgeHost=store.settings.edge||candidate.host;
  const edgeIP=tunnel?.edgeIP||(await dns.lookup(edgeHost)).address;
  const proxyIP=store.settings.upstream.enabled?(await dns.lookup(store.settings.upstream.host)).address:null;
  let networkDns;
  if(store.settings.doh==='off'&&!store.settings.customDns){
    networkDns=mac?await macNetworkDns():linux?await linuxNetworkDns():await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -or $_.IPv6DefaultGateway } | ForEach-Object { $_.DNSServer.ServerAddresses } | Select-Object -First 1"],{windowsHide:true,timeout:10000},(e,out)=>{const ip=out.trim();if(e||!net.isIP(ip))reject(Error('Cannot identify the network DNS resolver. Choose a DoH provider or custom DNS.'));else resolve(ip);}));
  }
  if(epoch!==generation)throw Error('Connection cancelled');
  const config=engineConfig({...store.settings,excludedApps:await applications.expand(store.settings.excludedApps)},edgeIP,proxyIP,networkDns);
  if(mac||linux){
    const Controller=linux?LinuxEngine:MacEngine;
    const controller=new Controller(app.getPath('userData'),executable,()=>{if(macEngine===controller&&connection==='connected')fail(Error(`The ${osName} tunnel engine stopped unexpectedly.`));});
    macEngine=controller;await controller.start(config);
    if(epoch!==generation){await controller.stop();throw Error('Connection cancelled');}
    log('info',`${osName} tunnel adapter ready · system traffic routed through Predator VPN`);return;
  }
  const configPath=path.join(app.getPath('userData'),'tunnel.json');
  fs.writeFileSync(configPath,JSON.stringify(config,null,2));
  const controller=new WindowsEngine({executable,configPath,cwd:engineDir(),log,onUnexpectedStop:()=>{
    if(engine===controller&&connection==='connected'){
      void recoverWindowsEngine();
    }
  }});
  engine=controller;
  await controller.start();
  if(!controller.child)throw Error('Windows tunnel engine stopped during startup.');
  if(epoch!==generation)throw Error('Connection cancelled');
  log('info','Windows TUN adapter ready · system traffic routed through Predator VPN');
}
async function stopEngine() {
  const controller=macEngine;macEngine=null;if(controller)await controller.stop();
  const windowsController=engine;engine=null;
  if(windowsController)await windowsController.stop();
}
async function recoverWindowsEngine() {
  if(recoveryController||quitting)return;
  const controller=new AbortController();
  recoveryController=controller;
  try {
    for(let attempt=1;attempt<=3;attempt++){
      if(controller.signal.aborted||quitting)return;
      log('warn','Windows VPN engine stopped. Reconnecting automatically ('+attempt+'/3).');
      await disconnect({keepSession:true,preserveRecovery:true});
      if(controller.signal.aborted||quitting)return;
      await connect({resumeTraffic:true,automaticRecovery:true});
      if(controller.signal.aborted||quitting)return;
      if(connection==='connected'){
        log('info','Windows VPN connection recovered.');
        return;
      }
      if(attempt<3)await new Promise(resolve=>{
        const timer=setTimeout(resolve,2000*attempt);
        controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});
      });
    }
    if(!controller.signal.aborted){
      lastError='The Windows tunnel engine could not be recovered. Check your network adapter and try connecting again.';
      log('error',lastError);
      if(multiAccount&&traffic)traffic.finish();
      emit();
    }
  } finally {
    if(recoveryController===controller)recoveryController=null;
  }
}
async function disconnect({keepSession=false,preserveRecovery=false}={}) {
  if(!preserveRecovery){recoveryController?.abort();recoveryController=null;}
  generation++;pendingTunnel?.stop();pendingTunnel=null;
  passRenewer?.stop();passRenewer=null;
  connection='disconnecting';emit();
  observeTraffic();await stopEngine();observeTraffic();tunnel?.stop();tunnel=null;if(multiAccount&&traffic){if(keepSession)traffic.suspended=true;else traffic.finish();}connection='disconnected';startedAt=null;exit=null;
  log('info',`Disconnected · ${osName} routes restored`);
}
async function fail(error) {
  if(switchingAccount)return;
  if(connection==='disconnecting'||connection==='disconnected')return;
  if(multiAccount&&connection==='connected'&&store.accountPreferences.autoSwitch&&!switchingAccount&&[401,403,429].includes(error.status)){
    switchingAccount=true;const id=store.activeAccountId,epoch=generation;busy=true;emit();
    try{if(await accountCoordinator.confirmExhausted(id,error)&&generation===epoch&&connection==='connected'){
      log('info','Account data allowance exhausted. Switching to another saved account.');await disconnect({keepSession:true});
      const recoveryEpoch=generation;const prepared=await accountCoordinator.prepare({exclude:[id]});if(generation!==recoveryEpoch)return;syncGuardian();await connect({resumeTraffic:true,prepared});return;
    }}catch(e){lastError=e.message;log('error',e.message);await disconnect();return;}
    finally{switchingAccount=false;busy=false;emit();}
  }
  lastError=error.message;log('error',error.message);await disconnect();
}
let sessionPassFlight=null;
function fetchSessionPass(source){
 if(!source)throw Error('No active account');
 if(sessionPassFlight?.source===source)return sessionPassFlight.promise;
 const promise=Promise.resolve().then(()=>source.pass());
 sessionPassFlight={source,promise};
 promise.finally(()=>{if(sessionPassFlight?.promise===promise)sessionPassFlight=null;}).catch(()=>{});
 return promise;
}
let proxyPassRecovery=null;
async function handleProxyRejection(error){
  const current=tunnel||pendingTunnel,epoch=generation,id=store.activeAccountId,source=guardian;
  if(!current||!source)return false;
  if(!proxyPassRecovery||proxyPassRecovery.current!==current){
    const controller=new ProxyPassRecovery({
      getPass:()=>fetchSessionPass(source),
      canApply:()=>generation===epoch&&store.activeAccountId===id&&(tunnel===current||pendingTunnel===current),
      applyPass:fresh=>{current.token=fresh.token;if(connection==="connected"){renew(fresh);quota=quotaFromPass(fresh);emit();}},
      onExhausted:err=>fail(err),log
    });
    proxyPassRecovery={current,controller};
  }
  return proxyPassRecovery.controller.handle(error);
}
function renew(pass) {
  passRenewer?.stop();
  const epoch=generation,accountId=store.activeAccountId,source=guardian;
  const controller=new PassRenewer({getPass:()=>fetchSessionPass(source),log,
    applyPass:fresh=>{
      if(epoch!==generation||connection!=='connected'||store.activeAccountId!==accountId)return;
      if(multiAccount)store.updateAccount(accountId,{quota:quotaFromPass(fresh),status:'ready',checkedAt:Date.now()});
      tunnel.token=fresh.token;
      quota={limit:fresh.quotaLimit,remaining:fresh.quotaRemaining,reset:fresh.quotaReset};emit();
    },
    onRejected:error=>{if(epoch===generation&&connection==='connected')return fail(error);}
  });
  passRenewer=controller;controller.start(pass);
}
async function connect({resumeTraffic=false,prepared=null,automaticRecovery=false}={}) {
  if(connection!=='disconnected')return;
  const epoch=++generation;
  const check=()=>{if(epoch!==generation)throw Error('Connection cancelled');};
  connection='connecting';lastError=null;exit=null;emit();
  try {
    if(!store.auth)throw Error('Sign in to your service account first.');
    if(!store.settings.proxyOnly&&store.settings.splitMode==='include'&&!store.settings.excludedApps.length)throw Error('Select at least one app in Split tunneling before connecting.');
    if(!mac&&!linux&&!store.settings.proxyOnly&&!await admin())throw Error('Run Predator VPN as administrator for system VPN, or enable proxy-only mode in Settings.');
    if(!servers.length)await refreshServers();
    check();
    const id=store.settings.serverId;
    const list=require('./lib/h3-tunnel.cjs').connectionCandidates(servers,id);
    if(!list.length)throw Error('This server is no longer available. Choose another location.');
    // The official REC edge provides anycast selection on Windows.
    const pass=multiAccount?(prepared||await accountCoordinator.prepare()).pass:await guardian.pass();syncGuardian();quota={limit:pass.quotaLimit,remaining:pass.quotaRemaining,reset:pass.quotaReset};
    check();
    let selected;
    for(const candidate of list.slice(0,5)) {
      const attempt=makeTunnel(structuredClone(store.settings),log,handleProxyRejection);
      pendingTunnel=attempt;
      try{await attempt.start(candidate,pass);check();exit=await attempt.exit(id==='REC'?null:candidate.code);check();tunnel=attempt;pendingTunnel=null;selected=candidate;break;}
      catch(e){attempt.stop();pendingTunnel=null;check();lastError=e.message;log('warn',`Could not connect to ${[candidate.country,candidate.city].filter((v,i,a)=>v&&a.indexOf(v)===i).join(', ')}. ${e.message}`);}
    }
    if(!selected)throw Error(lastError || 'No server could be reached.');
    if(!store.settings.proxyOnly)await launchEngine(selected,epoch);
    check();
    if(multiAccount)traffic.begin(resumeTraffic);connection='connected';startedAt=multiAccount?traffic.startedAt:Date.now();lastError=null;renew(pass);void refreshAddresses(tunnel,epoch);
    log('info',store.settings.proxyOnly?'Proxy-only mode active · configure your application to use the local SOCKS5 proxy':`Connected · ${osName} system VPN active`);
  }catch(e){if(epoch===generation){lastError=e.message;log('error',e.message);await disconnect({keepSession:automaticRecovery,preserveRecovery:automaticRecovery});}}
}
async function refreshAddresses(active,epoch) {
  if(tunnel!==active||connection!=='connected')return;
  const base=exit?.ip?{...exit}:null;exit={...exit,pending:true};emit();
  let result=base;
  try{result=await active.addresses(base||await active.exit(null));}catch{/* No optional probe can invalidate an established tunnel. */}
  if(tunnel===active&&generation===epoch&&connection==='connected'){exit={...result,pending:false};emit();}
}
function handle(channel, fn) {
  ipcMain.handle('fox:'+channel,async(event,...args)=>{
    if(event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame)throw Error('Invalid sender');
    try{return {ok:true,data:await fn(...args)};}catch(e){return {ok:false,error:e.message || 'Operation failed'};}
  });
}
function createWindow() {
  window=new BrowserWindow({width:1180,height:800,minWidth:960,minHeight:700,backgroundColor:'#101117',title:'Predator VPN',icon,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.loadFile(path.join(__dirname,'ui/index.html'));
  window.on('closed',()=>{window=null;});
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{showWindow();});
  app.whenReady().then(()=>{
    if(mac)Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Predator VPN',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'File',submenu:[{label:'Close Window',accelerator:'Command+W',click:()=>{if(window&&!window.isDestroyed())window.close();}}]},{role:'editMenu'},{role:'windowMenu'}]));
    // Verify OS-bound encrypted data at the new profile path before opening a
    // mutable Store. A failed verification cannot silently sign accounts out.
    if(profileMove)verifyMigratedProfile(profileMove,safeStorage);
    fs.rmSync(path.join(app.getPath('userData'),'oauth-client.json'),{force:true});
    store=new Store(app.getPath('userData'),safeStorage);
    if(profileMove&&store.loadError)throw Error('Migrated account data could not be read. No account files were deleted.');
    captchaPrompt=new CaptchaPrompt(()=>emit());
    servers=store.servers;if(multiAccount){traffic=new TrafficLedger(store.traffic,value=>store.setTraffic(value));accountCoordinator=new AccountCoordinator(store,accountGuardian);quota=store.activeAccount?.quota||null;}
    const control=makeControl({interactive:true});guardian=new Guardian(control,new Auth(control,store));
    const updates=new Updates({version:APP_VERSION,target:updateTarget(process.platform,process.arch,app.getPath('exe')),fetch:(...args)=>electronNet.fetch(...args),cacheFile:path.join(app.getPath('userData'),'release-cache.json')});
    syncGuardian();createWindow();tray=new Tray(mac||linux?nativeImage.createFromPath(icon).resize({width:22,height:22}):icon);tray.setToolTip('Predator VPN');
    trayPopup=new TrayPopup({state:trayState,command:trayCommand,bounds:()=>{const bounds=tray.getBounds();if(mac)return bounds;const point=screen.getCursorScreenPoint();return point.x>=bounds.x-8&&point.x<=bounds.x+bounds.width+8&&point.y>=bounds.y-8&&point.y<=bounds.y+bounds.height+8?bounds:{...point,width:0,height:0};}});
    bindTrayActions(tray,trayPopup,showWindow,error=>log('warn',error.message));emit();
    handle('state',()=>state());
    handle('checkUpdates',force=>updates.check(force===true));
    const releaseNotes=new ReleaseNotes({notes:require('../release-notes.json'),version:APP_VERSION,platform:process.platform,stateFile:path.join(app.getPath('userData'),'release-highlights.json')});
    handle('releaseNotes',()=>releaseNotes.read());
    handle('ackReleaseNotes',()=>releaseNotes.acknowledge());
    handle('downloadUpdate',async()=>{const update=await updates.check();if(!update.available)throw Error('No newer update is available.');await shell.openExternal(update.url);});
    handle('browserLogin',signInViaProviderBrowser);
    handle('login',async({email,password})=>{if(busy)throw Error('An operation is already running.');busy=true;emit();try{return multiAccount?completeLogin(await beginLogin().login(email,password)):await guardian.auth.login(email,password);}finally{busy=false;emit();}});
    handle('answerCaptcha',answer=>captchaPrompt.submit(answer));
    handle('cancelCaptcha',()=>captchaPrompt.cancel());
    handle('verify',async code=>{if(busy)throw Error('An operation is already running.');busy=true;emit();try{if(multiAccount&&!loginGuardian)throw Error('Start account sign-in again.');return multiAccount?completeLogin(await loginGuardian.auth.verify(code)):await guardian.auth.verify(code);}finally{busy=false;emit();}});
    handle('logout',async()=>{if(busy)throw Error('Wait for the current operation to finish.');await disconnect();if(multiAccount){if(store.activeAccountId)store.removeAccount(store.activeAccountId);syncGuardian();}else{store.setAuth(null);guardian.auth.pending=null;}quota=multiAccount?store.activeAccount?.quota||null:null;emit();});
    handle('servers',refreshServers);
    handle('ping',async id=>{
      if(!store.auth)throw Error('Sign in before checking real delay.');
      const pass=await guardian.pass();
      const pingSettings=structuredClone(store.settings);
      const probe=server=>measure(server,structuredClone(pingSettings),pass,5000,makeTunnel);
      if(id!==undefined){
        const server=servers.find(s=>s.id===id);if(!server)throw Error('Unknown location.');
        if(pinging||pingingIds.has(id))throw Error('A latency check is already running for this location.');
        pingingIds.add(id);delete latencies[id];emit();
        try{const result=await probe(server);if(store.settings.transport===pingSettings.transport)latencies[id]=result;return result;}
        finally{pingingIds.delete(id);emit();}
      }
      if(pinging||pingingIds.size)throw Error('Wait for the current location latency checks.');
      pinging=true;latencies={};emit();
      try{if(!servers.length)await refreshServers();await measureAll([...servers],(id,result)=>{if(store.settings.transport===pingSettings.transport)latencies[id]=result;emit();},3,probe);return latencies;}
      finally{pinging=false;emit();}
    });
    handle('account',()=>multiAccount?refreshAccount(store.activeAccountId):guardian.account());
    if(multiAccount){
      handle('cancelAccountLogin',()=>{captchaPrompt?.cancel();loginGuardian?.auth.cancel();loginGuardian=null;loginAccountId=null;if(providerBrowserWindow&&!providerBrowserWindow.isDestroyed()){providerBrowserAttempt++;providerBrowserWindow.close();}});
      handle('accountPreferences',auto=>{store.setAccountPreferences(auto);emit();});
      handle('selectAccount',async id=>{if(busy)throw Error('Wait for the current operation.');const chosen=store.accounts.find(a=>a.id===id);if(!chosen?.auth)throw Error('Sign in to this account again.');busy=true;emit();try{const reconnect=connection==='connected';if(connection!=='disconnected')await disconnect();store.selectAccount(id);syncGuardian();quota=store.activeAccount?.quota||null;if(reconnect)await connect();}finally{busy=false;emit();}});
      handle('removeAccount',async id=>{if(busy)throw Error('Wait for the current operation.');if(id===store.activeAccountId&&connection!=='disconnected')throw Error('Disconnect before removing the active account.');store.removeAccount(id);accountGuardians.delete(id);syncGuardian();quota=store.activeAccount?.quota||null;emit();});
    }
    handle('activate',async()=>{const data=await guardian.request('activate','POST');return data.data;});
    handle('settings',async settings=>{if(connection!=='disconnected')throw Error('Disconnect before changing connection settings.');if(settings.clearUpstreamPassword&&settings.upstream)settings.upstream.password='';else if(settings.upstream?.password==='')settings.upstream.password=store.settings.upstream.password;delete settings.clearUpstreamPassword;const changedProtocol=settings.transport!==store.settings.transport;store.setSettings({...settings,locationSort:store.settings.locationSort});if(changedProtocol)latencies={};emit();});
    handle('locationSort',locationSort=>{store.setSettings({...store.settings,locationSort});emit();});
    handle('apps',()=>applications.list());
    handle('appIcon',id=>applications.icon(id));
    handle('select',id=>{if(connection!=='disconnected')throw Error('Disconnect before choosing another server.');if(id!=='REC'&&!servers.some(s=>s.id===id))throw Error('Unknown server.');store.setSettings({...store.settings,serverId:id});emit();});
    handle('theme',theme=>{store.setSettings({...store.settings,theme});emit();});
    handle('accentColor',accentColor=>{store.setSettings({...store.settings,accentColor});emit();});
    handle('connect',async()=>{if(busy)throw Error('Wait for the current operation.');busy=true;emit();try{await connect();}finally{busy=false;emit();}});
    handle('disconnect',async()=>{if(busy&&!switchingAccount)throw Error('Wait for the current operation.');await disconnect();});
    handle('cancel',async()=>{if(connection==='connecting')await disconnect();});
    handle('exit',async()=>{if(connection!=='connected')throw Error('Connect before verifying your connection.');const active=tunnel,epoch=generation;const result=await active.exit(store.settings.serverId==='REC'?null:active.candidate.code);if(tunnel!==active||epoch!==generation)throw Error('Connection changed while checking.');exit=result;emit();void refreshAddresses(active,epoch);return result;});
    handle('clearLogs',()=>{logs=[];emit();});
    handle('exportLogs',async()=>{const result=await dialog.showSaveDialog(window,{defaultPath:'PredatorVPN-diagnostics.txt',filters:[{name:'Text files',extensions:['txt']}]});if(!result.canceled)fs.writeFileSync(result.filePath,logs.map(l=>`${l.time} [${l.level}] ${l.message}`).join('\n'));});
    handle('openLink',id=>{const urls={source:'https://github.com/erfan-tahvilian/PredatorVPN',license:'https://github.com/erfan-tahvilian/PredatorVPN/blob/main/LICENSE',providerLoginHelp:'https://mozilla.github.io/ecosystem-platform/relying-parties/tutorials/integration-with-fxa'};if(!urls[id])throw Error('Unknown link');return shell.openExternal(urls[id]);});
    nativeTheme.on('updated',emit);setInterval(()=>{if(multiAccount&&traffic){observeTraffic();try{traffic.checkpoint();trafficSaveWarning=false;}catch{if(!trafficSaveWarning){logs.push({time:new Date().toISOString(),level:'warn',message:'Traffic statistics could not be saved.'});trafficSaveWarning=true;}}}emit();},1000).unref();
    if(store.loadError)log('warn',store.loadError);
    refreshServers().catch(()=>log('warn','Locations could not be refreshed. Saved locations remain available; try Refresh again later.'));
  });
  app.on('before-quit',event=>{
    event.preventDefault();if(quitting)return;quitting=true;
    captchaPrompt?.cancel();loginGuardian?.auth.cancel();
    let finished=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(deadline);try{trayPopup?.destroy();}catch{}trayPopup=null;try{if(tray&&!tray.isDestroyed())tray.destroy();}catch{}tray=null;app.exit(0);};
    // A second quit cycle can be cancelled by a window; exit once cleanup has
    // finished instead. Bound cleanup so a hung child cannot retain the app.
    const deadline=setTimeout(finish,10000);
    Promise.resolve().then(disconnect).catch(()=>{}).finally(finish);
  });
  app.on('activate',()=>{showWindow();});
  app.on('window-all-closed',()=>{});
}
