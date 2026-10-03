'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function clean(v){
 if(!v||v.schemaVersion!==1||!Array.isArray(v.servers)||v.servers.length>30)throw Error('Invalid server list.');
 const keys=new Set();
 const servers=v.servers.map(s=>{
  const u=new URL(s.address);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||
   typeof s.key!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(s.key)||keys.has(s.key)||
   typeof s.nickname!=='string'||!s.nickname.trim()||s.nickname.trim().length>48||
   !/^[A-Za-z0-9_-]{1,32}$/.test(s.id)||!/^[A-Za-z0-9_-]{24,64}$/.test(s.token))throw Error('Invalid saved server.');
  keys.add(s.key);return {key:s.key,nickname:s.nickname.trim(),address:u.origin,id:s.id,token:s.token};
 });
 return {schemaVersion:1,servers,selectedKey:keys.has(v.selectedKey)?v.selectedKey:''};
}
exports.clean=clean;
exports.createServerStore=(directory,safeStorage,platform)=>{
 const file=path.join(directory,'servers-v1.bin'),legacy=path.join(directory,'profile.bin');
 function write(v){
  const result=clean(v);
  if(!safeStorage.isEncryptionAvailable()||(platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw Error('Unlock your desktop keyring to save servers.');
  fs.mkdirSync(directory,{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup');
  fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(result)),{mode:0o600});fs.renameSync(file+'.tmp',file);return result;
 }
 return {save:write,load(){
  if(fs.existsSync(file))return clean(JSON.parse(safeStorage.decryptString(fs.readFileSync(file))));
  if(!fs.existsSync(legacy))return {schemaVersion:1,servers:[],selectedKey:''};
  const old=JSON.parse(safeStorage.decryptString(fs.readFileSync(legacy)));
  const key=crypto.randomUUID(),v={schemaVersion:1,servers:[{...old,key,nickname:'My server'}],selectedKey:key};
  // Keep profile.bin intact for rollback. A failed migration never overwrites it.
  return write(v);
 }};
};

exports.validate=clean;
