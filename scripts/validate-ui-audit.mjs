import { readFile } from "node:fs/promises";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const auditPath = process.argv
    .slice(2)
    .filter((arg, index, args) => {
        if (arg === "--" || arg.startsWith("--")) return false;
        const previous = args[index - 1];
        return previous !== "--target" && previous !== "--range";
    })[0];
const allowFailed = process.argv.includes("--allow-failed");
const requireCopyExport = process.argv.includes("--require-copy-export");
const requireSettingsToggle = process.argv.includes("--require-settings-toggle");
const requirePreviewEditSave = process.argv.includes("--require-preview-edit-save");
const requireExternalChangeReload = process.argv.includes(
    "--require-external-change-reload"
);
const requireRenameRefresh = process.argv.includes("--require-rename-refresh");
const requireListHeading = process.argv.includes("--require-list-heading");
const requireBlockLink = process.argv.includes("--require-block-link");
const requireNavigation = process.argv.includes("--require-navigation");
const requirePerformance = process.argv.includes("--require-performance");
const requireOpenDefaultView = process.argv.includes(
    "--require-open-default-view"
);
const requireJournalSnapshot = !requireListHeading && !requirePerformance;
const expectedTarget = readOption("--target") ?? "Journal";
const expectedRange = readOption("--range") ?? "recent-30";
const expectedVaultRoot = resolveTestVaultRoot();
if (!auditPath) {
    console.error("Usage: node scripts/validate-ui-audit.mjs <ui-audit.json>");
    process.exit(1);
}

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const failures = [];

for (const field of [
    "runAt",
    "pluginId",
    "pluginVersion",
    "obsidianVersion",
    "vaultRoot",
    "viewport",
    "settings",
    "status",
]) {
    if (!audit[field]) failures.push(`Missing audit field: ${field}`);
}

if (audit.pluginId !== "roam-workspace") {
    failures.push(`pluginId must be roam-workspace, got ${audit.pluginId}`);
}

if (audit.vaultRoot !== expectedVaultRoot) {
    failures.push(`vaultRoot must be ${expectedVaultRoot}, got ${audit.vaultRoot}`);
}

if (!audit.runAt || Number.isNaN(Date.parse(audit.runAt))) {
    failures.push("runAt must be an ISO timestamp");
}

if (audit.status !== "passed") {
    if (!allowFailed) {
        failures.push(`audit.status must be passed, got ${audit.status}`);
    }
    if (!audit.reason || typeof audit.reason !== "string") {
        failures.push("failed audit must include reason");
    }
    finish();
}

if (requireJournalSnapshot) {
    if (!audit.viewState) failures.push("Missing audit field: viewState");
    if (!audit.snapshot) failures.push("Missing audit field: snapshot");
}

const snapshot = audit.snapshot ?? {};
if (requireJournalSnapshot && snapshot.selectionMode !== "folder") {
    failures.push(`snapshot.selectionMode must be folder, got ${snapshot.selectionMode}`);
}
if (requireJournalSnapshot && snapshot.target !== expectedTarget) {
    failures.push(`snapshot.target must be ${expectedTarget}, got ${snapshot.target}`);
}
if (requireJournalSnapshot && snapshot.selectedRange !== expectedRange) {
    failures.push(
        `snapshot.selectedRange must be ${expectedRange}, got ${snapshot.selectedRange}`
    );
}
if (requireJournalSnapshot && snapshot.timeField !== "journalDate") {
    failures.push(`snapshot.timeField must be journalDate, got ${snapshot.timeField}`);
}

