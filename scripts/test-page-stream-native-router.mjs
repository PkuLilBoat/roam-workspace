import assert from "node:assert/strict";
import { build } from "esbuild";
import { around } from "monkey-around";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalHTMLElement = globalThis.HTMLElement;
const originalObsidian = globalThis.__routerTestObsidian;
const originalNotice = globalThis.__routerTestNotice;
const originalConsoleError = console.error;

class TestMouseEvent {
    constructor(target, options = {}) {
        this.target = target;
        this.shiftKey = options.shiftKey ?? true;
        this.metaKey = options.metaKey ?? false;
        this.ctrlKey = options.ctrlKey ?? false;
        this.altKey = options.altKey ?? false;
        this.button = options.button ?? 0;
        this.defaultPrevented = options.defaultPrevented ?? false;
        this.propagationStopped = false;
    }

    preventDefault() {
        this.defaultPrevented = true;
    }

    stopPropagation() {
        this.propagationStopped = true;
    }
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

try {
    globalThis.HTMLElement = class {};
    globalThis.document = {};
    globalThis.window = {};

    const result = await build({
        entryPoints: ["./src/pageStreamNativeRouter.ts"],
        bundle: true,
        format: "esm",
        platform: "node",
        write: false,
        logLevel: "silent",
        plugins: [{
            name: "obsidian-router-test-double",
            setup(context) {
                context.onResolve({ filter: /^obsidian$/ }, () => ({
                    path: "obsidian",
                    namespace: "router-test",
                }));
                context.onLoad({ filter: /.*/, namespace: "router-test" }, () => ({
                    loader: "js",
                    contents: `
                        export class TFile {
                            constructor(path) {
                                this.path = path;
                                this.extension = path.split(".").pop();
                                this.basename = path.split("/").pop().replace(/\\.md$/, "");
                            }
                        }
                        export class MarkdownView {
                            constructor(file, containerEl) {
                                this.file = file;
                                this.containerEl = containerEl;
                            }
                        }
                        export class WorkspaceLeaf {
                            constructor() { this.nativeFiles = []; }
                            openFile(file, state) {
                                this.nativeFiles.push([file, state]);
                                return Promise.resolve();
                            }
                        }
                        export class Workspace {
                            constructor() {
                                this.nativeLinks = [];
                                this.splitRequests = [];
                                this.activeFile = null;
                                this.leaves = [];
                                this.splitLeaf = new WorkspaceLeaf();
                            }
                            getActiveFile() { return this.activeFile; }
                            iterateAllLeaves(callback) {
                                for (const leaf of this.leaves) callback(leaf);
                            }
                            getLeaf(kind) {
                                this.splitRequests.push(kind);
                                return this.splitLeaf;
                            }
                            openLinkText(...args) {
                                this.nativeLinks.push(args);
                                return Promise.resolve();
                            }
                        }
                        export class Notice {
                            constructor(message) { globalThis.__routerTestNotice = message; }
                        }
                        export function parseLinktext(text) {
                            const split = text.indexOf("#");
                            return split < 0
                                ? { path: text, subpath: "" }
                                : { path: text.slice(0, split), subpath: text.slice(split) };
                        }
                        export function resolveSubpath() { return null; }
                        globalThis.__routerTestObsidian = {
                            TFile, MarkdownView, Workspace, WorkspaceLeaf,
                        };
                    `,
                }));
            },
        }],
    });
    const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
    const { PageStreamNativeRouter } = await import("data:text/javascript;base64," + source);
    const { TFile, MarkdownView, Workspace, WorkspaceLeaf } =
        globalThis.__routerTestObsidian;

    class TestElement extends globalThis.HTMLElement {
        constructor(className, attributes = {}, parent = null) {
            super();
            this.className = className;
            this.attributes = attributes;
            this.parent = parent;
            this.textContent = "";
        }

        closest(selector) {
            for (let element = this; element; element = element.parent) {
                if (["button", "input", "textarea", "select"].includes(element.className) &&
                    selector.includes(element.className)) {
                    return element;
                }
                if (selector.includes("." + element.className) &&
                    (!selector.includes("." + element.className + "[data-path]") ||
                        element.getAttribute("data-path"))) {
                    return element;
                }
            }
            return null;
        }

        getAttribute(name) {
            return this.attributes[name] ?? null;
        }

        contains(target) {
            for (let element = target; element; element = element.parent) {
                if (element === this) return true;
            }
            return false;
        }
    }

    const sourceFile = new TFile("Source.md");
    const inactiveSource = new TFile("Folder/Source.md");
    const targetFile = new TFile("Target.md");
    const scopedTarget = new TFile("Folder/Target.md");
    const pdfFile = new TFile("Diagram.pdf");
    const files = new Map(
        [sourceFile, inactiveSource, targetFile, scopedTarget, pdfFile]
            .map((file) => [file.path, file])
    );
    const workspace = new Workspace();
    workspace.activeFile = sourceFile;
    const activeContainer = new TestElement("markdown-view");
    workspace.leaves.push({
        view: new MarkdownView(sourceFile, activeContainer),
    });
    const pushes = [];
    const cleanups = [];
    let clickHandler;
    let pushResult = async () => true;
    const plugin = {
        app: {
            workspace,
            vault: {
                getAbstractFileByPath(path) {
                    return files.get(path) ?? null;
                },
            },
            metadataCache: {
                getFirstLinkpathDest(path, sourcePath) {
                    if (path === "Target") {
                        return sourcePath === inactiveSource.path
                            ? scopedTarget : targetFile;
                    }
                    if (path === "Diagram") return pdfFile;
                    return null;
                },
            },
        },
        registerDomEvent(target, eventName, handler, options) {
            assert.equal(target, globalThis.window,
                "capture runs before document-level link handlers");
            assert.equal(eventName, "click");
            assert.equal(options.capture, true);
            clickHandler = handler;
            cleanups.push(() => { clickHandler = undefined; });
        },
        register(cleanup) {
            cleanups.push(cleanup);
        },
        pushFileToPageStream(...args) {
            pushes.push(args);
            return pushResult();
        },
    };
    const router = new PageStreamNativeRouter(plugin);
    const nativeOpenFile = WorkspaceLeaf.prototype.openFile;
    const nativeOpenLinkText = Workspace.prototype.openLinkText;
    router.install();
    assert.equal(WorkspaceLeaf.prototype.openFile, nativeOpenFile,
        "install does not patch openFile");
    assert.equal(Workspace.prototype.openLinkText, nativeOpenLinkText,
        "install does not patch openLinkText");

    function link(linktext = "Target#Heading", parent = activeContainer) {
        return new TestElement("internal-link", { href: linktext }, parent);
    }

    function row(className = "nav-file-title", path = targetFile.path) {
        return new TestElement(className, { "data-path": path });
    }

    const unrelatedClick = new TestMouseEvent(new TestElement("other"));
    clickHandler(unrelatedClick);
    assert.equal(unrelatedClick.defaultPrevented, false);
    const ambiguousClick = new TestMouseEvent(
        new TestElement("internal-link", { href: "Target" })
    );
    clickHandler(ambiguousClick);
    assert.equal(ambiguousClick.defaultPrevented, false,
        "a link with no identifiable source remains native");
    const unresolvedClick = new TestMouseEvent(link("Missing"));
    clickHandler(unresolvedClick);
    assert.equal(unresolvedClick.defaultPrevented, false,
        "unresolved links remain native");
    const pdfLinkClick = new TestMouseEvent(link("Diagram"));
    clickHandler(pdfLinkClick);
    assert.equal(pdfLinkClick.defaultPrevented, false,
        "non-Markdown links remain native");
    const pdfRowClick = new TestMouseEvent(row("nav-file-title", pdfFile.path));
    clickHandler(pdfRowClick);
    assert.equal(pdfRowClick.defaultPrevented, false,
        "non-Markdown rows remain native");
    const subpathBookmark = new TestMouseEvent(new TestElement("bookmark-item", {
        "data-path": targetFile.path,
        "data-subpath": "#Heading",
    }));
    clickHandler(subpathBookmark);
    assert.equal(subpathBookmark.defaultPrevented, false,
        "bookmarks with a subpath retain native positioning");

    for (const options of [
        { shiftKey: false },
        { metaKey: true },
        { ctrlKey: true },
        { altKey: true },
        { button: 1 },
        { button: 2 },
        { defaultPrevented: true },
    ]) {
        const click = new TestMouseEvent(link(), options);
        clickHandler(click);
        assert.equal(pushes.length, 0, "only plain Shift left clicks route");
    }

    const directClick = new TestMouseEvent(link());
    clickHandler(directClick);
    assert.equal(directClick.defaultPrevented, true);
    assert.equal(directClick.propagationStopped, true);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][1], "link");
    assert.equal(pushes[0][2].subpath, "#Heading");
    assert.equal(pushes[0][0], targetFile);

    const inactiveContainer = new TestElement("markdown-view");
    workspace.leaves.push({
        view: new MarkdownView(inactiveSource, inactiveContainer),
    });
    const inactiveClick = new TestMouseEvent(link("Target", inactiveContainer));
    clickHandler(inactiveClick);
    assert.equal(pushes.at(-1)[0], scopedTarget,
        "the clicked inactive Markdown view supplies the source path");
    const card = new TestElement("roam-page-card", {
        "data-path": inactiveSource.path,
    });
    const cardClick = new TestMouseEvent(link("Target#^block", card));
    clickHandler(cardClick);
    assert.equal(pushes.at(-1)[0], scopedTarget,
        "the clicked embedded card supplies the source path");
    assert.equal(pushes.at(-1)[2].subpath, "#^block");

    for (const className of [
        "nav-file-title",
        "search-result-file-title",
        "bookmark-item",
        "tree-item-self",
    ]) {
        const click = new TestMouseEvent(row(className));
        clickHandler(click);
        assert.equal(click.defaultPrevented, true, className + " routes directly");
        assert.equal(pushes.at(-1)[1], "navigation");
        assert.equal(pushes.at(-1)[0], targetFile);
    }
    const controlClick = new TestMouseEvent(
        new TestElement("button", {}, row())
    );
    const beforeControl = pushes.length;
    clickHandler(controlClick);
    assert.equal(controlClick.defaultPrevented, false,
        "a control inside a file row keeps its native Shift-click action");
    assert.equal(pushes.length, beforeControl);

    const pendingSameTarget = deferred();
    pushResult = () => pendingSameTarget.promise;
    const pendingClick = new TestMouseEvent(row());
    clickHandler(pendingClick);
    const leaf = new WorkspaceLeaf();
    await leaf.openFile(targetFile);
    await workspace.openLinkText("Target", sourceFile.path, "split");
    assert.equal(leaf.nativeFiles.length, 1,
        "an unrelated same-target openFile remains native during a pending route");
    assert.equal(workspace.nativeLinks.length, 1,
        "an unrelated same-target openLinkText remains native during a pending route");
    pendingSameTarget.resolve(true);
    await flush();
    assert.equal(leaf.nativeFiles.length, 1);
    assert.equal(workspace.nativeLinks.length, 1);

    pushResult = async () => false;
    clickHandler(new TestMouseEvent(link()));
    await flush();
    assert.deepEqual(workspace.nativeLinks.at(-1),
        ["Target#Heading", sourceFile.path, "split"],
        "unavailable Page Stream reopens the exact link natively");
    const linkFallbackCount = workspace.nativeLinks.length;
    clickHandler(new TestMouseEvent(row()));
    await flush();
    assert.equal(workspace.splitRequests.at(-1), "split");
    assert.equal(workspace.splitLeaf.nativeFiles.at(-1)[0], targetFile,
        "unavailable Page Stream reopens the file in a native split");
    assert.equal(workspace.nativeLinks.length, linkFallbackCount,
        "file fallback does not reopen a link");

    const expectedErrors = [];
    console.error = (...args) => { expectedErrors.push(args); };
    pushResult = async () => { throw new Error("push failed"); };
    const failedClick = new TestMouseEvent(link());
    clickHandler(failedClick);
    await flush();
    assert.equal(failedClick.defaultPrevented, true);
    assert.equal(workspace.nativeLinks.length, linkFallbackCount + 1,
        "failed push falls back exactly once");
    assert.equal(expectedErrors.length, 1);
    const fileFallbackCount = workspace.splitLeaf.nativeFiles.length;
    clickHandler(new TestMouseEvent(row()));
    await flush();
    assert.equal(workspace.splitLeaf.nativeFiles.length, fileFallbackCount + 1,
        "failed file push falls back exactly once");
    assert.equal(expectedErrors.length, 2);
    console.error = originalConsoleError;

    const newerPending = deferred();
    pushResult = () => newerPending.promise;
    globalThis.__routerTestNotice = null;
    clickHandler(new TestMouseEvent(link()));
    const beforeNewer = workspace.nativeLinks.length;
    clickHandler(new TestMouseEvent(new TestElement("other"), { shiftKey: false }));
    newerPending.resolve(false);
    await flush();
    assert.equal(workspace.nativeLinks.length, beforeNewer,
        "a newer click cancels a pending native fallback");
    assert.equal(globalThis.__routerTestNotice,
        "Could not open the earlier linked note. Try again.",
        "a superseded failed route reports the lost action to the user");

    const newerFilePending = deferred();
    pushResult = () => newerFilePending.promise;
    globalThis.__routerTestNotice = null;
    clickHandler(new TestMouseEvent(row()));
    clickHandler(new TestMouseEvent(new TestElement("other"), { shiftKey: false }));
    newerFilePending.resolve(false);
    await flush();
    assert.equal(globalThis.__routerTestNotice,
        "Could not open the earlier file. Try again.");

    let externalCalls = 0;
    const removeExternal = around(WorkspaceLeaf.prototype, {
        openFile(next) {
            return function (file, state) {
                externalCalls++;
                return next.call(this, file, state);
            };
        },
    });
    const externalWrapper = WorkspaceLeaf.prototype.openFile;
    const unloadPending = deferred();
    pushResult = () => unloadPending.promise;
    clickHandler(new TestMouseEvent(row()));
    const beforeUnload = workspace.splitLeaf.nativeFiles.length;
    for (const cleanup of cleanups) cleanup();
    unloadPending.resolve(false);
    await flush();
    assert.equal(workspace.splitLeaf.nativeFiles.length, beforeUnload,
        "unload cancels a pending native fallback");
    assert.equal(WorkspaceLeaf.prototype.openFile, externalWrapper,
        "router unload preserves a third-party wrapper");
    await leaf.openFile(targetFile);
    assert.equal(externalCalls, 1);
    removeExternal();
    assert.equal(WorkspaceLeaf.prototype.openFile, nativeOpenFile);
    assert.equal(Workspace.prototype.openLinkText, nativeOpenLinkText);

    console.log("Page Stream native router tests passed");
} finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.__routerTestObsidian = originalObsidian;
    globalThis.__routerTestNotice = originalNotice;
    console.error = originalConsoleError;
}
