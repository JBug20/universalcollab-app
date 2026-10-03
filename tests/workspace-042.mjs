import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:1300,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.features=null;window.calls=[];window.fail=false;window.live=false;
  const initial={schemaVersion:1,servers:[{key:'one',nickname:'Home studio',address:'http://127.0.0.1:25560',id:'Alice',token:'x'.repeat(32)},{key:'two',nickname:'Friends',address:'http://127.0.0.2:25560',id:'Alice',token:'y'.repeat(32)}],selectedKey:'one'};
  window.relayDesktop={
   loadServers:async()=>JSON.parse(localStorage.getItem('test-vault')||JSON.stringify(initial)),
   saveServers:async v=>localStorage.setItem('test-vault',JSON.stringify(v)),
   loadLocalProfile:async()=>({schemaVersion:1,displayName:'Bug',createdAt:'2026'}),
   saveLocalProfile:async()=>{},copy:async()=>{},
   request:async q=>{
    window.calls.push(q);if(window.fail)throw Error('Offline');
    const status={broadcast:window.live,state:window.live?'fallback':'ready',held:false,mode:'live',pictureInPicture:true,collabFallback:true,width:1920,height:1080,fps:60};
    if(q.route.endsWith('/secrets'))return {obsServer:'rtmp://secret.example/live',obsKey:'SECRET_KEY',loginToken:'x'.repeat(32),destinationBaseUrl:'rtmp://destination/live',destinationStreamKey:'SECRET_DEST'};
    if(q.route.endsWith('/register'))return {id:q.body.username,token:'z'.repeat(32)};
    if(q.route==='/api/end')window.live=false;
    return {capabilities:window.features,status:{...status,broadcast:window.live,state:window.live?'fallback':'ready'},me:{id:'Alice',destinationConfigured:true,settings:{overlays:[],fallback:[]}},peers:[],requests:[]};
   }
  };
 });
 await page.goto('file://'+path.resolve('universalcollab-062/DesktopSource/portal.html'));
 await page.waitForFunction(()=>document.querySelector('#serverSelect').options.length===4);
 assert(await page.locator('#dashboard').isVisible());assert(await page.locator('#welcome').isHidden());
 assert(await page.locator('#saveDestination').isDisabled());assert(await page.locator('#pip').isDisabled());
 assert.equal(await page.evaluate(()=>calls.length),0);
 assert.equal(await page.locator('#workspaceSettings').count(),0);
 assert(await page.locator('#addPanel').isHidden());
 await page.locator('#editPanels').click();
 await page.locator('#compactWorkspace').check();
 await page.getByRole('button',{name:'Hide People on this server panel',exact:true}).click();
 assert(await page.locator('[data-panel-id="people"]').isHidden());
 await page.locator('#addPanel').click();
 assert.equal(await page.locator('#panelChoices button').count(),6);
 assert(await page.locator('[data-add-panel="obs"]').isDisabled());
 assert(await page.locator('[data-add-panel="people"]').isEnabled());
 await page.reload();await page.waitForFunction(()=>document.querySelector('#serverSelect').options.length===4);
 assert(await page.locator('#compactWorkspace').isChecked());
 assert(await page.locator('[data-panel-id="people"]').isHidden());
 await page.locator('#editPanels').click();await page.locator('#addPanel').click();
 await page.locator('[data-add-panel="people"]').click();
 assert(await page.locator('[data-panel-id="people"]').isVisible());
 assert(await page.locator('[data-add-panel="people"]').isDisabled());
 assert.equal(await page.locator('[data-panel-id="people"]').count(),1);
 for(const b of await page.locator('.panel-remove').all())await b.click();
 assert.equal(await page.locator('#panelGrid .card:visible').count(),0);
 assert.equal(await page.locator('#panelChoices button:enabled').count(),6);
 await page.locator('#resetPanels').click();
 assert.equal(await page.locator('#panelGrid .card:visible').count(),6);
 await page.locator('#editPanels').click();assert(await page.locator('#panelCatalog').isHidden());assert(await page.locator('#addPanel').isHidden());
 await page.locator('#editPanels').click();await page.getByRole('button',{name:'Move Requests & permissions panel to other column',exact:true}).click();
 assert.equal(await page.locator('#panelGrid .stack').first().locator('.card').first().getAttribute('data-panel-id'),'requests');
 await page.locator('#serverSelect').selectOption('two');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-vault')).selectedKey==='two');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#serverSelect').value==='two');
 assert.equal(await page.locator('#panelGrid .stack').first().locator('.card').first().getAttribute('data-panel-id'),'requests');
 await page.locator('#serverConnect').click();await page.waitForFunction(()=>document.querySelector('#serverConnect').textContent==='Disconnect');
 assert(await page.locator('#pip').isEnabled());
 await page.evaluate(()=>window.features={registration:false,pictureInPicture:false,collaboratorFallback:true});
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#pip').disabled);
 assert(await page.locator('#peer1').isDisabled());assert(await page.locator('#collab').isEnabled());assert(await page.locator('#saveDestination').isEnabled());
 assert((await page.locator('#hostCapabilities').textContent()).includes('corner feeds'));
 await page.evaluate(()=>window.features={registration:true,pictureInPicture:true,collaboratorFallback:false});
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#collab').disabled);
 assert(await page.locator('#pip').isEnabled());
 await page.evaluate(()=>window.features=null);await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#collab').disabled);
