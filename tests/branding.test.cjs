// SPDX-License-Identifier: GPL-3.0-or-later
// Keep upcoming brand migration from re-introducing upstream marketing links.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('public documentation and interface avoid upstream brand promotion',()=>{
  for(const name of ['README.md','README.fa.md','RELEASE_NOTES.md','src/ui/index.html','src/ui/app.js','src/ui/accounts-ui.js','package.json']){
    const content=read(name);
    assert.doesNotMatch(content,/firefox|mozilla|فایرفاکس|موزیلا|accounts\.firefox\.com\/signup/i,name);
  }
  for(const name of ['README.md','README.fa.md']){
    const content=read(name);
    // Deprecated generic mockups must stay unreferenced; v2.0.5 now uses
    // real app screenshots framed in the four responsive workspace images.
    assert.doesNotMatch(content,/docs\/readme\/hero-|docs\/readme\/workspace-(?!v205-)/,name);
    assert.match(content,/docs\/readme\/workspace-v205-cinematic\.png/,name);
    assert.doesNotMatch(content,/View original desktop screenshot|View Android screenshot|docs\/screenshots\/desktop-v205-overview-dark\.png/,name);
    assert.match(content,/assets\/logo\.png/,name);
  }
});
test('unused in-repository bootstrap feed and hourly refresh are retired',()=>{
  const root=path.join(__dirname,'..');
  assert.equal(fs.existsSync(path.join(root,'.github/workflows/bootstrap-refresh.yml')),false);
  assert.equal(fs.existsSync(path.join(root,'docs/bootstrap/working-nodes.txt')),false);
  const settings=read('src/lib/settings.cjs');
  assert.match(settings,/DEFAULT_BOOTSTRAP_URLS=\['https:\/\/raw\.githubusercontent\.com\/0xRadikal\/Free-v2ray-Configs\/main\/top100\.txt'\]/);
  // Older subscription URLs remain recognized only for migration of saved settings.
  assert.match(settings,/RETIRED_BOOTSTRAP_URLS/);
});

test('registration and provider-account outbound links are absent, transport identity remains intact',()=>{
  const html=read('src/ui/index.html'),renderer=read('src/ui/app.js'),main=read('src/main.cjs');
  assert.doesNotMatch(html,/id="create-account"|id="manage-account"/);
  assert.doesNotMatch(renderer,/\$\('create-account'\)|\$\('manage-account'\)/);
  assert.doesNotMatch(main,/accountSettings:|account:'https:\/\/accounts\./);
  assert.match(read('src/lib/auth.cjs'),/https:\/\/api\.accounts\.firefox\.com\/v1/);
  assert.match(html,/third-party identity provider/);
});