if (requireJournalSnapshot) {
    for (const numericPath of [
        ["snapshot", "renderedFileCount"],
        ["snapshot", "pendingFileCount"],
        ["snapshot", "visibleNoteCount"],
        ["snapshot", "dom", "noteContainerCount"],
        ["snapshot", "dom", "previewCount"],
        ["snapshot", "dom", "editorCount"],
    ]) {
        const value = numericPath.reduce((current, key) => current?.[key], audit);
        if (typeof value !== "number" || value < 0 || Number.isNaN(value)) {
            failures.push(`${numericPath.join(".")} must be a non-negative number`);
        }
    }

    if (snapshot.renderedFileCount < 1) {
        failures.push("snapshot.renderedFileCount must be at least 1 for a passed audit");
    }
    if ((snapshot.dom?.noteContainerCount ?? 0) < 1) {
        failures.push("snapshot.dom.noteContainerCount must be at least 1 for a passed audit");
    }

    if (!Array.isArray(snapshot.renderedFilePaths)) {
        failures.push("snapshot.renderedFilePaths must be an array");
    }
    if (!Array.isArray(snapshot.visibleNotePaths)) {
        failures.push("snapshot.visibleNotePaths must be an array");
    }
    if (!Array.isArray(snapshot.titles)) {
        failures.push("snapshot.titles must be an array");
    }
}

if (requireOpenDefaultView) {
    validateOpenDefaultView();
}

if (requireCopyExport) {
    const copyExport = audit.actions?.copyExport;
    if (!copyExport) {
        failures.push("actions.copyExport is required");
    } else {
        if (copyExport.status !== "passed") {
            failures.push(
                `actions.copyExport.status must be passed, got ${copyExport.status}`
            );
        }
        if (copyExport.exportFileCount < 1) {
            failures.push("actions.copyExport.exportFileCount must be at least 1");
        }
        if (!Array.isArray(copyExport.exportedPaths) || copyExport.exportedPaths.length < 1) {
            failures.push("actions.copyExport.exportedPaths must include at least one path");
        }
        for (const field of [
            "markdownStartsWithHeader",
            "includesSourcePath",
            "includesDateSource",
            "clipboardWriteOk",
            "clipboardReadOk",
            "clipboardMatchesExport",
            "clipboardStartsWithHeader",
        ]) {
            if (copyExport[field] !== true) {
                failures.push(`actions.copyExport.${field} must be true`);
            }
        }
        if (
            typeof copyExport.markdownLength !== "number" ||
            copyExport.markdownLength < 1
        ) {
            failures.push("actions.copyExport.markdownLength must be a positive number");
        }
    }
}

if (requireSettingsToggle) {
    const settingsToggle = audit.actions?.settingsToggle;
    if (!settingsToggle) {
        failures.push("actions.settingsToggle is required");
    } else {
        if (settingsToggle.status !== "passed") {
            failures.push(
                `actions.settingsToggle.status must be passed, got ${settingsToggle.status}`
            );
        }
        validateSettingsToggle(settingsToggle);
    }
}

if (requirePreviewEditSave) {
    const previewEditSave = audit.actions?.previewEditSave;
    if (!previewEditSave) {
        failures.push("actions.previewEditSave is required");
    } else {
        validatePreviewEditSave(previewEditSave);
    }
}

if (requireExternalChangeReload) {
    const externalChangeReload = audit.actions?.externalChangeReload;
    if (!externalChangeReload) {
        failures.push("actions.externalChangeReload is required");
    } else {
        if (externalChangeReload.status !== "passed") {
            failures.push(
                `actions.externalChangeReload.status must be passed, got ${externalChangeReload.status}`
            );
        }
        if (externalChangeReload.syncState?.status !== "passed") {
            failures.push(
                "actions.externalChangeReload.syncState.status must be passed"
            );
        }
        if (externalChangeReload.syncState?.saveStatus?.startsWith("Synced") !== true) {
            failures.push(
                "actions.externalChangeReload.syncState.saveStatus must start with Synced"
            );
        }
        if (externalChangeReload.syncState?.conflictVisible !== false) {
            failures.push(
                "actions.externalChangeReload.syncState.conflictVisible must be false"
            );
        }
        if (externalChangeReload.reloadState?.sourceContainsMarker !== true) {
            failures.push(
                "actions.externalChangeReload.reloadState.sourceContainsMarker must be true"
            );
        }
    }
}

