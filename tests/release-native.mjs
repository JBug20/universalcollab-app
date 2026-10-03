import vm from 'node:vm';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
import {PortalStore} from '../../universalcollab-relay/src/portal-store.mjs';import {createPortalServer} from '../../universalcollab-relay/src/portal-server.mjs';
const require=createRequire(import.meta.url),dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-bridge-'));let server,ready,window,encrypted=true;const handlers=new Map();
try{
 const store=new PortalStore({directory:dir+'/server'}),user=store.register('Alice',store.joinPassword);
 server=await createPortalServer({config:{port:0,bind:'127.0.0.1',publicOrigin:''},store,status:id=>({id,state:'ready'}),action:async()=>{},changed:()=>{},busy:()=>false,validateDestination:async()=>{},rtmpPort:1935});
 const origin='http://127.0.0.1:'+server.server.address().port;
 const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../DesktopSource');let copied='';
 const electron={dialog:{showSaveDialog:async()=>({filePath:dir+'/backup.ucbackup'}),showOpenDialog:async()=>({filePaths:[dir+'/backup.ucbackup']}),showMessageBox:async()=>({response:1})},app:{setName(){},setPath(){},whenReady:()=>({then:fn=>{ready=fn}}),getPath:()=>dir+'/client',on(){},quit(){}},BrowserWindow:class{constructor(){window=this;this.webContents={setWindowOpenHandler(){},on(){}};}setMenu(){}loadFile(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},clipboard:{writeText:text=>copied=text},safeStorage:{isEncryptionAvailable:()=>encrypted,getSelectedStorageBackend:()=>encrypted?'kwallet':'basic_text',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 vm.runInNewContext(fs.readFileSync(root+'/main.cjs','utf8'),{require:n=>n==='electron'?electron:n.startsWith('./')?require(root+'/'+n.slice(2)):require(n),__dirname:root,process:{platform:'linux'},fetch,URL,AbortSignal,Buffer,console});ready();
 const sender={sender:window.webContents,senderFrame:{url:pathToFileURL(root+'/portal.html').href}};
 const call=(name,...args)=>handlers.get(name)(sender,...args);
 const profile={address:origin,id:user.id,token:user.controlToken};
 assert.equal((await call('relay-request',{address:origin,route:'/api/v3/view',token:user.id+':'+user.controlToken})).data.me.id,user.id);
 assert.equal((await call('relay-request',{address:origin,route:'/api/v3/settings',token:user.id+':'+user.controlToken,body:{overlays:[],fallback:[]}})).ok,true);
 assert.equal((await call('relay-request',{address:origin,route:'/unauthorized',token:''})).ok,false);
 assert.equal((await call('relay-request',{address:'rtmp://private.test',route:'/api/v3/view',token:''})).ok,false);
 const bad=await call('relay-request',{address:origin,route:'/api/v3/view',token:'Alice:wrong_token_12345678901234567890'});assert(!bad.ok);assert(!bad.error.includes(user.controlToken));
 call('relay-save',profile);assert.equal(call('servers-load').servers[0].id,'Alice');assert.equal(call('local-profile-load'),null);call('local-profile-save',{schemaVersion:1,displayName:'Local Alice'});assert.equal(call('local-profile-load').displayName,'Local Alice');assert.equal(JSON.stringify(call('relay-load')),JSON.stringify(profile));call('relay-copy','copyme');assert.equal(copied,'copyme');

 const saved=call('servers-load');
 const custom=await call('studio-command','custom',{name:'Custom test',url:'rtmp://example.com/live',key:'PRIVATE_DESTINATION_KEY'});assert(custom.ok);
 const customId=custom.data.custom[0].id;
 const prepared=await call('studio-command','prepare',{serverKey:saved.selectedKey,draft:{id:'12345678-1234-1234-1234-123456789abc',title:'Private test',description:'',sync:true,selected:[customId],record:false}});
 assert(prepared.ok,JSON.stringify(prepared));assert.equal(store.get('Alice').production.destinations[0].key,'PRIVATE_DESTINATION_KEY');assert(!JSON.stringify(prepared).includes('PRIVATE_DESTINATION_KEY'));assert(!JSON.stringify(prepared).includes('rtmp://example.com'));
 assert.equal((await call('studio-command','prepare',{serverKey:'wrong',draft:{}})).ok,false);
 const draft={id:'22345678-1234-1234-1234-123456789abc',title:'Retry test',description:'',sync:true,selected:[customId],record:false};
 const {StudioService}=require(root+'/platforms/studio.cjs'),{PlatformError}=require(root+'/platforms/service.cjs');const prepare=StudioService.prototype.prepare;
 StudioService.prototype.prepare=async()=>{throw new PlatformError('Simulated permission failure');};
 const failed=await call('studio-command','prepare',{serverKey:saved.selectedKey,draft});assert(!failed.ok);assert.equal(store.get('Alice').production,null);assert.equal(store.get('Alice').destinationStreamKey,'');
 StudioService.prototype.prepare=prepare;
 const setter=store.setProduction;store.setProduction=()=>true;
 const mismatch=await call('studio-command','prepare',{serverKey:saved.selectedKey,draft});assert(!mismatch.ok);assert.match(mismatch.error,/could not be confirmed/);
 store.setProduction=setter;assert((await call('studio-command','prepare',{serverKey:saved.selectedKey,draft})).ok);
 console.log('PASS failed preparation clears previous destination; missing server write cannot report Ready; retry saves and verifies.');

 console.log('PASS native studio bridge selects saved relay, commits private custom key, returns no ingest credentials, rejects unknown server.');

 const password='a-private-backup-password',workspace={'universalcollab-workspace-v1':JSON.stringify({compact:true})};
 const exported=await call('backup-command','export',{password,workspace});assert(exported.ok,exported.error);
 const encryptedFile=fs.readFileSync(dir+'/backup.ucbackup','utf8');assert(!encryptedFile.includes(user.controlToken));assert(!encryptedFile.includes('PRIVATE_DESTINATION_KEY'));
 call('local-profile-save',{schemaVersion:1,displayName:'Changed'});
 const wrong=await call('backup-command','import',{password:'incorrect-password'});assert(!wrong.ok);assert.equal(call('local-profile-load').displayName,'Changed');
 const restored=await call('backup-command','import',{password});assert(restored.ok,restored.error);assert(restored.data.restored);assert.equal(call('local-profile-load').displayName,'Local Alice');assert.deepEqual(restored.data.workspace,workspace);assert.equal(call('servers-load').servers[0].id,'Alice');
 console.log('PASS native encrypted backup dialogs, wrong-password no-change, restored account/platform/workspace and secret-free output.');
 encrypted=false;assert.throws(()=>call('relay-save',profile));call('relay-clear');assert.equal(call('local-profile-load').displayName,'Local Alice');assert.equal(call('relay-load'),null);
 assert.throws(()=>handlers.get('relay-copy')({sender:window.webContents,senderFrame:{url:'http://evil.test'}},'bad'));
 console.log('PASS desktop bridge HTTP API, command methods, scoped token, route/origin validation, saved profile interface, missing-keyring handling, copy and untrusted IPC rejection. Native OS keyring/UI not simulated.');
}finally{await server?.close();fs.rmSync(dir,{recursive:true,force:true});}
