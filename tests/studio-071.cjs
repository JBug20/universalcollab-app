const assert=require('node:assert/strict');const {StudioService}=require('../DesktopSource/platforms/studio.cjs');const {PlatformError}=require('../DesktopSource/platforms/service.cjs');
(async()=>{
 const calls=[];let scope=false,bindFails=true,ids=0,key='secret_tw';
 const p={db:{accounts:{twitch:{id:'tw'},youtube:{id:'yt'}}},save(){},now:()=>Date.now(),account(id){if(!this.db.accounts[id])throw new PlatformError('Connect account');return this.db.accounts[id];},validateTwitch:async()=>({scopes:scope?['channel:read:stream_key','channel:manage:broadcast']:[]}),raw:async()=>({ingests:[{url_template:'rtmp://ingest.example/app/{stream_key}'}]}),twitchInfo:async()=>({gameId:'42',language:'en'}),updateTwitch:async x=>calls.push(['tw',x]),updateYoutube:async x=>calls.push(['yt',x]),api:async(platform,route,opts={})=>{
 calls.push([route,opts]);if(route.startsWith('streams/key'))return{data:[{stream_key:key}]};
 if(route.startsWith('liveBroadcasts?part=id&mine='))return{items:[]};
 if(route.startsWith('liveBroadcasts?part=status'))return{items:[{status:{lifeCycleStatus:'ready'}}]};
 if(route.startsWith('liveBroadcasts?')&&opts.method==='POST')return{id:'b'+(++ids)};
 if(route.startsWith('liveStreams?')&&opts.method==='POST')return{id:'s'+(++ids)};
 if(route.startsWith('liveBroadcasts/bind')){if(bindFails){bindFails=false;throw new PlatformError('Temporary failure');}return{};}
 if(route.startsWith('liveStreams?'))return{items:[{cdn:{ingestionInfo:{ingestionAddress:'rtmp://yt.example/live',streamName:'secret_yt'}}}]};throw Error(route);
 }};
 const s=new StudioService(p),input={id:'12345678-1234-1234-1234-123456789abc',title:'First',description:'',sync:true,selected:['youtube','twitch'],privacy:'unlisted',madeForKids:false,categoryId:'20',record:false};
 await assert.rejects(()=>s.prepare(input),e=>e.platform==='twitch'&&e.reason==='reconnect');assert.equal(ids,0);assert(!calls.some(c=>['tw','yt'].includes(c[0])));
 scope=true;await assert.rejects(()=>s.prepare(input),e=>e.platform==='youtube');assert.equal(ids,2);
 const stages=[];const result=await s.prepare({...input,title:'Edited after failure'},s=>stages.push(s));assert.equal(ids,2);assert.equal(result.title,'Edited after failure');assert.deepEqual(result.destinations.map(d=>d.id),input.selected);assert(stages.some(x=>x.message.startsWith('Checking')));
 key='rotated_key';const reduced=await s.prepare({...input,title:'Just Twitch',selected:['twitch']});assert.equal(reduced.destinations.length,1);assert.equal(reduced.destinations[0].key,key);assert(!JSON.stringify(s.snapshot()).includes('secret_'));assert(!JSON.stringify(stages).includes('secret_'));
 await assert.rejects(()=>s.prepare({...input,privacy:'public'}),/original visibility/);assert.equal(ids,2);
 p.db.accounts.youtube.id='other';await assert.rejects(()=>s.prepare(input),/account changed/);
 const uncertain={...input,id:'22345678-1234-1234-1234-123456789abc',selected:['youtube']};s.db.streamDrafts[uncertain.id]={id:uncertain.id,input:uncertain,targets:[],accountIds:{},uncertain:true};await assert.rejects(()=>s.prepare(uncertain),/did not confirm/);assert.equal(ids,2);
 console.log('PASS scope preflight before mutations, edited retry without duplicate creation, explicit subset, rotated key refresh, account binding, unknown-outcome protection, secret-free progress.');
})().catch(e=>{console.error(e);process.exitCode=1;});