if (requireRenameRefresh) {
    const renameRefresh = audit.actions?.renameRefresh;
    if (!renameRefresh) {
        failures.push("actions.renameRefresh is required");
    } else {
        if (renameRefresh.status !== "passed") {
            failures.push(
                `actions.renameRefresh.status must be passed, got ${renameRefresh.status}`
            );
        }
        for (const field of [
            "outRemoved",
            "backAppeared",
            "newMarkdownAppeared",
            "uniquePaths",
        ]) {
            if (renameRefresh[field] !== true) {
                failures.push(`actions.renameRefresh.${field} must be true`);
            }
        }
    }
}

if (requireListHeading) {
    const listHeading = audit.actions?.listHeading;
    if (!listHeading) {
        failures.push("actions.listHeading is required");
    } else {
        if (listHeading.status !== "passed") {
            failures.push(
                `actions.listHeading.status must be passed, got ${listHeading.status}`
            );
        }
        const snapshots = listHeading.snapshots ?? {};
        const depthTitles = [0, 1, 2, 3, 4, 5].map(
            (depth) => snapshots[`depth-${depth}`]?.titles ?? []
        );
        if (
            depthTitles[0].join("|") !==
            "Root|List heading|Deep list heading|Second"
        ) {
            failures.push("depth-0 titles must include all heading kinds only");
        }
        if (!depthTitles[1].includes("top block")) {
            failures.push("depth-1 titles must include top block");
        }
        if (depthTitles[1].includes("child block")) {
            failures.push("depth-1 titles must not include child block");
        }
        if (!depthTitles[2].includes("child block")) {
            failures.push("depth-2 titles must include child block");
        }
        for (const [depth, title] of [
            [3, "grand child block"],
            [4, "great grand child block"],
            [5, "deepest block"],
        ]) {
            if (!depthTitles[depth].includes(title)) {
                failures.push(`depth-${depth} titles must include ${title}`);
            }
        }
        if (listHeading.sliderDomContract !== true) {
            failures.push("List heading slider DOM contract must pass");
        }
        const interaction = listHeading.sliderInteraction ?? {};
        for (const [field, expected] of Object.entries({
            migratedLegacyDepth: 2,
            arrowRightDepth: 3,
            homeDepth: 0,
            endDepth: 5,
            inputDepth: 4,
            persistedDepth: 4,
        })) {
            if (interaction[field] !== expected) {
                failures.push(
                    `List heading slider ${field} must be ${expected}, got ${interaction[field]}`
                );
            }
        }
        for (const field of [
            "arrowRightFocusRestored",
            "homeFocusRestored",
            "endFocusRestored",
            "inputFocusRestored",
        ]) {
            if (interaction[field] !== true) {
                failures.push(`List heading slider ${field} must be true`);
            }
        }
        const blockSelection =
            listHeading.pageStreamEditSave?.blockSelectionAudit ?? {};
        if (blockSelection.status !== "passed") {
            failures.push(
                `Outliner block selection status must be passed, got ${blockSelection.status}`
            );
        }
        if (!(blockSelection.selectedLineCount > 1)) {
            failures.push("Outliner block selection must include descendant lines");
        }
        if (
            blockSelection.copiedMarkdown !== blockSelection.expectedMarkdown ||
            blockSelection.cutClipboardMarkdown !== blockSelection.expectedMarkdown
        ) {
            failures.push(
                "Outliner copy and cut clipboard Markdown must match the resolved subtree"
            );
        }
        for (const field of [
            "copyDefaultPrevented",
            "copyClearedSelection",
            "cutDefaultPrevented",
            "cutRemovedCompleteSubtree",
            "undoRestoredSource",
        ]) {
            if (blockSelection[field] !== true) {
                failures.push(`Outliner block selection ${field} must be true`);
            }
        }
        const topTarget = listHeading.pageStreamTopTarget ?? {};
        if (topTarget.path !== listHeading.fixturePath) {
            failures.push("Page Stream top target path must match fixture");
        }
        if (topTarget.source !== "list-heading" || topTarget.kind !== "line") {
            failures.push("Page Stream top target must be a list-heading line target");
        }
    }
}

