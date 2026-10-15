import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const validatorPath = path.join(root, "scripts", "validate-ui-audit.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "journal-stream-ui03-"));
const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const marker = "journal-stream-preview-edit-save-ui03-valid";

const state = (isEditing, collapsed = true) => ({
    path: fixturePath,
    isEditing,
    editorMounted: true,
    editorReady: true,
    singleEditorDom: true,
    editorMountId: "editor-mount-1",
    properties: {
        mountStatus: "native",
        visibleContainerCount: 1,
        collapsed,
    },
});

const validAudit = {
    runAt: "2026-08-24T00:00:00.000Z",
    runId: "ui03-valid",
    pluginId: "roam-workspace",
    pluginVersion: "0.1.0",
    obsidianVersion: "1.13.7",
    vaultRoot: "/Users/feng/Documents/OBSIDIAN/TEST",
    viewport: { width: 1600, height: 970, devicePixelRatio: 2 },
    settings: {
        journalFolder: "Journal",
        defaultOpenMode: "journal-folder",
        initialRange: "recent-30",
        enableExportMarkdown: true,
    },
    status: "passed",
    viewState: {
        selectionMode: "folder",
        target: "Journal/_journal_stream_regression_fixture",
        timeField: "journalDate",
        selectedRange: "all",
    },
    snapshot: {
        selectionMode: "folder",
        target: "Journal/_journal_stream_regression_fixture",
        timeField: "journalDate",
        selectedRange: "all",
        renderedFileCount: 4,
        pendingFileCount: 0,
        hasMore: false,
        visibleNoteCount: 1,
        renderedFilePaths: [fixturePath],
        visibleNotePaths: [fixturePath],
        titles: ["2026-08-12"],
        dom: { noteContainerCount: 1, previewCount: 0, editorCount: 1 },
    },
    actions: {
        previewEditSave: {
            status: "passed",
            path: fixturePath,
            marker,
            sourceBefore: { bytes: 256, markerAbsent: true },
            before: state(false),
            editState: state(true),
            saveState: {
                ...state(true),
                status: "passed",
                marker,
                sourceContainsMarker: true,
                sourceBytes: 307,
            },
            previewRestoreState: state(false),
            expandedPreviewState: {
                ...state(false),
                properties: {
                    ...state(false).properties,
                    collapsed: false,
                },
            },
            reeditState: state(true, false),
            finalPreviewState: state(false, false),
            singleDomStable: true,
            geometry: {
                bodyLeftDelta: 0,
                bodyTopDelta: 0,
                pageLeftDelta: 0,
                pageTopDelta: 0,
                pageWidthDelta: 0,
                streamScrollTopDelta: 0,
                targetViewportTopDelta: 0,
                alignedWithinOnePixel: true,
            },
            propertiesStable: true,
            transaction: {
                status: "passed",
                runCompleted: true,
                runError: null,
                cleanup: {
                    restoreAttempted: true,
                    restoreError: null,
                    verificationError: null,
                    restored: true,
                    sourceExact: true,
                    editorExact: true,
                    markerRemoved: true,
                    markerRemovedFromSource: true,
                    markerRemovedFromEditor: true,
                    propertiesRestored: true,
                },
            },
            cleanup: {
                restoreAttempted: true,
                restoreError: null,
                verificationError: null,
                restored: true,
                sourceExact: true,
                editorExact: true,
                markerRemoved: true,
                markerRemovedFromSource: true,
                markerRemovedFromEditor: true,
                propertiesRestored: true,
            },
            postCleanupState: state(false),
        },
    },
};

try {
    await expectValidation(
        "ordinary-note-fallback",
        mutate(validAudit, (audit) => {
            audit.actions.previewEditSave.path = "Journal/260824.md";
        }),
        false
    );
    await expectValidation("valid", validAudit, true);
    for (const [name, update] of [
        ["marker-present-before", (a) => { a.actions.previewEditSave.sourceBefore.markerAbsent = false; }],
        ["transaction-failed", (a) => { a.actions.previewEditSave.transaction.status = "failed"; }],
        ["restore-not-attempted", (a) => { a.actions.previewEditSave.cleanup.restoreAttempted = false; }],
        ["source-not-exact", (a) => { a.actions.previewEditSave.cleanup.sourceExact = false; }],
        ["editor-not-exact", (a) => { a.actions.previewEditSave.cleanup.editorExact = false; }],
        ["editor-marker-remains", (a) => { a.actions.previewEditSave.cleanup.markerRemovedFromEditor = false; }],
        ["mount-id-changed", (a) => { a.actions.previewEditSave.reeditState.editorMountId = "editor-mount-2"; }],
        ["save-mount-id-changed", (a) => { a.actions.previewEditSave.saveState.editorMountId = "editor-mount-2"; }],
        ["expanded-properties-collapsed", (a) => { a.actions.previewEditSave.expandedPreviewState.properties.collapsed = true; }],
        ["duplicate-properties", (a) => { a.actions.previewEditSave.finalPreviewState.properties.visibleContainerCount = 2; }],
        ["state-duplicate-editor", (a) => { a.actions.previewEditSave.editState.singleEditorDom = false; }],
        ["geometry-over-limit", (a) => { a.actions.previewEditSave.geometry.pageTopDelta = 1.01; }],
        ["post-cleanup-editing", (a) => { a.actions.previewEditSave.postCleanupState.isEditing = true; }],
    ]) {
        await expectValidation(name, mutate(validAudit, update), false);
    }

    const outfile = path.join(tempRoot, "preview-edit-save-contract.mjs");
    await build({
        entryPoints: ["src/dev/audit/previewEditSaveAuditContract.ts"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });
    const { runPreviewEditSaveAuditTransaction } = await import(
        `${pathToFileURL(outfile).href}?t=${Date.now()}`
    );
    await testTransactionSuccess(runPreviewEditSaveAuditTransaction);
    await testRunFailureStillRestores(runPreviewEditSaveAuditTransaction);
    await testRestoreFailureIsReported(runPreviewEditSaveAuditTransaction);
    await testMarkerCollisionFailsClosed(runPreviewEditSaveAuditTransaction);
    await testVerificationFailureIsReported(runPreviewEditSaveAuditTransaction);

    console.log(
        "UI-03 preview/edit/save audit contract passed (temporary directory + spies only)"
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

async function testTransactionSuccess(runTransaction) {
    const calls = [];
    const result = await runTransaction({
        marker: "marker",
        readOriginal: async () => "original",
        run: async () => { calls.push("run"); return "ui-result"; },
        restore: async () => { calls.push("restore"); },
        verify: async () => {
            calls.push("verify");
            return restoredVerification();
        },
    });
    assert.equal(result.status, "passed");
    assert.equal(result.runResult, "ui-result");
    assert.deepEqual(calls, ["run", "restore", "verify"]);
}

async function testRunFailureStillRestores(runTransaction) {
    let restoreCount = 0;
    const result = await runTransaction({
        marker: "marker",
        readOriginal: async () => "original",
        run: async () => { throw new Error("ui-stage-failed"); },
        restore: async () => { restoreCount += 1; },
        verify: async () => restoredVerification(),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.runError, "ui-stage-failed");
    assert.equal(result.cleanup.restored, true);
    assert.equal(restoreCount, 1);
}

async function testRestoreFailureIsReported(runTransaction) {
    const result = await runTransaction({
        marker: "marker",
        readOriginal: async () => "original",
        run: async () => "ui-result",
        restore: async () => { throw new Error("restore-failed"); },
        verify: async () => ({ ...restoredVerification(), sourceExact: false }),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.cleanup.restoreAttempted, true);
    assert.equal(result.cleanup.restoreError, "restore-failed");
    assert.equal(result.cleanup.restored, false);
}

async function testMarkerCollisionFailsClosed(runTransaction) {
    let runCount = 0;
    let restoreCount = 0;
    const result = await runTransaction({
        marker: "marker",
        readOriginal: async () => "original marker",
        run: async () => { runCount += 1; },
        restore: async () => { restoreCount += 1; },
        verify: async () => restoredVerification(),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "marker-already-present");
    assert.equal(runCount, 0);
    assert.equal(restoreCount, 0);
}

async function testVerificationFailureIsReported(runTransaction) {
    const result = await runTransaction({
        marker: "marker",
        readOriginal: async () => "original",
        run: async () => "ui-result",
        restore: async () => {},
        verify: async () => ({ ...restoredVerification(), editorExact: false }),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.cleanup.editorExact, false);
    assert.equal(result.cleanup.restored, false);
}

function restoredVerification() {
    return {
        sourceExact: true,
        editorExact: true,
        markerRemovedFromSource: true,
        markerRemovedFromEditor: true,
        propertiesRestored: true,
    };
}

function mutate(value, update) {
    const copy = JSON.parse(JSON.stringify(value));
    update(copy);
    return copy;
}

async function expectValidation(name, audit, shouldPass) {
    const auditPath = path.join(tempRoot, `${name}.json`);
    await writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
    const result = spawnSync(
        process.execPath,
        [validatorPath, auditPath, "--require-preview-edit-save", "--target", "Journal/_journal_stream_regression_fixture", "--range", "all"],
        {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                JOURNAL_STREAM_VAULT_ROOT: "/Users/feng/Documents/OBSIDIAN/TEST",
            },
        }
    );
    if ((result.status === 0) !== shouldPass) {
        throw new Error(
            `${name} expected ${shouldPass ? "pass" : "failure"}, got exit ${result.status}: ${result.stdout}${result.stderr}`
        );
    }
}
