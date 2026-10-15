import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "journal-file-events-test-"));
const outfile = join(directory, "controller.mjs");

try {
    await build({
        stdin: {
            contents: `
                export { JournalV2Controller } from "./src/journal-v2/JournalV2Controller.ts";
                export { JournalFileEvents } from "./src/journal-v2/source/JournalFileEvents.ts";
                export { JournalSourceBusyError, JournalSourceReadTimeoutError } from "./src/journal-v2/source/JournalSourceRepository.ts";
                export { createJournalState, reduceJournalState } from "./src/journal-v2/model/journalState.ts";
                export { TFile } from "obsidian";
            `,
            loader: "ts",
            resolveDir: process.cwd(),
            sourcefile: "journal-file-events-test-entry.ts",
        },
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
        plugins: [{
            name: "journal-runtime-boundary",
            setup(buildContext) {
                buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
                    path: "obsidian",
                    namespace: "journal-test",
                }));
                buildContext.onResolve(
                    { filter: /^obsidian-daily-notes-interface$/ },
                    () => ({ path: "daily-notes", namespace: "journal-test" })
                );
                buildContext.onResolve(
                    { filter: /ObsidianEmbeddedEditorAdapter$/ },
                    () => ({ path: "editor-adapter", namespace: "journal-test" })
                );
                buildContext.onLoad(
                    { filter: /.*/, namespace: "journal-test" },
                    ({ path }) => ({
                        contents: path === "obsidian"
                            ? `
                                export class TFile {
                                    constructor(path) {
                                        this.path = path;
                                        this.name = path.split("/").at(-1);
                                        this.basename = this.name.replace(/\\.md$/, "");
                                        this.extension = this.name.split(".").at(-1);
                                        this.stat = { ctime: 0, mtime: 0 };
                                        this.parent = null;
                                    }
                                }
                                export class TFolder {}
                                export const normalizePath = (path) => path;
                                export const setIcon = () => undefined;
                            `
                            : path === "daily-notes"
                                ? "export const getAllDailyNotes = () => ({});"
                                : "export class ObsidianEmbeddedEditorAdapter {}",
                        loader: "js",
                    })
                );
            },
        }],
    });

    const {
        JournalV2Controller,
        JournalFileEvents,
        JournalSourceBusyError,
        JournalSourceReadTimeoutError,
        createJournalState,
        reduceJournalState,
        TFile,
    } = await import(pathToFileURL(outfile).href);

    const query = (target = "Journal") => ({
        selectionMode: "folder",
        target,
        timeField: "name",
        selectedRange: "all",
        customRange: null,
    });
    const record = (file, path = file.path, content = "disk") => ({
        content,
        dateLabel: path,
        dateTime: 0,
        file,
        isStrictlyEmpty: false,
        path,
    });
    const deferred = () => {
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        return { promise, resolve, reject };
    };
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const waitUntil = async (predicate) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("Timed out waiting for a Journal file event");
    };

    class EventSource {
        callbacks = new Map();

        on(name, callback) {
            const listeners = this.callbacks.get(name) ?? new Set();
            listeners.add(callback);
            this.callbacks.set(name, listeners);
            return { name, callback };
        }

        offref({ name, callback }) {
            this.callbacks.get(name)?.delete(callback);
        }

        emit(name, ...args) {
            for (const callback of this.callbacks.get(name) ?? []) {
                callback(...args);
            }
        }
    }

    function createHarness(file, initialPath = file.path) {
        const files = new Map([[file.path, file]]);
        const vaultEvents = new EventSource();
        const metadataEvents = new EventSource();
        let diskReads = 0;
        const vault = Object.assign(vaultEvents, {
            adapter: {
                read: async () => {
                    diskReads += 1;
                    return "disk";
                },
            },
            cachedRead: async () => "disk",
            getAbstractFileByPath: (path) => files.get(path) ?? null,
        });
        const app = {
            vault,
            metadataCache: metadataEvents,
            workspace: {
                containerEl: { ownerDocument: { defaultView: globalThis } },
            },
        };
        const cards = new Map();
        const card = (key) => ({
            key,
            collapsed: false,
            conflict: null,
            status: null,
            isCollapsed() { return this.collapsed; },
            setCollapsed(value) { this.collapsed = value; },
            showConflict(kind, draft) { this.conflict = { kind, draft }; },
            clearConflict() { this.conflict = null; },
            setRecoveryBusy(value) { this.busy = value; },
            setSaveStatus(value) { this.status = value; },
        });
        const cardList = {
            getCard: (key) => cards.get(key),
            renameKey(oldKey, newKey) {
                if (cards.has(newKey) || !cards.has(oldKey)) return false;
                const moved = cards.get(oldKey);
                cards.delete(oldKey);
                cards.set(newKey, moved);
                return true;
            },
        };
        const controller = Object.create(JournalV2Controller.prototype);
        Object.assign(controller, {
            abortController: new AbortController(),
            activatedEmptyPaths: new Set(),
            cardList,
            conflicts: new Map(),
            conflictActions: new Set(),
            conflictProbeTimers: new Map(),
            dirtyBaselines: new Map(),
            editorStates: new Map(),
            editorPool: { rename: () => null },
            focusedKey: null,
            localDrafts: new Map(),
            localEditCaptureTimers: new Map(),
            mountPromises: new Map(),
            parentLeaf: {
                containerEl: { ownerDocument: { defaultView: globalThis } },
            },
            pendingMounts: new Map(),
            plugin: { app },
            refreshGeneration: 0,
            repository: {
                contains: (candidate, selectedQuery) =>
                    candidate.path.startsWith(`${selectedQuery.target}/`),
                readIfIncluded: async (candidate, selectedQuery, _now, content) =>
                    candidate.path.startsWith(`${selectedQuery.target}/`)
                        ? record(candidate, candidate.path, content ?? "disk")
                        : null,
                query: async () => [],
            },
            sessionLeases: new Map(),
            sessions: new Map(),
            sourceRevision: 0,
            sourceQueryAbort: new AbortController(),
            state: reduceJournalState(createJournalState(query()), {
                type: "replace-source",
                records: [record(file, initialPath)],
                virtualToday: null,
            }),
        });
        controller.getVirtualTodayProjection = () => null;
        controller.scheduleConflictProbe = () => undefined;
        controller.reconcileState = (beforeMount) => {
            const keys = new Set(controller.state.items.map((item) => item.key));
            for (const key of cards.keys()) {
                if (!keys.has(key)) cards.delete(key);
            }
            for (const key of keys) {
                if (!cards.has(key)) cards.set(key, card(key));
            }
            beforeMount?.();
        };
        controller.reconcileState();
        return {
            app,
            cards,
            controller,
            files,
            get diskReads() { return diskReads; },
            metadataEvents,
            vaultEvents,
        };
    }

    // Unrelated modifications cause neither a body read nor a state change.
    {
        const file = new TFile("Journal/current.md");
        const outside = new TFile("Other/unrelated.md");
        const harness = createHarness(file);
        harness.files.set(outside.path, outside);
        const previousState = harness.controller.state;
        await harness.controller.handleFileModify(outside);
        assert.equal(harness.diskReads, 0);
        assert.equal(harness.controller.state, previousState);
    }

    // A read of an earlier autosave must not classify a newer local draft as
    // an external conflict or clear it.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const read = deferred();
        harness.app.vault.adapter.read = () => read.promise;
        harness.controller.localDrafts.set(file.path, "draft A");
        const modify = harness.controller.handleFileModify(file);
        harness.controller.localDrafts.set(file.path, "draft B");
        read.resolve("draft A");
        await modify;
        assert.equal(harness.controller.localDrafts.get(file.path), "draft B");
        assert.equal(harness.controller.conflicts.has(file.path), false);
    }

    // An older upsert must not erase a conflict that appeared during its read.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const read = deferred();
        harness.controller.repository.readIfIncluded = () => read.promise;
        const upsert = harness.controller.upsertFile(file, "Synced");
        const conflict = {
            diskContent: "external",
            draft: "local",
            kind: "modified",
            path: file.path,
        };
        harness.controller.conflicts.set(file.path, conflict);
        read.resolve(record(file, file.path, "stale"));
        await upsert;
        assert.equal(harness.controller.conflicts.get(file.path), conflict);
        assert.equal(harness.controller.state.records[0].content, "disk");
    }

    // A source change during an upsert retries membership under the new
    // query, so an older answer cannot restore an excluded record.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const firstRead = deferred();
        const observedTargets = [];
        harness.controller.repository.readIfIncluded = (_file, selectedQuery) => {
            observedTargets.push(selectedQuery.target);
            if (observedTargets.length === 1) return firstRead.promise;
            return Promise.resolve(null);
        };
        const upsert = harness.controller.upsertFile(file, "Synced");
        harness.controller.state = reduceJournalState(harness.controller.state, {
            type: "set-query",
            query: query("Other"),
        });
        firstRead.resolve(record(file, file.path, "stale"));
        await upsert;
        assert.deepEqual(observedTargets, ["Journal", "Other"]);
        assert.deepEqual(harness.controller.state.records, []);
    }

    // A file event committed during a full query forces a new source snapshot.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const reads = [];
        harness.controller.repository.query = () => {
            const read = deferred();
            reads.push(read);
            return read.promise;
        };
        const refresh = harness.controller.replaceSource(query());
        assert.equal(reads.length, 1);
        harness.controller.applySourceRemoval(file.path);
        reads[0].resolve([record(file, file.path, "stale")]);
        await waitUntil(() => reads.length === 2);
        reads[1].resolve([]);
        await refresh;
        assert.deepEqual(harness.controller.state.records, []);
    }

    // A new query can include a file that the currently displayed query
    // excludes. Its create event must invalidate the pending source snapshot.
    {
        const existing = new TFile("Journal/current.md");
        const added = new TFile("Other/new.md");
        const harness = createHarness(existing);
        const reads = [];
        harness.controller.repository.query = () => {
            const read = deferred();
            reads.push(read);
            return read.promise;
        };
        const watcher = new JournalFileEvents(harness.app, async (event) => {
            await harness.controller.handleFileEvent(event);
        }, (event) => {
            if (harness.controller.touchesPendingSource(event)) {
                harness.controller.sourceRevision += 1;
            }
        });
        watcher.start();
        const refresh = harness.controller.replaceSource(query("Other"));
        harness.files.set(added.path, added);
        harness.vaultEvents.emit("create", added);
        reads[0].resolve([]);
        await waitUntil(() => reads.length === 2);
        reads[1].resolve([record(added)]);
        await refresh;
        assert.deepEqual(harness.controller.state.records.map((item) => item.path), [
            added.path,
        ]);
        watcher.dispose();
    }

    // Refresh while a source switch is loading must keep the requested source.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const reads = [];
        harness.controller.repository.query = (selectedQuery) => {
            const read = deferred();
            reads.push({ read, target: selectedQuery.target });
            return read.promise;
        };
        const sourceChange = harness.controller.setQuery(query("Other"));
        const refresh = harness.controller.refresh();
        assert.deepEqual(reads.map(({ target }) => target), ["Other"]);
        reads[0].read.resolve([]);
        await Promise.all([sourceChange, refresh]);
        assert.equal(harness.controller.state.query.target, "Other");
    }

    // Refresh shares a pending source change. If that read fails, neither
    // caller can report the new source as committed.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        harness.controller.repository.query = async () => {
            attempts += 1;
            throw new Error("source unavailable");
        };
        const sourceChange = harness.controller.setQuery(query("Other"));
        const refresh = harness.controller.refresh();
        const results = await Promise.allSettled([sourceChange, refresh]);
        assert.deepEqual(results.map((result) => result.status), [
            "rejected", "rejected",
        ]);
        assert.equal(attempts, 3);
        assert.equal(harness.controller.getCurrentQuery().target, "Journal");
        assert.equal(harness.controller.getPendingQuery(), null);
    }

    // Superseded source reads receive an abort signal so they stop consuming
    // the shared cachedRead budget while the latest selection loads.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const firstRead = deferred();
        const signals = [];
        harness.controller.repository.query = (_query, _now, signal) => {
            signals.push(signal);
            return signals.length === 1 ? firstRead.promise : Promise.resolve([]);
        };
        const first = harness.controller.setQuery(query("Other"));
        const second = harness.controller.setQuery(query());
        assert.equal(signals[0].aborted, true);
        firstRead.resolve([]);
        await Promise.all([first, second]);
        assert.equal(harness.controller.state.query.target, "Journal");
    }

    // Repeated read errors and continuous source invalidations end with a
    // visible failure path instead of leaving an unresolved loading promise.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        harness.controller.repository.query = async () => {
            attempts += 1;
            throw new Error("cachedRead unavailable");
        };
        await assert.rejects(
            harness.controller.setQuery(query("Other")),
            /cachedRead unavailable/
        );
        assert.equal(attempts, 3);
        assert.equal(harness.controller.getCurrentQuery().target, "Journal");
        assert.equal(harness.controller.pendingSourceQuery, null);
    }

    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        harness.controller.repository.query = async () => {
            attempts += 1;
            harness.controller.sourceRevision += 1;
            return [];
        };
        await assert.rejects(
            harness.controller.refresh(),
            /changed repeatedly/
        );
        assert.equal(attempts, 8);
    }

    // Query changes keep excluded dirty cards until their draft is resolved.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.localDrafts.set(file.path, "unsaved");
        await harness.controller.replaceSource(query("Other"));
        assert.equal(harness.controller.localDrafts.get(file.path), "unsaved");
        assert.equal(harness.controller.state.records[0].path, file.path);
        assert.ok(harness.cards.has(file.path));
    }

    // A refresh must not remove an editor whose on-disk file is still empty
    // while its current content exists only as a local draft.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.localDrafts.set(file.path, "unsaved");
        harness.controller.repository.query = async () => [{
            ...record(file, file.path, ""),
            isStrictlyEmpty: true,
        }];
        await harness.controller.replaceSource(query());
        assert.equal(harness.controller.localDrafts.get(file.path), "unsaved");
        assert.ok(harness.cards.has(file.path));
        assert.equal(harness.controller.state.items[0]?.key, file.path);
    }

    // Activating the empty Today card keeps its real editor mounted during
    // a refresh, even before the first autosave has reached the vault.
    {
        const file = new TFile("Journal/today.md");
        const harness = createHarness(file);
        harness.controller.activatedEmptyPaths.add(file.path);
        harness.controller.getVirtualTodayProjection = () => ({
            dateLabel: "Today",
            dateTime: 0,
            path: file.path,
            position: "first",
        });
        harness.controller.repository.query = async () => [{
            ...record(file, file.path, ""),
            isStrictlyEmpty: true,
        }];
        await harness.controller.refresh();
        assert.equal(harness.controller.state.items[0]?.isVirtualToday, false);
        assert.ok(harness.cards.has(file.path));
    }

    // The displayed source record is the pre-edit baseline. Capturing the
    // first draft must not wait for a later disk read that may see a new save.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, {
            getContent: () => "local draft",
        });
        harness.controller.captureLocalDraft(file.path);
        assert.equal(harness.controller.localDrafts.get(file.path), "local draft");
        assert.equal(harness.controller.dirtyBaselines.get(file.path)?.content, "disk");
        assert.equal(harness.diskReads, 0);
    }

    // Rename reads the latest draft after waiting and preserves it as a
    // conflict at the new path when the disk differs.
    {
        const file = new TFile("Journal/new.md");
        const harness = createHarness(file, "Journal/old.md");
        harness.controller.localDrafts.set("Journal/old.md", "draft A");
        const read = deferred();
        harness.controller.repository.readIfIncluded = () => read.promise;
        const rename = harness.controller.handleFileRename(
            file, "Journal/old.md", "Journal/new.md"
        );
        await tick();
        harness.controller.localDrafts.set("Journal/old.md", "draft B");
        read.resolve(record(file, file.path, "disk"));
        await rename;
        assert.equal(harness.controller.localDrafts.get("Journal/new.md"), "draft B");
        assert.equal(harness.controller.localDrafts.has("Journal/old.md"), false);
        assert.equal(harness.controller.conflicts.get("Journal/new.md").draft, "draft B");
        assert.deepEqual(harness.controller.state.records.map((item) => item.path), ["Journal/new.md"]);
    }

    // Moving a dirty file outside the selected source retains the original
    // recovery card and draft instead of silently destroying them.
    {
        const file = new TFile("Other/moved.md");
        const harness = createHarness(file, "Journal/old.md");
        harness.controller.localDrafts.set("Journal/old.md", "unsaved");
        let released = false;
        harness.controller.releaseSession = (path) => {
            if (path === "Journal/old.md") released = true;
        };
        await harness.controller.handleFileRename(file, "Journal/old.md", file.path);
        assert.equal(harness.controller.localDrafts.get("Journal/old.md"), "unsaved");
        assert.equal(harness.controller.conflicts.get("Journal/old.md").kind, "deleted");
        assert.ok(harness.cards.has("Journal/old.md"));
        assert.equal(released, true);
    }

    // Rename must preserve native save ownership, including edits observed
    // before the input callback. A live writer and a conflict cannot coexist.
    {
        const file = new TFile("Journal/new.md");
        const harness = createHarness(file, "Journal/old.md");
        let liveContent = "latest [[draft]]";
        const session = {
            getContent: () => liveContent,
            renamePath(path) { this.path = path; },
        };
        harness.controller.sessions.set("Journal/old.md", session);
        harness.controller.localDrafts.set("Journal/old.md", "older draft");
        await harness.controller.handleFileRename(file, "Journal/old.md", file.path);
        assert.equal(harness.controller.sessions.get(file.path), session);
        assert.equal(harness.controller.conflicts.has(file.path), false, "Native rename created a false conflict");
        assert.equal(harness.controller.localDrafts.get(file.path), liveContent);
        liveContent += " continues";
        harness.controller.captureLocalDraft(file.path);
        assert.equal(harness.controller.localDrafts.get(file.path), liveContent);
    }

    // An earlier native autosave is not an external write while the same
    // MarkdownView still owns the edit session.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, {
            getContent: () => "draft B [[link]]",
        });
        harness.controller.localDrafts.set(file.path, "draft B [[link]]");
        harness.controller.dirtyBaselines.set(file.path, { content: "disk" });
        harness.app.vault.adapter.read = async () => "draft A [[";
        let released = false;
        harness.controller.releaseSession = () => { released = true; };
        await harness.controller.handleFileModify(file);
        assert.equal(released, false);
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.localDrafts.get(file.path), "draft B [[link]]");
    }

    // The fallback disk probe follows the same native-editor ownership rule.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, {
            getContent: () => "draft B [[link]]",
        });
        harness.controller.localDrafts.set(file.path, "draft B [[link]]");
        harness.controller.dirtyBaselines.set(file.path, { content: "disk" });
        harness.app.vault.adapter.read = async () => "draft A [[";
        let released = false;
        harness.controller.releaseSession = () => { released = true; };
        await harness.controller.probeDirtyPath(file.path);
        assert.equal(released, false);
        assert.equal(harness.controller.conflicts.has(file.path), false);
    }

    // A confirmed older save must not clear a newer editor revision whose
    // input callback has not run yet.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, {
            getContent: () => "draft B [[link]]",
        });
        harness.controller.localDrafts.set(file.path, "draft A [[");
        harness.controller.dirtyBaselines.set(file.path, { content: "disk" });
        harness.app.vault.adapter.read = async () => "draft A [[";
        await harness.controller.handleFileModify(file);
        assert.equal(harness.controller.localDrafts.get(file.path), "draft B [[link]]");
        assert.equal(harness.controller.conflicts.has(file.path), false);
    }

    // Duplicate metadata notifications can arrive while the disk is still at
    // the clean baseline. Neither notifications nor probes may detach the
    // native writer; only confirmation of its latest text unpins the lease.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let liveContent = "pending [[link]]";
        let diskContent = "disk";
        let updates = 0;
        let released = false;
        harness.controller.sessions.set(file.path, {
            getContent: () => liveContent,
        });
        harness.controller.updateEditorActivity = () => { updates += 1; };
        harness.controller.releaseSession = () => { released = true; };
        harness.app.vault.adapter.read = async () => diskContent;
        harness.controller.captureLocalDraft(file.path);
        for (let event = 0; event < 3; event += 1) {
            await harness.controller.handleFileModify(file);
            await harness.controller.probeDirtyPath(file.path);
        }
        assert.equal(released, false);
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.localDrafts.get(file.path), liveContent);
        diskContent = liveContent;
        await harness.controller.handleFileModify(file);
        assert.equal(harness.controller.localDrafts.has(file.path), false);
        assert.equal(harness.controller.dirtyBaselines.has(file.path), false);
        assert.equal(harness.controller.state.records[0]?.content, liveContent);
        assert.ok(updates >= 2);

        // Undo is another native revision, not an external conflict.
        liveContent = "disk";
        harness.controller.captureLocalDraft(file.path);
        await harness.controller.handleFileModify(file);
        assert.equal(released, false);
        assert.equal(harness.controller.conflicts.has(file.path), false);
        diskContent = liveContent;
        await harness.controller.probeDirtyPath(file.path);
        assert.equal(harness.controller.localDrafts.has(file.path), false);
        assert.equal(harness.controller.state.records[0]?.content, "disk");
    }

    // A conflicting external write after the native editor has been released
    // retains the pending draft for recovery.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.localDrafts.set(file.path, "local draft");
        harness.app.vault.adapter.read = async () => "external save";
        let released = false;
        harness.controller.releaseSession = (path) => {
            if (path === file.path) released = true;
        };
        await harness.controller.handleFileModify(file);
        assert.equal(released, true);
        assert.equal(harness.controller.conflicts.get(file.path)?.draft, "local draft");
    }

    // If Obsidian has not updated the mounted editor for an external write,
    // remount it before the displayed record moves to the new disk content.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, { getContent: () => "disk" });
        harness.app.vault.adapter.read = async () => "external save";
        let released = false;
        harness.controller.releaseSession = (path) => {
            released = path === file.path;
            harness.controller.sessions.delete(path);
        };
        await harness.controller.handleFileModify(file);
        assert.equal(released, true);
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.state.records[0]?.content, "external save");
    }

    // A native edit that precedes our input callback remains in its editor;
    // a modify event cannot identify whether it came from that editor.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.sessions.set(file.path, {
            getContent: () => "draft before callback",
        });
        harness.app.vault.adapter.read = async () => "external save";
        harness.controller.releaseSession = (path) => {
            harness.controller.sessions.delete(path);
        };
        await harness.controller.handleFileModify(file);
        assert.equal(
            harness.controller.localDrafts.get(file.path),
            "draft before callback"
        );
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.sessions.has(file.path), true);
        assert.equal(harness.controller.state.records[0]?.content, "disk");
    }

    // Reloading the disk never writes a captured snapshot back to the vault.
    // A failed read leaves both the draft and recovery action available.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const conflict = {
            diskContent: "outdated snapshot",
            draft: "local draft",
            kind: "modified",
            path: file.path,
        };
        harness.controller.conflicts.set(file.path, conflict);
        harness.controller.localDrafts.set(file.path, conflict.draft);
        let writes = 0;
        harness.app.vault.modify = async () => { writes += 1; };
        harness.app.vault.adapter.read = async () => {
            throw new Error("disk read failed");
        };
        const originalConsoleError = console.error;
        try {
            console.error = () => undefined;
            await harness.controller.handleConflictAction(file.path, "reload-disk");
        } finally {
            console.error = originalConsoleError;
        }
        assert.equal(writes, 0);
        assert.equal(harness.controller.conflicts.get(file.path), conflict);
        assert.equal(harness.controller.localDrafts.get(file.path), conflict.draft);
        assert.equal(harness.cards.get(file.path)?.status, "Reload failed; draft retained");

        harness.app.vault.adapter.read = async () => "latest disk content";
        await harness.controller.handleConflictAction(file.path, "reload-disk");
        assert.equal(writes, 0);
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.state.records[0]?.content, "latest disk content");
    }

    // A failed recovery write leaves the same action retryable; only a
    // confirmed vault write may clear the conflict and local draft.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const conflict = {
            diskContent: "external",
            draft: "local draft",
            kind: "modified",
            path: file.path,
        };
        harness.controller.conflicts.set(file.path, conflict);
        harness.controller.localDrafts.set(file.path, conflict.draft);
        harness.app.vault.modify = async () => {
            throw new Error("write failed");
        };
        const originalConsoleError = console.error;
        try {
            console.error = () => undefined;
            await harness.controller.handleConflictAction(file.path, "keep-current");
        } finally {
            console.error = originalConsoleError;
        }
        assert.equal(harness.controller.conflicts.get(file.path), conflict);
        assert.equal(harness.controller.localDrafts.get(file.path), conflict.draft);
        harness.app.vault.modify = async () => undefined;
        await harness.controller.handleConflictAction(file.path, "keep-current");
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.localDrafts.has(file.path), false);
        assert.equal(harness.controller.state.records[0]?.content, conflict.draft);
    }

    // A file can disappear while the modified-conflict panel is open. Reload
    // then becomes deleted-file recovery and must retain the local draft.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const conflict = {
            diskContent: "external",
            draft: "local draft",
            kind: "modified",
            path: file.path,
        };
        harness.controller.conflicts.set(file.path, conflict);
        harness.controller.localDrafts.set(file.path, conflict.draft);
        harness.files.delete(file.path);
        await harness.controller.handleConflictAction(file.path, "reload-disk");
        assert.equal(harness.controller.conflicts.get(file.path)?.kind, "deleted");
        assert.equal(harness.controller.localDrafts.get(file.path), conflict.draft);
        assert.equal(harness.cards.get(file.path)?.conflict?.kind, "deleted");
        assert.ok(harness.cards.has(file.path));
    }

    // Recovery buttons must share one in-flight action for the same file.
    // A second create must not resurrect a conflict after the first succeeded.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        const conflict = { diskContent: null, draft: "latest draft", kind: "deleted", path: file.path };
        harness.files.delete(file.path);
        harness.controller.conflicts.set(file.path, conflict);
        harness.controller.localDrafts.set(file.path, conflict.draft);
        const pendingCreate = deferred();
        let creates = 0;
        harness.app.vault.create = async () => {
            creates += 1;
            if (creates > 1) throw new Error("File already exists");
            await pendingCreate.promise;
            harness.files.set(file.path, file);
            return file;
        };
        const first = harness.controller.handleConflictAction(file.path, "restore");
        assert.equal(harness.cards.get(file.path).busy, true);
        const second = harness.controller.handleConflictAction(file.path, "restore");
        await harness.controller.handleConflictAction(file.path, "discard");
        assert.equal(harness.controller.conflicts.get(file.path), conflict);
        pendingCreate.resolve();
        await Promise.all([first, second]);
        assert.equal(creates, 1, "Duplicate recovery started a second vault write");
        assert.equal(harness.controller.conflicts.has(file.path), false);
        assert.equal(harness.controller.localDrafts.has(file.path), false);
        assert.equal(harness.cards.get(file.path).busy, false);
    }

    // A failed read/write completion belongs to its original conflict only.
    // Neither a newer conflict nor a closed view can be overwritten by it.
    for (const action of ["reload-disk", "keep-current"]) {
        for (const closeView of [false, true]) {
            const file = new TFile("Journal/current.md");
            const harness = createHarness(file);
            const original = { diskContent: "old disk", draft: "old draft", kind: "modified", path: file.path };
            const newer = { ...original, draft: "new draft" };
            harness.controller.conflicts.set(file.path, original);
            const io = deferred();
            harness.app.vault.adapter.read = () => io.promise;
            harness.app.vault.modify = () => io.promise;
            const pendingAction = harness.controller.handleConflictAction(file.path, action);
            if (closeView) {
                harness.controller.abortController.abort();
                harness.controller.conflicts.clear();
                harness.controller.localDrafts.clear();
            } else {
                harness.controller.conflicts.set(file.path, newer);
                harness.controller.localDrafts.set(file.path, newer.draft);
            }
            io.reject(new Error("late I/O failure"));
            await pendingAction;
            assert.equal(harness.controller.conflicts.get(file.path), closeView ? undefined : newer);
            assert.equal(harness.controller.localDrafts.get(file.path), closeView ? undefined : newer.draft);
            assert.equal(harness.cards.get(file.path).busy, false);
        }
    }

    // Once the selected file content is applied, a projection failure must
    // clear stale action buttons and report refresh, not retry the old write.
    for (const action of ["reload-disk", "keep-current"]) {
        for (const failureStage of ["read", "reconcile"]) {
            const file = new TFile("Journal/current.md");
            const harness = createHarness(file);
            const conflict = { diskContent: "disk", draft: "draft", kind: "modified", path: file.path };
            harness.controller.conflicts.set(file.path, conflict);
            harness.controller.localDrafts.set(file.path, conflict.draft);
            harness.cards.get(file.path).showConflict(conflict.kind, conflict.draft);
            let writes = 0;
            harness.app.vault.modify = async () => { writes += 1; };
            if (failureStage === "read") {
                harness.controller.repository.readIfIncluded = async () => { throw new Error("projection read failed"); };
            } else {
                harness.controller.reconcileState = () => { throw new Error("reconcile failed"); };
            }
            const originalConsoleError = console.error;
            const errors = [];
            try {
                console.error = (...parts) => errors.push(parts);
                await harness.controller.handleConflictAction(file.path, action);
            } finally { console.error = originalConsoleError; }
            assert.equal(harness.controller.conflicts.has(file.path), false);
            assert.equal(harness.controller.localDrafts.has(file.path), false);
            assert.equal(harness.cards.get(file.path).conflict, null, "Consumed recovery left dead buttons");
            assert.equal(harness.cards.get(file.path).status, "File updated; refresh journal to reopen");
            assert.equal(errors.length, 1, "Projection failure was silently swallowed");
            assert.equal(writes, action === "keep-current" ? 1 : 0);
        }
    }

    // Delete can arrive before DOM input (e.g. an Editor API transaction).
    // Read the native buffer before detaching it, not an older input snapshot.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        harness.controller.localDrafts.set(file.path, "old draft");
        harness.controller.sessions.set(file.path, {
            getContent: () => "latest [[native draft]]",
            destroy() {},
        });
        harness.controller.handleFileDelete(file.path);
        assert.equal(harness.controller.conflicts.get(file.path)?.draft, "latest [[native draft]]");
        assert.equal(harness.controller.localDrafts.get(file.path), "latest [[native draft]]");
    }

    // A failed rename with a dirty editor freezes that editor and leaves an
    // old-path recovery card before a broader source refresh is attempted.
    {
        const file = new TFile("Other/moved.md");
        const harness = createHarness(file, "Journal/old.md");
        harness.controller.localDrafts.set("Journal/old.md", "unsaved");
        let released = false;
        harness.controller.releaseSession = (path) => {
            released = path === "Journal/old.md";
        };
        harness.controller.refresh = async () => undefined;
        harness.controller.handleFailedFileEvent({
            type: "rename",
            file,
            oldPath: "Journal/old.md",
            path: file.path,
        });
        assert.equal(released, true);
        assert.equal(harness.controller.conflicts.get("Journal/old.md")?.draft, "unsaved");
        assert.equal(harness.cards.get("Journal/old.md")?.conflict?.kind, "deleted");
    }

    // The editor may have changed before its local-edit callback ran. Capture
    // that live content before freezing a failed rename.
    {
        const file = new TFile("Other/moved.md");
        const harness = createHarness(file, "Journal/old.md");
        harness.controller.sessions.set("Journal/old.md", {
            getContent: () => "uncaptured input",
        });
        harness.controller.releaseSession = (path) => {
            harness.controller.sessions.delete(path);
        };
        harness.controller.refresh = async () => true;
        harness.controller.handleFailedFileEvent({
            type: "rename",
            file,
            oldPath: "Journal/old.md",
            path: file.path,
        });
        assert.equal(
            harness.controller.conflicts.get("Journal/old.md")?.draft,
            "uncaptured input"
        );
        assert.equal(harness.controller.sessions.has("Journal/old.md"), false);
    }

    // A full query may already have projected the new path before the rename
    // event runs. Independent drafts at both keys must remain recoverable.
    {
        const file = new TFile("Journal/new.md");
        const harness = createHarness(file, "Journal/old.md");
        harness.controller.state = reduceJournalState(harness.controller.state, {
            type: "replace-source",
            records: [
                record(file, "Journal/new.md"),
                record(file, "Journal/old.md"),
            ],
            virtualToday: null,
        });
        harness.controller.reconcileState();
        harness.controller.localDrafts.set("Journal/old.md", "old draft");
        harness.controller.localDrafts.set("Journal/new.md", "new draft");
        await harness.controller.handleFileRename(
            file, "Journal/old.md", "Journal/new.md"
        );
        assert.equal(harness.controller.localDrafts.get("Journal/old.md"), "old draft");
        assert.equal(harness.controller.localDrafts.get("Journal/new.md"), "new draft");
        assert.equal(harness.controller.conflicts.get("Journal/old.md")?.kind, "deleted");
        assert.ok(harness.cards.has("Journal/old.md"));
        assert.ok(harness.cards.has("Journal/new.md"));
    }

    // Queued events capture their path at emit time. The later rename can
    // migrate the still-tracked original path when the first target is stale.
    {
        const file = new TFile("Journal/old.md");
        const harness = createHarness(file);
        const events = [];
        const watcher = new JournalFileEvents(harness.app, async (event) => {
            events.push(event);
            await harness.controller.handleFileEvent(event);
        });
        watcher.start();
        harness.files.delete(file.path);
        file.path = "Journal/middle.md";
        harness.files.set(file.path, file);
        harness.vaultEvents.emit("rename", file, "Journal/old.md");
        harness.files.delete(file.path);
        file.path = "Journal/final.md";
        harness.files.set(file.path, file);
        harness.vaultEvents.emit("rename", file, "Journal/middle.md");
        await waitUntil(() => events.length === 2 &&
            harness.controller.state.records[0]?.path === "Journal/final.md");
        assert.deepEqual(events.map((event) => event.path), [
            "Journal/middle.md", "Journal/final.md",
        ]);
        assert.deepEqual(harness.controller.state.records.map((item) => item.path), [
            "Journal/final.md",
        ]);
        watcher.dispose();
    }

    // An event waiting behind a slow queue invalidates an in-flight source
    // query immediately, before its asynchronous handler starts.
    {
        const file = new TFile("Journal/old.md");
        const harness = createHarness(file);
        const block = deferred();
        const reads = [];
        harness.controller.repository.query = () => {
            const read = deferred();
            reads.push(read);
            return read.promise;
        };
        const watcher = new JournalFileEvents(harness.app, async (event) => {
            await block.promise;
            await harness.controller.handleFileEvent(event);
        }, (event) => {
            if (harness.controller.touchesPendingSource(event)) {
                harness.controller.sourceRevision += 1;
            }
        });
        watcher.start();
        const refresh = harness.controller.refresh();
        harness.files.delete(file.path);
        file.path = "Other/moved.md";
        harness.files.set(file.path, file);
        harness.vaultEvents.emit("rename", file, "Journal/old.md");
        reads[0].resolve([record(file, "Journal/old.md")]);
        await waitUntil(() => reads.length === 2);
        reads[1].resolve([]);
        await refresh;
        assert.deepEqual(harness.controller.state.records.map((item) => item.path), []);
        block.resolve();
        watcher.dispose();
    }

    // A temporary file read error is retried without dropping the event.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        let failures = 0;
        const watcher = new JournalFileEvents(harness.app, async () => {
            attempts += 1;
            if (attempts < 3) throw new Error("temporary read failure");
        }, undefined, () => { failures += 1; });
        watcher.start();
        harness.vaultEvents.emit("modify", file);
        await waitUntil(() => attempts === 3);
        assert.equal(failures, 0);
        watcher.dispose();
    }

    // A persistent error exhausts the bounded retry and reports one recovery
    // signal so the controller can refresh the source and expose the failure.
    {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        let failures = 0;
        const errors = [];
        const originalConsoleError = console.error;
        try {
            console.error = (...parts) => { errors.push(parts); };
            const watcher = new JournalFileEvents(harness.app, async () => {
                attempts += 1;
                throw new Error("persistent read failure");
            }, undefined, () => { failures += 1; });
            watcher.start();
            harness.vaultEvents.emit("modify", file);
            await waitUntil(() => failures === 1);
            assert.equal(attempts, 3);
            assert.equal(errors.length, 1);
            watcher.dispose();
        } finally {
            console.error = originalConsoleError;
        }
    }

    // A saturated or timed-out source read already consumed its time budget.
    // Report it once, then let the next queued vault event run promptly.
    for (const FailureType of [JournalSourceBusyError, JournalSourceReadTimeoutError]) {
        const file = new TFile("Journal/current.md");
        const harness = createHarness(file);
        let attempts = 0;
        let failures = 0;
        let handled = 0;
        const originalConsoleError = console.error;
        try {
            console.error = () => undefined;
            const watcher = new JournalFileEvents(harness.app, async () => {
                attempts += 1;
                if (attempts === 1) throw new FailureType();
                handled += 1;
            }, undefined, () => { failures += 1; });
            watcher.start();
            harness.vaultEvents.emit("modify", file);
            harness.vaultEvents.emit("modify", file);
            await waitUntil(() => failures === 1 && handled === 1);
            assert.equal(attempts, 2, `${FailureType.name} must not retry`);
            watcher.dispose();
        } finally {
            console.error = originalConsoleError;
        }
    }

    console.log("Journal file event tests passed");
} finally {
    await rm(directory, { recursive: true, force: true });
}