if (requireNavigation) {
    const navigation = audit.actions?.navigation;
    if (!navigation) {
        failures.push("actions.navigation is required");
    } else {
        if (navigation.status !== "passed") {
            failures.push(
                `actions.navigation.status must be passed, got ${navigation.status}`
            );
        }
        if (navigation.duplicateCreated !== false) {
            failures.push("actions.navigation.duplicateCreated must be false");
        }
        if (navigation.onlyConfiguredViewsRendered !== true) {
            failures.push("actions.navigation must render only configured views");
        }
        if (
            !Array.isArray(navigation.configuredEntryLabels) ||
            navigation.entryLabels?.join("|") !==
                navigation.configuredEntryLabels.join("|")
        ) {
            failures.push(
                "actions.navigation.entryLabels must match configuredEntryLabels"
            );
        }
        for (const title of ["Navigation", "Recent files", "Bookmarks"]) {
            if (!navigation.sectionTitles?.includes(title)) {
                failures.push(`actions.navigation.sectionTitles must include ${title}`);
            }
        }
        if (navigation.displayText !== "Roam workspace") {
            failures.push("actions.navigation.displayText must be Roam workspace");
        }
        if (navigation.icon !== "layout-dashboard") {
            failures.push("actions.navigation.icon must be layout-dashboard");
        }
        if (
            !(
                typeof navigation.recentFileCount === "number" &&
                navigation.recentFileCount > 0
            ) &&
            navigation.hasEmptyRecent !== true
        ) {
            failures.push(
                "actions.navigation must render recent files or an empty recent state"
            );
        }
        if (
            typeof navigation.bookmarkCount !== "number" ||
            navigation.bookmarkCount < 1
        ) {
            failures.push("actions.navigation.bookmarkCount must be positive");
        }
    }
}

if (requireBlockLink) {
    const blockLink = audit.actions?.blockLink;
    if (!blockLink) {
        failures.push("actions.blockLink is required");
    } else {
        if (blockLink.status !== "passed") {
            failures.push(
                `actions.blockLink.status must be passed, got ${blockLink.status}`
            );
        }
        if (blockLink.inserted?.changed !== true) {
            failures.push("actions.blockLink.inserted.changed must be true");
        }
        if (blockLink.existing?.blockId !== "old-id") {
            failures.push("actions.blockLink.existing.blockId must be old-id");
        }
        if (blockLink.unsupported?.reason !== "unsupported") {
            failures.push("actions.blockLink.unsupported.reason must be unsupported");
        }
        if (blockLink.link !== `[[${blockLink.fixturePath}#^baudit123]]`) {
            failures.push("actions.blockLink.link must target baudit123");
        }
        if (
            typeof blockLink.text !== "string" ||
            !blockLink.text.includes("- [x] audit task ^baudit123")
        ) {
            failures.push("actions.blockLink.text must include inserted block id");
        }
    }
}

if (requirePerformance) {
    const performance = audit.actions?.performance;
    if (!performance) {
        failures.push("actions.performance is required");
    } else {
        if (performance.status !== "passed") {
            failures.push(
                `actions.performance.status must be passed, got ${performance.status}`
            );
        }
        const metrics = performance.metrics ?? {};
        const thresholds = performance.thresholds ?? {};
        for (const metricName of [
            "smallWarmOpenMs",
            "mediumWarmOpenMs",
            "modifyToUiP95Ms",
        ]) {
            if (!Number.isFinite(metrics[metricName])) {
                failures.push(`actions.performance.metrics.${metricName} must be finite`);
            } else if (metrics[metricName] > thresholds[metricName]) {
                failures.push(
                    `actions.performance.metrics.${metricName} exceeds ${thresholds[metricName]}`
                );
            }
        }
        if (performance.fixtures?.small?.totalFileCount !== 100) {
            failures.push("Small performance fixture must contain 100 files");
        }
        if (performance.fixtures?.medium?.totalFileCount !== 2000) {
            failures.push("Medium performance fixture must contain 2000 files");
        }
        if (
            performance.fixtures?.small?.firstEditorReady !== true ||
            performance.fixtures?.medium?.firstEditorReady !== true
        ) {
            failures.push("Performance warm open must wait for the first editor");
        }
        if (
            performance.modifyToUi?.status !== "passed" ||
            performance.modifyToUi?.sampleCount !== 20 ||
            performance.modifyToUi?.restored !== true
        ) {
            failures.push(
                "Modify-to-UI audit must pass 20 samples and restore its source file"
            );
        }
        if (performance.recentFilesStable !== true) {
            failures.push(
                "External performance updates must not reorder Recent files"
            );
        }
    }
}

