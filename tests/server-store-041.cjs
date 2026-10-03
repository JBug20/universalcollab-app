const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServerStore}=require('../DesktopSource/server-store.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uc-vault-'));
let available=true;
const storage={isEncryptionAvailable:()=>available,getSelectedStorageBackend:()=>available?'kwallet':'basic_text',encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>{if(!available)throw Error();return b.toString().slice(10);}};
try{
 const old={address:'http://localhost:25560',id:'Alice',token:'a'.repeat(32)};
 fs.writeFileSync(path.join(dir,'profile.bin'),storage.encryptString(JSON.stringify(old)));
 const before=fs.readFileSync(path.join(dir,'profile.bin'));
 const store=createServerStore(dir,storage,'linux'),v=store.load();
 assert.equal(v.servers[0].nickname,'My server');assert.equal(v.servers[0].token,old.token);
 assert.deepEqual(fs.readFileSync(path.join(dir,'profile.bin')),before);
 const second={...v.servers[0],key:'second',nickname:'Friends',address:'http://localhost:25561'};
 store.save({...v,servers:[...v.servers,second],selectedKey:'second'});assert.equal(store.load().servers.length,2);
 store.save({...store.load(),selectedKey:''});assert.equal(store.load().selectedKey,'');
 available=false;assert.throws(()=>store.load());assert.throws(()=>store.save(v));
 available=true;assert.equal(store.load().servers.length,2);
 assert.throws(()=>store.save({...v,servers:[v.servers[0],v.servers[0]]}));
 console.log('PASS legacy credential migration, preserved old file, multiple accounts, selection, locked keyring and duplicate validation.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
