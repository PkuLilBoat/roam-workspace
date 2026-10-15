import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Run only against a separately launched TEST Bundle with local CDP enabled.
const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.slice(7) ?? 9237);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
const vaultRoot = "/Users/feng/Documents/OBSIDIAN/TEST";
const buildInfo = process.argv.find((arg) => arg.startsWith("--build-info="))?.slice(13) ?? "artifacts/current-build-info.json";
const build = JSON.parse(await readFile(buildInfo, "utf8"));
const output = path.resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "artifacts/journal-native-save-20261002");
const deleteOnly = process.argv.includes("--recovery-delete-only");
const recovery = process.argv.includes("--recovery") || deleteOnly;
await mkdir(output, { recursive: true });
for (const name of ["main.js", "styles.css", "manifest.json"]) {
    const installed = await readFile(path.join(vaultRoot, ".obsidian/plugins/roam-workspace", name));
    assert.equal(createHash("sha256").update(installed).digest("hex"), build.artifactHashes[name]);
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = targets.filter((target) => target.type === "page" && target.url === "app://obsidian.md/index.html");
assert.equal(pages.length, 1, "Expected one isolated TEST window");
const socket = new globalThis.WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error" &&
        message.params.args[0]?.value?.includes(folder)) {
        runtimeErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? arg.type));
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
});
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate(expression)) return;
        await wait(100);
    }
    throw new Error(`Runtime condition timed out: ${expression}`);
}
async function screenshot(name) {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(output, `${name}.png`), Buffer.from(data, "base64"));
}
const folder = `tmp/journal-native-save-${randomUUID()}`;
const fixture = `${folder}/2026-10-02.md`;
const results = { buildId: build.buildId, fixture, startedAt: new Date().toISOString(), phases: [] };
function phase(name, details = {}) {
    results.phases.push({ name, status: "passed", atSeconds: (Date.now() - Date.parse(results.startedAt)) / 1000, ...details });
}
let created = false;
try {
    assert.equal(await evaluate("app.vault.adapter.basePath"), vaultRoot, "Not the TEST vault");
    await send("Runtime.enable");
    await evaluate(`(async()=>{
        const folder=${JSON.stringify(folder)};
        if(app.vault.getAbstractFileByPath(folder))throw Error('Fixture already exists');
        await app.vault.createFolder(folder);
    })()`);
    created = true;
    await evaluate(`(async()=>{
        await app.plugins.plugins['roam-workspace'].writeJournalStreamUiAuditPayload(${JSON.stringify(`${folder}/identity.json`)},{});
        return null;
    })()`);
    results.identity = await evaluate(`(async()=>JSON.parse(await app.vault.adapter.read(${JSON.stringify(`${folder}/identity.json`)})))()`);
    assert.equal(results.identity.buildFingerprint.buildId, build.buildId, "Loaded bundle mismatch");
    assert.ok(!Array.from(results.identity.enabledPlugins ?? []).includes("daily-notes-editor"));
    await evaluate(`(async()=>{
        await app.vault.create(${JSON.stringify(fixture)},'- native save baseline\\n');
        window.__journalSaveTest={path:${JSON.stringify(fixture)},previous:app.workspace.activeLeaf};
        const t=window.__journalSaveTest;
        t.leaf=app.workspace.getLeaf('tab');
        await t.leaf.setViewState({type:'daily-note-editor-view',state:{selectionMode:'folder',target:${JSON.stringify(folder)},timeField:'name',selectedRange:'all'},active:true});
        t.controller=t.leaf.view.controller;
    })()`);
    await until("window.__journalSaveTest.controller.sessions.has(window.__journalSaveTest.path)");
    results.enabledPlugins = await evaluate("Array.from(app.plugins.enabledPlugins)");
    results.loadedPlugins = await evaluate("Object.keys(app.plugins.plugins)");
    results.quietOutline = await evaluate("(()=>{const p=app.plugins.plugins['obsidian-quiet-outline'];return p?{version:p.manifest.version,persistMarkdownStates:p.settings.persist_md_states}:null;})()");
    assert.ok(!results.enabledPlugins.includes("daily-notes-editor"));
    await evaluate(`(()=>{
        const t=window.__journalSaveTest;
        t.session=t.controller.sessions.get(t.path);
        t.editor=t.session.slotEl.querySelector('.cm-editor');
        t.session.focus();
        const editor=t.session.getMarkdownView().editor;
        editor.setCursor(editor.lastLine(),editor.getLine(editor.lastLine()).length);
        t.samples={frames:0,disconnected:0,replaced:0,conflicts:0};
        const sample=()=>{
            t.samples.frames++;
            if(!t.editor.isConnected)t.samples.disconnected++;
            if(t.controller.sessions.get(t.path)!==t.session)t.samples.replaced++;
            if(t.controller.conflicts.has(t.path))t.samples.conflicts++;
            t.frame=requestAnimationFrame(sample);
        };sample();
    })()`);
    await screenshot("before-input");
    for (const text of ["[[native", " revision", " one]]", "\n- next revision"]) {
        await send("Input.insertText", { text });
        await evaluate(`(()=>{const t=window.__journalSaveTest;const file=app.vault.getAbstractFileByPath(t.path);app.metadataCache.trigger('changed',file,'',app.metadataCache.getFileCache(file));})()`);
        await wait(250);
    }
    await until(`(async()=>{const t=window.__journalSaveTest;return !t.controller.localDrafts.has(t.path)&&t.session.getContent()===await app.vault.adapter.read(t.path);})()`);
    const samples = await evaluate("(()=>{const t=window.__journalSaveTest;cancelAnimationFrame(t.frame);return t.samples;})()");
    assert.ok(samples.frames > 0);
    assert.equal(samples.disconnected + samples.replaced + samples.conflicts, 0);
    const beforeUndo = await evaluate("window.__journalSaveTest.session.getContent()");
    assert.ok(beforeUndo.includes("[[native revision one]]") && beforeUndo.includes("next revision"));
    phase("continuous-input-and-duplicate-metadata", { samples });
    await screenshot("after-input");
    assert.equal(await evaluate("document.querySelector('.journal-v2__save-status').textContent"), "");

    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 4 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 4 });
    await until(`(async()=>{const t=window.__journalSaveTest;return !t.controller.localDrafts.has(t.path)&&t.session.getContent()===await app.vault.adapter.read(t.path);})()`);
    assert.notEqual(await evaluate("window.__journalSaveTest.session.getContent()"), beforeUndo, "Native undo did not change the document");
    assert.equal(await evaluate("window.__journalSaveTest.controller.conflicts.size"), 0);
    assert.equal(await evaluate("window.__journalSaveTest.editor.isConnected"), true);
    phase("native-undo");

    await evaluate("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path).focus()");
    await send("Input.insertText", { text: " local-parallel-marker " });
    await evaluate(`(async()=>{const t=window.__journalSaveTest;await app.vault.process(app.vault.getAbstractFileByPath(t.path),content=>content+'\\n- external-parallel-marker\\n');})()`);
    await until(`(async()=>{const t=window.__journalSaveTest;const disk=await app.vault.adapter.read(t.path);return !t.controller.localDrafts.has(t.path)&&disk===t.controller.sessions.get(t.path)?.getContent();})()`);
    const concurrentDisk = await evaluate("app.vault.adapter.read(window.__journalSaveTest.path)");
    assert.ok(concurrentDisk.includes("local-parallel-marker") && concurrentDisk.includes("external-parallel-marker"), "Concurrent native edit lost a revision");
    phase("native-edit-with-external-append");

    await evaluate(`(async()=>{const t=window.__journalSaveTest;await app.vault.modify(app.vault.getAbstractFileByPath(t.path),'- clean external update\\n');})()`);
    await until("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path)?.getContent()==='- clean external update\\n'");
    phase("clean-external-modify");
    await screenshot("after-external-modify");

    if (recovery) {
        if (!deleteOnly) {
        await evaluate(`(async()=>{
            const t=window.__journalSaveTest;
            t.session=t.controller.sessions.get(t.path);
            t.editor=t.session.slotEl.querySelector('.cm-editor');
            t.session.focus();
            t.session.getMarkdownView().editor.setCursor({line:0,ch:0});
        })()`);
        await send("Input.insertText", { text: "rename [[pending]] " });
        await evaluate(`(async()=>{
            const t=window.__journalSaveTest;
            const file=app.vault.getAbstractFileByPath(t.path);
            const renamed=t.path.replace('2026-10-02.md','2026-10-01.md');
            await app.vault.rename(file,renamed);
            t.path=renamed;
        })()`);
        await until("window.__journalSaveTest.controller.state.records.some(r=>r.path===window.__journalSaveTest.path)");
        const renameConflict = await evaluate("window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)");
        if (renameConflict && process.argv.includes("--probe-keep")) {
            results.keepProbe = { before: await evaluate("(()=>{const t=window.__journalSaveTest;return {sessionPresent:t.controller.sessions.has(t.path),draft:t.controller.conflicts.get(t.path).draft,live:t.controller.sessions.get(t.path)?.getContent()};})()") };
            await screenshot("rename-conflict-before-keep");
            await evaluate("window.__journalSaveTest.controller.cardList.getCard(window.__journalSaveTest.path).rootEl.querySelector('[data-conflict-action=keep-current]').click()");
            await wait(3500);
            results.keepProbe.after = await evaluate("(()=>{const t=window.__journalSaveTest;return {sessionPresent:t.controller.sessions.has(t.path),conflict:t.controller.conflicts.has(t.path),status:t.controller.cardList.getCard(t.path)?.rootEl.dataset.editorStatus};})()");
            await screenshot("rename-conflict-after-keep");
        }
        assert.equal(renameConflict, false, "Rename created a false conflict");
        assert.equal(await evaluate("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path)===window.__journalSaveTest.session"), true, "Rename replaced the native writer");
        assert.equal(await evaluate("window.__journalSaveTest.editor.isConnected"), true);
        await send("Input.insertText", { text: "continues after rename " });
        await until(`(async()=>{const t=window.__journalSaveTest;return !t.controller.localDrafts.has(t.path)&&t.session.getContent()===await app.vault.adapter.read(t.path);})()`);
        assert.ok((await evaluate("app.vault.adapter.read(window.__journalSaveTest.path)")).includes("continues after rename"));
        phase("pending-native-rename-and-continue");
        await screenshot("after-native-rename");
        }

        // Public Editor API changes need not emit a DOM input event. Delete
        // immediately, without fabricating controller drafts or conflicts.
        await evaluate(`(async()=>{
            const t=window.__journalSaveTest;
            const s=t.controller.sessions.get(t.path);
            s.getMarkdownView().editor.setValue('- latest Editor API [[draft]]\\n');
            t.expectedDraft=s.getContent();
            await app.vault.delete(app.vault.getAbstractFileByPath(t.path));
        })()`);
        await until("window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)");
        assert.equal(await evaluate("window.__journalSaveTest.controller.conflicts.get(window.__journalSaveTest.path).draft"), await evaluate("window.__journalSaveTest.expectedDraft"), "Delete lost the latest native buffer");
        phase("editor-api-delete-retains-latest-buffer");
        await screenshot("editor-api-deleted-draft");
        await evaluate(`(()=>{
            const t=window.__journalSaveTest;
            const button=t.controller.cardList.getCard(t.path).rootEl.querySelector('[data-conflict-action=restore]');
            button.click();button.click();
        })()`);
        await until("window.__journalSaveTest.controller.sessions.has(window.__journalSaveTest.path)&&!window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)");
        await wait(500);
        assert.equal(await evaluate("window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)"), false);
        await evaluate("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path).focus()");
        await send("Input.insertText", { text: "continues after double restore " });
        await until(`(async()=>{const t=window.__journalSaveTest;const disk=await app.vault.adapter.read(t.path);return disk.includes('latest Editor API [[draft]]')&&disk.includes('continues after double restore')&&t.controller.sessions.get(t.path)?.getContent()===disk&&!t.controller.localDrafts.has(t.path);})()`);
        phase("double-restore-and-continue");
        await screenshot("double-restored-and-editable");
    }

    // Real external deletion exercises retained-draft recovery and a fresh mount.
    await evaluate("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path).focus()");
    await send("Input.insertText", { text: "recovery [[draft]]" });
    await evaluate("(async()=>{const t=window.__journalSaveTest;await app.vault.delete(app.vault.getAbstractFileByPath(t.path));})()");
    await until("window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)");
    await screenshot("deleted-draft-recovery");
    await evaluate("document.querySelector('.journal-v2__conflict [data-conflict-action=restore]').click()");
    await until("window.__journalSaveTest.controller.sessions.has(window.__journalSaveTest.path)&&!window.__journalSaveTest.controller.conflicts.has(window.__journalSaveTest.path)");
    await evaluate("window.__journalSaveTest.controller.sessions.get(window.__journalSaveTest.path).focus()");
    await send("Input.insertText", { text: " continues" });
    await until(`(async()=>{const t=window.__journalSaveTest,s=t.controller.sessions.get(t.path);const disk=await app.vault.adapter.read(t.path);return disk.includes('recovery [[draft]]')&&disk.includes('continues')&&s.getContent()===disk&&!t.controller.localDrafts.has(t.path);})()`);
    phase("deleted-file-restore-and-continue");
    await screenshot("restored-and-editable");
    results.status = "passed";
} catch (error) {
    results.status = "failed";
    results.error = error.message;
    await screenshot("failure").catch(() => undefined);
    process.exitCode = 1;
} finally {
    if (created) {
        await evaluate(`window.__journalSaveCleanup=(async()=>{
            const t=window.__journalSaveTest;
            if(t){cancelAnimationFrame(t.frame);t.leaf.detach();if(t.previous?.containerEl.isConnected)app.workspace.setActiveLeaf(t.previous);}
            delete window.__journalSaveTest;
            await new Promise(resolve=>setTimeout(resolve,2200));
            const folder=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});
            if(folder)await app.vault.delete(folder,true);
            return true;
        })()`).catch((error) => { results.status = "failed"; results.cleanupError = error.message; process.exitCode = 1; });
        await evaluate("delete window.__journalSaveCleanup").catch(() => undefined);
    }
    results.finishedAt = new Date().toISOString();
    results.runtimeErrors = runtimeErrors;
    await writeFile(path.join(output, "runtime-result.json"), `${JSON.stringify(results, null, 2)}\n`);
    socket.close();
}
console.log(JSON.stringify(results, null, 2));