finish();

function finish() {
    if (failures.length > 0) {
        for (const failure of failures) console.error(`- ${failure}`);
        process.exit(1);
    }

    console.log(`Journal Stream UI audit OK: ${auditPath}`);
    process.exit(0);
}

function validateSettingsToggle(settingsToggle) {
    const before = settingsToggle.before;
    const temporary = settingsToggle.temporary;
    const afterRestore = settingsToggle.afterRestore;
    if (!before || !temporary || !afterRestore) {
        failures.push(
            "actions.settingsToggle must include before, temporary, and afterRestore"
        );
        return;
    }

    const layout = settingsToggle.settingsLayout;
    if (layout?.status !== "passed" || layout.containerVisible !== true) {
        failures.push("settingsLayout must pass with a visible settings container");
    }
    if (layout?.overlapCount !== 0) {
        failures.push("settingsLayout.overlapCount must be 0");
    }
    for (const label of [
        "Journal folder",
        "Default open mode",
        "Initial range",
        "Enable Markdown export",
    ]) {
        if (layout?.requiredControlCounts?.[label] !== 1) {
            failures.push(`settingsLayout must contain exactly one ${label} control`);
        }
    }

    for (const [label, state] of Object.entries({ before, temporary, afterRestore })) {
        if (!Number.isInteger(state.settingsRevision) || state.settingsRevision < 0) {
            failures.push(`${label}.settingsRevision must be a non-negative integer`);
        }
        if (
            !Number.isInteger(state.viewSettingsRevision) ||
            state.viewSettingsRevision < 0
        ) {
            failures.push(
                `${label}.viewSettingsRevision must be a non-negative integer`
            );
        }
        if (state.settingsRevision !== state.viewSettingsRevision) {
            failures.push(`${label} plugin/view settings revisions must match`);
        }
        if (
            state.exportCommandAvailable !==
            state.settings?.enableExportMarkdown
        ) {
            failures.push(
                `${label}.exportCommandAvailable must match enableExportMarkdown`
            );
        }
    }

    if (temporary.settingsRevision !== before.settingsRevision + 1) {
        failures.push("temporary.settingsRevision must advance by exactly one");
    }
    if (afterRestore.settingsRevision !== before.settingsRevision + 2) {
        failures.push("afterRestore.settingsRevision must advance by exactly two");
    }

    for (const field of [
        "journalFolder",
        "defaultOpenMode",
        "initialRange",
        "enableExportMarkdown",
    ]) {
        if (temporary.settings?.[field] === before.settings?.[field]) {
            failures.push(`temporary.settings.${field} must differ from before`);
        }
        if (afterRestore.settings?.[field] !== before.settings?.[field]) {
            failures.push(`afterRestore.settings.${field} must match before`);
        }
    }
    if (temporary.persistedSettingsMatch !== true) {
        failures.push("temporary.persistedSettingsMatch must be true");
    }
    if (afterRestore.persistedSettingsMatch !== true) {
        failures.push("afterRestore.persistedSettingsMatch must be true");
    }
    if (afterRestore.dataBytesRestored !== true) {
        failures.push("afterRestore.dataBytesRestored must be true");
    }
}

