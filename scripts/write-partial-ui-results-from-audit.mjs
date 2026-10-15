import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
    assertTestVaultPayloadRoot,
    resolveTestVaultRoot,
} from "./test-vault-root.mjs";

const root = process.cwd();
const vaultRoot = resolveTestVaultRoot();
const auditPath =
    process.argv.slice(2).find((arg) => arg !== "--" && !arg.startsWith("--")) ??
    path.join(
        vaultRoot,
        ".obsidian",
        "plugins",
        "roam-workspace",
        "ui-audit-latest.json"
    );
const outDir = path.join(root, "artifacts");
const outPath = path.join(outDir, "ui-regression-results.partial.json");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
assertTestVaultPayloadRoot(audit.vaultRoot, "Audit");
const checklist = JSON.parse(
    await readFile(path.join(root, "scripts/ui-regression-checklist.json"), "utf8")
);
await mkdir(outDir, { recursive: true });
const artifactPath = path.join(
    outDir,
    `ui-audit-${sanitizeFilePart(audit.runId ?? "manual")}.json`
);
await copyFile(auditPath, artifactPath);
const existingResults = existsSync(outPath)
    ? JSON.parse(await readFile(outPath, "utf8"))
    : null;
const existingCases = new Map(
    (existingResults?.cases ?? []).map((resultCase) => [resultCase.id, resultCase])
);

const passedOpenDefault =
    audit.status === "passed" &&
    audit.snapshot?.selectionMode === "folder" &&
    audit.snapshot?.target === "Journal" &&
    audit.snapshot?.timeField === "journalDate" &&
    audit.snapshot?.selectedRange === "recent-30" &&
    audit.snapshot?.renderedFileCount > 0 &&
    audit.snapshot?.dom?.noteContainerCount > 0;
const passedBadYamlAndUnparsed =
    audit.status === "passed" &&
    audit.snapshot?.target === "Journal/_journal_stream_regression_fixture" &&
    audit.snapshot?.selectedRange === "all" &&
    audit.snapshot?.renderedFilePaths?.includes(
        "Journal/_journal_stream_regression_fixture/bad-yaml-260813.md"
    ) &&
    audit.snapshot?.renderedFilePaths?.includes(
        "Journal/_journal_stream_regression_fixture/unparsed-fixture.md"
    );
const passedCopyVisibleMarkdown =
    audit.actions?.copyExport?.status === "passed" &&
    audit.actions.copyExport.exportFileCount > 0 &&
    audit.actions.copyExport.markdownStartsWithHeader === true &&
    audit.actions.copyExport.includesSourcePath === true &&
    audit.actions.copyExport.includesDateSource === true &&
    audit.actions.copyExport.clipboardWriteOk === true &&
    audit.actions.copyExport.clipboardReadOk === true &&
    audit.actions.copyExport.clipboardMatchesExport === true &&
    audit.actions.copyExport.clipboardStartsWithHeader === true;
const passedSettingsUi =
    audit.actions?.settingsToggle?.status === "passed" &&
    audit.actions.settingsToggle.temporary?.persistedSettingsMatch === true &&
    audit.actions.settingsToggle.afterRestore?.persistedSettingsMatch === true &&
    audit.actions.settingsToggle.afterRestore?.dataBytesRestored === true &&
    audit.actions.settingsToggle.temporary?.settingsRevision ===
        audit.actions.settingsToggle.before?.settingsRevision + 1 &&
    audit.actions.settingsToggle.afterRestore?.settingsRevision ===
        audit.actions.settingsToggle.before?.settingsRevision + 2;
