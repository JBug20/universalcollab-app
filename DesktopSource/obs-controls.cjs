'use strict';
const name=v=>{if(typeof v!=='string'||!v.trim()||v.length>512)throw Error('Choose a valid OBS name.');return v;};
const num=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error('OBS value is outside its allowed range.');return v;};
const bool=v=>{if(typeof v!=='boolean')throw Error('Invalid checkbox value.');return v;};
class OBSControls {
 constructor(link){this.link=link;this.available=null;}
 async call(type,data={}){if(this.available&&!this.available.has(type))throw Error('This OBS version does not support '+type+'.');return this.link.request(type,data);}
 async init(){const v=await this.link.request('GetVersion');this.available=new Set(v.availableRequests||[]);return {connected:true,version:v.obsVersion,available:[...this.available]};}
 async quiet(){for(const t of ['GetStreamStatus','GetRecordStatus','GetReplayBufferStatus','GetVirtualCamStatus'])if(this.available?.has(t)&&(await this.call(t)).outputActive)throw Error('Stop streaming, recording, replay buffer and virtual camera before changing video settings.');}
 async handle(op,i={}){
  if(!this.link.ready)throw Error('Connect OBS first.');
  if(!this.available)await this.init();
  if(op==='snapshot'){
   const [scenes,stream,record,inputs]=await Promise.all([this.call('GetSceneList'),this.call('GetStreamStatus'),this.call('GetRecordStatus'),this.call('GetInputList')]);
   const sceneName=i.sceneName?name(i.sceneName):scenes.currentProgramSceneName;
   const items=sceneName?(await this.call('GetSceneItemList',{sceneName})).sceneItems:[];
   const mixer=[];for(const input of (inputs.inputs||[]).slice(0,64)){try{const [volume,mute]=await Promise.all([this.call('GetInputVolume',{inputName:input.inputName}),this.call('GetInputMute',{inputName:input.inputName})]);mixer.push({inputName:input.inputName,...volume,...mute});}catch{}}
   return {connected:true,scenes:scenes.scenes,current:scenes.currentProgramSceneName,sceneName,items,inputs:inputs.inputs,mixer,stream,record,available:[...this.available]};
  }
  if(op==='preview'){const width=num(i.width,160,1280);const {currentProgramSceneName}=await this.call('GetCurrentProgramScene');const r=await this.call('GetSourceScreenshot',{sourceName:currentProgramSceneName,imageFormat:'jpeg',imageWidth:width,imageCompressionQuality:65});if(typeof r.imageData!=='string'||r.imageData.length>3*1024*1024||!r.imageData.startsWith('data:image/jpeg;base64,'))throw Error('OBS preview image is unavailable.');return {image:r.imageData};}
  if(op==='meters'){this.link.subscribe(bool(i.enabled));return {};}
  if(op==='settings')return {video:await this.call('GetVideoSettings'),record:this.available.has('GetRecordDirectory')?await this.call('GetRecordDirectory'):null};
  if(op==='video'){await this.quiet();const data={};for(const k of ['baseWidth','baseHeight','outputWidth','outputHeight'])data[k]=num(i[k],16,8192);data.fpsNumerator=num(i.fpsNumerator,1,240000);data.fpsDenominator=num(i.fpsDenominator,1,1001);if(data.fpsNumerator/data.fpsDenominator>240)throw Error('Maximum 240 frames per second.');for(const v of Object.values(data))if(!Number.isInteger(v))throw Error('Video settings must be whole numbers.');return this.call('SetVideoSettings',data);}
  if(op==='record-directory'){if((await this.call('GetRecordStatus')).outputActive)throw Error('Stop recording before changing its folder.');return this.call('SetRecordDirectory',{recordDirectory:name(i.directory)});}
  if(op==='record-start')return this.call('StartRecord');
  if(op==='record-stop')return this.call('StopRecord');
  if(op==='stream-stop')return this.call('StopStream');
  if(op==='scene-switch')return this.call('SetCurrentProgramScene',{sceneName:name(i.sceneName)});
  if(op==='scene-create')return this.call('CreateScene',{sceneName:name(i.sceneName)});
  if(op==='scene-rename')return this.call('SetSceneName',{sceneName:name(i.sceneName),newSceneName:name(i.newName)});
  if(op==='scene-delete'){const s=await this.call('GetSceneList');if(s.scenes.length<=1)throw Error('Keep at least one OBS scene.');return this.call('RemoveScene',{sceneName:name(i.sceneName)});}
  if(op==='source-add')return this.call('CreateSceneItem',{sceneName:name(i.sceneName),sourceName:name(i.sourceName),sceneItemEnabled:true});
  if(op==='volume')return this.call('SetInputVolume',{inputName:name(i.inputName),inputVolumeDb:num(i.db,-100,0)});
  if(op==='mute')return this.call('SetInputMute',{inputName:name(i.inputName),inputMuted:bool(i.muted)});
  if(op.startsWith('source-')){
   const data={sceneName:name(i.sceneName),sceneItemId:num(i.id,0,2147483647)};
   if(!Number.isInteger(data.sceneItemId))throw Error('Invalid source.');
   if(op==='source-visible')return this.call('SetSceneItemEnabled',{...data,sceneItemEnabled:bool(i.enabled)});
   if(op==='source-lock')return this.call('SetSceneItemLocked',{...data,sceneItemLocked:bool(i.locked)});
   if(op==='source-delete')return this.call('RemoveSceneItem',data);
   if(op==='source-order')return this.call('SetSceneItemIndex',{...data,sceneItemIndex:num(i.index,0,10000)});
   if(op==='source-transform'){
    if((await this.call('GetSceneItemLocked',data)).sceneItemLocked)throw Error('Unlock this OBS source before moving or resizing it.');
    const sceneItemTransform={positionX:num(i.x,-16384,16384),positionY:num(i.y,-16384,16384),scaleX:num(i.scaleX,.01,100),scaleY:num(i.scaleY,.01,100),rotation:num(i.rotation,-360,360)};
    return this.call('SetSceneItemTransform',{...data,sceneItemTransform});
   }
  }
  throw Error('Unknown OBS control.');
 }
}
module.exports={OBSControls};
