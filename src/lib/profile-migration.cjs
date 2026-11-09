// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Erfan Tahvilian
// Safely migrate the old Electron profile before Chromium opens any storage.
// Windows DPAPI/safeStorage and Chromium profile state are preserved together.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const OLD_DIR='Fox VPN';
const NEW_DIR='Predator VPN';
function fileSha(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function isRetryableMoveError(error){
  return error&&['EPERM','EACCES','EBUSY','EXDEV','EEXIST'].includes(error.code);
}
function copyDirectorySync(source,destination){
  fs.mkdirSync(destination,{recursive:true});
  for(const name of fs.readdirSync(source)){
    const from=path.join(source,name),to=path.join(destination,name);
    const stat=fs.lstatSync(from);
    if(stat.isSymbolicLink())continue;
    if(stat.isDirectory())copyDirectorySync(from,to);
    else fs.copyFileSync(from,to);
  }
}
// Prefer an atomic rename. On Windows a locked Chromium/antivirus handle often
// returns EPERM; fall back to copy + best-effort remove so startup never dies.
function moveDirectory(source,destination){
  try{
    fs.renameSync(source,destination);
    return 'renamed';
  }catch(error){
    if(!isRetryableMoveError(error))throw error;
    if(fs.existsSync(destination)){
      const entries=fs.readdirSync(destination);
      if(entries.length)throw error;
      fs.rmdirSync(destination);
    }
    copyDirectorySync(source,destination);
    try{fs.rmSync(source,{recursive:true,force:true});}catch{}
    return 'copied';
  }
}
function retireDirectory(dir,suffix='.migrated'){
  const backup=dir+suffix;
  if(fs.existsSync(backup))fs.rmSync(backup,{recursive:true,force:true});
  moveDirectory(dir,backup);
  return backup;
}
function profileMigration(appData,{legacyName=OLD_DIR,productName=NEW_DIR}={}){
 const legacy=path.join(appData,legacyName),target=path.join(appData,productName);
 if(path.resolve(legacy)===path.resolve(target))throw Error('Profile migration destination equals the legacy profile.');
 if(!fs.existsSync(legacy))return {status:'already-new',target};
 const stat=fs.lstatSync(legacy);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('The legacy profile is not a regular directory. Migration stopped to protect account data.');
 if(fs.existsSync(target)){
   const dst=fs.lstatSync(target);
   if(!dst.isDirectory()||dst.isSymbolicLink())throw Error('The new profile path is not a regular directory.');
   const entries=fs.readdirSync(target);
   if(entries.length){
     const oldVault=path.join(legacy,'vault.bin'),newVault=path.join(target,'vault.bin');
     const hasOld=fs.existsSync(oldVault),hasNew=fs.existsSync(newVault);
     // Identical vaults: keep the product profile and retire the leftover legacy
     // tree so a later vault update cannot turn this into a hard conflict.
     if(hasOld&&hasNew&&fileSha(oldVault)===fileSha(newVault)){
       try{retireDirectory(legacy);}catch{}
       return {status:'already-copied',target,legacy};
     }
     // Only the active product profile holds accounts. Retire stale legacy files
     // left behind after a previous successful copy or partial rename.
     if(hasNew&&!hasOld){
       try{retireDirectory(legacy);}catch{}
       return {status:'prefer-new',target,legacy};
     }
     // Legacy still owns the vault; the product directory is only Chromium noise
     // or an empty seed from a failed earlier launch. Replace the seed.
     if(hasOld&&!hasNew){
       fs.rmSync(target,{recursive:true,force:true});
       moveDirectory(legacy,target);
       return {status:'moved',target,legacy};
     }
     // Different vaults in both places: keep the newer vault as the live profile.
     if(hasOld&&hasNew){
       const oldTime=fs.statSync(oldVault).mtimeMs,newTime=fs.statSync(newVault).mtimeMs;
       if(newTime>=oldTime){
         try{retireDirectory(legacy);}catch{}
         return {status:'prefer-new',target,legacy};
       }
       try{retireDirectory(target,'.superseded');}catch{fs.rmSync(target,{recursive:true,force:true});}
       moveDirectory(legacy,target);
       return {status:'moved',target,legacy};
     }
     // Neither directory has an account vault. Prefer the product path.
     try{retireDirectory(legacy);}catch{}
     return {status:'prefer-new',target,legacy};
   }
   fs.rmdirSync(target); // only verified-empty directory
 }
 // Same-volume rename is preferred; Windows may require a copy when files are locked.
 moveDirectory(legacy,target);
 return {status:'moved',target,legacy};
}
function verifyMigratedProfile({target,legacy,status},safeStorage){
 const vault=path.join(target,'vault.bin');
 if(!fs.existsSync(vault))return {verified:true,hasVault:false};
 if(!safeStorage?.isEncryptionAvailable?.())throw Error('System encryption is not available to verify migrated accounts.');
 try{
   const data=JSON.parse(safeStorage.decryptString(fs.readFileSync(vault)));
   if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Unexpected vault schema');
 }catch{
   // Only undo an atomic move. Never overwrite or remove other data.
   if(status==='moved'&&legacy&&!fs.existsSync(legacy)){
     try{moveDirectory(target,legacy);}catch{}
   }
   throw Error('The migrated encrypted account vault could not be verified. Existing account data was preserved; sign-in settings have not been reset.');
 }
 return {verified:true,hasVault:true};
}
module.exports={profileMigration,verifyMigratedProfile,retireDirectory,moveDirectory,OLD_DIR,NEW_DIR};