function validatePreviewEditSave(previewEditSave) {
    const fixturePath =
        "Journal/_journal_stream_regression_fixture/260812.md";
    const expectedMarker = `journal-stream-preview-edit-save-${audit.runId}`;
    if (previewEditSave.status !== "passed") {
        failures.push(
            `actions.previewEditSave.status must be passed, got ${previewEditSave.status}`
        );
    }
    if (previewEditSave.path !== fixturePath) {
        failures.push(`actions.previewEditSave.path must be ${fixturePath}`);
    }
    if (previewEditSave.marker !== expectedMarker) {
        failures.push(
            `actions.previewEditSave.marker must be bound to runId ${audit.runId}`
        );
    }
    if (
        previewEditSave.sourceBefore?.markerAbsent !== true ||
        !Number.isInteger(previewEditSave.sourceBefore?.bytes) ||
        previewEditSave.sourceBefore.bytes < 1
    ) {
        failures.push(
            "actions.previewEditSave.sourceBefore must prove a non-empty collision-free fixture"
        );
    }

    const states = [
        ["before", previewEditSave.before, false],
        ["editState", previewEditSave.editState, true],
        ["saveState", previewEditSave.saveState, true],
        ["previewRestoreState", previewEditSave.previewRestoreState, false],
        ["expandedPreviewState", previewEditSave.expandedPreviewState, false],
        ["reeditState", previewEditSave.reeditState, true],
        ["finalPreviewState", previewEditSave.finalPreviewState, false],
        ["postCleanupState", previewEditSave.postCleanupState, false],
    ];
    const mountIds = [];
    for (const [label, state, expectedEditing] of states) {
        if (state?.path !== fixturePath) {
            failures.push(`actions.previewEditSave.${label}.path must be ${fixturePath}`);
        }
        if (state?.isEditing !== expectedEditing) {
            failures.push(
                `actions.previewEditSave.${label}.isEditing must be ${expectedEditing}`
            );
        }
        if (state?.editorMounted !== true || state?.editorReady !== true) {
            failures.push(
                `actions.previewEditSave.${label} must retain a ready persistent editor`
            );
        }
        if (typeof state?.editorMountId !== "string" || !state.editorMountId) {
            failures.push(
                `actions.previewEditSave.${label}.editorMountId must be non-empty`
            );
        } else {
            mountIds.push(state.editorMountId);
        }
        if (state?.singleEditorDom !== true) {
            failures.push(
                `actions.previewEditSave.${label}.singleEditorDom must be true`
            );
        }
        if (
            state?.properties?.mountStatus !== "native" ||
            state?.properties?.visibleContainerCount !== 1
        ) {
            failures.push(
                `actions.previewEditSave.${label} must retain one native Properties container`
            );
        }
        const expectedCollapsed = ![
            "expandedPreviewState",
            "reeditState",
            "finalPreviewState",
        ].includes(label);
        if (state?.properties?.collapsed !== expectedCollapsed) {
            failures.push(
                `actions.previewEditSave.${label}.properties.collapsed must be ${expectedCollapsed}`
            );
        }
    }
    if (mountIds.length !== states.length || new Set(mountIds).size !== 1) {
        failures.push(
            "actions.previewEditSave must preserve one editor mount ID through cleanup"
        );
    }
    if (previewEditSave.singleDomStable !== true) {
        failures.push("actions.previewEditSave.singleDomStable must be true");
    }
    if (
        previewEditSave.saveState?.status !== "passed" ||
        previewEditSave.saveState?.marker !== expectedMarker ||
        previewEditSave.saveState?.sourceContainsMarker !== true ||
        !Number.isInteger(previewEditSave.saveState?.sourceBytes) ||
        previewEditSave.saveState.sourceBytes <= previewEditSave.sourceBefore?.bytes
    ) {
        failures.push(
            "actions.previewEditSave.saveState must prove the exact marker reached a larger source file"
        );
    }

    const geometry = previewEditSave.geometry;
    if (geometry?.alignedWithinOnePixel !== true) {
        failures.push(
            "actions.previewEditSave geometry must stay aligned within 1px"
        );
    }
    for (const field of [
        "bodyLeftDelta",
        "bodyTopDelta",
        "pageLeftDelta",
        "pageTopDelta",
        "pageWidthDelta",
        "streamScrollTopDelta",
        "targetViewportTopDelta",
    ]) {
        if (
            typeof geometry?.[field] !== "number" ||
            geometry[field] < 0 ||
            geometry[field] > 1
        ) {
            failures.push(`actions.previewEditSave.geometry.${field} must be 0..1`);
        }
    }
    if (previewEditSave.propertiesStable !== true) {
        failures.push(
            "actions.previewEditSave must not expose duplicate Properties containers"
        );
    }

    const transaction = previewEditSave.transaction;
    if (
        transaction?.status !== "passed" ||
        transaction.runCompleted !== true ||
        transaction.runError !== null
    ) {
        failures.push(
            "actions.previewEditSave.transaction must complete without a run error"
        );
    }
    for (const [label, cleanup] of [
        ["transaction.cleanup", transaction?.cleanup],
        ["cleanup", previewEditSave.cleanup],
    ]) {
        for (const field of [
            "restoreAttempted",
            "restored",
            "sourceExact",
            "editorExact",
            "markerRemoved",
            "markerRemovedFromSource",
            "markerRemovedFromEditor",
            "propertiesRestored",
        ]) {
            if (cleanup?.[field] !== true) {
                failures.push(`actions.previewEditSave.${label}.${field} must be true`);
            }
        }
        if (cleanup?.restoreError !== null || cleanup?.verificationError !== null) {
            failures.push(
                `actions.previewEditSave.${label} must not contain cleanup errors`
            );
        }
    }
}

