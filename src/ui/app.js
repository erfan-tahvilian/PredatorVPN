// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
const $=id=>document.getElementById(id);
let currentState=null, page='home', initialized=false, needsCode=false, lastLogs='',lastServers='',lastUp=0,lastDown=0,lastTick=Date.now(),toastTimer;
const labels={home:'Overview',locations:'Locations',account:'My account',settings:'Settings',logs:'Activity log'};
function toast(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500); }
async function call(channel,...args) {
  const result=await window.fox.call(channel,...args);
  if(!result.ok)throw Error(result.error);
  return result.data;
}
function action(fn) {return async event=>{try{await fn(event);}catch(e){toast(e.message);}};}
function navigate(next) {page=next;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===page));

document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));$('page-label').textContent=labels[page];if(page==='locations')renderServers();if(page==='logs')renderLogs();window.scrollTo({top:0,left:0,behavior:'instant'});}
function showSplitSettings(){navigate('settings');const section=$('split-tunneling');section?.scrollIntoView({behavior:'auto',block:'start'});$('choose-apps')?.focus({preventScroll:true});}
function bytes(n) {n=Number(n)||0;const units=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${n.toFixed(i&&n<10?1:0)} ${units[i]}`;}
function time(n) {const s=Math.max(0,Math.floor(n/1000));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
const ACCENTS={
orange:['#ff8b3d','#d95812'],gold:['#ffc43d','#9b6800'],blue:['#5aa6ff','#126fc9'],teal:['#42d0c2','#087c73'],emerald:['#4bd68b','#16824f'],red:['#fa7575','#c53a38'],purple:['#bb87ff','#823cc9'],pink:['#ff79b5','#bf267c'],indigo:['#9c9bff','#514ac5'],cyan:['#4ad9ee','#007f9e']
};
function setAccent(color,light){const name=Object.hasOwn(ACCENTS,color)?color:'orange';
document.body.dataset.accent=name;for(const button of document.querySelectorAll('[data-accent]'))button.setAttribute('aria-pressed',String(button.dataset.accent===name));}
for(const button of document.querySelectorAll('[data-accent]'))button.addEventListener('click',()=>{
const selector=$('accentColor');selector.value=button.dataset.accent;setAccent(selector.value,document.body.classList.contains('light'));selector.dispatchEvent(new Event('change',{bubbles:true}));});
function applyTheme(s) {
  const light=s.settings.theme==='light'||s.settings.theme==='system'&&!s.systemDark;
  document.body.classList.toggle('light',light);
  setAccent(s.settings.accentColor||'orange',light);
  $('theme-toggle').replaceChildren(icon(light?'moon':'sun'));
  $('theme-toggle').title=light?'Switch to dark theme':'Switch to light theme';
  $('theme-toggle').setAttribute('aria-label',$('theme-toggle').title);
  document.querySelectorAll('[data-theme-logo]').forEach(img=>{const src=`../../assets/${light?'logo':'logo-light'}.png`;if(img.getAttribute('src')!==src)img.src=src;});
}
function countryName(code) {try{return new Intl.DisplayNames(['en'],{type:'region'}).of(code);}catch{return code;}}
function locationCity(server) {const city=(server?.city||'').trim();return city&&city.toLowerCase()!==(server?.country||'').trim().toLowerCase()?city:'';}
function locationLabel(server) {return [server?.country,locationCity(server)].filter(Boolean).join(', ');}
function renderLatency(element,server,s) {
  const result=server?s.latencies?.[server.id]:null;
  const pending=server&&!result&&(s.pinging||(s.pingingIds||[]).includes(server.id));
  element.className='latency';element.setAttribute('aria-live','polite');element.textContent=pending?'Checking…':result?(result.ms==null?(result.reason==='timeout'?'Timed out':'Unreachable'):`${result.ms} ms`):'- ms';
  if(!pending&&result?.ms!=null)element.classList.add(result.ms<150?'fast':result.ms<350?'moderate':'slow');
  element.title=result?.ms==null&&result?.reason==='timeout'?(result.phase==='setup'?'The VPN transport did not connect before the timeout.':'The HTTPS delay check timed out through this location.'):'Real delay: HTTPS response through the authenticated VPN tunnel';
}
function automaticServer(server) {return /recom+end|anycast/i.test(server.country+' '+server.city)||server.code==='REC';}
function readBootstrapSources(){
  return [...document.querySelectorAll("#bootstrap-source-list input[data-bootstrap-url]")]
    .map(input=>input.value.trim()).filter(Boolean);
}
function renderBootstrapSources(urls){
  const container=$("bootstrap-source-list");if(!container)return;
  container.replaceChildren();
  const list=Array.isArray(urls)?urls:[];
  list.forEach((value,index)=>{
    const row=document.createElement("div");row.className="bootstrap-source-row";
    const label=document.createElement("label");label.textContent="Source "+(index+1);
    const input=document.createElement("input");input.type="url";input.dataset.bootstrapUrl="true";
    input.placeholder="https://example.com/subscription.txt";input.value=value;
    input.setAttribute("aria-label","Bootstrap subscription "+(index+1));
    label.append(input);
    const controls=document.createElement("div");controls.className="bootstrap-source-actions";
    for(const [caption,action] of [["Up","up"],["Down","down"],["Remove","remove"]]){
      const button=document.createElement("button");button.type="button";button.textContent=caption;
      button.className="bootstrap-source-action";button.dataset.action=action;
      button.disabled=(action==="up"&&index===0)||(action==="down"&&index===list.length-1);
      button.addEventListener("click",()=>{
        // Read unsaved input before reordering or removing rows.
        const current=[...container.querySelectorAll("input[data-bootstrap-url]")].map(x=>x.value);
        if(action==="remove")current.splice(index,1);
        else if(action==="up") [current[index-1],current[index]]=[current[index],current[index-1]];
        else if(action==="down") [current[index],current[index+1]]=[current[index+1],current[index]];
        renderBootstrapSources(current);
      });
      controls.append(button);
    }
    row.append(label,controls);container.append(row);
  });
}
$("bootstrap-add-source").addEventListener("click",()=>{
  renderBootstrapSources([...document.querySelectorAll("#bootstrap-source-list input[data-bootstrap-url]")].map(x=>x.value).concat(""));
  const inputs=[...document.querySelectorAll("#bootstrap-source-list input[data-bootstrap-url]")];
  inputs[inputs.length-1]?.focus();
});

function fillSettings(s) {
  if($('transport'))$('transport').value=s.transport||'auto';
  for(const key of ['theme','bind','socksPort','doh','customDns','edge'])$(key).value=s[key];
  $('accentColor').value=s.accentColor||'orange';
  for(const key of ['proxyOnly'])$(key).checked=s[key];
  $('excludedApps').value=s.excludedApps.join('\n');
  $('upstreamEnabled').checked=s.upstream.enabled;
  renderBootstrapSources(s.bootstrapSubUrls||[s.bootstrapSubUrl].filter(Boolean));
  for(const key of ['type','host','port','username'])$('upstream'+key[0].toUpperCase()+key.slice(1)).value=s.upstream[key];
  $('upstreamPassword').value='';
}
let allowanceData=null,allowanceEmail=null,allowanceRequested=false,allowanceLoading=false,lastAllowanceQuota='';
function renderAllowance(s){
  if(!s.signedIn||allowanceEmail!==s.email){allowanceData=null;allowanceEmail=s.signedIn?s.email:null;allowanceRequested=false;lastAllowanceQuota='';}
  const key=JSON.stringify(s.quota);if(s.signedIn&&key!==lastAllowanceQuota){lastAllowanceQuota=key;if(s.quota)allowanceData=s.quota;}
  const summary=allowanceSummary(s.signedIn?allowanceData:null),ring=$('allowance-ring');
  ring.closest('.allowance-card').dataset.status=summary.kind;
  ring.style.setProperty('--usage',(summary.percent||0)+'%');
  ring.setAttribute('aria-valuemin','0');ring.setAttribute('aria-valuemax','100');
  if(summary.kind==='limited')ring.setAttribute('aria-valuenow',summary.percent);else ring.removeAttribute('aria-valuenow');
  $('allowance-percent').textContent=summary.kind==='limited'?summary.percent+'%':summary.kind==='unlimited'?'∞':'-';
  $('allowance-used').textContent=summary.kind==='limited'?bytes(summary.used)+' used':summary.kind==='unlimited'?'Unlimited data':'Your data allowance';
  $('allowance-detail').textContent=!s.signedIn?'Sign in to view your usage.':summary.kind==='limited'?`${bytes(summary.remaining)} remaining of ${bytes(summary.limit)}${summary.reset?' · Resets '+summary.reset.toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}`:summary.kind==='unlimited'?'No monthly data limit reported.':allowanceLoading?'Checking your allowance…':'Refresh to view your data allowance.';
  $('allowance-progress').style.width=(summary.percent||0)+'%';
  $('refresh-allowance').disabled=!s.signedIn||allowanceLoading;
  $('refresh-allowance').setAttribute('aria-busy',String(allowanceLoading));
  if(s.signedIn&&!allowanceRequested){allowanceRequested=true;queueMicrotask(()=>refreshAllowance(false));}
}
async function refreshAllowance(announce){
  if(allowanceLoading||!currentState?.signedIn)return;
  const email=currentState.email;allowanceLoading=true;renderAllowance(currentState);
  try{const data=await call('account');if(currentState?.signedIn&&currentState.email===email)accountInfo(data);}
  catch(e){if(announce)toast(e.message);}
  finally{allowanceLoading=false;if(currentState.email!==email)allowanceRequested=false;renderAllowance(currentState);}
}
$('refresh-allowance').addEventListener('click',()=>refreshAllowance(true));
$('allowance-account').addEventListener('click',()=>navigate('account'));
function render(s) {
  currentState=s;applyTheme(s);
  renderAllowance(s);updateConnectionHealth(s);renderRecentEvents(s);$('transport-field').hidden=!['win32','darwin','linux','android'].includes(s.platform);document.querySelector('#transport option[value=auto]').textContent='Automatic · Compare HTTP/3 and HTTP/2';$('protocol-name').textContent=s.connection==='connected'?(s.protocol==='h3'?'HTTP/3 over QUIC':'HTTP/2 over TLS'):'-';$('protocol-secure').hidden=s.connection!=='connected';
  if(!initialized){fillSettings(s.settings);initialized=true;}
  syncSelects();
  const connected=s.connection==='connected', transitional=['connecting','disconnecting'].includes(s.connection);
  $('status-label').className='status '+s.connection;
  $('status-label').replaceChildren(Object.assign(document.createElement('i'),{}),document.createTextNode(s.connection[0].toUpperCase()+s.connection.slice(1)));
  $('connect').className='power-button '+s.connection;$('connect').disabled=s.connection==='disconnecting'||s.busy&&s.connection!=='connecting';
  $('connect').setAttribute('aria-label',connected?'Disconnect VPN':s.connection==='connecting'?'Cancel connection':'Connect VPN');
  $('connection-title').textContent=connected?'You’re connected.':s.connection==='connecting'?'Finding your private path…':s.connection==='disconnecting'?'Closing your connection…':'Ready when you are.';
  $('connection-description').textContent=connected?(s.settings.proxyOnly?'Your local SOCKS5 proxy is ready.':'Your system traffic is using the tunnel.'):s.connection==='connecting'?'Click again to cancel.':'One click to a more private connection.';
  $('mode-label').textContent=s.settings.proxyOnly?'PROXY ONLY':'SYSTEM VPN';
  $('connection-footnote').textContent=s.settings.proxyOnly?`SOCKS5 · ${s.settings.bind}:${s.settings.socksPort}`:`Encrypted tunnel · ${s.settings.doh==='off'&&!s.settings.customDns?'System DNS':'Private DNS'}`;
  const selected=s.activeServer||s.servers.find(server=>server.id===s.settings.serverId);
  const exitCountry=connected&&s.exit?.country?countryName(s.exit.country):null;
  $('selected-symbol').replaceChildren(exitCountry?flag(s.exit.country,exitCountry):selected?flag(selected.code,selected.country):icon('globe'));
  const shown=exitCountry&&selected?.code!==s.exit.country?{country:exitCountry,city:''}:selected;
  $('selected-location').textContent=shown?locationLabel(shown):'Recommended location';
  $('selected-detail').textContent=connected&&selected?`${s.settings.serverId==='REC'?'Recommended · ':''}Connected to ${locationLabel(shown)}`:selected?(s.settings.transport==='h3'?'HTTP/3 endpoint':s.settings.transport==='h2'?'HTTP/2 endpoint':'Automatic protocol'):'Automatically choose an available server';
  renderLatency($('selected-latency'),selected,s);
  $('ping-selected').disabled=!selected||s.pinging||(s.pingingIds||[]).includes(selected.id);
  $('ping-selected').title=selected?`Ping ${locationLabel(selected)}`:'Connect to identify the recommended endpoint, or choose a location';
  const legacy=s.exit?.ip||'';
  $('exit-ipv4').textContent=s.exit?.ipv4||(!legacy.includes(':')&&legacy)|| (connected?(s.exit?.pending?'Checking…':'Not available'):'Not connected');
  $('exit-ipv6').textContent=s.exit?.ipv6||(legacy.includes(':')&&legacy)|| (connected?(s.exit?.pending?'Checking…':'Not available'):'Not connected');
  $('exit-country').textContent=exitCountry||s.exit?.country||'-';
  $('verify-exit').disabled=!connected;
  $('downloaded').textContent=bytes(s.down);$('uploaded').textContent=bytes(s.up);
  const now=Date.now(), elapsed=(now-lastTick)/1000;
  if(elapsed>.5){$('download-speed').textContent=bytes(Math.max(0,s.down-lastDown)/elapsed)+'/s';$('upload-speed').textContent=bytes(Math.max(0,s.up-lastUp)/elapsed)+'/s';lastUp=s.up;lastDown=s.down;lastTick=now;}
  $('session-time').textContent=time(s.sessionDuration??(s.startedAt?now-s.startedAt:0));
  $('location-count').textContent=new Set(s.servers.filter(c=>!automaticServer(c)).map(c=>c.code)).size || '-';
  $('account-name').textContent=s.signedIn?s.email.split('@')[0]:'Sign in';
  document.querySelector('#account-shortcut .avatar').textContent=s.signedIn?(Array.from((s.email||'').trim())[0]?.toUpperCase()||'?'):'P';
  $('signin-panel').hidden=s.signedIn;$('signedin-panel').hidden=!s.signedIn;$('signedin-email').textContent=s.email;
  const captchaActive=!!s.signinCaptcha;
   $('login-form').hidden=needsCode||captchaActive;
   $('code-form').hidden=!needsCode||captchaActive;
   $('captcha-form').hidden=!captchaActive;
   if(captchaActive&&$('captcha-image').getAttribute('src')!==s.signinCaptcha)$('captcha-image').src=s.signinCaptcha;
   if(!captchaActive)$('captcha-image').removeAttribute('src');
  $('login-button').disabled=s.busy;renderAccountManager(s);
  $('home-info').textContent=s.lastError||(s.signedIn?(s.quota?.remaining?`${bytes(s.quota.remaining)} remaining in your current service allowance.`:'Your service account is ready. Choose a location and connect.'):'Sign in with your service account to get started.');
  $('settings-notice').textContent=s.connection==='disconnected'?'Credentials are encrypted on this device.':'Disconnect before saving network preferences.';
  $('ping-servers').disabled=s.pinging||(s.pingingIds||[]).length>0;
  $('ping-servers').textContent=s.pinging?'Checking latency…':'Ping all locations';
  const measured=Object.keys(s.latencies||{}).length;
  $('ping-status').textContent=s.pinging?`Checking endpoints · ${measured} / ${s.servers.length}`:measured?'Real delay · current network path · Refresh after changing networks or protocols.':'Real delay through each VPN location. Sign in, then run a check to compare locations.';
  const serverKey=JSON.stringify([s.servers,s.latencies,s.pinging,s.pingingIds])+s.settings.serverId;if(serverKey!==lastServers){lastServers=serverKey;renderServers();}
  const logKey=JSON.stringify(s.logs);if(logKey!==lastLogs){lastLogs=logKey;renderLogs();}
  window.desktopUI?.state(s);
}
function icon(name) {const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#glyph-'+name);svg.append(use);return svg;}
function flag(code,country) {
  if(!/^[a-z]{2}$/i.test(code))return icon('globe');
  const img=document.createElement('img');img.className='country-flag';img.src=`../../assets/flags/${code.toLowerCase()}.svg`;img.alt=`${country} flag`;
  img.addEventListener('error',()=>img.replaceWith(icon('globe')),{once:true});return img;
}
function renderServers() {
  if(!currentState)return;
  const query=$('server-search').value.toLowerCase(),seen=new Set();
  const servers=currentState.servers.filter(s=>{if(automaticServer(s))return false;const key=s.code+'/'+s.cityCode;if(seen.has(key))return false;seen.add(key);return `${s.country} ${s.city} ${s.code}`.toLowerCase().includes(query);}).sort((a,b)=>{
    const mode=$('server-sort').value,byName=a.country.localeCompare(b.country)||a.city.localeCompare(b.city);
    if(mode.startsWith('name'))return mode==='name-desc'?-byName:byName;
    const left=currentState.latencies?.[a.id]?.ms,right=currentState.latencies?.[b.id]?.ms;
    const leftKnown=Number.isFinite(left),rightKnown=Number.isFinite(right);
    if(leftKnown!==rightKnown)return leftKnown?-1:1;
    return leftKnown&&left!==right?(mode==='ping-desc'?right-left:left-right):byName;
  });
  $('server-list').replaceChildren();
  for(const server of servers) {
    const row=document.createElement('div');row.className='server-row'+(currentState.settings.serverId.startsWith(server.code+'/'+server.cityCode+'/')?' selected':'');
    const button=document.createElement('button');button.className='server-choice';button.dataset.serverId=server.id;
    const code=document.createElement('span');code.className='country-code';code.append(flag(server.code,server.country));
    const text=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=server.country;small.textContent=locationCity(server);small.hidden=!small.textContent;text.append(strong,small);
    const latency=document.createElement('span');latency.className='latency';
    renderLatency(latency,server,currentState);
    button.append(code,text,latency);button.addEventListener('click',action(async()=>{await call('select',server.id);navigate('home');toast(`Selected ${locationLabel(server)}`);}));const ping=document.createElement('button');ping.className='server-ping icon-button';ping.type='button';ping.setAttribute('aria-label',`Ping ${locationLabel(server)}`);ping.title=`Ping ${server.country}`;ping.append(icon('ping'));
    ping.disabled=currentState.pinging||(currentState.pingingIds||[]).includes(server.id);
    ping.addEventListener('click',action(async()=>{await call('ping',server.id);}));const choose=document.createElement('button');choose.type='button';choose.className='server-select icon-button';choose.setAttribute('aria-label',`Select ${locationLabel(server)}`);choose.title=`Select ${server.country}`;choose.append(icon('arrow'));choose.addEventListener('click',()=>button.click());row.append(button,ping,choose);$('server-list').append(row);
  }
  $('server-empty').hidden=servers.length>0;$('server-empty').textContent=query?'No matching locations.':'No locations loaded. Refresh to fetch the live server list.';
}
function renderRecentEvents(s){
 const list=$('recent-activity-list');if(!list)return;
 const recent=(s.logs||[]).slice(-3).reverse();list.replaceChildren();
 if(!recent.length){const empty=document.createElement('p');empty.className='recent-empty';empty.textContent='No connection events yet. Diagnostics will appear here.';list.append(empty);return;}
 for(const item of recent){const row=document.createElement('div');row.className='recent-row';
 const timestamp=document.createElement('time');timestamp.textContent=new Date(item.time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
 const level=document.createElement('span');level.className='recent-severity '+item.level;level.textContent=item.level.toUpperCase();
 const message=document.createElement('span');message.textContent=item.message;row.append(timestamp,level,message);list.append(row);}
}
function updateConnectionHealth(s){const root=$('connection-health');if(!root)return;root.dataset.status=s.connection;
 const label={connected:'Connected',connecting:'Connecting…',disconnecting:'Disconnecting…',disconnected:'Not connected'};
 $('health-title').textContent=label[s.connection]||'Connection status unavailable';
 $('health-subtitle').textContent=s.connection==='connected'?(s.settings.proxyOnly?'Local SOCKS5 proxy is active.':'System VPN tunnel is active.'):s.connection==='connecting'?'Establishing the connection…':s.connection==='disconnecting'?'Closing the active connection…':'Choose a location and connect when you are ready.';
}
function renderLogs() {
  if(!currentState)return;
  const filter=$('log-filter').value,logs=currentState.logs.filter(l=>filter==='all'||l.level===filter).slice().reverse();
  $('log-list').replaceChildren();
  if(!logs.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='No events to show. Your connection activity will appear here.';$('log-list').append(empty);return;}
  for(const log of logs){const row=document.createElement('div');row.className='log-row';const time=document.createElement('span');time.className='log-time';time.textContent=new Date(log.time).toLocaleTimeString('en-GB');const level=document.createElement('span');level.className='log-level '+log.level;level.textContent=log.level;const message=document.createElement('span');message.textContent=log.message;row.append(time,level,message);$('log-list').append(row);}
}
const selectControls=[];
function syncSelects(){for(const control of selectControls)control.sync();}
function setupSelects() {
  for(const select of document.querySelectorAll('select')) {
    const wrapper=document.createElement('div');wrapper.className='select-control';
    select.before(wrapper);wrapper.append(select);select.hidden=true;
    const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';
    trigger.id=select.id+'-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=select.getAttribute('aria-label')||document.querySelector(`label[for="${select.id}"]`)?.textContent||select.closest('label')?.childNodes[0]?.textContent||'Select option';
    trigger.setAttribute('aria-label',label.trim());
    const value=document.createElement('span');trigger.append(value,icon('arrow'));
    const menu=document.createElement('div');menu.className='select-menu';menu.id=select.id+'-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label.trim());menu.hidden=true;
    trigger.setAttribute('aria-controls',menu.id);
    const options=[...select.options].map((option,index)=>{
      const button=document.createElement('button');button.type='button';button.className='select-option';button.id=select.id+'-option-'+index;button.setAttribute('role','option');button.textContent=option.textContent;button.disabled=option.disabled;
      button.addEventListener('click',()=>choose(index));menu.append(button);return button;
    });
    function sync(){value.textContent=select.selectedOptions[0]?.textContent||'';options.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===select.selectedIndex));});trigger.disabled=select.disabled;}
    function close(){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
    function open(){document.dispatchEvent(new Event('close-selects'));menu.hidden=false;trigger.setAttribute('aria-expanded','true');options[select.selectedIndex]?.focus();}
    function choose(index){select.selectedIndex=index;sync();close();trigger.focus();select.dispatchEvent(new Event('change',{bubbles:true}));}
    trigger.addEventListener('click',()=>menu.hidden?open():close());
    wrapper.addEventListener('keydown',event=>{
      const index=options.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();close();trigger.focus();}
      else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(menu.hidden)open();else options[(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();}
      else if(event.key==='Home'||event.key==='End'){if(!menu.hidden){event.preventDefault();options[event.key==='Home'?0:options.length-1].focus();}}
      else if(event.key==='Tab')close();
      else if(event.key.length===1&&!event.ctrlKey&&!event.altKey&&!menu.hidden){const match=options.find(b=>b.textContent.toLowerCase().startsWith(event.key.toLowerCase()));match?.focus();}
    });
    document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
    document.addEventListener('close-selects',close);
    const externalLabel=document.querySelector(`label[for="${select.id}"]`);if(externalLabel)externalLabel.htmlFor=trigger.id;
    select.addEventListener('change',sync);wrapper.append(trigger,menu);selectControls.push({sync});sync();
  }
}
setupSelects();
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));
for(const id of ['account-shortcut','home-account'])$(id).addEventListener('click',()=>navigate('account'));
for(const id of ['choose-location','choose-location-arrow'])$(id).addEventListener('click',()=>navigate('locations'));
$('choose-recommended-home').addEventListener('click',()=> $('recommended').click());
for(const item of document.querySelectorAll('[data-settings-jump]'))item.addEventListener('click',()=>{
 const section=document.getElementById(item.dataset.settingsJump);
 if(section)section.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
});
$('ping-selected').addEventListener('click',action(async()=>{const selected=currentState.activeServer||currentState.servers.find(s=>s.id===currentState.settings.serverId);if(selected)await call('ping',selected.id);}));
$('connect').addEventListener('click',action(async()=>{if(currentState.connection==='disconnected')await window.flushSettings?.();if(!currentState.signedIn){navigate('account');return;}if(currentState.connection==='disconnected'&&!currentState.settings.proxyOnly&&currentState.settings.splitMode==='include'&&!currentState.settings.excludedApps.length){toast('No apps selected. Choose at least one app in Settings > Split tunneling before connecting.');showSplitSettings();return;}await call(currentState.connection==='connected'?'disconnect':currentState.connection==='connecting'?'cancel':'connect');}));
$('theme-toggle').addEventListener('click',action(async()=>{const theme=document.body.classList.contains('light')?'dark':'light';await call('theme',theme);$('theme').value=theme;syncSelects();}));
$('ping-servers').addEventListener('click',action(async()=>{await call('ping');toast('Location latency check complete.');}));
$('source').addEventListener('click',action(()=>call('openLink','source')));
$('view-license').addEventListener('click',action(()=>call('openLink','license')));
$('refresh-servers').addEventListener('click',action(async()=>{$('refresh-servers').disabled=true;try{await call('servers');toast('Locations updated.');}finally{$('refresh-servers').disabled=false;}}));
$('server-search').addEventListener('input',renderServers);
$('server-sort').addEventListener('change',renderServers);
$('recommended').addEventListener('click',action(async()=>{await call('select','REC');navigate('home');}));
$('verify-exit').addEventListener('click',action(async()=>{const result=await call('exit');toast(`Exit verified · ${result.ip} · ${result.country}`);}));
function configureVerification(method){
  needsCode=true;
  const isUnblock=method==='unblock-code',isTotp=method==='totp-2fa',isLink=method==='email';
  $('code-label').hidden=isLink;
  $('code').required=!isLink;$('code').disabled=isLink;$('code').value='';
  $('code').placeholder=isUnblock?'Unblock code from email':isTotp?'Code from authenticator app':'Code from email';
  $('code-instructions').textContent=isUnblock?'The account provider flagged this sign-in and emailed an unblock code. Enter that code to continue.':isTotp?'Enter the current code from your authenticator app.':isLink?'Open the confirmation link emailed by the provider, then return here.':'Enter the verification code sent to your email.';
  $('verify-button').textContent=isLink?'I confirmed my email':'Verify and continue';
  render(currentState);
  if(!isLink)$('code').focus();
}
$('login-form').addEventListener('submit',action(async e=>{
  e.preventDefault();
  const email=$('email').value.trim(),password=$('password').value;
  $('password').value='';
  const result=await call('login',{email,password});
  if(result.needsCode){configureVerification(result.verificationMethod);return;}
  needsCode=false;addingAccount=false;render(await call('state'));
  toast('Your account is ready.');navigate(hasAccountManager()?'account':'home');
}));
$('code-form').addEventListener('submit',action(async e=>{
  e.preventDefault();
  const result=await call('verify',$('code').value);
  $('code').value='';
  if(result.needsCode){configureVerification(result.verificationMethod);return;}
  needsCode=false;addingAccount=false;render(await call('state'));
  toast('Your account is ready.');navigate(hasAccountManager()?'account':'home');
}));
$('captcha-form').addEventListener('submit',action(async e=>{
  e.preventDefault();
  await call('answerCaptcha',$('captcha-answer').value);
  $('captcha-answer').value='';
}));
$('cancel-captcha').addEventListener('click',action(async()=>{
  await call('cancelCaptcha');$('captcha-answer').value='';
}));
$('restart-login').addEventListener('click',action(async()=>{
  if(hasAccountManager())await call('cancelAccountLogin');
  needsCode=false;$('code').value='';render(currentState);
}));
$('logout').addEventListener('click',action(async()=>{await call('logout');needsCode=false;$('account-stats').textContent='Refresh to view your account details and data allowance.';toast('Signed out.');}));
function accountInfo(data) {
  allowanceData={limit:data.quotaLimit!=null&&String(data.quotaLimit).trim()!==''?data.quotaLimit:data.maxBytes,remaining:data.quotaRemaining,reset:data.quotaReset??allowanceData?.reset,unlimited:data.limited_bandwidth===false};
  if(currentState)renderAllowance(currentState);
  const parts=[`Account ID: ${data.uid||'Not reported'}`,`Monthly allowance: ${data.maxBytes==null?'Not reported':bytes(data.maxBytes)}`,`Data remaining: ${!data.limited_bandwidth?'Unlimited':data.quotaRemaining==null?'Not reported':bytes(data.quotaRemaining)}`];
  $('account-stats').replaceChildren(...parts.map(text=>{const p=document.createElement('div');p.textContent=text;return p;}));
}
$('refresh-account').addEventListener('click',action(async()=>accountInfo(await call('account'))));
function readSettings(){
  const settings={...currentState.settings};if(['win32','darwin','linux','android'].includes(currentState.platform))settings.transport=$('transport').value;
  for(const key of ['theme','accentColor','bind','doh','customDns','edge'])settings[key]=$(key).value.trim();
  settings.socksPort=Number($('socksPort').value);for(const key of ['proxyOnly'])settings[key]=$(key).checked;
  settings.excludedApps=[...new Set($('excludedApps').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
   settings.bootstrapSubUrls=readBootstrapSources();
  settings.upstream={enabled:$('upstreamEnabled').checked,type:$('upstreamType').value,host:$('upstreamHost').value.trim(),port:Number($('upstreamPort').value),username:$('upstreamUsername').value,password:$('upstreamPassword').value};
  settings.clearUpstreamPassword=$('clearUpstreamPassword').checked;
  return settings;
}
if(!window.desktopUI)$('settings-form').addEventListener('submit',action(async e=>{
  e.preventDefault();const settings=readSettings();
  await call('settings',settings);$('upstreamPassword').value='';$('clearUpstreamPassword').checked=false;toast('Preferences saved.');
}));
$('view-all-activity').addEventListener('click',()=>navigate('logs'));
$('log-filter').addEventListener('change',renderLogs);
$('clear-logs').addEventListener('click',action(()=>call('clearLogs')));
$('export-logs').addEventListener('click',action(()=>call('exportLogs')));
setupAccountManager();
window.fox.onState(render);
call('state').then(render).catch(e=>toast(e.message));
