import { readFile } from "node:fs/promises";

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
const expectedTarget = readOption("--target") ?? "Journal";
const expectedRange = readOption("--range") ?? "recent-30";
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

if (audit.pluginId !== "roam-in-ob") {
    failures.push(`pluginId must be roam-in-ob, got ${audit.pluginId}`);
}

if (typeof audit.vaultRoot !== "string" || audit.vaultRoot.length === 0) {
    failures.push("vaultRoot must identify the test vault");
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

if (!requireListHeading) {
    if (!audit.viewState) failures.push("Missing audit field: viewState");
    if (!audit.snapshot) failures.push("Missing audit field: snapshot");
}

const snapshot = audit.snapshot ?? {};
if (!requireListHeading && snapshot.selectionMode !== "folder") {
    failures.push(`snapshot.selectionMode must be folder, got ${snapshot.selectionMode}`);
}
if (!requireListHeading && snapshot.target !== expectedTarget) {
    failures.push(`snapshot.target must be ${expectedTarget}, got ${snapshot.target}`);
}
if (!requireListHeading && snapshot.selectedRange !== expectedRange) {
    failures.push(
        `snapshot.selectedRange must be ${expectedRange}, got ${snapshot.selectedRange}`
    );
}
if (!requireListHeading && snapshot.timeField !== "journalDate") {
    failures.push(`snapshot.timeField must be journalDate, got ${snapshot.timeField}`);
}

if (!requireListHeading) {
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
        if (settingsToggle.afterDisabled?.exportButtonCount !== 0) {
            failures.push("actions.settingsToggle.afterDisabled.exportButtonCount must be 0");
        }
        if (
            settingsToggle.afterRestore?.exportButtonCount !==
            settingsToggle.before?.exportButtonCount
        ) {
            failures.push(
                "actions.settingsToggle.afterRestore.exportButtonCount must match before.exportButtonCount"
            );
        }
    }
}

if (requirePreviewEditSave) {
    const previewEditSave = audit.actions?.previewEditSave;
    if (!previewEditSave) {
        failures.push("actions.previewEditSave is required");
    } else {
        if (previewEditSave.status !== "passed") {
            failures.push(
                `actions.previewEditSave.status must be passed, got ${previewEditSave.status}`
            );
        }
        if (previewEditSave.before?.isEditing !== false) {
            failures.push("actions.previewEditSave.before.isEditing must be false");
        }
        if (previewEditSave.editState?.isEditing !== true) {
            failures.push("actions.previewEditSave.editState.isEditing must be true");
        }
        if (previewEditSave.saveState?.sourceContainsMarker !== true) {
            failures.push(
                "actions.previewEditSave.saveState.sourceContainsMarker must be true"
            );
        }
        if (previewEditSave.previewRestoreState?.isEditing !== false) {
            failures.push(
                "actions.previewEditSave.previewRestoreState.isEditing must be false"
            );
        }
        if (previewEditSave.previewRestoreState?.previewRendered !== true) {
            failures.push(
                "actions.previewEditSave.previewRestoreState.previewRendered must be true"
            );
        }
        if (typeof previewEditSave.path !== "string" || !previewEditSave.path) {
            failures.push("actions.previewEditSave.path must be set");
        }
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
        const headingsOnlyTitles = snapshots["headings-only"]?.titles ?? [];
        const topIndentTitles = snapshots["top-indent"]?.titles ?? [];
        const topTwoTitles = snapshots["top-two-indent"]?.titles ?? [];
        if (headingsOnlyTitles.join("|") !== "Root|List heading|Second") {
            failures.push("headings-only titles must match fixture headings");
        }
        if (!topIndentTitles.includes("top block")) {
            failures.push("top-indent titles must include top block");
        }
        if (topIndentTitles.includes("child block")) {
            failures.push("top-indent titles must not include child block");
        }
        if (!topTwoTitles.includes("child block")) {
            failures.push("top-two-indent titles must include child block");
        }
        if (topTwoTitles.includes("hidden grand child")) {
            failures.push("top-two-indent titles must not include hidden grand child");
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
        for (const title of ["Views", "Recent files", "Bookmarks"]) {
            if (!navigation.sectionTitles?.includes(title)) {
                failures.push(`actions.navigation.sectionTitles must include ${title}`);
            }
        }
        if (navigation.displayText !== "Roam navigation") {
            failures.push("actions.navigation.displayText must be Roam navigation");
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

finish();

function finish() {
    if (failures.length > 0) {
        for (const failure of failures) console.error(`- ${failure}`);
        process.exit(1);
    }

    console.log(`Journal Stream UI audit OK: ${auditPath}`);
    process.exit(0);
}

function readOption(name) {
    const args = process.argv.slice(2);
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
    const prefix = `${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
