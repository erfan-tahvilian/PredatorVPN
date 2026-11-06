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
     // Never silently overwrite a newer account vault or Chromium Local State.
     // Require an explicit, separately verified reconciliation instead.
     const oldVault=path.join(legacy,'vault.bin'),newVault=path.join(target,'vault.bin');
     if(fs.existsSync(oldVault)&&fs.existsSync(newVault)&&fileSha(oldVault)===fileSha(newVault))
       return {status:'already-copied',target,legacy};
     throw Error('Both legacy and new profile directories contain data. Automatic migration stopped to avoid overwriting encrypted accounts.');
   }
   fs.rmdirSync(target); // only verified-empty directory
 }
 // Same-volume rename is atomic: transfer the entire encrypted vault, Chromium
 // Local State, update caches, saved tunnel settings and any future profile files.
 fs.renameSync(legacy,target);
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
   if(status==='moved'&&!fs.existsSync(legacy)){
     try{fs.renameSync(target,legacy);}catch{}
   }
   throw Error('The migrated encrypted account vault could not be verified. Existing account data was preserved; sign-in settings have not been reset.');
 }
 return {verified:true,hasVault:true};
}
module.exports={profileMigration,verifyMigratedProfile,OLD_DIR,NEW_DIR};
