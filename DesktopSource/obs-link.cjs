const {createHash,randomUUID}=require('node:crypto');
const WebSocket=require('./vendor/ws');
const sha=s=>createHash('sha256').update(s).digest('base64');
class OBSLink{
 constructor(notify=()=>{}){this.notify=notify;this.meterTime=0;this.meters=false;this.socket=null;this.ready=false;this.pending=new Map();}
 close(){this.ready=false;this.notify({type:"connection",connected:false});this.socket?.close();this.socket=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('OBS disconnected.'));}this.pending.clear();}
 async connect({port=4455,password=''}){if(!Number.isInteger(port)||port<1||port>65535||typeof password!=='string'||password.length>512)throw Error('Invalid OBS connection settings.');this.close();const ws=new WebSocket('ws://127.0.0.1:'+port,{maxPayload:4*1024*1024});this.socket=ws;
  return new Promise((resolve,reject)=>{let settled=false;const timer=setTimeout(()=>fail(),10000);const fail=()=>{if(this.socket===ws)this.close();if(!settled){settled=true;clearTimeout(timer);reject(Error('Could not connect to OBS. Enable WebSocket Server in OBS Tools and check its port/password.'));}};
   ws.on('error',fail);ws.on('close',()=>{if(this.socket===ws){this.ready=false;this.notify({type:"connection",connected:false});for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('OBS disconnected.'));}this.pending.clear();}if(!settled)fail();});
   ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.op===0){const a=m.d.authentication;ws.send(JSON.stringify({op:1,d:{rpcVersion:1,eventSubscriptions:this.subscriptions(),...(a?{authentication:sha(sha(password+a.salt)+a.challenge)}:{})}}));}
    if(m.op===2&&!settled){if(this.socket!==ws)return fail();settled=true;this.ready=true;clearTimeout(timer);this.notify({type:"connection",connected:true});resolve({connected:true});}
    if(m.op===5){const type=m.d.eventType;if(type==='InputVolumeMeters'){if(Date.now()-this.meterTime>=100){this.meterTime=Date.now();this.notify({type:'meters',inputs:(m.d.eventData?.inputs||[]).slice(0,64).map(i=>({name:i.inputName,level:Math.max(0,...(i.inputLevelsMul||[]).map(c=>Number(c[1])||0))}))});}}else if(/^(CurrentProgramSceneChanged|SceneListChanged|SceneItem.*|InputMuteStateChanged|InputVolumeChanged|StreamStateChanged|RecordStateChanged)$/.test(type))this.notify({type:'changed'});}
    if(m.op===7){const p=this.pending.get(m.d.requestId);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.d.requestId);m.d.requestStatus.result?p.resolve(m.d.responseData||{}):p.reject(Error('OBS rejected '+p.type+'. Check that streaming is stopped and the selected OBS profile supports this action.'));}
   }catch{fail();}});
  });
 }
 // 1023 = every normal event group except UI; 65536 = InputVolumeMeters (high volume, so only while the mixer is visible).
 subscriptions(){return 1023|(this.meters?65536:0);}
 subscribe(meters){this.meters=!!meters;if(this.ready)this.socket.send(JSON.stringify({op:3,d:{eventSubscriptions:this.subscriptions()}}));}
 request(type,data={}){if(!this.ready||!this.socket)return Promise.reject(Error('Connect OBS first.'));return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(Error('OBS did not respond.'));},8000);this.pending.set(id,{resolve,reject,timer,type});this.socket.send(JSON.stringify({op:6,d:{requestType:type,requestId:id,requestData:data}}),e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(Error('OBS disconnected.'));}});});}
 async idle(){if((await this.request('GetStreamStatus')).outputActive)throw Error('Stop OBS streaming before changing its destination.');}
 async configure(server,key,backup){const old=await this.request('GetStreamServiceSettings');if(old.streamServiceSettings?.server===server&&old.streamServiceSettings?.key===key)return {configured:true};await this.idle();await backup(old);await this.request('SetStreamServiceSettings',{streamServiceType:'rtmp_custom',streamServiceSettings:{server,key}});const check=await this.request('GetStreamServiceSettings');if(check.streamServiceSettings.server!==server||check.streamServiceSettings.key!==key)throw Error('OBS settings could not be verified.');return {configured:true};}
 async start(server,key){const s=await this.request('GetStreamServiceSettings');if(s.streamServiceSettings.server!==server||s.streamServiceSettings.key!==key)throw Error('Configure OBS for this relay first.');await this.request('StartStream');return {started:true};}
}
module.exports={OBSLink};
