import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.platformCalls=[];
 const state={accounts:{twitch:{id:'123',name:'Streamer'},youtube:{id:'UC1',name:'YT Streamer'}},configured:{twitch:true,youtube:true},auth:{},chats:{twitch:{running:true,status:'Connected'},youtube:{running:true,status:'Connected'}},messages:[{key:'tw-key',platform:'twitch',channel:'123',id:'m1',authorId:'viewer',author:'Viewer',text:'<img src=x onerror=alert(1)>',time:new Date().toISOString()},{key:'yt-key',platform:'youtube',channel:'chat1',id:'m2',authorId:'UCviewer',author:'YT Viewer',text:'Hello from YouTube',time:new Date().toISOString()}]};
 window.relayDesktop={loadServers:async()=>({schemaVersion:1,servers:[],selectedKey:''}),saveServers:async()=>{},loadLocalProfile:async()=>({displayName:'Local profile'}),saveLocalProfile:async()=>{},copy:async()=>{},onPlatforms:fn=>{window.platformPaint=fn;},platform:async(op,input)=>{window.platformCalls.push({op,input});if(op==='twitch-info')return {title:'Current title',gameId:'42',gameName:'Game',language:'en'};if(op==='categories')return [{id:'7',name:'Other game'}];if(op==='broadcasts')return [{id:'vid',title:'My stream',description:'Description',state:'live'}];if(op==='moderate'){state.messages=state.messages.filter(m=>m.key!==input.key);window.platformPaint(state);return {done:true};}if(op==='youtube-save')return input;if(op==='send')return {sent:true};return state;}};
});
await page.goto('file://'+new URL('../../DesktopSource/portal.html',import.meta.url).pathname);await page.waitForFunction(()=>document.querySelector('#state').textContent==='Offline');
await page.getByRole('tab',{name:'Twitch',exact:true}).click();assert(await page.locator('#relayWorkspace').isHidden());assert(await page.locator('#twitchTitle').isEnabled());
await page.locator('#twitchReload').click();await page.waitForFunction(()=>document.querySelector('#twitchTitle').value==='Current title');
await page.locator('#twitchTitle').fill('Edited stream title');await page.locator('#twitchInfoForm button').click();await page.waitForFunction(()=>platformCalls.some(x=>x.op==='twitch-save'));
assert.equal((await page.evaluate(()=>platformCalls.find(x=>x.op==='twitch-save'))).input.title,'Edited stream title');
assert.equal(await page.locator('#chatMessages img').count(),0);assert((await page.locator('#chatMessages').textContent()).includes('<img'));
await page.getByRole('tab',{name:'YouTube',exact:true}).click();await page.locator('#youtubeReload').click();await page.locator('#youtubeBroadcast').selectOption('vid');await page.locator('#youtubeTitle').fill('New YT title');await page.locator('#youtubeSave').click();await page.waitForFunction(()=>platformCalls.some(x=>x.op==='youtube-save'));
await page.getByRole('tab',{name:'Combined chat',exact:true}).click();assert.equal(await page.locator('.chat-message').count(),2);
await page.locator('#chatTwitch').uncheck();assert.equal(await page.locator('.chat-message').count(),1);assert((await page.locator('.chat-message').textContent()).includes('YouTube'));
await page.locator('#chatMessages').getByRole('button',{name:'Delete',exact:true}).click();assert((await page.locator('#moderationText').textContent()).includes('YouTube'));await page.locator('#moderationDo').click();await page.waitForFunction(()=>platformCalls.some(x=>x.op==='moderate'));assert.equal((await page.evaluate(()=>platformCalls.find(x=>x.op==='moderate'))).input.key,'yt-key');
await page.locator('#chatTarget').selectOption('youtube');await page.locator('#chatText').fill('Test message');await page.locator('#chatSendForm button').click();await page.waitForFunction(()=>platformCalls.some(x=>x.op==='send'));assert.equal((await page.evaluate(()=>platformCalls.find(x=>x.op==='send'))).input.platform,'youtube');
await page.locator('#chatFont').selectOption('large');await page.reload();await page.getByRole('tab',{name:'Combined chat',exact:true}).click();assert.equal(await page.locator('#chatFont').inputValue(),'large');assert(!(await page.locator('#chatTwitch').isChecked()));
await page.locator('#chatTwitch').check();await page.screenshot({path:'UniversalCollab-0.6.3-chat.png',fullPage:true});
await page.getByRole('tab',{name:'Twitch',exact:true}).click();await page.screenshot({path:'UniversalCollab-0.6.3-twitch.png',fullPage:true});
await page.setViewportSize({width:480,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.getByRole('tab',{name:'Stream',exact:true}).click();assert(await page.locator('#dashboard').isVisible());assert(await page.locator('#saveDestination').isDisabled());
assert.deepEqual(errors,[]);console.log('PASS platform tabs offline, stream editing, chat text escaping, combined filters/preferences, origin-specific moderation/send, narrow layout and relay state preservation.');
}finally{await browser.close();}