assert.equal(await page.locator('#obsKey').getAttribute('type'),'password');
 assert(!(await page.locator('body').innerText()).includes('SECRET_KEY'));
 await page.evaluate(()=>window.live=true);await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#serverSelect').disabled);
 assert(await page.locator('#removeServer').isDisabled());
 await page.locator('#serverConnect').click();assert.equal(await page.locator('#serverConnect').textContent(),'Disconnect');
 await page.locator('#end').click();await page.waitForFunction(()=>!document.querySelector('#serverSelect').disabled);
 await page.locator('#serverConnect').click();await page.waitForFunction(()=>document.querySelector('#serverConnect').textContent==='Connect');
 await page.evaluate(()=>window.fail=true);await page.locator('#serverSelect').selectOption('one');
 await page.waitForFunction(()=>document.querySelector('#serverSelect').disabled);assert.equal(await page.locator('#serverSelect').inputValue(),'two');
 await page.evaluate(()=>window.fail=false);await page.locator('#serverConnect').click();await page.waitForFunction(()=>!document.querySelector('#serverSelect').disabled);
 await page.locator('#serverSelect').selectOption('__add__');await page.locator('#welcome').waitFor({state:'visible'});
 assert(await page.locator('#dashboard').isVisible());
 await page.locator('#serverNickname').fill('Weekend crew');await page.locator('#address').fill('127.0.0.3:25560');await page.locator('#username').fill('Alice');await page.locator('#password').fill('join-secret');await page.locator('#connect').click();
 await page.locator('#welcome').waitFor({state:'hidden'});
 assert.equal(await page.locator('#serverSelect option:checked').textContent(),'Weekend crew');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('test-vault')).servers.length),3);
 await page.locator('#renameServer').click();await page.locator('#renameValue').fill('Gaming friends');await page.locator('#renameForm button').first().click();
 await page.waitForFunction(()=>document.querySelector('#serverSelect option:checked').textContent==='Gaming friends');
 await page.screenshot({path:'UniversalCollab-0.4.2-dashboard.png',fullPage:true});
 await page.locator('#serverConnect').click();await page.waitForFunction(()=>document.querySelector('#serverConnect').textContent==='Connect');
 await page.setViewportSize({width:480,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'UniversalCollab-0.4.2-offline.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS offline dashboard, disabled controls, persistent panel moves, nicknames, multiple servers, add, rename, broadcast/fallback lock, unreachable-server lock, retry and narrow layout.');
}finally{await browser.close();}
