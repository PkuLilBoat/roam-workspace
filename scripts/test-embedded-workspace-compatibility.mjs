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
                        export class FileView extends View {}
                        export class MarkdownView extends FileView {}
                        export class Workspace {
                            constructor() {
                                this.activeLeaf = null;
                                this.activeEditor = null;
                                this.recent = [];
                                this.rootSplit = new WorkspaceItem();
                                this.activations = [];
                            }
                            getActiveFileView() {
                                return this.activeLeaf?.view instanceof FileView ? this.activeLeaf.view : this.lastFileView ?? null;
                            }
                            createLeafInParent(parent) {
                                const leaf = new WorkspaceLeaf(this, new View());
                                leaf.parent = parent;
                                this.setActiveLeaf(leaf);
                                if (parent.fail) throw Error('mount failed');
                                return leaf;
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
                                    ownerDocument: { defaultView: null, activeElement: null },
                                    contains: (element) => element === this,
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
                            FileView, MarkdownView, Plugin, TFile, View, Workspace, WorkspaceItem, WorkspaceLeaf,
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
    workspace.lastFileView = normal.view;

    const passiveParent = {containerEl: {closest: () => ({})}};
    const ordinaryParent = {containerEl: {closest: () => null}};
    workspace.setActiveLeaf(normal);
    const pendingChild = workspace.createLeafInParent(passiveParent, 0);
    assert.equal(workspace.activeLeaf, normal,
        "background creation before parentLeaf assignment must preserve ordinary focus");
    assert.equal(pendingChild.parentLeaf, undefined);

    workspace.setActiveLeaf(child, { focus: true });
    assert.equal(workspace.activeLeaf, journalParent);
    assert.equal(workspace.activeEditor, markdown);
    assert.deepEqual(workspace.activations.at(-1), [journalParent, { focus: true }]);
    assert.equal(workspace.getActiveViewOfType(View), parentView);
    assert.equal(workspace.getActiveViewOfType(MarkdownView), markdown);
    assert.equal(workspace.getActiveFileView(), markdown,
        "status-bar file lookup must agree with the active embedded editor, not a background pane");
    child.containerEl.ownerDocument.activeElement = child;
    workspace.setActiveLeaf(journalParent);
    assert.equal(workspace.activeEditor, markdown,
        "bubbling native focus must not forget the embedded editor when it reactivates its parent");
    assert.equal(workspace.getActiveFileView(), markdown);
    workspace.createLeafInParent(passiveParent, 0);
    assert.equal(workspace.activeLeaf, journalParent);
    assert.equal(workspace.getActiveFileView(), markdown,
        "background creation must preserve the focused embedded editor");
    passiveParent.fail = true;
    assert.throws(() => workspace.createLeafInParent(passiveParent, 0), /mount failed/);
    workspace.setActiveLeaf(pendingChild);
    assert.equal(workspace.activeLeaf, pendingChild,
        "failed creation must release its transient activation guard");
    passiveParent.fail = false;
    const ordinaryCreated = workspace.createLeafInParent(ordinaryParent, 0);
    assert.equal(workspace.activeLeaf, ordinaryCreated,
        "ordinary native leaf creation must still activate its new leaf");
    workspace.setActiveLeaf(child, {focus: true});
    child.containerEl.ownerDocument.activeElement = null;
    workspace.setActiveLeaf(journalParent);
    assert.equal(workspace.activeEditor, null,
        "an explicit parent activation outside the child clears embedded context");
    workspace.setActiveLeaf(child, { focus: true });
    child.containerEl.isConnected = false;
    assert.equal(workspace.getActiveFileView(), normal.view,
        "disconnected embedded view falls back to native file lookup");
    child.containerEl.isConnected = true;
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
    assert.equal(workspace.getActiveFileView(), normal.view,
        "switching to an ordinary pane keeps native file lookup");
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
    assert.equal(workspace.getActiveFileView(), normal.view,
        "plugin unload restores the original file lookup");
    const workspaceWithoutFileLookup = new Workspace();
    workspaceWithoutFileLookup.getActiveFileView = undefined;
    const fallbackPlugin = new Plugin({ workspace: workspaceWithoutFileLookup });
    installEmbeddedWorkspaceCompatibility(fallbackPlugin);
    assert.equal(workspaceWithoutFileLookup.getActiveFileView, undefined,
        "missing private host capability must not be invented");
    for (const cleanup of fallbackPlugin.cleanups) cleanup();
    external();

    console.log("Embedded workspace compatibility tests passed");
} finally {
    globalThis.__compatTestObsidian = originalObsidian;
}
