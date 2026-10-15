import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "journal-editor-recovery-"));
try {
    const outfile = join(directory, "adapter.mjs");
    await build({
        stdin: {
            contents: `export { ObsidianEmbeddedEditorAdapter } from "./src/journal-v2/editor/ObsidianEmbeddedEditorAdapter";
                export { MarkdownView, TFile } from "obsidian";`,
            resolveDir: process.cwd(), loader: "ts",
        },
        outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent",
        plugins: [{
            name: "journal-editor-boundary",
            setup(context) {
                context.onResolve({ filter: /^(obsidian)$|leafView$|codeMirrorAdapter$|streamProperties$/ }, ({ path }) => ({ path, namespace: "boundary" }));
                context.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({
                    loader: "js",
                    contents: path === "obsidian" ? `
                        export class TFile { constructor(path) { this.path = path; } }
                        export class MarkdownView { constructor(file, editor) { this.file = file; this.editor = editor; } }
                        export class WorkspaceLeaf {}`
                        : path.endsWith("leafView") ? "export class DailyNoteEditor {}"
                        : path.endsWith("codeMirrorAdapter") ? "export const markEditorAsStream = () => {};"
                        : "export const bindStreamProperties = () => () => {};",
                }));
            },
        }],
    });
    const { ObsidianEmbeddedEditorAdapter, MarkdownView, TFile } = await import(pathToFileURL(outfile).href);
    const adapter = new ObsidianEmbeddedEditorAdapter({ settings: { hideBacklinks: false } });
    const file = new TFile("Journal/recovered.md");
    const staleCursor = new RangeError("Selection points outside of document");
    let resets = 0;
    const editor = { setCursor(position) { assert.deepEqual(position, { line: 0, ch: 0 }); resets += 1; } };
    const view = new MarkdownView(file, editor);
    const leaf = (view, error) => ({ view, async setViewState(state) {
        assert.equal(state.state.file, file.path);
        if (error) throw error;
    } });
    await adapter.openView(leaf(view), file);
    assert.equal(resets, 0, "Ordinary initialization must preserve its cursor");
    const warn = console.warn;
    try {
        console.warn = () => undefined;
        await adapter.openView(leaf(view, staleCursor), file);
    } finally { console.warn = warn; }
    assert.equal(resets, 1, "Recover only the optional stale cursor after the correct file opened");
    for (const [otherView, error] of [
        [view, new Error("Disk read failed")],
        [view, new RangeError("Different range error")],
        [new MarkdownView(new TFile(file.path), editor), staleCursor],
        [{ file }, staleCursor],
    ]) {
        await assert.rejects(adapter.openView(leaf(otherView, error), file), candidate => candidate === error);
    }
    assert.equal(resets, 1, "Other failures must not be hidden as cursor recovery");
    console.log("Journal editor recovery boundary tests passed");
} finally {
    await rm(directory, { recursive: true, force: true });
}
