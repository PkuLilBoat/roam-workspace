import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = "./.tmp-page-stream-editor-priority-test.mjs";

await build({
    entryPoints: ["./src/pageStreamEditorPriority.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

try {
    const {
        comparePageStreamEditorPriority,
        resolvePageStreamEditorPriority,
        shouldPinPageStreamEditor,
    } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

    const editing = resolvePageStreamEditorPriority({
        collapsed: false,
        editing: true,
        nearViewport: false,
        visible: false,
    });
    const visible = resolvePageStreamEditorPriority({
        collapsed: false,
        editing: false,
        nearViewport: true,
        visible: true,
    });
    const near = resolvePageStreamEditorPriority({
        collapsed: false,
        editing: false,
        nearViewport: true,
        visible: false,
    });
    const offscreen = resolvePageStreamEditorPriority({
        collapsed: false,
        editing: false,
        nearViewport: false,
        visible: false,
    });
    const collapsed = resolvePageStreamEditorPriority({
        collapsed: true,
        editing: false,
        nearViewport: true,
        visible: true,
    });

    assert.deepEqual(
        [editing, visible, near, offscreen, collapsed],
        [
            "editing",
            "visible-expanded",
            "near-viewport",
            "collapsed-offscreen",
            "collapsed-offscreen",
        ]
    );
    assert.equal(shouldPinPageStreamEditor(editing), true);
    assert.equal(shouldPinPageStreamEditor(visible), true);
    assert.equal(shouldPinPageStreamEditor(near), false);
    assert.ok(comparePageStreamEditorPriority(editing, visible) < 0);
    assert.ok(comparePageStreamEditorPriority(visible, near) < 0);
    assert.ok(comparePageStreamEditorPriority(near, offscreen) < 0);
    console.log("Page Stream editor priority tests passed");
} finally {
    await unlink(outfile).catch(() => undefined);
}
