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
    assert.match(content,/docs\/readme\/workspace-v205-dark\.webp/,name);
    assert.doesNotMatch(content,/View original desktop screenshot|View Android screenshot|docs\/screenshots\/desktop-v205-overview-dark\.png/,name);
    assert.match(content,/assets\/logo\.png/,name);
  }
});
test('automated bootstrap list refresh never commits as github-actions bot',()=>{
  const workflow=read('.github/workflows/bootstrap-refresh.yml');
  assert.match(workflow,/git config user\.name "erfan-tahvilian"/);
  assert.match(workflow,/git config user\.email "198095948\+erfan-tahvilian@users\.noreply\.github\.com"/);
  assert.doesNotMatch(workflow,/git config user\.(?:name|email) [^\n]*github-actions\[bot\]/);
});

test('bootstrap mirror refresh runs hourly and preserves the last good list on errors',()=>{
  const workflow=read('.github/workflows/bootstrap-refresh.yml');
  assert(workflow.includes("cron: '17 * * * *'"));
  assert(workflow.includes('group: predator-bootstrap-refresh'));
  assert(workflow.includes('cancel-in-progress: false'));
  assert(workflow.includes('secrets.PREDATOR_BOOTSTRAP_SUB_URL'));
  assert(workflow.includes('docs/bootstrap/working-nodes.txt'));
  assert(workflow.includes('if git diff --cached --quiet'));
  assert(workflow.includes('if not nodes:'));
});

test('registration and provider-account outbound links are absent, transport identity remains intact',()=>{
  const html=read('src/ui/index.html'),renderer=read('src/ui/app.js'),main=read('src/main.cjs');
  assert.doesNotMatch(html,/id="create-account"|id="manage-account"/);
  assert.doesNotMatch(renderer,/\$\('create-account'\)|\$\('manage-account'\)/);
  assert.doesNotMatch(main,/accountSettings:|account:'https:\/\/accounts\./);
  assert.match(read('src/lib/auth.cjs'),/https:\/\/api\.accounts\.firefox\.com\/v1/);
  assert.match(html,/third-party identity provider/);
});