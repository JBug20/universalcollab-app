from pathlib import Path
from bs4 import BeautifulSoup
r=Path(__file__).resolve().parent
D=r/'DesktopSource'
def edit(n,a,b):
 p=D/n;s=p.read_text();assert a in s,(n,a[:90]);p.write_text(s.replace(a,b))
edit('main.cjs',"const creds=input.retry?(obsCredentials||read().credentials):input.saved?read().credentials:","const creds=input.discover?(obsCredentials||read().credentials||require('./obs-discovery.cjs').discover()||{port:4455,password:''}):input.retry?(obsCredentials||read().credentials||require('./obs-discovery.cjs').discover()):input.saved?read().credentials:")
edit('platforms-ui.js',"const notify=message=>{$('platformNotice').textContent=message;};","const notify=message=>{$('platformNotice').textContent=message;window.dispatchEvent(new CustomEvent('platform-notice',{detail:message}));};")
edit('platforms-ui.js',"!!a||!s.configured[p]||j?.status==='waiting'","!!a||j?.status==='waiting'")
edit('platforms-ui.js',"  renderChat();\n }","  renderChat();window.dispatchEvent(new CustomEvent('platform-state',{detail:s}));\n }")
p=D/'studio-ui.js';s=p.read_text();a=s.index(' for(const [p,id]of');b=s.index(" $('connectionDetails').append",a);s=s[:a]+" for(const [p,id]of [['twitch','linkTwitch'],['youtube','linkYoutube']])$(id).onclick=()=>{if(accountState?.accounts[p])window.dispatchEvent(new CustomEvent('manage-platform',{detail:p}));else $(p+'Connect').click();};\n"+s[b:];p.write_text(s)
edit('obs-ui.js',"async function connect(saved){","async function connect(saved,discover=false){")
edit('obs-ui.js',"await call('connect',saved?","await call('connect',discover?{discover:true}:saved?")
edit('obs-ui.js'," $('obsConnect').onclick", " window.connectOBSAutomatically=()=>connect(false,true);\n $('obsConnect').onclick")
edit('obs-ui.js',"function buttons(){", "function buttons(){start.hidden=!!state?.stream?.outputActive;stop.hidden=!online||!state?.stream?.outputActive;")
edit('studio-ui-v2.js',"$('studioPage').hidden=false;","$('studioPage').hidden=onboarding;")
edit('studio-ui-v2.js',"function setupPaint() {", "function setupPaint() {\n    document.body.classList.toggle('onboarding',onboarding);$('studioPage').hidden=onboarding;window.onboardingActive=onboarding;window.dispatchEvent(new Event('setup-step'));")
edit('studio-ui-v2.js',"output:['fallbackPanel']", "output:['fallbackPanel','resolutionSettings']")
edit('studio-ui-v2.js',"{ $('welcome').hidden = false; if (!$('username').value)","{ if (!$('username').value)")
edit('studio-ui-v2.js',"    if (onboarding && !selected()) { $('welcome').hidden = false; return; }\n",'')
edit('studio-ui-v2.js',"$('serverSelect').value = '__add__'; await $('serverSelect').onchange();", "$('serverSelect').value = '__add__'; await $('serverSelect').onchange();$('username').value=localProfile.displayName.replace(/[^A-Za-z0-9_-]/g,'').slice(0,32)||'Streamer';mode(true);$('welcome').hidden=false;open('joinRelayWindow');")
edit('studio-ui-v2.js',"$('installerPending').hidden = false; };", "$('installerPending').hidden = false;open('hostRelayWindow'); };")
p=D/'studio-ui-v2.js';s=p.read_text();a=s.index('  const defaults=');b=s.index('\n',a);s=s[:a]+"  const defaults={order:{dockLeft:['chat'],dockCenter:['layout'],dockRight:['stream','obsSources'],dockBottom:['obsScenes','scenes','sources','obsMixer']},hidden:['obsSources'],width:'balanced',unlocked:true,heights:{},colors:{}};"+s[b:];s=s.replace('uc-ui7-workspace','uc-ui8-workspace').replace(".map(p=>p.dataset.dock)]", ".map(p=>p.dataset.dock).filter(Boolean)]");s=s.replace("workspaceSettings();\n  }","workspaceSettings();window.dispatchEvent(new Event('panels-changed'));\n  }");s=s.replace('window.workspaceUI={setPage,',"window.workspaceUI={getWorkspace:()=>workspace,setPanelVisible:(id,show)=>{workspace.hidden=(workspace.hidden||[]).filter(n=>n!==id);if(!show)workspace.hidden.push(id);saveWorkspace();},setPage,");s=s.replace("['uc-ui5-workspace','uc-ui8-workspace'", "['uc-ui8-dock-sizes','uc-ui8-panel-weights','uc-ui5-workspace','uc-ui8-workspace'");p.write_text(s)
edit('backup.cjs',"exports.workspaceKeys=[", "exports.workspaceKeys=['uc-ui8-workspace','uc-ui8-dock-sizes','uc-ui8-panel-weights',")
# Keep rc.7's verified floating window, resolution, and section-divider behavior.
p=D/'workspace-ui.js';s=p.read_text().replace("if(e.button!==0||e.target.closest('button'))", "if(e.button!==0||e.target.closest('button')||(window.onboardingActive&&dialog.id==='settingsPageWindow'))").replace("if(e.key==='Escape'){dialog.close();", "if(e.key==='Escape'&&!(window.onboardingActive&&dialog.id==='settingsPageWindow')){dialog.close();")
a=s.index(' Panels:[');b=s.index('\n Tools:',a);s=s[:a]+" Panels:[],"+s[b:];s=s.replace(",['Custom workspace tools',()=>open('workspaceDialog')]",'');s=s.replace('uc-ui7-dock-sizes','uc-ui8-dock-sizes').replace('sizes?.left||240','sizes?.left||280').replace('sizes?.right||280','sizes?.right||200').replace('sizes?.bottom||210','sizes?.bottom||260');s=s.replace("$('sourcesPanel').append(button('Properties…',()=>open('sourceProperties')));",'');s=s.replace('Panels → Arrange panels and colors controls visibility, colors and placement.','Panels controls visibility, adding panels and reset. Drag dividers between panels to resize.');s=s.replace('})();',"\n/*COMPACT_EXTENSION*/\n})().catch(e=>{document.getElementById('bootMessage').textContent='Workspace could not start: '+e.message;document.getElementById('bootStatus').hidden=false;});");p.write_text(s)
# Move forms before scripts so initial handlers bind to the same live nodes.
p=D/'portal.html';soup=BeautifulSoup(p.read_text(),'html.parser')
def el(i):return soup.find(id=i)
def fragment(s):return BeautifulSoup(s,'html.parser')
def dialog(i,title):
 d=soup.new_tag('dialog',id=i);d['class']='floating-window';d.append(fragment(f'<div class="window-title"><strong>{title}</strong><button type="button" data-close="{i}" aria-label="Close {title}">×</button></div>'));soup.body.append(d);return d
