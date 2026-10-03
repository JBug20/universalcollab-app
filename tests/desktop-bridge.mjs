import vm from 'node:vm';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
import {PortalStore} from '../../universalcollab-relay/src/portal-store.mjs';import {createPortalServer} from '../../universalcollab-relay/src/portal-server.mjs';
const require=createRequire(import.meta.url),dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-bridge-'));let server,ready,window,encrypted=true;const handlers=new Map();
try{
 const store=new PortalStore({directory:dir+'/server'}),user=store.register('Alice',store.joinPassword);
 server=await createPortalServer({config:{port:0,bind:'127.0.0.1',publicOrigin:''},store,status:id=>({id,state:'ready'}),action:async()=>{},changed:()=>{},busy:()=>false,validateDestination:async()=>{},rtmpPort:1935});
 const origin='http://127.0.0.1:'+server.server.address().port;
 const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'../DesktopSource');let copied='',obsActive=false,obsDestination={streamServiceType:'rtmp_common',streamServiceSettings:{server:'rtmp://previous/live',key:'previous'}},obsStarts=0;const {OBSLink}=require('../DesktopSource/obs-link.cjs');class TestOBS extends OBSLink{async connect(){this.ready=true;return {connected:true};}async request(type,data){if(type==='GetVersion')return {availableRequests:['GetVersion']};if(type==='GetStreamStatus')return {outputActive:obsActive};if(type==='GetStreamServiceSettings')return structuredClone(obsDestination);if(type==='SetStreamServiceSettings'){obsDestination=structuredClone(data);return {};}if(type==='StartStream'){obsStarts++;obsActive=true;return {};}throw Error('Unexpected OBS test request: '+type);}}
 const electron={app:{setName(){},setPath(){},whenReady:()=>({then:fn=>{ready=fn}}),getPath:()=>dir+'/client',on(){},quit(){}},BrowserWindow:class{constructor(){window=this;this.webContents={setWindowOpenHandler(){},on(){},send(){}};}setMenu(){}loadFile(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},clipboard:{writeText:text=>copied=text},safeStorage:{isEncryptionAvailable:()=>encrypted,getSelectedStorageBackend:()=>encrypted?'kwallet':'basic_text',encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}}}};
 vm.runInNewContext(fs.readFileSync(root+'/main.cjs','utf8'),{require:n=>n==='electron'?electron:n==='./obs-link.cjs'?{OBSLink:TestOBS}:n.startsWith('./')?require(root+'/'+n.slice(2)):require(n),__dirname:root,process:{platform:'linux'},fetch,URL,AbortSignal,Buffer,console});ready();
 const sender={sender:window.webContents,senderFrame:{url:pathToFileURL(root+'/portal.html').href}};
 const call=(name,...args)=>handlers.get(name)(sender,...args);
 const profile={address:origin,id:user.id,token:user.controlToken};
 assert.equal((await call('relay-request',{address:origin,route:'/api/v3/view',token:user.id+':'+user.controlToken})).data.me.id,user.id);
 assert.equal((await call('relay-request',{address:origin,route:'/api/v3/settings',token:user.id+':'+user.controlToken,body:{overlays:[],fallback:[]}})).ok,true);
 assert.equal((await call('relay-request',{address:origin,route:'/unauthorized',token:''})).ok,false);
 assert.equal((await call('relay-request',{address:'rtmp://private.test',route:'/api/v3/view',token:''})).ok,false);
 const bad=await call('relay-request',{address:origin,route:'/api/v3/view',token:'Alice:wrong_token_12345678901234567890'});assert(!bad.ok);assert(!bad.error.includes(user.controlToken));
 call('relay-save',profile);assert.equal(call('servers-load').servers[0].id,'Alice');assert.equal(call('local-profile-load'),null);call('local-profile-save',{schemaVersion:1,displayName:'Local Alice'});assert.equal(call('local-profile-load').displayName,'Local Alice');assert.equal(JSON.stringify(call('relay-load')),JSON.stringify(profile));call('relay-copy','copyme');assert.equal(copied,'copyme');
 const saved=call('servers-load'),key=saved.selectedKey;
 assert((await call('obs-command','connect',{port:4455})).ok);
 assert(!(await call('obs-command','configure',{serverKey:'wrong'})).ok);
 encrypted=false;const configured=await call('obs-command','configure',{serverKey:key});assert(configured.ok,configured.error);assert.equal(obsDestination.streamServiceSettings.key,user.inputKey);
 assert(!(await call('obs-command','start',{serverKey:key,automatic:true})).ok);assert.equal(obsStarts,0);
 store.setDestination(user.id,'rtmp://destination/live','destinationkey');
 const start=await call('obs-command','start',{serverKey:key,automatic:true});assert(start.ok,start.error);assert.equal(obsStarts,1);
 obsDestination.streamServiceSettings.key='changed-while-live';assert(!(await call('obs-command','configure',{serverKey:key})).ok);assert.equal(obsDestination.streamServiceSettings.key,'changed-while-live');
 obsActive=false;assert((await call('obs-command','restore')).ok);assert.equal(obsDestination.streamServiceSettings.key,'previous');
 const manual=await call('obs-command','start',{serverKey:key,automatic:false});assert(!manual.ok);assert.equal(obsDestination.streamServiceSettings.key,'previous');
 const automatic=await call('obs-command','start',{serverKey:key,automatic:true});assert(automatic.ok,automatic.error);assert.equal(obsDestination.streamServiceSettings.key,user.inputKey);assert.equal(obsStarts,2);
 console.log('PASS native command routing: selected relay verification, automatic configure/start, no start without destinations, active stream guard, manual mode, session restore without keyring.');
 encrypted=false;assert.throws(()=>call('relay-save',profile));call('relay-clear');assert.equal(call('local-profile-load').displayName,'Local Alice');assert.equal(call('relay-load'),null);
 assert.throws(()=>handlers.get('relay-copy')({sender:window.webContents,senderFrame:{url:'http://evil.test'}},'bad'));
 console.log('PASS desktop bridge HTTP API, command methods, scoped token, route/origin validation, saved profile interface, missing-keyring handling, copy and untrusted IPC rejection. Native OS keyring/UI not simulated.');
}finally{await server?.close();fs.rmSync(dir,{recursive:true,force:true});}
