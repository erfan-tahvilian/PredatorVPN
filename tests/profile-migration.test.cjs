// SPDX-License-Identifier: GPL-3.0-or-later
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {profileMigration,verifyMigratedProfile,OLD_DIR,NEW_DIR}=require('../src/lib/profile-migration.cjs');
const safe={isEncryptionAvailable:()=>true,decryptString:buffer=>buffer.toString('utf8')};
function sandbox(callback){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'predator-migrate-'));
 try{return callback(root);}
 finally{fs.rmSync(root,{force:true,recursive:true});}
}
test('atomic directory rename preserves complete profile, encrypted vault and nested files',()=>sandbox(root=>{
 const old=path.join(root,OLD_DIR),dest=path.join(root,NEW_DIR);
 fs.mkdirSync(path.join(old,'Network'),{recursive:true});
 fs.mkdirSync(dest);
 fs.writeFileSync(path.join(old,'vault.bin'),JSON.stringify({accounts:[{id:'fixture'}]}));
 fs.writeFileSync(path.join(old,'tunnel.json'),'fixture settings');
 fs.writeFileSync(path.join(old,'Network','Cookies'),'fixture cookies');
 const result=profileMigration(root);
 assert.equal(result.status,'moved');
 assert.equal(result.target,dest);
 assert.equal(fs.existsSync(old),false);
 assert.equal(fs.existsSync(path.join(dest,'vault.bin')),true);
 assert.equal(fs.readFileSync(path.join(dest,'tunnel.json'),'utf8'),'fixture settings');
 assert.equal(fs.readFileSync(path.join(dest,'Network','Cookies'),'utf8'),'fixture cookies');
 assert.deepEqual(verifyMigratedProfile(result,safe),{verified:true,hasVault:true});
 assert.equal(profileMigration(root).status,'already-new');
}));
test('encrypted vault conflicts do not overwrite old or new accounts',()=>sandbox(root=>{
 const old=path.join(root,OLD_DIR),dest=path.join(root,NEW_DIR);
 fs.mkdirSync(old);fs.mkdirSync(dest);
 fs.writeFileSync(path.join(old,'vault.bin'),JSON.stringify({activeAccountId:'legacy'}));
 fs.writeFileSync(path.join(dest,'vault.bin'),JSON.stringify({activeAccountId:'new'}));
 assert.throws(()=>profileMigration(root),/Automatic migration stopped/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(old,'vault.bin'))).activeAccountId,'legacy');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dest,'vault.bin'))).activeAccountId,'new');
}));
test('legacy data is restored on migration validation failure when possible',()=>sandbox(root=>{
 const old=path.join(root,OLD_DIR);fs.mkdirSync(old);
 fs.writeFileSync(path.join(old,'vault.bin'),'corrupted fixture');
 const result=profileMigration(root);
 assert.throws(()=>verifyMigratedProfile(result,safe),/could not be verified/);
 assert.equal(fs.readFileSync(path.join(old,'vault.bin'),'utf8'),'corrupted fixture');
}));
test('matched legacy vaults preserve both directories without deleting live user data',()=>sandbox(root=>{
 const old=path.join(root,OLD_DIR),dest=path.join(root,NEW_DIR);
 fs.mkdirSync(old);fs.mkdirSync(dest);
 const payload=JSON.stringify({activeAccountId:'shared'});
 fs.writeFileSync(path.join(old,'vault.bin'),payload);
 fs.writeFileSync(path.join(dest,'vault.bin'),payload);
 const result=profileMigration(root);
 assert.equal(result.status,'already-copied');
 assert.deepEqual(verifyMigratedProfile(result,safe),{verified:true,hasVault:true});
 assert(fs.existsSync(old));
 assert(fs.existsSync(dest));
}));
test('profile migration never follows symlinked legacy directories',()=>sandbox(root=>{
 const real=path.join(root,'actual'),legacy=path.join(root,OLD_DIR);
 fs.mkdirSync(real);
 try{fs.symlinkSync(real,legacy,'junction');}catch{return;}
 assert.throws(()=>profileMigration(root),/regular directory/);
 assert(fs.existsSync(real));
}));
