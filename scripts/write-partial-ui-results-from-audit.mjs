import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const vaultRoot = process.env.ROAM_IN_OB_VAULT_ROOT;
const auditPath =
    process.argv.slice(2).find((arg) => arg !== "--" && !arg.startsWith("--")) ??
    (vaultRoot
        ? path.join(vaultRoot, ".obsidian", "plugins", "roam-in-ob", "ui-audit-latest.json")
        : null);
if (!auditPath) {
    throw new Error("Pass an audit path or set ROAM_IN_OB_VAULT_ROOT.");
}
const outDir = path.join(root, "artifacts");
const outPath = path.join(outDir, "ui-regression-results.partial.json");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
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
    audit.snapshot?.renderedFilePaths?.includes(
        "Journal/_journal_stream_regression_fixture/bad-yaml-260813.md"
    ) &&
    audit.snapshot?.renderedFilePaths?.includes(
        "Journal/_journal_stream_regression_fixture/unparsed-fixture.md"
    );
const passedCopyVisibleMarkdown =
    audit.status === "passed" &&
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
    audit.status === "passed" &&
    audit.actions?.settingsToggle?.status === "passed" &&
    audit.actions.settingsToggle.afterDisabled?.exportButtonCount === 0 &&
    audit.actions.settingsToggle.afterRestore?.exportButtonCount ===
        audit.actions.settingsToggle.before?.exportButtonCount;
const passedPreviewEditSave =
    audit.status === "passed" &&
    audit.actions?.previewEditSave?.status === "passed" &&
    audit.actions.previewEditSave.before?.isEditing === false &&
    audit.actions.previewEditSave.editState?.isEditing === true &&
    audit.actions.previewEditSave.saveState?.sourceContainsMarker === true &&
    audit.actions.previewEditSave.previewRestoreState?.isEditing === false &&
    audit.actions.previewEditSave.previewRestoreState?.previewRendered === true;
const passedExternalChangeReload =
    audit.status === "passed" &&
    audit.actions?.externalChangeReload?.status === "passed" &&
    audit.actions.externalChangeReload.syncState?.status === "passed" &&
    audit.actions.externalChangeReload.syncState?.saveStatus?.startsWith("Synced") === true &&
    audit.actions.externalChangeReload.syncState?.conflictVisible === false &&
    audit.actions.externalChangeReload.reloadState?.sourceContainsMarker === true;
const passedRenameRefresh =
    audit.status === "passed" &&
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
                `Audit runId ${audit.runId} toggled enableExportMarkdown through the plugin settings field.`,
                `Disabled state hid export buttons; restore state returned ${audit.actions.settingsToggle.afterRestore.exportButtonCount} export buttons.`,
            ],
            artifacts: [artifactPath],
        };
    }
    if (testCase.id === "preview-to-edit-save" && passedPreviewEditSave) {
        return {
            id: testCase.id,
            status: "passed",
            evidence: [
                `Audit runId ${audit.runId} opened ${audit.actions.previewEditSave.path} from preview into embedded edit mode.`,
                "The audit marker was written through the same source-file save path and confirmed by cachedRead.",
                `Save state: ${audit.actions.previewEditSave.saveState.saveStatus}; preview restored with isEditing=${audit.actions.previewEditSave.previewRestoreState.isEditing}.`,
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
        vaultRoot: checklist.vaultRoot,
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