function validateOpenDefaultView() {
    const expectedPaths = [
        "Journal/_journal_stream_regression_fixture/260812.md",
        "Journal/_journal_stream_regression_fixture/2026-08-11.md",
    ];
    const expectedState = {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDate",
        selectedRange: "recent-30",
    };

    for (const [field, expected] of Object.entries(expectedState)) {
        if (audit.viewState?.[field] !== expected) {
            failures.push(
                `viewState.${field} must be ${expected}, got ${audit.viewState?.[field]}`
            );
        }
        if (snapshot[field] !== expected) {
            failures.push(
                `snapshot.${field} must be ${expected}, got ${snapshot[field]}`
            );
        }
    }

    const expectedSettings = {
        journalFolder: "Journal",
        defaultOpenMode: "journal-folder",
        initialRange: "recent-30",
    };
    for (const [field, expected] of Object.entries(expectedSettings)) {
        if (audit.settings?.[field] !== expected) {
            failures.push(
                `settings.${field} must be ${expected}, got ${audit.settings?.[field]}`
            );
        }
    }

    const renderedPaths = snapshot.renderedFilePaths;
    if (!Array.isArray(renderedPaths)) return;
    if (new Set(renderedPaths).size !== renderedPaths.length) {
        failures.push("snapshot.renderedFilePaths must not contain duplicates");
    }
    if (snapshot.renderedFileCount !== renderedPaths.length) {
        failures.push(
            "snapshot.renderedFileCount must match renderedFilePaths length"
        );
    }
    if (snapshot.pendingFileCount !== 0 || snapshot.hasMore !== false) {
        failures.push(
            "open-default-view audit must reach the end of progressive rendering"
        );
    }
    if (snapshot.dom?.noteContainerCount !== snapshot.renderedFileCount) {
        failures.push(
            "snapshot.dom.noteContainerCount must match renderedFileCount"
        );
    }

    const indexes = expectedPaths.map((filePath) => renderedPaths.indexOf(filePath));
    expectedPaths.forEach((filePath, index) => {
        if (indexes[index] === -1) {
            failures.push(
                `snapshot.renderedFilePaths must include ${filePath}`
            );
        }
    });
    if (indexes.every((index) => index !== -1) && indexes[0] >= indexes[1]) {
        failures.push(
            "260812.md must render before 2026-08-11.md in descending journal-date order"
        );
    }
}

function readOption(name) {
    const args = process.argv.slice(2);
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
    const prefix = `${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
