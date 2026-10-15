import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "journal-source-test-"));
const outfile = join(temporaryDirectory, "repository.mjs");

try {
    await build({
        stdin: {
            contents: `
                export { JournalSourceBusyError, JournalSourceReadTimeoutError, JournalSourceRepository } from "./src/journal-v2/source/JournalSourceRepository.ts";
                export { JournalFileEvents } from "./src/journal-v2/source/JournalFileEvents.ts";
                export { TFile, TFolder } from "obsidian";
            `,
            loader: "ts",
            resolveDir: process.cwd(),
            sourcefile: "journal-source-test-entry.ts",
        },
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
        plugins: [{
            name: "obsidian-source-test-stubs",
            setup(buildContext) {
                buildContext.onResolve(
                    { filter: /^(obsidian|obsidian-daily-notes-interface)$/ },
                    ({ path }) => ({ path, namespace: "test-stub" })
                );
                buildContext.onLoad(
                    { filter: /.*/, namespace: "test-stub" },
                    ({ path }) => ({
                        contents: path === "obsidian"
                            ? `
                                export class TFile {
                                    constructor(path, mtime = 0) {
                                        this.path = path;
                                        this.name = path.split("/").at(-1);
                                        this.extension = this.name.split(".").at(-1);
                                        this.basename = this.name.slice(0, -(this.extension.length + 1));
                                        this.stat = { ctime: mtime, mtime };
                                        this.parent = null;
                                    }
                                }
                                export class TFolder {
                                    constructor(path, children = []) {
                                        this.path = path;
                                        this.children = children;
                                        for (const child of children) child.parent = this;
                                    }
                                }
                            `
                            : "export const getAllDailyNotes = () => globalThis.__journalTestDailyNotes ?? {};",
                        loader: "js",
                    })
                );
            },
        }],
    });

    const {
        JournalSourceBusyError,
        JournalSourceReadTimeoutError,
        JournalSourceRepository,
        JournalFileEvents,
        TFile,
        TFolder,
    } = await import(
        pathToFileURL(outfile).href
    );
    const query = (overrides = {}) => ({
        selectionMode: "folder",
        target: "Journal",
        timeField: "name",
        selectedRange: "all",
        customRange: null,
        ...overrides,
    });
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const waitUntil = async (predicate) => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (predicate()) return;
            await tick();
        }
        throw new Error("Timed out waiting for repository reads");
    };
    const appFor = (folder, cachedRead, caches = new Map()) => ({
        vault: {
            getAbstractFileByPath: (path) => path === folder.path ? folder : null,
            getMarkdownFiles: () => folder.children.filter((child) => child instanceof TFile),
            cachedRead,
        },
        metadataCache: {
            getFileCache: (file) => caches.get(file.path) ?? null,
        },
        workspace: {
            containerEl: { ownerDocument: { defaultView: globalThis } },
        },
    });

    // A file path is captured when the query selects its candidates. A later
    // TFile rename must not turn an old-folder result into a new-path record.
    {
        const file = new TFile("Journal/2026-09-23.md");
        const folder = new TFolder("Journal", [file]);
        let finishRead;
        const app = appFor(folder, () => new Promise((resolve) => {
            finishRead = resolve;
        }));
        const repository = new JournalSourceRepository(app);
        const result = repository.query(query());
        await waitUntil(() => finishRead !== undefined);
        file.path = "Other/new.md";
        file.name = "new.md";
        file.basename = "new";
        finishRead("content from the pending read");
        const records = await result;
        assert.equal(records.length, 1);
        assert.equal(records[0].path, "Journal/2026-09-23.md");
        assert.equal(records[0].dateLabel, "2026-09-23");
    }

    {
        const file = new TFile("Journal/2026-09-24.md");
        const folder = new TFolder("Journal", [file]);
        let finishRead;
        const repository = new JournalSourceRepository(appFor(
            folder,
            () => new Promise((resolve) => { finishRead = resolve; })
        ));
        const result = repository.readIfIncluded(file, query());
        await waitUntil(() => finishRead !== undefined);
        file.path = "Other/moved.md";
        finishRead("content");
        assert.equal((await result)?.path, "Journal/2026-09-24.md");
    }

    // The optional enqueue hook fires during the vault callback, before the
    // serialized async handler begins; it receives the event-time path.
    {
        const listeners = new Map();
        const source = {
            on(name, listener) {
                listeners.set(name, listener);
                return { name, listener };
            },
            offref(ref) {
                listeners.delete(ref.name);
            },
        };
        const observed = [];
        const handled = [];
        const app = { vault: source, metadataCache: source };
        const watcher = new JournalFileEvents(
            app,
            async (event) => { handled.push(event.path); },
            (event) => { observed.push(event.path); }
        );
        watcher.start();
        const file = new TFile("Journal/old.md");
        listeners.get("rename")(file, "Journal/earlier.md");
        assert.deepEqual(observed, ["Journal/old.md"]);
        assert.deepEqual(handled, []);
        file.path = "Journal/new.md";
        await tick();
        assert.deepEqual(handled, ["Journal/old.md"]);
        watcher.dispose();
    }

    // Two simultaneous queries share the 12-read budget, even when reads finish
    // out of order. Each result still follows the selected file order.
    {
        const files = Array.from({ length: 25 }, (_, index) =>
            new TFile(`Journal/${String(24 - index).padStart(2, "0")}.md`)
        );
        const folder = new TFolder("Journal", files);
        const pending = [];
        let active = 0;
        let maximumActive = 0;
        const app = appFor(folder, (file) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            return new Promise((resolve) => {
                pending.push({
                    file,
                    resolve: () => {
                        active -= 1;
                        resolve(file.path === "Journal/00.md" ? "   " : file.path);
                    },
                });
            });
        });
        const repository = new JournalSourceRepository(app);
        const first = repository.query(query());
        const second = repository.query(query());
        await waitUntil(() => pending.length === 12);
        assert.equal(active, 12);
        await tick();
        assert.equal(pending.length, 12);

        let released = 0;
        while (released < files.length * 2) {
            await waitUntil(() => pending.length > released);
            const batch = pending.slice(released);
            for (const read of batch.reverse()) read.resolve();
            released += batch.length;
            await tick();
        }
        const [firstRecords, secondRecords] = await Promise.all([first, second]);
        const expectedPaths = files.map((file) => file.path).sort();
        assert.deepEqual(firstRecords.map((record) => record.path), expectedPaths);
        assert.deepEqual(secondRecords.map((record) => record.path), expectedPaths);
        assert.equal(firstRecords[0].isStrictlyEmpty, true);
        assert.equal(maximumActive, 12);
        assert.equal(active, 0);
    }

    // A rejected read rejects the whole query and prevents workers from
    // starting further reads. Its slots remain reusable afterward.
    {
        const files = Array.from({ length: 20 }, (_, index) =>
            new TFile(`Journal/${String(index).padStart(2, "0")}.md`)
        );
        const folder = new TFolder("Journal", files);
        const pending = [];
        const app = appFor(folder, (file) => new Promise((resolve, reject) => {
            pending.push({ file, resolve, reject });
        }));
        const repository = new JournalSourceRepository(app);
        const failed = repository.query(query());
        await waitUntil(() => pending.length === 12);
        pending[3].reject(new Error("cachedRead failed"));
        await assert.rejects(failed, /cachedRead failed/);
        for (const [index, read] of pending.entries()) {
            if (index !== 3) read.resolve(read.file.path);
        }
        await tick();
        assert.equal(pending.length, 12);
        app.vault.cachedRead = async (file) => file.path;
        assert.equal((await repository.query(query())).length, files.length);
    }

    // Cancelling a superseded query lets its in-flight reads settle without
    // scheduling more work ahead of the current source selection.
    {
        const files = Array.from({ length: 25 }, (_, index) =>
            new TFile(`Journal/${String(index).padStart(2, "0")}.md`)
        );
        const folder = new TFolder("Journal", files);
        const pending = [];
        const app = appFor(folder, (file) => new Promise((resolve) => {
            pending.push({ file, resolve });
        }));
        const repository = new JournalSourceRepository(app);
        const abort = new AbortController();
        const obsolete = repository.query(query(), Date.now(), abort.signal);
        await waitUntil(() => pending.length === 12);
        abort.abort();
        await assert.rejects(obsolete, /cancelled/);
        for (const read of pending) read.resolve(read.file.path);
        await tick();
        assert.equal(pending.length, 12);
        app.vault.cachedRead = async (file) => file.path;
        assert.equal((await repository.query(query())).length, files.length);
    }

    // An uncancellable native read may stay in flight, but the next source
    // selection must fail visibly instead of waiting on a slot forever.
    {
        const files = Array.from({ length: 25 }, (_, index) =>
            new TFile(`Journal/${String(index).padStart(2, "0")}.md`)
        );
        const folder = new TFolder("Journal", files);
        const pending = [];
        const app = appFor(folder, (file) => new Promise((resolve) => {
            pending.push({ file, resolve });
        }));
        const repository = new JournalSourceRepository(app, 20);
        const oldAbort = new AbortController();
        const oldQuery = repository.query(query(), Date.now(), oldAbort.signal);
        await waitUntil(() => pending.length === 12);
        oldAbort.abort();
        await assert.rejects(oldQuery, /cancelled/);
        const currentQuery = repository.query(query());
        await assert.rejects(currentQuery, JournalSourceBusyError);
        assert.equal(pending.length, 12);
        for (const read of pending) read.resolve(read.file.path);
        await tick();
        app.vault.cachedRead = async (file) => file.path;
        assert.equal((await repository.query(query())).length, files.length);
    }

    // An in-flight native read may never settle. The caller must fail in a
    // bounded time, while its physical slot remains occupied until native
    // completion so repeated retries cannot exceed the 12-read budget.
    {
        const files = Array.from({ length: 13 }, (_, index) =>
            new TFile(`Journal/${String(index).padStart(2, "0")}.md`)
        );
        const folder = new TFolder("Journal", files);
        const pending = [];
        const app = appFor(folder, (file) => new Promise((resolve) => {
            pending.push({ file, resolve });
        }));
        const repository = new JournalSourceRepository(app, 10, 20);
        await assert.rejects(repository.query(query()), JournalSourceReadTimeoutError);
        assert.equal(pending.length, 12);
        assert.equal(repository.activeSourceReads, 12);
        await assert.rejects(repository.query(query()), JournalSourceBusyError);
        assert.equal(pending.length, 12, "busy retry must not start more native reads");
        for (const read of pending) read.resolve(read.file.path);
        await tick();
        assert.equal(repository.activeSourceReads, 0);
        app.vault.cachedRead = async (file) => file.path;
        assert.equal((await repository.query(query())).length, files.length);
    }

    // File events call readIfIncluded without an AbortSignal. It shares the
    // same timeout and physical budget, so a stuck read cannot pin the serial
    // event chain forever.
    {
        const file = new TFile("Journal/2026-09-24.md");
        const folder = new TFolder("Journal", [file]);
        let finishRead;
        const app = appFor(folder, () => new Promise((resolve) => {
            finishRead = resolve;
        }));
        const repository = new JournalSourceRepository(app, 10, 20);
        await assert.rejects(repository.readIfIncluded(file, query()), JournalSourceReadTimeoutError);
        assert.equal(repository.activeSourceReads, 1);
        app.vault.cachedRead = async () => "new content";
        assert.equal((await repository.readIfIncluded(file, query()))?.content, "new content");
        finishRead("late content");
        await tick();
        assert.equal(repository.activeSourceReads, 0);
    }

    // The synchronous membership check agrees with readIfIncluded and avoids
    // reading source text for files outside source or time filters.
    {
        const today = new Date(2026, 8, 23, 12).getTime();
        const recent = new TFile("Journal/recent.md", today);
        const old = new TFile("Journal/old.md", new Date(2026, 7, 1).getTime());
        const nested = new TFile("Journal/Work/nested.md", today);
        const outside = new TFile("Other/outside.md", today);
        const nonMarkdown = new TFile("Journal/attachment.txt", today);
        const nestedFolder = new TFolder("Journal/Work", [nested]);
        const folder = new TFolder("Journal", [old, recent, nestedFolder, nonMarkdown]);
        const caches = new Map([
            [recent.path, { tags: [{ tag: "#work" }] }],
            [outside.path, { tags: [{ tag: "#work" }] }],
        ]);
        let readCount = 0;
        const app = appFor(folder, async (file) => {
            readCount += 1;
            return file.path;
        }, caches);
        const repository = new JournalSourceRepository(app);
        const recentQuery = query({ selectedRange: "recent-7", timeField: "mtime" });
        assert.equal(repository.contains(recent, recentQuery, today), true);
        assert.equal(repository.contains(nested, recentQuery, today), true);
        assert.equal(repository.contains(old, recentQuery, today), false);
        assert.equal(repository.contains(outside, recentQuery, today), false);
        assert.equal(repository.contains(nonMarkdown, recentQuery, today), false);
        assert.equal(await repository.readIfIncluded(old, recentQuery, today), null);
        assert.equal(await repository.readIfIncluded(outside, recentQuery, today), null);
        assert.equal(readCount, 0);
        assert.deepEqual(
            (await repository.query(recentQuery, today)).map((record) => record.path),
            [recent.path, nested.path]
        );
        assert.equal(readCount, 2);

        assert.equal(repository.contains(recent, query({ selectionMode: "tag", target: "work" }), today), true);
        assert.equal(repository.contains(outside, query({ selectionMode: "tag", target: "#work" }), today), true);
        assert.equal(repository.contains(old, query({ selectionMode: "tag", target: "work" }), today), false);
        globalThis.__journalTestDailyNotes = { today: recent };
        assert.equal(repository.contains(recent, query({ selectionMode: "daily" }), today), true);
        assert.equal(repository.contains(nested, query({ selectionMode: "daily" }), today), false);
        const known = await repository.readIfIncluded(recent, recentQuery, today, "known");
        assert.equal(known.content, "known");
        assert.equal(readCount, 2);
    }

    console.log("Journal source repository tests passed");
} finally {
    delete globalThis.__journalTestDailyNotes;
    await rm(temporaryDirectory, { recursive: true, force: true });
}
