import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const vault='/Users/feng/Documents/OBSIDIAN/TEST';
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'artifacts/navigation-journals/runtime');
await mkdir(output,{recursive:true});
const build=JSON.parse(await readFile('artifacts/current-build-info.json','utf8'));
for(const name of ['main.js','manifest.json','styles.css'])assert.equal(createHash('sha256').update(await readFile(path.join(vault,'.obsidian/plugins/roam-workspace',name))).digest('hex'),build.artifactHashes[name]);
const pages=(await (await fetch('http://127.0.0.1:9237/json/list')).json()).filter(p=>p.type==='page'&&p.url==='app://obsidian.md/index.html');
assert.equal(pages.length,1,'Expected the isolated TEST window');
const socket=new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
let id=0;const requests=new Map();const errors=[];
socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);const request=requests.get(message.id);if(!request)return;requests.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(JSON.stringify(message.error)));else request.resolve(message.result)});
function send(method,params={}){return new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>{requests.delete(requestId);reject(Error(`CDP timeout: ${method}`))},15000);requests.set(requestId,{resolve,reject,timer});socket.send(JSON.stringify({id:requestId,method,params}))})}
async function evaluate(expression){const response=await send('Runtime.evaluate',{expression:`window.__navigationRuntimeResult=eval(${JSON.stringify(expression)})`,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result.value}
async function until(expression){for(let i=0;i<100;i++){if(await evaluate(`(async()=>Boolean(await (${expression})))()`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Condition timed out: '+expression)}
async function screenshot(name){const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'))}
const cleanupOnly=process.argv.includes('--cleanup-only');
const folder=cleanupOnly?await evaluate('window.__navigationTest?.folder'): 'tmp/navigation-'+randomUUID();
if(typeof folder!=='string'||!/^tmp\/navigation-[a-f0-9-]+$/.test(folder))throw Error('Missing or unsafe fixture folder');
const cleanup=()=>evaluate(`(async()=>{const t=window.__navigationTest;if(!t)return true;if(t.folder!==${JSON.stringify(folder)}||app.vault.adapter.basePath!==${JSON.stringify(vault)})throw Error('Fixture identity mismatch');if(t.nativeOpen)window.open=t.nativeOpen;for(const d of new Set([document,app.setting.modalEl.ownerDocument]))for(const e of d.querySelectorAll('.roam-navigation-entry-editor'))Array.from(e.querySelectorAll('button')).find(b=>b.textContent==='Cancel')?.click();app.setting.close();const p=app.plugins.plugins['roam-workspace'];p.settings=t.settings;await p.saveSettings();p.notifySettingsChanged();await app.vault.adapter.write(app.vault.configDir+'/bookmarks.json',t.bookmarks);for(const leaf of app.workspace.getLeavesOfType('daily-note-editor-view'))if((leaf.view.target??leaf.getViewState().state?.target)?.startsWith(t.folder+'/'))leaf.detach();for(const leaf of app.workspace.getLeavesOfType('markdown'))if((leaf.view.file?.path??leaf.getViewState().state?.file)?.startsWith(t.folder+'/'))leaf.detach();const fixture=app.vault.getAbstractFileByPath(t.folder);if(fixture)await app.vault.delete(fixture,true);const clean=!app.vault.getAbstractFileByPath(t.folder);delete window.__navigationTest;return clean})()`);
if(cleanupOnly){try{console.log(JSON.stringify({cleanup:await cleanup()}))}finally{socket.close()}process.exit(0)}
const results={folder,buildId:build.buildId,phases:[],startedAt:new Date().toISOString()};let created=true;
function passed(name,details){results.phases.push({name,details})}
try {
    assert.equal(await evaluate('app.vault.adapter.basePath'),vault);
    await send('Runtime.enable');errors.length=0;
    await evaluate(`(async()=>{
        if(window.__navigationTest)throw Error('Another Navigation fixture is active');
        const p=app.plugins.plugins['roam-workspace'];
        const t=window.__navigationTest={folder:${JSON.stringify(folder)},settings:structuredClone(p.settings),layout:app.workspace.getLayout(),bookmarks:await app.vault.adapter.read(app.vault.configDir+'/bookmarks.json')};
        const make=async path=>{if(!app.vault.getAbstractFileByPath(path))await app.vault.createFolder(path)};
        await make('tmp');await make(t.folder);for(const sub of ['Main','Paper','Tools'])await make(t.folder+'/'+sub);
        for(const sub of ['Main','Paper','Tools'])await app.vault.create(t.folder+'/'+sub+'/2026-10-16.md','- '+sub+' fixture\\n');
        await app.vault.create(t.folder+'/OKR.md','# Goal\\nNavigation note fixture\\n');
        const config={journalName:'Main journal',journals:[{id:'paper',name:'Paper journal',folder:t.folder+'/Paper'},{id:'tools',name:'Tools journal',folder:t.folder+'/Tools'},{id:'missing',name:'Missing journal',folder:t.folder+'/Missing'}],links:[{id:'okr',name:'OKR note',type:'note',target:t.folder+'/OKR.md#Goal'},{id:'web',name:'Test website',type:'web',target:'https://example.com'},{id:'missing-note',name:'Missing note',type:'note',target:t.folder+'/Absent.md'}]};
        p.settings.journalFolder=t.folder+'/Main';p.settings.defaultOpenMode='journal-folder';p.settings.initialRange='all';p.settings.navigationViews=['journal-stream','page-stream','list-heading'];p.settings.navigationConfiguration=config;p.settings.additionalJournalsCollapsed=true;p.settings.navigationSectionCollapsed.bookmarks=false;
        await p.saveSettings();p.notifySettingsChanged();await p.openRoamNavigationView();
        const bookmarks=JSON.parse(t.bookmarks);t.group={type:'group',title:'Navigation fixture',ctime:Date.now(),items:[{type:'file',path:t.folder+'/OKR.md',title:'Fixture OKR'},{type:'group',title:'Nested group',ctime:Date.now()+1,items:[{type:'folder',path:t.folder+'/Paper',title:'Paper folder'}]}]};bookmarks.items.push(t.group);t.bookmarksWithFixture=JSON.stringify(bookmarks);await app.vault.adapter.write(app.vault.configDir+'/bookmarks.json',t.bookmarksWithFixture);
        t.config=structuredClone(config);t.initialFiles=app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(t.folder+'/')).map(f=>f.path).sort();
        t.enabled=Array.from(app.plugins.enabledPlugins);t.version=p.getRuntimeObsidianVersionForAudit();
        await p.writeJournalStreamUiAuditPayload(t.folder+'/identity.json',{});
        return null;
    })()`);
    results.identity=await evaluate(`(async()=>JSON.parse(await app.vault.adapter.read(${JSON.stringify(folder+'/identity.json')})))()`);
    results.enabled=await evaluate('window.__navigationTest.enabled');
    assert.equal(results.identity.buildFingerprint.buildId,build.buildId);assert.equal(results.identity.pluginId,'roam-workspace');assert.ok(!results.enabled.includes('daily-notes-editor'),'Conflicting daily-notes-editor must be disabled');
    await until("Array.from(document.querySelectorAll('.roam-nav-bookmark-group-toggle')).some(e=>e.textContent==='Navigation fixture')");
    passed('bundle-identity-and-fixture',{obsidian:results.identity.obsidianVersion,enabled:results.enabled});
    assert.equal(await evaluate("document.querySelector('.roam-nav-journal-toggle').getAttribute('aria-expanded')"),'false');
    await evaluate("document.querySelector('[data-journal-default]').click()");
    await until("app.workspace.getLeavesOfType('daily-note-editor-view').some(l=>l.view.target===window.__navigationTest.folder+'/Main')");
    const countBefore=await evaluate("app.workspace.getLeavesOfType('daily-note-editor-view').length");
    await evaluate("document.querySelector('.roam-nav-journal-toggle').click()");
    assert.equal(await evaluate("document.querySelector('.roam-nav-journal-toggle').getAttribute('aria-expanded')"),'true');
    assert.equal(await evaluate("app.workspace.getLeavesOfType('daily-note-editor-view').length"),countBefore,'Arrow must not open a Journal');
    for(const id of ['paper','tools','paper']) {
        await evaluate(`document.querySelector('[data-journal-id="${id}"]').click()`);
        const sub=id==='paper'?'Paper':'Tools';
        await until(`app.workspace.getLeavesOfType('daily-note-editor-view').some(l=>l.view.target===window.__navigationTest.folder+'/${sub}')`);
    }
    const journals=await evaluate("(()=>{const t=window.__navigationTest;return app.workspace.getLeavesOfType('daily-note-editor-view').filter(l=>l.view.target.startsWith(t.folder+'/')).map(l=>({target:l.view.target,title:l.view.getDisplayText()}))})()");
    assert.equal(journals.length,3,'Different journals stay open; repeated targets reuse their leaf');
    assert.equal(journals.find(j=>j.target.endsWith('/Paper')).title,'Paper journal');
    assert.equal(journals.find(j=>j.target.endsWith('/Main')).title,'Main journal');
    passed('default-child-routing-and-independent-toggle',journals);
    const missingBefore=await evaluate("app.workspace.getLeavesOfType('daily-note-editor-view').length");
    await evaluate("document.querySelector('[data-journal-id=missing]').click();document.querySelector('[data-shortcut-id=missing-note]').click()");
    await until("document.body.innerText.includes('Journal folder not found:')&&document.body.innerText.includes('Note not found:')");
    assert.equal(await evaluate("app.workspace.getLeavesOfType('daily-note-editor-view').length"),missingBefore);
    assert.equal(await evaluate("Boolean(app.vault.getAbstractFileByPath(window.__navigationTest.folder+'/Absent.md')||app.vault.getAbstractFileByPath(window.__navigationTest.folder+'/Missing'))"),false);
    await evaluate("document.querySelector('[data-shortcut-id=okr]').click()");
    await until("app.workspace.getActiveFile()?.path===window.__navigationTest.folder+'/OKR.md'");
    await evaluate("(()=>{const t=window.__navigationTest;t.nativeOpen=window.open;t.webCalls=[];window.open=(...args)=>{t.webCalls.push(args);return null};document.querySelector('[data-shortcut-id=web]').click()})()");
    await until('window.__navigationTest.webCalls.length===1');
    const calls=await evaluate('window.__navigationTest.webCalls');assert.deepEqual(calls[0],['https://example.com','_blank','noopener,noreferrer']);
    await evaluate('window.open=window.__navigationTest.nativeOpen;delete window.__navigationTest.nativeOpen');
    passed('note-web-dispatch-and-missing-targets',{calls});
    await evaluate("(()=>{const t=window.__navigationTest;const group=Array.from(document.querySelectorAll('.roam-nav-bookmark-group-toggle')).find(e=>e.textContent==='Navigation fixture');t.groupKey=group.parentElement.dataset.bookmarkGroup;group.click();const nested=Array.from(document.querySelectorAll('.roam-nav-bookmark-group-toggle')).find(e=>e.textContent==='Nested group');t.nestedKey=nested.parentElement.dataset.bookmarkGroup;nested.click()})()");
    const groupState=await evaluate("(()=>{const t=window.__navigationTest,p=app.plugins.plugins['roam-workspace'];return {parent:p.settings.bookmarkGroupCollapsed[t.groupKey],nested:p.settings.bookmarkGroupCollapsed[t.nestedKey]}})()");
    assert.deepEqual(groupState,{parent:true,nested:true});
    await evaluate("document.querySelector('.roam-nav-journal-toggle').click()");
    await until("(async()=>{const x=JSON.parse(await app.vault.adapter.read(app.vault.configDir+'/plugins/roam-workspace/data.json'));return x.additionalJournalsCollapsed&&x.bookmarkGroupCollapsed[window.__navigationTest.groupKey]&&x.bookmarkGroupCollapsed[window.__navigationTest.nestedKey]})()");
    await screenshot('dark-collapsed');
    await evaluate("(async()=>{await app.plugins.disablePlugin('roam-workspace');await app.plugins.enablePlugin('roam-workspace');await app.plugins.plugins['roam-workspace'].openRoamNavigationView()})()");
    await until("document.querySelector('.roam-nav-journal-toggle')?.getAttribute('aria-expanded')==='false'");
    await until("Array.from(document.querySelectorAll('.roam-nav-bookmark-group-toggle')).some(e=>e.textContent==='Navigation fixture'&&e.getAttribute('aria-expanded')==='false')");
    assert.equal(await evaluate("app.plugins.plugins['roam-workspace'].settings.bookmarkGroupCollapsed[window.__navigationTest.nestedKey]"),true);
    passed('collapse-and-configuration-persist-through-reload');
    await evaluate("(async()=>{await app.setting.open();await app.setting.openTabById('roam-workspace');return null})()");
    await until("app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration textarea')");
    const beforeConfig=await evaluate("JSON.stringify(app.plugins.plugins['roam-workspace'].settings.navigationConfiguration)");
    await evaluate("(()=>{const area=app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration textarea');area.value='{bad json';area.dispatchEvent(new Event('input',{bubbles:true}));app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration button').click()})()");
    await until("[document,app.setting.modalEl.ownerDocument].some(d=>d.body.innerText.includes('Configuration not applied:'))");
    assert.equal(await evaluate("JSON.stringify(app.plugins.plugins['roam-workspace'].settings.navigationConfiguration)"),beforeConfig);
    await evaluate("(()=>{const t=window.__navigationTest,c=structuredClone(t.config);c.journalName='Renamed main';c.journals[0].name='Renamed paper';const area=app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration textarea');area.value=JSON.stringify(c);area.dispatchEvent(new Event('input',{bubbles:true}));app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration button').click()})()");
    await until("app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.journalName==='Renamed main'");
    await until("[document,app.setting.modalEl.ownerDocument].some(d=>d.body.innerText.includes('Navigation configuration applied.'))");
    await screenshot('settings-applied-main');await evaluate('app.setting.close();null');
    assert.equal(await evaluate("app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.journals[0].folder"),folder+'/Paper');
    const paths=await evaluate("(()=>{const t=window.__navigationTest;return app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(t.folder+'/')).map(f=>f.path).sort()})()");
    assert.equal(paths.length,4);assert.ok(paths.includes(folder+'/Paper/2026-10-16.md'));assert.ok(paths.includes(folder+'/identity.json')===false);
    assert.equal(await evaluate("(async()=>await app.vault.adapter.read(app.vault.configDir+'/bookmarks.json')===window.__navigationTest.bookmarksWithFixture)()"),true,'Plugin interactions must not write core bookmarks');
    passed('settings-validation-and-display-name-path-separation');
    // Deterministic UI events exercise the real Obsidian controls; native input is checked separately.
    const modal="[document,app.setting.modalEl.ownerDocument].flatMap(d=>Array.from(d.querySelectorAll('.roam-navigation-entry-editor'))).find(e=>e.isConnected)";
    const fill=async fields=>evaluate(`(()=>{const m=${modal};if(!m)throw Error('No shortcut modal');for(const [label,value] of Object.entries(${JSON.stringify(fields)})){const input=m.querySelector('[aria-label="'+label+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
    const save=()=>evaluate(`(()=>{const m=${modal};Array.from(m.querySelectorAll('button')).find(e=>e.textContent==='Save shortcut').click()})()`);
    const openSettings=async()=>{
        await evaluate("(async()=>{await app.setting.open();await app.setting.openTabById('roam-workspace');return null})()");
        await until("app.setting.activeTab.containerEl.querySelector('.roam-navigation-manager')");
    };
    const contextItem=async(title)=>{
        await until(`Array.from(document.querySelectorAll('.menu-item-title')).some(e=>e.textContent===${JSON.stringify(title)})`);
        await evaluate(`Array.from(document.querySelectorAll('.menu-item-title')).find(e=>e.textContent===${JSON.stringify(title)}).closest('.menu-item').click()`);
    };
    await openSettings();
    assert.equal(await evaluate("app.setting.activeTab.containerEl.querySelector('.roam-navigation-advanced').open"),false);
    await evaluate("app.setting.activeTab.containerEl.querySelector('.roam-navigation-manager button').click()");
    await until(modal);
    await fill({'Shortcut display name':'Manual note','Shortcut target':folder+'/OKR.md','Shortcut icon':'book-open'});
    await save();
    await until("app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.some(x=>x.name==='Manual note')");
    const manualId=await evaluate("app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.find(x=>x.name==='Manual note').id");
    const row=`app.setting.activeTab.containerEl.querySelector('[data-navigation-item="link:${manualId}"]')`;
    await until(row);
    await evaluate(`${row}.querySelector('[aria-label="Move up"]').click()`);
    await until(`app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.at(-2)?.id===${JSON.stringify(manualId)}`);
    await evaluate('app.setting.close();null');
    await until(`document.querySelector('[data-shortcut-id="${manualId}"]')`);
    const manual=`document.querySelector('[data-shortcut-id="${manualId}"]')`;
    await evaluate(`${manual}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:160}))`);
    await contextItem('Rename shortcut');await until(modal);
    await fill({'Shortcut display name':'Renamed manual'});await save();
    await until(`${manual}?.textContent==='Renamed manual'`);
    await evaluate(`${manual}.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))`);
    await contextItem('Change icon');await until(modal);
    assert.equal(await evaluate(`(${modal}).querySelector('[aria-label="Shortcut icon"]').matches(':focus')`),true);
    await fill({'Shortcut icon':'globe'});await save();
    await until(`app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.find(x=>x.id===${JSON.stringify(manualId)}).icon==='globe'`);
    await openSettings();await until(row);
    await evaluate(`${row}.querySelector('.checkbox-container').click()`);
    await until(`app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.find(x=>x.id===${JSON.stringify(manualId)}).hidden===true`);
    assert.equal(await evaluate(`Boolean(${manual})`),false);
    await until(row);await evaluate(`${row}.querySelector('.checkbox-container').click()`);
    await until(manual);
    await evaluate('app.setting.close();null');
    await evaluate(`${manual}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:160}))`);
    await contextItem('Manage navigation');
    await until("app.setting.activeTab?.id==='roam-workspace'&&app.setting.activeTab.containerEl.querySelector('.roam-navigation-manager')");
    const json=await evaluate("JSON.parse(app.setting.activeTab.containerEl.querySelector('.roam-navigation-configuration textarea').value)");
    assert.equal(json.links.find(x=>x.id===manualId).icon,'globe','Settings and context menu share the same configuration');
    await evaluate('app.setting.close();null');
    await evaluate("(async()=>{await app.plugins.disablePlugin('roam-workspace');await app.plugins.enablePlugin('roam-workspace');await app.plugins.plugins['roam-workspace'].openRoamNavigationView()})()");
    await until(manual);
    assert.equal(await evaluate(`app.plugins.plugins['roam-workspace'].settings.navigationConfiguration.links.find(x=>x.id===${JSON.stringify(manualId)}).icon`),'globe');
    await evaluate(`${manual}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:120,clientY:160}))`);
    await contextItem('Remove shortcut');
    await until(`!${manual}`);
    assert.equal(await evaluate(`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(folder+'/OKR.md')}))`),true);
    assert.equal(await evaluate("(async()=>await app.vault.adapter.read(app.vault.configDir+'/bookmarks.json')===window.__navigationTest.bookmarksWithFixture)()"),true);
    const fonts=await evaluate("(()=>{const group=Array.from(document.querySelectorAll('.roam-nav-bookmark-group-toggle')).find(e=>e.textContent==='Navigation fixture');group.click();const file=group.parentElement.querySelector('.roam-nav-file-main');const g=getComputedStyle(group),f=getComputedStyle(file);return {groupWeight:g.fontWeight,fileWeight:f.fontWeight,groupSize:g.fontSize,fileSize:f.fontSize,guide:getComputedStyle(group.nextElementSibling).borderInlineStartWidth}})()");
    assert.equal(fonts.groupWeight,fonts.fileWeight);assert.equal(fonts.groupSize,fonts.fileSize);assert.equal(fonts.guide,'1px');
    passed('manual-manager-context-menu-icons-order-visibility-reload-and-safe-removal',{manualId,fonts});
    await screenshot('managed-native-tree');
    // Leave the fixture visible for a separate native keyboard/click check, if requested.
    if(process.argv.includes('--keep-fixture')){
        results.status='awaiting-native-check';created=false;
        await screenshot('ready-for-native');
    } else results.status='passed';
    results.observerWarnings=errors.filter(e=>e.exception?.value==='ResizeObserver loop completed with undelivered notifications.');
    const exceptions=errors.filter(e=>e.exception?.value!=='ResizeObserver loop completed with undelivered notifications.');
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
} catch(error){results.status='failed';results.failure=error.message;await screenshot('failure').catch(()=>{});throw error}
finally {
    if(created)results.cleanup=await cleanup().catch(e=>({error:e.message}));
    if(created&&results.cleanup!==true){results.status='failed';process.exitCode=1;}
    await send('Runtime.evaluate',{expression:'delete window.__navigationRuntimeResult',returnByValue:true}).catch(()=>{});results.errors=errors;await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');socket.close();console.log(JSON.stringify({status:results.status,phases:results.phases.map(p=>p.name),cleanup:results.cleanup,output}));
}