el('menuBar').append(el('settingsGear').extract());el('workspaceName').insert_before(el('obsConnectionIndicator').extract())
el('obsMode').parent['hidden']='';el('obsSetupChoice').insert(0,fragment('<div class="setup-choices"><button id="chooseAutoOBS" type="button">Automatic OBS sync</button><button id="chooseManualOBS" type="button">Manual · fewer OBS tools</button></div><p id="obsChoiceStatus" role="status"></p>'))
dialog('obsPairWindow','Connect OBS').append(el('automaticOBS').extract())
for x in el('obsSetupChoice').find_all(['p','h2'],recursive=False):
 if x.get('id')!='obsChoiceStatus':x.decompose()
el('joinRelay').string='Join a relay';el('hostRelay').string='Make my own relay';el('relaySetup').append(fragment('<p id="relayChoiceStatus" role="status"></p>'))
dialog('joinRelayWindow','Join a relay').append(el('welcome').extract());dialog('hostRelayWindow','Make my own relay').append(el('installerPending').extract())
el('loginForm').append(fragment('<details id="joinAdvanced"><summary>Existing account or different account name</summary><div id="joinAdvancedFields"></div></details>'));el('joinAdvancedFields').append(el('username').parent.extract());el('connect').string='Join relay'
res=soup.new_tag('section',id='resolutionSettings');res['class']='card';res.append(fragment('<h2>Relay layout resolution</h2>'));res.append(el('resolutionBar').extract());el('settingsPage').append(res)
el('appearanceSettings').clear();el('appearanceSettings').append(fragment('<h2>Themes</h2><p>Current theme: dark purple.</p><p>More themes are planned.</p><button id="settingsCustomize" hidden type="button">Workspace</button>'))
cs=dialog('chatSettingsWindow','Chat settings');cs.append(el('chatFilters').extract());cs.append(el('chatSurface').select_one('.chat-options').extract());cs.append(fragment('<section id="chatConnections"><h3>Chat connections</h3></section>'))
dialog('prepareStreamWindow','Prepare stream').append(el('productionForm').extract());hist=dialog('streamHistoryWindow','Past streams');hist.append(el('refreshRecordings').extract());hist.append(el('streamHistory').extract())
for n in list(el('streamsPanel').find_all(['h3'],recursive=False)):n.decompose()
for n in list(el('streamsPanel').select(':scope>.sectionhead')):
 if not n.find(id='newStream'):n.decompose()
el('connectionDetails').insert_before(fragment('<p id="linkFeedback" role="status" aria-live="polite"></p>'))
soup.body.append(fragment('<dialog id="nameActionWindow"><h2 id="nameActionTitle">Scene name</h2><form id="nameActionForm"><label>Name<input id="nameActionValue" required maxlength="128"></label><button type="submit">Save</button><button type="button" data-close="nameActionWindow">Cancel</button></form></dialog>'))
for n in list(soup.find_all('script')):soup.body.append(n.extract())
p.write_text('<!DOCTYPE html>\n'+str(soup))
for p in r.rglob('*'):
 if p.is_file() and p.suffix in ['.js','.cjs','.mjs','.py','.json','.nsi'] and 'vendor' not in p.parts and p.name!='rebuild-compact.py':
  try:s=p.read_text();p.write_text(s.replace('1.0.0-rc.7','1.0.0-rc.8').replace('UniversalCollab · rc.7','UniversalCollab · rc.8'))
  except UnicodeError:pass
