import assert from "node:assert/strict";
import { build } from "esbuild";
import { around } from "monkey-around";

const originalObsidian = globalThis.__compatTestObsidian;

try {
    const result = await build({
        entryPoints: ["./src/compat/EmbeddedWorkspaceCompatibility.ts"],
        bundle: true,
        format: "esm",
        platform: "node",
        write: false,
        logLevel: "silent",
        plugins: [{
            name: "embedded-compat-test-double",
            setup(context) {
                context.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "compat-test" }));
                context.onLoad({ filter: /.*/, namespace: "compat-test" }, () => ({
                    loader: "js",
                    contents: `
                        export class WorkspaceItem {
                            getRoot() { return this; }
                        }
                        export class View {
                            constructor() { this.leaf = null; }
                        }
                        export class MarkdownView extends View {}
                        export class Workspace {
                            constructor() {
                                this.activeLeaf = null;
                                this.activeEditor = null;
                                this.recent = [];
                                this.rootSplit = new WorkspaceItem();
                                this.activations = [];
                            }
                            getActiveViewOfType(type) {
                                return this.activeLeaf?.view instanceof type ? this.activeLeaf.view : null;
                            }
                            setActiveLeaf(leaf, ...args) {
                                this.activeLeaf = leaf;
                                this.activeEditor = leaf.view instanceof MarkdownView ? leaf.view : null;
                                this.activations.push([leaf, ...args]);
                            }
                            recordMostRecentOpenedFile(file) { this.recent.push(file); }
                        }
                        export class WorkspaceLeaf extends WorkspaceItem {
                            constructor(workspace, view, embedded = false) {
                                super();
                                this.app = { workspace };
                                this.view = view;
                                view.leaf = this;
                                this.embedded = embedded;
                                this.parentLeaf = undefined;
                                this.containerEl = {
                                    isConnected: true,
                                    ownerDocument: { defaultView: null },
                                };
                                this.pinned = false;
                            }
                            getRoot() { return this.app.workspace.rootSplit; }
                            detach() { this.containerEl.isConnected = false; }
                            setPinned(value) { this.pinned = value; }
                            openFile(file) {
                                if (this.embedded && this.app.workspace.delayedEmbeddedOpen) {
                                    return this.app.workspace.delayedEmbeddedOpen(file);
                                }
                                this.app.workspace.recordMostRecentOpenedFile(file);
                                this.app.workspace.recentDecision =
                                    this.app.workspace.recentPlugin?.shouldAddFile(file);
                                return Promise.resolve();
                            }
                        }
                        export class Plugin {
                            constructor(app) { this.app = app; this.cleanups = []; }
                            register(cleanup) { this.cleanups.push(cleanup); }
                        }
                        export class TFile {
                            constructor(path) { this.path = path; }
                        }
                        globalThis.__compatTestObsidian = {
                            MarkdownView, Plugin, TFile, View, Workspace, WorkspaceItem, WorkspaceLeaf,
                        };
                    `,
                }));
                context.onResolve({ filter: /^\.\.\/leafView$/ }, () => ({ path: "leafView", namespace: "compat-helper" }));
                context.onLoad({ filter: /^leafView$/, namespace: "compat-helper" }, () => ({
                    loader: "js",
                    contents: "export function isDailyNoteLeaf(leaf) { return leaf.embedded === true; }",
                }));
            },
        }],
    });
    const source = Buffer.from(result.outputFiles[0].contents).toString("base64");
    const { installEmbeddedWorkspaceCompatibility } = await import(`data:text/javascript;base64,${source}`);
    const { MarkdownView, Plugin, TFile, View, Workspace, WorkspaceLeaf } = globalThis.__compatTestObsidian;
    const workspace = new Workspace();
    const recentPlugin = { files: [], shouldAddFile(file) { this.files.push(file); return true; } };
    workspace.recentPlugin = recentPlugin;
    const plugin = new Plugin({ workspace, plugins: { plugins: { "recent-files-obsidian": recentPlugin } } });
    const nativeOpenFile = WorkspaceLeaf.prototype.openFile;
    installEmbeddedWorkspaceCompatibility(plugin);
    assert.equal(WorkspaceLeaf.prototype.openFile, nativeOpenFile,
        "compatibility setup does not globally replace native file opening");

    const parentView = new View();
    const journalParent = new WorkspaceLeaf(workspace, parentView);
    const markdown = new MarkdownView();
    const child = new WorkspaceLeaf(workspace, markdown, true);
    child.parentLeaf = journalParent;
    const normal = new WorkspaceLeaf(workspace, new MarkdownView());

    workspace.setActiveLeaf(child, { focus: true });
    assert.equal(workspace.activeLeaf, journalParent);
    assert.equal(workspace.activeEditor, markdown);
    assert.deepEqual(workspace.activations.at(-1), [journalParent, { focus: true }]);
    assert.equal(workspace.getActiveViewOfType(View), parentView);
    assert.equal(workspace.getActiveViewOfType(MarkdownView), markdown);
    child.detach();
    assert.equal(workspace.getActiveViewOfType(MarkdownView), null,
        "detached editor must not be returned as the active view");
    assert.equal(workspace.activeEditor, null,
        "detached embedded editor must not stay active");
    child.containerEl.isConnected = true;

    const pageParent = new WorkspaceLeaf(workspace, new View());
    child.parentLeaf = pageParent;
    workspace.setActiveLeaf(child, { focus: true });
    assert.equal(workspace.getActiveViewOfType(MarkdownView), markdown,
        "Page Stream embedded editor must be discoverable");

    child.parentLeaf = journalParent;
    workspace.setActiveLeaf(child, true, false);
    assert.deepEqual(workspace.activations.at(-1), [journalParent, true, false],
        "legacy native arguments must be forwarded intact");
    workspace.setActiveLeaf(normal, { focus: false });
    assert.equal(workspace.activeLeaf, normal);
    assert.equal(workspace.activeEditor, normal.view);
    assert.equal(workspace.getActiveViewOfType(MarkdownView), normal.view);
    child.setPinned(false);
    assert.equal(child.pinned, true, "embedded leaves remain pinned");
    normal.setPinned(false);
    assert.equal(normal.pinned, false, "ordinary leaves retain native pin behavior");

    const file = new TFile("Journal/test.md");
    await child.openFile(file);
    assert.deepEqual(workspace.recent, [file],
        "an explicit embedded link open follows the host's native recent-file policy");
    assert.equal(workspace.recentDecision, true,
        "third-party recent-file policy remains native for explicit link opens");

    let finishEmbeddedOpen;
    workspace.delayedEmbeddedOpen = (openedFile) => new Promise((resolve) => {
        finishEmbeddedOpen = () => {
            workspace.recordMostRecentOpenedFile(openedFile);
            workspace.recentDecision = recentPlugin.shouldAddFile(openedFile);
            resolve();
        };
    });
    const pendingEmbeddedOpen = child.openFile(file);
    await normal.openFile(file);
    assert.deepEqual(workspace.recent, [file, file],
        "an ordinary open remains recorded while another open is pending");
    finishEmbeddedOpen();
    await pendingEmbeddedOpen;
    assert.deepEqual(workspace.recent, [file, file, file],
        "overlapping opens each retain their native attribution");
    assert.equal(workspace.recentDecision, true);
    workspace.delayedEmbeddedOpen = null;

    plugin.app.plugins.plugins["recent-files-obsidian"] = Object.freeze({
        shouldAddFile() { return true; },
    });
    workspace.recentPlugin = plugin.app.plugins.plugins["recent-files-obsidian"];
    await child.openFile(file);
    assert.deepEqual(workspace.recent, [file, file, file, file],
        "a frozen third-party plugin object does not block native opening");

    const external = around(WorkspaceLeaf.prototype, {
        openFile(next) {
            return function (target, state) {
                external.calls++;
                return next.call(this, target, state);
            };
        },
    });
    external.calls = 0;
    workspace.setActiveLeaf(child, { focus: true });
    assert.equal(workspace.activeEditor, markdown);
    for (const cleanup of plugin.cleanups) cleanup();
    assert.equal(workspace.activeEditor, null,
        "plugin unload clears its active embedded editor reference");
    await normal.openFile(file);
    assert.equal(external.calls, 1, "an outer wrapper survives plugin unload");
    assert.deepEqual(workspace.recent, [file, file, file, file, file],
        "ordinary native recent-file behavior survives unload");
    assert.equal(recentPlugin.shouldAddFile(file), true);
    external();

    console.log("Embedded workspace compatibility tests passed");
} finally {
    globalThis.__compatTestObsidian = originalObsidian;
}
