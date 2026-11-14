'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=f=>fs.readFileSync(path.join(root,f),'utf8');
test('Android sign-in renderer supports legacy WebView without Object.hasOwn',()=>{
 const app=source('src/ui/app.js');
 assert(!app.includes('Object.hasOwn('));
 const a=app.indexOf('function setAccent('), b=app.indexOf("for(const button of document.querySelectorAll('[data-accent]'))button.addEventListener",a);
 assert(a>=0&&b>a);
 const colors=app.match(/const ACCENTS=\{[\s\S]*?\};/)[0];
 const sandbox={document:{body:{dataset:{}},querySelectorAll:()=>[]},Object:{prototype:{hasOwnProperty:Object.prototype.hasOwnProperty}}};
 vm.runInNewContext(colors+'\n'+app.slice(a,b)+';setAccent("gold",false);',sandbox);
 assert.equal(sandbox.document.body.dataset.accent,'gold');
 const store=source('src/lib/store.cjs');
 assert(!store.includes('Object.hasOwn('));
});
test('Light theme latency chips are accessible, dark theme remains unchanged',()=>{
 const shared=source('src/ui/theme-v2.css');
 for(const type of ['fast','moderate','slow']){
  assert(shared.includes('body.light .latency.'+type));
  assert(/body\.light \.latency\.(fast|moderate|slow)\{color:#[0-9a-f]{6};background:#[0-9a-f]{6};border-color:#[0-9a-f]{6}\}/i.test(shared));
 }
 assert(source('src/ui/styles.css').includes('.latency.fast{color:#22c55e;background:#102417'));
 assert(source('android/ui/mobile-v2.css').includes('#locations .latency'));
});
test('Green connected power button wins over accent and mobile CSS selectors',()=>{
 const css=source('src/ui/theme-v2.css');
 for(const selector of [
  'body #home .power-button.connected{',
  'body #home .power-button.connected svg,',
  'body #home .power-button.connected::after{color:#092d1c!important}'
 ])assert(css.includes(selector));
 assert(css.includes('background:linear-gradient(145deg,#62e6a1,#21ae6d)!important'));
 assert(!css.includes('body #home .power-button.connecting{'));
 assert(source('android/ui/mobile-v2.css').includes('#home .power-button.connected'));
 const app=source('src/ui/app.js');
 assert(app.includes("$('connect').className='power-button '+s.connection"));
});
test('v2.0.6 public notes and signed-Android version match',()=>{
 const version=require('../package.json').version;
 assert.equal(version,'2.0.6');
 assert.equal(require('../release-notes.json').version,version);
 assert(source('android/core/mobile/updates.go').includes('const appVersion = "2.0.6"'));
 const release=source('RELEASE_NOTES.md');
 assert(release.includes('<!-- predatorvpn-downloads:start -->'));
 assert(release.includes('PredatorVPN-2.0.6-Android-arm64-v8a.apk'));
 assert(release.includes('PredatorVPN-2.0.6-Windows-x64.exe'));
});