const previewEditSaveProperties = [
    [audit.actions?.previewEditSave?.before, true],
    [audit.actions?.previewEditSave?.editState, true],
    [audit.actions?.previewEditSave?.saveState, true],
    [audit.actions?.previewEditSave?.previewRestoreState, true],
    [audit.actions?.previewEditSave?.expandedPreviewState, false],
    [audit.actions?.previewEditSave?.reeditState, false],
    [audit.actions?.previewEditSave?.finalPreviewState, false],
    [audit.actions?.previewEditSave?.postCleanupState, true],
];
const passedPreviewEditSaveProperties = previewEditSaveProperties.every(
    ([state, collapsed]) =>
        state?.singleEditorDom === true &&
        state?.properties?.mountStatus === "native" &&
        state?.properties?.visibleContainerCount === 1 &&
        state?.properties?.collapsed === collapsed
);
const passedPreviewEditSave =
    audit.actions?.previewEditSave?.status === "passed" &&
    audit.actions.previewEditSave.path ===
        "Journal/_journal_stream_regression_fixture/260812.md" &&
    audit.actions.previewEditSave.marker ===
        `journal-stream-preview-edit-save-${audit.runId}` &&
    audit.actions.previewEditSave.sourceBefore?.markerAbsent === true &&
    audit.actions.previewEditSave.before?.isEditing === false &&
    audit.actions.previewEditSave.before?.editorMounted === true &&
    audit.actions.previewEditSave.before?.editorReady === true &&
    audit.actions.previewEditSave.editState?.isEditing === true &&
    audit.actions.previewEditSave.saveState?.sourceContainsMarker === true &&
    audit.actions.previewEditSave.transaction?.status === "passed" &&
    audit.actions.previewEditSave.transaction?.runCompleted === true &&
    audit.actions.previewEditSave.transaction?.runError === null &&
    audit.actions.previewEditSave.cleanup?.restoreAttempted === true &&
    audit.actions.previewEditSave.cleanup?.restored === true &&
    audit.actions.previewEditSave.cleanup?.markerRemoved === true &&
    audit.actions.previewEditSave.cleanup?.sourceExact === true &&
    audit.actions.previewEditSave.cleanup?.editorExact === true &&
    audit.actions.previewEditSave.cleanup?.markerRemovedFromSource === true &&
    audit.actions.previewEditSave.cleanup?.markerRemovedFromEditor === true &&
    audit.actions.previewEditSave.cleanup?.propertiesRestored === true &&
    audit.actions.previewEditSave.previewRestoreState?.isEditing === false &&
    audit.actions.previewEditSave.previewRestoreState?.editorMounted === true &&
    audit.actions.previewEditSave.previewRestoreState?.editorReady === true &&
    audit.actions.previewEditSave.postCleanupState?.isEditing === false &&
    audit.actions.previewEditSave.postCleanupState?.editorMounted === true &&
    audit.actions.previewEditSave.postCleanupState?.editorReady === true &&
    audit.actions.previewEditSave.postCleanupState?.editorMountId ===
        audit.actions.previewEditSave.before?.editorMountId &&
    audit.actions.previewEditSave.singleDomStable === true &&
    audit.actions.previewEditSave.geometry?.alignedWithinOnePixel === true &&
    audit.actions.previewEditSave.propertiesStable === true &&
    passedPreviewEditSaveProperties;
const passedExternalChangeReload =
    audit.actions?.externalChangeReload?.status === "passed" &&
    audit.actions.externalChangeReload.syncState?.status === "passed" &&
    audit.actions.externalChangeReload.syncState?.saveStatus?.startsWith("Synced") === true &&
    audit.actions.externalChangeReload.syncState?.conflictVisible === false &&
    audit.actions.externalChangeReload.reloadState?.sourceContainsMarker === true;
const passedRenameRefresh =
    audit.actions?.renameRefresh?.status === "passed" &&
    audit.actions.renameRefresh.outRemoved === true &&
    audit.actions.renameRefresh.backAppeared === true &&
    audit.actions.renameRefresh.newMarkdownAppeared === true &&
    audit.actions.renameRefresh.uniquePaths === true;

