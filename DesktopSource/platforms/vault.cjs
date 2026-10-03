'use strict';
const fs=require('node:fs'),path=require('node:path');
exports.createVault=(directory,safeStorage,platform=process.platform)=>{
 const file=path.join(directory,'platform-accounts-v1.bin');
 const ready=()=>{if(!safeStorage.isEncryptionAvailable()||(platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('Unlock your desktop keyring to use platform accounts.');};
 return {load(){if(!fs.existsSync(file))return {version:1,clients:{},accounts:{}};ready();try{const v=JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));if(v.version!==1||!v.clients||!v.accounts)throw Error();return v;}catch{throw Error('Platform accounts could not be unlocked. Existing data was kept.');}},save(value){ready();fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(file+'.tmp',file);}};
};
