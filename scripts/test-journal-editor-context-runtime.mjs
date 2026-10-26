import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Requires the isolated TEST Bundle, not the standard Obsidian CLI/socket.
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = path.resolve(option("output", "artifacts/editor-context/runtime"));
const build = JSON.parse(await readFile(option("build-info", "artifacts/current-build-info.json"), "utf8"));
const vault = "/Users/feng/Documents/OBSIDIAN/TEST";
await mkdir(output, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) {
    assert.equal(createHash("sha256").update(await readFile(path.join(vault, ".obsidian/plugins/roam-workspace", name))).digest("hex"), build.artifactHashes[name]);
}
const pages = (await (await fetch(`http://127.0.0.1:${option("port", "9237")}/json/list`)).json()).filter(t => t.type === "page" && t.url === "app://obsidian.md/index.html");
assert.equal(pages.length, 1);
const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
const pending = new Map();
const errors = [];
// Also reproduced with the original installed bundle during split/card layout.
// Retain every event in the report; only this exact host notification is known.
const isLayoutNotification = error => error.lineNumber === 0 && error.columnNumber === 0 &&
    error.exception?.type === "string" &&
    error.exception.value === "ResizeObserver loop completed with undelivered notifications.";
socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push({time:new Date().toISOString(),...message.params.exceptionDetails});
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result);
});
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await wait(100); }
    throw Error(`Timed out: ${expression}`);
}
async function screenshot(name) {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
}
async function key(key, code = key) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
const folder = `tmp/journal-context-${randomUUID()}`;
const results = { buildId: build.buildId, folder, startedAt: new Date().toISOString(), phases: [] };
const phase = (name, details = {}) => results.phases.push({ name, ...details });
let created = false;
try {
    assert.equal(await evaluate("app.vault.adapter.basePath"), vault);
    await send("Runtime.enable");
    errors.length = 0;
    await evaluate(`(async()=>{
        const folder=${JSON.stringify(folder)};
        if(app.vault.getAbstractFileByPath(folder))throw Error('Fixture exists');
        const t=window.__editorContextTest={folder,previous:app.workspace.activeLeaf};
        await app.vault.createFolder(folder);await app.vault.createFolder(folder+'/Journal');
        t.candidate='ABC-context-'+folder.split('-').at(-1);
        await app.vault.create(folder+'/'+t.candidate+'.md','candidate body\\n');
        t.normalFile=await app.vault.create(folder+'/ordinary.md','ordinary pane with a deliberately different count '.repeat(15));
        for(let day=1;day<=8;day++)await app.vault.create(folder+'/Journal/2026-10-0'+day+'.md','- Journal day '+day+' English 中文\\n'+('- background line\\n'.repeat(4)));
        t.normal=app.workspace.getLeaf('split');await t.normal.openFile(t.normalFile);
        t.leaf=app.workspace.getLeaf('tab');
        await t.leaf.setViewState({type:'daily-note-editor-view',state:{selectionMode:'folder',target:folder+'/Journal',timeField:'name',selectedRange:'all'},active:true});
        t.path=folder+'/Journal/2026-10-01.md';
        t.propertyEnabled=app.plugins.enabledPlugins.has('property-over-file-name');
        await app.plugins.plugins['roam-workspace'].writeJournalStreamUiAuditPayload(folder+'/identity.json',{});
        return null;
    })()`);
    created = true;
    results.identity = await evaluate(`(async()=>JSON.parse(await app.vault.adapter.read(${JSON.stringify(folder + "/identity.json")})))()`);
    results.enabled = await evaluate("Array.from(app.plugins.enabledPlugins)");
    assert.equal(results.identity.buildFingerprint.buildId, build.buildId);
    assert.ok(!results.enabled.includes("daily-notes-editor"));
    await until("window.__editorContextTest.leaf.view.controller.sessions.has(window.__editorContextTest.path)");
    await until("(()=>{const c=window.__editorContextTest.leaf.view.controller;return !c.drainingMountQueue&&c.mountPromises.size===0})()");
    await evaluate(`(()=>{
        const t=window.__editorContextTest;t.controller=t.leaf.view.controller;t.session=t.controller.sessions.get(t.path);t.view=t.session.getMarkdownView();
        app.workspace.setActiveLeaf(t.session.leaf,{focus:true});t.session.focus();
        t.view.editor.setCursor(0,t.view.editor.getLine(0).length);
        t.editor=t.session.slotEl.querySelector('.cm-editor');
        t.samples=[];t.counts=[];t.selectionEvents=[];t.activations=[];
        t.activeDescriptor=Object.getOwnPropertyDescriptor(app.workspace,'setActiveLeaf');t.originalActivate=app.workspace.setActiveLeaf;
        app.workspace.setActiveLeaf=function(leaf,...args){const event={time:performance.now(),path:leaf.view?.file?.path,parent:leaf.parentLeaf?.view?.getViewType(),type:leaf.view?.getViewType(),connected:leaf.containerEl.isConnected,focused:leaf.containerEl.contains(document.activeElement),focusPath:document.activeElement?.closest('.journal-v2__card')?.dataset?.path,args,stack:Error().stack};const result=t.originalActivate.call(this,leaf,...args);event.active=app.workspace.activeEditor?.file?.path;t.activations.push(event);return result};
        t.ref=app.workspace.on('editor-selection-change',(editor,view)=>t.selectionEvents.push({time:performance.now(),path:view?.file?.path,focused:editor.hasFocus()}));
        const sample=()=>{t.samples.push({time:performance.now(),active:app.workspace.activeEditor?.file?.path,fileView:app.workspace.getActiveFileView()?.file?.path,focused:t.view.editor.hasFocus(),connected:t.editor.isConnected,same:t.session.slotEl.querySelector('.cm-editor')===t.editor,status:document.querySelector('.status-bar')?.innerText,count:app.internalPlugins.plugins['word-count'].instance.wordEl?.parentElement?.innerText,suggest:document.querySelector('.suggestion-container')?.innerText});t.frame=requestAnimationFrame(sample)};sample();
    })()`);
    await screenshot("before-input");
    const agreement = await evaluate("(()=>{const t=window.__editorContextTest;return {editor:app.workspace.activeEditor?.file?.path,fileView:app.workspace.getActiveFileView()?.file?.path,expected:t.path}})()");
    phase("active-file-agreement", agreement);
    assert.equal(agreement.fileView, agreement.expected, "host file lookup must agree with focused Journal editor");
    assert.equal(agreement.editor, agreement.expected);
    await send("Input.insertText", { text: " continuous English 中文" });
    await key("ArrowLeft"); await key("ArrowRight");
    await until("(async()=>{const t=window.__editorContextTest;return t.session.getContent()===await app.vault.cachedRead(t.view.file)})()");
    // A background cursor update must not make the active file lookup count that card.
    await evaluate("(()=>{const t=window.__editorContextTest;for(const s of t.controller.sessions.values())if(s!==t.session)s.getMarkdownView().editor.setCursor(0,0)})()");
    await wait(1000);
    const idleStart = await evaluate("window.__editorContextTest.samples.length");
    await wait(6000);
    const idle = await evaluate(`(()=>{const t=window.__editorContextTest;return t.samples.slice(${idleStart})})()`);
    assert.ok(idle.length > 30);
    assert.ok(idle.every(s => s.fileView === agreement.expected && s.active === agreement.expected && s.focused && s.connected && s.same));
    assert.equal(new Set(idle.map(s => s.count)).size, 1, "idle status must not oscillate");
    phase("continuous-input-background-selection-and-idle", { samples: idle.length, status: idle[0].status });
    for (const mode of ["property-plugin", "native"]) {
        if (mode === "native") await evaluate("(async()=>{const t=window.__editorContextTest;if(t.propertyEnabled)await app.plugins.disablePlugin('property-over-file-name')})()");
        await evaluate("(()=>{const t=window.__editorContextTest;t.view.editor.setCursor(0,t.view.editor.getLine(0).length);t.session.focus()})()");
        await send("Input.insertText", { text: " [[AB" });
        await until("(()=>{const t=window.__editorContextTest;return document.querySelector('.suggestion-container')?.innerText.includes(t.candidate)})()");
        await send("Input.insertText", { text: "C" });
        await until("app.workspace.editorSuggest.currentSuggest?.context?.query==='ABC'");
        await wait(500);
        const suggestion = await evaluate("(()=>{const t=window.__editorContextTest;return {query:app.workspace.editorSuggest.currentSuggest.context.query,file:app.workspace.editorSuggest.currentSuggest.context.file.path,rows:Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).map(e=>e.innerText),candidate:t.candidate}})()");
        assert.equal(suggestion.file, agreement.expected);
        const index = suggestion.rows.findIndex(row => row.includes(suggestion.candidate)); assert.ok(index >= 0);
        for (let i = 0; i < index; i++) await key("ArrowDown");
        await key("Enter");
        await until("(()=>{const t=window.__editorContextTest;return t.session.getContent().includes(t.candidate)})()");
        phase(`${mode}-AB-ABC-keyboard-selection`, suggestion);
        await screenshot(`${mode}-after-selection`);
    }
    await evaluate("(async()=>{const t=window.__editorContextTest;if(t.propertyEnabled)await app.plugins.enablePlugin('property-over-file-name');app.workspace.setActiveLeaf(t.normal,{focus:true})})()");
    await until("(()=>{const t=window.__editorContextTest;return app.workspace.getActiveFileView()===t.normal.view&&app.workspace.activeEditor===t.normal.view})()");
    phase("ordinary-pane-focus");
    await evaluate("(()=>{const t=window.__editorContextTest;app.workspace.setActiveLeaf(t.session.leaf,{focus:true});t.session.focus();t.beforePool=Array.from(t.controller.sessions.keys());t.scroller=t.leaf.view.contentEl;t.scroller.scrollTop=t.scroller.scrollHeight})()");
    await evaluate("(()=>{const t=window.__editorContextTest;const scroller=t.leaf.view.contentEl;if(scroller)scroller.scrollTop=scroller.scrollHeight})()");
    await wait(1500);
    const pool = await evaluate("(()=>{const t=window.__editorContextTest;return {before:t.beforePool,after:Array.from(t.controller.sessions.keys()),mounted:t.controller.sessions.size,active:app.workspace.getActiveFileView()?.file?.path,scrollTop:t.scroller.scrollTop,scrollHeight:t.scroller.scrollHeight,clientHeight:t.scroller.clientHeight}})()");
    phase("multi-card-background", pool);
    assert.ok(pool.scrollTop > 0, "must exercise real background mounting by scrolling");
    assert.ok(pool.after.some(key => !pool.before.includes(key)), "must mount a new background card");
    assert.ok(pool.mounted <= 5);
    assert.equal(pool.active, agreement.expected);
    await screenshot("after-input");
    results.samples = await evaluate("window.__editorContextTest.samples");
    results.selectionEvents = await evaluate("window.__editorContextTest.selectionEvents");
    assert.equal(errors.filter(error => !isLayoutNotification(error)).length, 0, `Runtime exceptions: ${JSON.stringify(errors)}`);
    results.status = "passed";
    results.errorsBeforeCleanup = [...errors];
} catch (error) {
    results.status = "failed"; results.failure = error.message;
    await screenshot("failure").catch(() => {});
    throw error;
} finally {
    if (created) {
        results.activations = await evaluate("window.__editorContextTest.activations").catch(() => []);
        results.cleanup = await evaluate(`window.__editorContextCleanup=(async()=>{
            const t=window.__editorContextTest;
            cancelAnimationFrame(t.frame);if(t.ref)app.workspace.offref(t.ref);
            if(t.originalActivate){if(t.activeDescriptor)Object.defineProperty(app.workspace,'setActiveLeaf',t.activeDescriptor);else delete app.workspace.setActiveLeaf;}
            if(t.propertyEnabled&&!app.plugins.enabledPlugins.has('property-over-file-name'))await app.plugins.enablePlugin('property-over-file-name');
            t.leaf.detach();t.normal.detach();if(t.previous?.containerEl.isConnected)app.workspace.setActiveLeaf(t.previous,{focus:false});
            await new Promise(resolve=>setTimeout(resolve,2200));
            const folder=app.vault.getAbstractFileByPath(t.folder);if(folder)await app.vault.delete(folder,true);
            const clean=!app.vault.getAbstractFileByPath(t.folder);delete window.__editorContextTest;return clean;
        })()`).catch(error => ({ error: error.message }));
    }
    await evaluate("delete window.__editorContextCleanup").catch(() => {});
    if (created && results.cleanup !== true) { results.status = "failed"; process.exitCode = 1; }
    results.errors = errors;
    results.layoutNotifications = errors.filter(isLayoutNotification);
    results.unexpectedErrors = errors.filter(error => !isLayoutNotification(error));
    if (results.unexpectedErrors.length) { results.status = "failed"; process.exitCode = 1; }
    await writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
    socket.close();
    console.log(JSON.stringify({ status: results.status, phases: results.phases.map(p => p.name), cleanup: results.cleanup, output }));
}