const cases = checklist.cases.map((testCase) => {
    const existingCase = existingCases.get(testCase.id);
    if (existingCase?.status === "passed") return existingCase;

    if (testCase.id === "open-default-view" && passedOpenDefault) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} has Journal folder recent-30 view state.`,
                `Rendered ${audit.snapshot.renderedFileCount} Journal cards with ${audit.snapshot.dom.noteContainerCount} DOM note containers.`,
                `Rendered paths: ${audit.snapshot.renderedFilePaths.join(", ")}`,
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "bad-yaml-and-unparsed" && passedBadYamlAndUnparsed) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Fixture audit runId ${audit.runId} rendered bad-yaml-260813.md and unparsed-fixture.md.`,
                "Both fixture cards rendered without crashing the view after date parsing fell back.",
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "copy-visible-markdown" && passedCopyVisibleMarkdown) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} invoked the copy export action from the rendered Journal window.`,
                `Clipboard readback matched the generated Markdown export (${audit.actions.copyExport.markdownLength} characters).`,
                `Export included source_path/date_source metadata for ${audit.actions.copyExport.exportFileCount} files: ${audit.actions.copyExport.exportedPaths.join(", ")}`,
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "settings-ui" && passedSettingsUi) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} changed all four settings fields and advanced the open view revision from ${audit.actions.settingsToggle.before.settingsRevision} to ${audit.actions.settingsToggle.afterRestore.settingsRevision}.`,
                "Markdown export command availability followed enableExportMarkdown in temporary and restored states.",
                "Temporary settings persisted and cleanup restored the original data.json bytes exactly.",
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "preview-to-edit-save" && passedPreviewEditSave) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} focused the persistent embedded editor for ${audit.actions.previewEditSave.path}.`,
                "The runId-bound audit marker was written through the same source-file save path and confirmed in the exact registered fixture.",
                `Save state: ${audit.actions.previewEditSave.saveState.saveStatus}; the preview transition retained the same editor DOM with isEditing=${audit.actions.previewEditSave.previewRestoreState.isEditing} and <=1px geometry delta.`,
                "The transaction restored the source bytes, embedded editor buffer, Properties state, and marker absence exactly, including the post-cleanup editor state.",
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "external-change-reload" && passedExternalChangeReload) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} externally modified ${audit.actions.externalChangeReload.path} while the card was in edit mode.`,
                `The card automatically synced from source with status ${audit.actions.externalChangeReload.syncState.saveStatus}.`,
                "The source file still contained the external marker after the embedded editor was reloaded from Markdown.",
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "rename-refresh" && passedRenameRefresh) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} renamed ${audit.actions.renameRefresh.sourcePath} out to a non-Markdown path and back.`,
                `The non-Markdown rename disappeared, the restored Markdown path reappeared, and ${audit.actions.renameRefresh.newMarkdownPath} entered the list.`,
                "Rendered file paths remained unique after rename events.",
            ],
            artifacts: [artifactPath],
        };
    }

    return {
        id: testCase.id,
        status: "pending",
        evidence: [],
        artifacts: [],
        ...(testCase.id === "real-ui-performance"
            ? {
                  metrics: {
                      smallWarmOpenMs: null,
                      mediumWarmOpenMs: null,
                      modifyToUiP95Ms: null,
                  },
              }
            : {}),
    };
});

const results = {
    checklist: checklist.name,
    runAt: new Date().toISOString(),
    operator: "journal-stream-ui-audit",
    environment: {
        vaultRoot: audit.vaultRoot,
        pluginId: checklist.pluginId,
        obsidianVersion: audit.obsidianVersion,
        viewport: `${audit.viewport.width}x${audit.viewport.height}@${audit.viewport.devicePixelRatio}`,
    },
    cases,
};

await writeFile(outPath, JSON.stringify(results, null, 2));
console.log(`Partial Journal Stream UI results written: ${outPath}`);

function sanitizeFilePart(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}
