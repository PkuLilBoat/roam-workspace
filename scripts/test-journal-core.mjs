import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { build } from "esbuild";

const outfile = "./.tmp-journal-core-test.mjs";

await build({
    entryPoints: ["./src/utils/journalCore.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    filterJournalFilesByRange,
    getJournalDateInfoFromParts,
    sortJournalFiles,
} = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const exportOutfile = "./.tmp-journal-export-test.mjs";
await build({
    entryPoints: ["./src/utils/journalExport.ts"],
    outfile: exportOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    buildJournalExportMarkdown,
    copyMarkdownToClipboard,
    readJournalExportEntries,
    selectVisibleExportFiles,
} = await import(`${pathToFileURL(exportOutfile).href}?t=${Date.now()}`);

const visibleNotesOutfile = "./.tmp-visible-notes-test.mjs";
await build({
    entryPoints: ["./src/utils/visibleNotes.ts"],
    outfile: visibleNotesOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { renameVisiblePath } = await import(
    `${pathToFileURL(visibleNotesOutfile).href}?t=${Date.now()}`
);

const modifyQueueOutfile = "./.tmp-modify-queue-test.mjs";
await build({
    entryPoints: ["./src/utils/modifyQueue.ts"],
    outfile: modifyQueueOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { drainModifiedFiles, enqueueModifiedFile } = await import(
    `${pathToFileURL(modifyQueueOutfile).href}?t=${Date.now()}`
);

const saveStatusOutfile = "./.tmp-save-status-test.mjs";
await build({
    entryPoints: ["./src/utils/saveStatus.ts"],
    outfile: saveStatusOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    isLocalSaveConfirmation,
    isTextChangingKey,
    SAVE_NOT_CONFIRMED_MS,
    shouldShowSaveNotConfirmed,
} = await import(`${pathToFileURL(saveStatusOutfile).href}?t=${Date.now()}`);

const conflictStateOutfile = "./.tmp-conflict-state-test.mjs";
await build({
    entryPoints: ["./src/utils/conflictState.ts"],
    outfile: conflictStateOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { applyExternalChangeState, applyReloadConflictState } = await import(
    `${pathToFileURL(conflictStateOutfile).href}?t=${Date.now()}`
);

const dateInputOutfile = "./.tmp-date-input-test.mjs";
await build({
    entryPoints: ["./src/utils/dateInput.ts"],
    outfile: dateInputOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    endOfLocalDay,
    normalizeCustomRange,
    parseDateInputEnd,
    parseDateInputStart,
    startOfLocalDay,
    tryParseDateInputEnd,
    tryParseDateInputStart,
} = await import(`${pathToFileURL(dateInputOutfile).href}?t=${Date.now()}`);

const fileListOutfile = "./.tmp-file-list-test.mjs";
await build({
    entryPoints: ["./src/utils/fileList.ts"],
    outfile: fileListOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    collectMarkdownFilesFromFolder,
    isMarkdownFile,
    isMarkdownPath,
    removeFileByPath,
    upsertFileByPath,
} = await import(`${pathToFileURL(fileListOutfile).href}?t=${Date.now()}`);

const viewStateOutfile = "./.tmp-view-state-test.mjs";
await build({
    entryPoints: ["./src/utils/viewState.ts"],
    outfile: viewStateOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    INITIAL_RANGE_OPTIONS,
    TIME_RANGE_OPTIONS,
    TIME_RANGES,
    buildDailyViewState,
    buildDefaultJournalStreamViewState,
    buildJournalFolderViewState,
    buildTagViewState,
    canCopyJournalStreamMarkdown,
    restoreJournalStreamState,
} = await import(`${pathToFileURL(viewStateOutfile).href}?t=${Date.now()}`);

const settingsOutfile = "./.tmp-settings-test.mjs";
await build({
    entryPoints: ["./src/utils/defaultSettings.ts"],
    outfile: settingsOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { DEFAULT_SETTINGS } = await import(
    `${pathToFileURL(settingsOutfile).href}?t=${Date.now()}`
);

const settingsStateOutfile = "./.tmp-settings-state-test.mjs";
await build({
    entryPoints: ["./src/utils/settingsState.ts"],
    outfile: settingsStateOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { restoreDailyNoteSettings } = await import(
    `${pathToFileURL(settingsStateOutfile).href}?t=${Date.now()}`
);

const journalV2RoutingOutfile = "./.tmp-journal-v2-routing-test.mjs";
await build({
    entryPoints: ["./src/journal-v2/routing.ts"],
    outfile: journalV2RoutingOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { JOURNAL_VIEW_TYPE } = await import(
    `${pathToFileURL(journalV2RoutingOutfile).href}?t=${Date.now()}`
);

const journalV2StateOutfile = "./.tmp-journal-v2-state-test.mjs";
await build({
    entryPoints: ["./src/journal-v2/model/journalState.ts"],
    outfile: journalV2StateOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { createJournalState, reduceJournalState } = await import(
    `${pathToFileURL(journalV2StateOutfile).href}?t=${Date.now()}`
);

const journalV2ConflictOutfile = "./.tmp-journal-v2-conflict-test.mjs";
await build({
    entryPoints: ["./src/journal-v2/source/journalConflict.ts"],
    outfile: journalV2ConflictOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { classifyJournalModify, journalContentsEqual } = await import(
    `${pathToFileURL(journalV2ConflictOutfile).href}?t=${Date.now()}`
);

const journalV2EditorReadinessOutfile = "./.tmp-journal-v2-editor-readiness-test.mjs";
await build({
    entryPoints: ["./src/journal-v2/editor/editorReadiness.ts"],
    outfile: journalV2EditorReadinessOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { resolveJournalEditorReadiness } = await import(
    `${pathToFileURL(journalV2EditorReadinessOutfile).href}?t=${Date.now()}`
);

const journalV2EditorPoolOutfile = "./.tmp-journal-v2-editor-pool-test.mjs";
await build({
    entryPoints: ["./src/journal-v2/editor/JournalEditorPool.ts"],
    outfile: journalV2EditorPoolOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { JournalEditorPool } = await import(
    `${pathToFileURL(journalV2EditorPoolOutfile).href}?t=${Date.now()}`
);

const recentFilesOutfile = "./.tmp-recent-files-test.mjs";
await build({
    entryPoints: ["./src/utils/recentFiles.ts"],
    outfile: recentFilesOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    recordRecentPath,
    removeRecentPath,
    renameRecentPath,
    restoreRecentPaths,
    shouldRecordRecentEditorChange,
} = await import(
    `${pathToFileURL(recentFilesOutfile).href}?t=${Date.now()}`
);

const settingsRevisionOutfile = "./.tmp-settings-revision-test.mjs";
await build({
    entryPoints: ["./src/utils/settingsRevision.ts"],
    outfile: settingsRevisionOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { nextSettingsRevision } = await import(
    `${pathToFileURL(settingsRevisionOutfile).href}?t=${Date.now()}`
);

const outlinerScopeOutfile = "./.tmp-outliner-scope-test.mjs";
await build({
    entryPoints: ["./src/outliner/scope.ts"],
    outfile: outlinerScopeOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    resolveOutlinerCapabilities,
} = await import(
    `${pathToFileURL(outlinerScopeOutfile).href}?t=${Date.now()}`
);

const fileSourceOutfile = "./.tmp-file-source-test.mjs";
await build({
    entryPoints: ["./src/utils/fileSource.ts"],
    outfile: fileSourceOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    fileHasTag,
    isFileInFolder,
    normalizeTag,
    sortAndFilterJournalFiles,
} = await import(`${pathToFileURL(fileSourceOutfile).href}?t=${Date.now()}`);

const incrementalFileSetOutfile = "./.tmp-incremental-file-set-test.mjs";
await build({
    entryPoints: ["./src/utils/incrementalFileSet.ts"],
    outfile: incrementalFileSetOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { updateIncrementalFileSet } = await import(
    `${pathToFileURL(incrementalFileSetOutfile).href}?t=${Date.now()}`
);

const renderWindowOutfile = "./.tmp-render-window-test.mjs";
await build({
    entryPoints: ["./src/utils/renderWindow.ts"],
    outfile: renderWindowOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { appendRenderBatch, rebuildRenderWindow } = await import(
    `${pathToFileURL(renderWindowOutfile).href}?t=${Date.now()}`
);

const renderPolicyOutfile = "./.tmp-render-policy-test.mjs";
await build({
    entryPoints: ["./src/utils/renderPolicy.ts"],
    outfile: renderPolicyOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    shouldMountMarkdownEditor,
    shouldRefreshPreviewAfterExternalChange,
    shouldRenderMarkdownPreview,
    shouldUnloadMarkdownEditor,
    shouldUnloadMarkdownPreview,
} = await import(`${pathToFileURL(renderPolicyOutfile).href}?t=${Date.now()}`);

const streamEditorPoolOutfile = "./.tmp-stream-editor-pool-test.mjs";
await build({
    entryPoints: ["./src/utils/streamEditorPool.ts"],
    outfile: streamEditorPoolOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { MAX_STREAM_EDITORS, StreamEditorPool } = await import(
    `${pathToFileURL(streamEditorPoolOutfile).href}?t=${Date.now()}`
);

const pageStreamStackOutfile = "./.tmp-page-stream-stack-test.mjs";
await build({
    entryPoints: ["./src/pageStreamStack.ts"],
    outfile: pageStreamStackOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { pushPageStreamTarget, restorePageStreamTargets } = await import(
    `${pathToFileURL(pageStreamStackOutfile).href}?t=${Date.now()}`
);

const pageStreamReconcileOutfile = "./.tmp-page-stream-reconcile-test.mjs";
await build({
    entryPoints: ["./src/pageStreamReconcile.ts"],
    outfile: pageStreamReconcileOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { planPageStreamReconcile } = await import(
    `${pathToFileURL(pageStreamReconcileOutfile).href}?t=${Date.now()}`
);

const listHeadingParserOutfile = "./.tmp-list-heading-parser-test.mjs";
await build({
    entryPoints: ["./src/listHeadingParser.ts"],
    outfile: listHeadingParserOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    collectListHeadingItems,
    getListHeadingFoldTargets,
    applyListHeadingDepthFold,
    getListHeadingDescendantEnds,
    getListHeadingItemKeys,
    parseListHeadingItems,
    reconcileListHeadingCollapsedKeys,
    summarizeListHeadingDepths,
} = await import(
    `${pathToFileURL(listHeadingParserOutfile).href}?t=${Date.now()}`
);

const outlinerPasteOutfile = "./.tmp-outliner-paste-test.mjs";
await build({
    entryPoints: ["./src/utils/outlinerPaste.ts"],
    outfile: outlinerPasteOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { adaptOutlinerPasteToListContext, normalizeOutlinerPaste } = await import(
    `${pathToFileURL(outlinerPasteOutfile).href}?t=${Date.now()}`
);

const outlinerPasteExtensionOutfile = "./.tmp-outliner-paste-extension-test.mjs";
await build({
    entryPoints: ["./src/component/OutlinerPasteNormalize.ts"],
    outfile: outlinerPasteExtensionOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["@codemirror/state", "@codemirror/view"],
    logLevel: "silent",
});

const { createOutlinerPasteNormalizeExtension } = await import(
    `${pathToFileURL(outlinerPasteExtensionOutfile).href}?t=${Date.now()}`
);

const builtInOutlinerModelOutfile = "./.tmp-built-in-outliner-model.mjs";
await build({
    entryPoints: ["./src/outliner/model.ts"],
    outfile: builtInOutlinerModelOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});
const builtInOutlinerPasteOutfile = "./.tmp-built-in-outliner-paste.mjs";
await build({
    entryPoints: ["./src/outliner/paste.ts"],
    outfile: builtInOutlinerPasteOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const builtInOutlinerModel = await import(
    `${pathToFileURL(builtInOutlinerModelOutfile).href}?t=${Date.now()}`
);
const builtInOutlinerPaste = await import(
    `${pathToFileURL(builtInOutlinerPasteOutfile).href}?t=${Date.now()}`
);
const builtInOutlinerSelectionOutfile = "./.tmp-built-in-outliner-selection.mjs";
await build({
    entryPoints: ["./src/outliner/selection.ts"],
    outfile: builtInOutlinerSelectionOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});
const builtInOutlinerSelection = await import(
    `${pathToFileURL(builtInOutlinerSelectionOutfile).href}?t=${Date.now()}`
);

const blockLinkOutfile = "./.tmp-block-link-test.mjs";
await build({
    entryPoints: ["./src/utils/blockLink.ts"],
    outfile: blockLinkOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const {
    appendBlockIdToLine,
    buildBlockLink,
    canInsertBlockId,
    createBlockId,
    findBlockId,
} = await import(`${pathToFileURL(blockLinkOutfile).href}?t=${Date.now()}`);

function dateTime(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
    return new Date(year, month - 1, day, hour, minute, second, ms).valueOf();
}

function file(basename, options = {}) {
    return {
        basename,
        name: `${basename}.md`,
        path: options.path ?? `Journal/${basename}.md`,
        stat: {
            ctime: options.ctime ?? dateTime(2026, 1, 1),
            mtime: options.mtime ?? dateTime(2026, 1, 1),
        },
        frontmatter: options.frontmatter,
    };
}

const yy = file("260810");
assert.deepEqual(
    pickDateInfo(getJournalDateInfoFromParts(yy)),
    {
        label: "2026-08-10",
        source: "filename",
    },
    "YYMMDD filename should parse as 20YY-MM-DD"
);

const iso = file("2026-07-08");
assert.deepEqual(
    pickDateInfo(getJournalDateInfoFromParts(iso)),
    {
        label: "2026-07-08",
        source: "filename",
    },
    "YYYY-MM-DD filename should parse"
);

const frontmatterDate = file("260810", {
    frontmatter: {
        date: "2026-07-09",
        created: "2026-07-10",
    },
});
assert.deepEqual(
    pickDateInfo(getJournalDateInfoFromParts(frontmatterDate)),
    {
        label: "2026-07-09",
        source: "frontmatter-date",
    },
    "frontmatter date should override filename and created"
);

const frontmatterCreated = file("260810", {
    frontmatter: {
        created: "2026-07-10",
    },
});
assert.deepEqual(
    pickDateInfo(getJournalDateInfoFromParts(frontmatterCreated)),
    {
        label: "2026-07-10",
        source: "frontmatter-created",
    },
    "frontmatter created should override filename when date is absent"
);

const unparsed = file("meeting-notes", {
    mtime: dateTime(2026, 8, 9),
});
assert.deepEqual(
    pickDateInfo(getJournalDateInfoFromParts(unparsed)),
    {
        label: "date not parsed; sorted by modified time",
        source: "unparsed",
    },
    "unparsed filenames should degrade with a visible label"
);

for (const badDateName of ["260230", "2026-02-30", "2026-13-01"]) {
    assert.deepEqual(
        pickDateInfo(getJournalDateInfoFromParts(file(badDateName))),
        {
            label: "date not parsed; sorted by modified time",
            source: "unparsed",
        },
        `${badDateName} should not roll over into a valid Journal date`
    );
}

const sortedDesc = sortJournalFiles([iso, unparsed, yy], "journalDate").map(
    (item) => item.basename
);
assert.deepEqual(
    sortedDesc,
    ["260810", "meeting-notes", "2026-07-08"],
    "journalDate should sort parsed dates first and use mtime fallback for unparsed files"
);

const sortedAsc = sortJournalFiles(
    [iso, unparsed, yy],
    "journalDateReverse"
).map((item) => item.basename);
assert.deepEqual(
    sortedAsc,
    ["2026-07-08", "meeting-notes", "260810"],
    "journalDateReverse should sort ascending"
);

const monthFiles = filterJournalFilesByRange(
    [iso, unparsed, yy],
    "journalDate",
    "month",
    dateTime(2026, 8, 12)
).map((item) => item.basename);
assert.deepEqual(
    monthFiles,
    ["meeting-notes", "260810"],
    "month filtering should include parsed files and mtime-fallback unparsed files in range"
);

const customFiles = filterJournalFilesByRange(
    [iso, unparsed, yy],
    "journalDate",
    "custom",
    dateTime(2026, 8, 12),
    {
        start: new Date(2026, 6, 1),
        end: new Date(2026, 6, 31, 23, 59, 59, 999),
    }
).map((item) => item.basename);
assert.deepEqual(
    customFiles,
    ["2026-07-08"],
    "custom range should exclude mtime-fallback unparsed files outside range"
);

const stringCustomFiles = filterJournalFilesByRange(
    [iso, unparsed, yy],
    "journalDate",
    "custom",
    dateTime(2026, 8, 12),
    {
        start: "2026-07-01T00:00:00.000",
        end: "2026-07-31T23:59:59.999",
    }
).map((item) => item.basename);
assert.deepEqual(
    stringCustomFiles,
    ["2026-07-08"],
    "custom range filtering should tolerate serialized date strings from workspace state"
);

const recentFiles = filterJournalFilesByRange(
    [
        file("260812"),
        file("260810"),
        file("260805"),
        file("260713"),
        file("260712"),
        file("2026-07-01"),
        file("meeting-notes", { mtime: dateTime(2026, 8, 11) }),
    ],
    "journalDate",
    "recent-30",
    dateTime(2026, 8, 12)
).map((item) => item.basename);
assert.deepEqual(
    recentFiles,
    ["260812", "260810", "260805", "260713", "meeting-notes"],
    "recent-30 should include the inclusive 30-day window and mtime-fallback unparsed files in range"
);

const recentReverseFiles = filterJournalFilesByRange(
    sortJournalFiles(
        [
            file("260812"),
            file("260810"),
            file("260805"),
            file("260713"),
            file("2026-07-01"),
            file("meeting-notes", { mtime: dateTime(2026, 8, 11) }),
        ],
        "journalDateReverse"
    ),
    "journalDateReverse",
    "recent-30",
    dateTime(2026, 8, 12)
).map((item) => item.basename);
assert.deepEqual(
    recentReverseFiles,
    ["260713", "260805", "260810", "meeting-notes", "260812"],
    "range filtering should preserve existing journalDateReverse ascending order"
);

const recentSevenFiles = filterJournalFilesByRange(
    [
        file("260812"),
        file("260810"),
        file("260805"),
        file("meeting-notes", { mtime: dateTime(2026, 8, 11) }),
    ],
    "journalDate",
    "recent-7",
    dateTime(2026, 8, 12)
).map((item) => item.basename);
assert.deepEqual(
    recentSevenFiles,
    ["260812", "260810", "260805", "meeting-notes"],
    "recent-7 should include the last seven days and mtime-fallback unparsed files in range"
);

const todayFiles = filterJournalFilesByRange(
    [
        file("260812"),
        file("260811"),
        file("meeting-notes", { mtime: dateTime(2026, 8, 12) }),
    ],
    "journalDate",
    "today",
    dateTime(2026, 8, 12)
).map((item) => item.basename);
assert.deepEqual(
    todayFiles,
    ["260812", "meeting-notes"],
    "today should include same-day parsed files and same-day mtime-fallback unparsed files"
);

const todayMtimeReverseFiles = filterJournalFilesByRange(
    sortJournalFiles(
        [
            file("same-day-early", { mtime: dateTime(2026, 8, 12) + 1_000 }),
            file("same-day-late", { mtime: dateTime(2026, 8, 12) + 2_000 }),
            file("other-day", { mtime: dateTime(2026, 8, 11) }),
        ],
        "mtimeReverse"
    ),
    "mtimeReverse",
    "today",
    dateTime(2026, 8, 12, 12)
).map((item) => item.basename);
assert.deepEqual(
    todayMtimeReverseFiles,
    ["same-day-early", "same-day-late"],
    "range filtering should preserve existing mtimeReverse ascending order"
);

const exportMarkdown = buildJournalExportMarkdown(
    [
        {
            file: {
                ...yy,
                path: "Journal/260810.md",
            },
            content: "# 260810\n- test entry\n",
        },
        {
            file: {
                ...iso,
                path: "Journal/2026-07-08.md",
            },
            content: "- another entry\n",
        },
    ],
    {
        selectionMode: "folder",
        target: "Journal",
        selectedRange: "recent-30",
        timeField: "journalDate",
        exportedAt: new Date("2026-08-12T00:00:00.000Z"),
    }
);

assert.ok(exportMarkdown.includes("# Journal Stream Export"));
assert.ok(exportMarkdown.includes("- selectedRange: recent-30"));
assert.ok(exportMarkdown.includes("- [[Journal/260810.md]] | 2026-08-10"));
assert.ok(exportMarkdown.includes("### 2026-08-10 | 260810.md"));
assert.ok(exportMarkdown.includes("- source_path: Journal/2026-07-08.md"));
assert.ok(exportMarkdown.includes("```markdown\n# 260810\n- test entry\n```"));

const customRangeExportMarkdown = buildJournalExportMarkdown([], {
    selectionMode: "folder",
    target: "Journal",
    selectedRange: "custom",
    timeField: "journalDate",
    customRange: {
        start: new Date(2026, 7, 12, 0, 0, 0, 0),
        end: new Date(2026, 7, 12, 23, 59, 59, 999),
    },
    exportedAt: new Date("2026-08-12T00:00:00.000Z"),
});
assert.ok(
    customRangeExportMarkdown.includes(
        "- customRange: 2026-08-12 to 2026-08-12"
    ),
    "custom range export should format dates using local date parts"
);

const staleCustomRangeExportMarkdown = buildJournalExportMarkdown([], {
    selectionMode: "folder",
    target: "Journal",
    selectedRange: "recent-30",
    timeField: "journalDate",
    customRange: {
        start: new Date(2026, 7, 12, 0, 0, 0, 0),
        end: new Date(2026, 7, 12, 23, 59, 59, 999),
    },
    exportedAt: new Date("2026-08-12T00:00:00.000Z"),
});
assert.equal(
    staleCustomRangeExportMarkdown.includes("- customRange:"),
    false,
    "non-custom range export should not include stale customRange state"
);

const stringCustomRangeExportMarkdown = buildJournalExportMarkdown([], {
    selectionMode: "folder",
    target: "Journal",
    selectedRange: "custom",
    timeField: "journalDate",
    customRange: {
        start: "2026-08-12T00:00:00.000",
        end: "2026-08-12T23:59:59.999",
    },
    exportedAt: new Date("2026-08-12T00:00:00.000Z"),
});
assert.ok(
    stringCustomRangeExportMarkdown.includes(
        "- customRange: 2026-08-12 to 2026-08-12"
    ),
    "custom range export should tolerate serialized date strings from workspace state"
);

const invalidCustomRangeExportMarkdown = buildJournalExportMarkdown([], {
    selectionMode: "folder",
    target: "Journal",
    selectedRange: "custom",
    timeField: "journalDate",
    customRange: {
        start: "not-a-date",
        end: "2026-08-12T23:59:59.999",
    },
    exportedAt: new Date("2026-08-12T00:00:00.000Z"),
});
assert.ok(
    invalidCustomRangeExportMarkdown.includes("- customRange: invalid"),
    "custom range export should label invalid restored ranges"
);

const fencedExportMarkdown = buildJournalExportMarkdown(
    [
        {
            file: {
                ...yy,
                path: "Journal/260810.md",
            },
            content: "```js\nconsole.log('nested fence');\n```\n",
        },
    ],
    {
        selectionMode: "folder",
        target: "Journal",
        selectedRange: "today",
        timeField: "journalDate",
        exportedAt: new Date("2026-08-12T00:00:00.000Z"),
    }
);
assert.ok(
    fencedExportMarkdown.includes(
        "````markdown\n```js\nconsole.log('nested fence');\n```\n````"
    ),
    "export markdown should use a longer fence when Journal content contains code fences"
);

const renderedExportFiles = [
    {
        ...yy,
        path: "Journal/260810.md",
    },
    {
        ...iso,
        path: "Journal/2026-07-08.md",
    },
];
assert.deepEqual(
    selectVisibleExportFiles(
        renderedExportFiles,
        new Set(["Journal/2026-07-08.md"])
    ).map((item) => item.path),
    ["Journal/2026-07-08.md"],
    "visible export selection should prefer currently visible files"
);
assert.deepEqual(
    selectVisibleExportFiles(renderedExportFiles, new Set()).map(
        (item) => item.path
    ),
    ["Journal/260810.md", "Journal/2026-07-08.md"],
    "visible export selection should fall back to rendered files before visibility initializes"
);

assert.deepEqual(
    Array.from(
        renameVisiblePath(
            new Set(["Journal/260810.md", "Journal/2026-07-08.md"]),
            "Journal/260810.md",
            "Journal/260811.md",
            new Set(["Journal/260811.md", "Journal/2026-07-08.md"])
        )
    ).sort(),
    ["Journal/2026-07-08.md", "Journal/260811.md"],
    "visible path rename should migrate visibility when the new path remains rendered"
);
assert.deepEqual(
    Array.from(
        renameVisiblePath(
            new Set(["Journal/260810.md", "Journal/2026-07-08.md"]),
            "Journal/260810.md",
            "Journal/260810.png",
            new Set(["Journal/2026-07-08.md"])
        )
    ),
    ["Journal/2026-07-08.md"],
    "visible path rename should drop visibility when a Markdown note leaves the render window"
);
assert.deepEqual(
    Array.from(
        renameVisiblePath(
            new Set(["Journal/2026-07-08.md"]),
            "Journal/260810.md",
            "Journal/260811.md",
            new Set(["Journal/260811.md", "Journal/2026-07-08.md"])
        )
    ),
    ["Journal/2026-07-08.md"],
    "visible path rename should not mark an unseen renamed file visible"
);

let pendingModifiedFiles = new Map();
pendingModifiedFiles = enqueueModifiedFile(
    pendingModifiedFiles,
    { path: "Journal/260810.md", mtime: 1 }
);
pendingModifiedFiles = enqueueModifiedFile(
    pendingModifiedFiles,
    { path: "Journal/260811.md", mtime: 2 }
);
pendingModifiedFiles = enqueueModifiedFile(
    pendingModifiedFiles,
    { path: "Journal/260810.md", mtime: 3 }
);
const drainedModifiedFiles = drainModifiedFiles(pendingModifiedFiles);
assert.deepEqual(
    drainedModifiedFiles.files,
    [
        { path: "Journal/260810.md", mtime: 3 },
        { path: "Journal/260811.md", mtime: 2 },
    ],
    "modify debounce queue should keep every changed path and replace duplicate paths with the latest file"
);
assert.equal(
    drainedModifiedFiles.pendingFiles.size,
    0,
    "modify debounce queue should clear after draining"
);

const oldIncrementalFile = file("260801");
const oldWindowFile = file("260806");
const enteringWindowFile = file("260812");
const leavingWindowFile = file("260730");
const renamedWindowFile = file("260813", {
    path: "Journal/renamed-260813.md",
});
const incrementalNow = dateTime(2026, 8, 13, 12);

let incrementalResult = updateIncrementalFileSet(
    [oldIncrementalFile, oldWindowFile],
    enteringWindowFile,
    {
        belongsToSource: true,
        timeRange: "recent-7",
        timeField: "journalDateReverse",
        now: incrementalNow,
    }
);
assert.deepEqual(
    incrementalResult.filteredFiles.map((item) => item.path),
    [
        "Journal/260806.md",
        "Journal/260812.md",
    ],
    "incremental update should add a source file when it enters the active range without a full reload"
);
incrementalResult = updateIncrementalFileSet(
    incrementalResult.allFiles,
    leavingWindowFile,
    {
        belongsToSource: true,
        timeRange: "recent-7",
        timeField: "journalDateReverse",
        now: incrementalNow,
    }
);
assert.deepEqual(
    incrementalResult.filteredFiles.map((item) => item.path),
    [
        "Journal/260806.md",
        "Journal/260812.md",
    ],
    "incremental update should keep out-of-range files out of the active window"
);
incrementalResult = updateIncrementalFileSet(
    incrementalResult.allFiles,
    renamedWindowFile,
    {
        belongsToSource: true,
        timeRange: "recent-7",
        timeField: "journalDateReverse",
        now: incrementalNow,
        oldPath: "Journal/260812.md",
    }
);
assert.deepEqual(
    incrementalResult.filteredFiles.map((item) => item.path),
    [
        "Journal/260806.md",
        "Journal/renamed-260813.md",
    ],
    "incremental rename should replace the old path and keep the new source file in sorted range order"
);
incrementalResult = updateIncrementalFileSet(
    incrementalResult.allFiles,
    {
        ...renamedWindowFile,
        path: "Assets/renamed-260813.png",
    },
    {
        belongsToSource: false,
        timeRange: "recent-7",
        timeField: "journalDateReverse",
        now: incrementalNow,
        oldPath: "Journal/renamed-260813.md",
    }
);
assert.deepEqual(
    incrementalResult.filteredFiles.map((item) => item.path),
    ["Journal/260806.md"],
    "incremental rename should remove a file that leaves the current source instead of rebuilding the whole source"
);

const readEntries = await readJournalExportEntries(
    renderedExportFiles,
    async (item) => `content for ${item.path}`
);
assert.deepEqual(
    readEntries.map((entry) => [entry.file.path, entry.content]),
    [
        ["Journal/260810.md", "content for Journal/260810.md"],
        ["Journal/2026-07-08.md", "content for Journal/2026-07-08.md"],
    ],
    "export entry reading should preserve the selected file order"
);
await assert.rejects(
    () =>
        readJournalExportEntries(renderedExportFiles, async (item) => {
            if (item.path === "Journal/2026-07-08.md") {
                throw new Error("read failed");
            }
            return `content for ${item.path}`;
        }),
    /read failed/,
    "export entry reading should surface source file read failures"
);

let copiedMarkdown = "";
await copyMarkdownToClipboard(
    {
        async writeText(text) {
            copiedMarkdown = text;
        },
    },
    exportMarkdown
);
assert.equal(
    copiedMarkdown,
    exportMarkdown,
    "clipboard export should write the generated Markdown"
);
await assert.rejects(
    () => copyMarkdownToClipboard(undefined, exportMarkdown),
    /Clipboard API is not available/,
    "clipboard export should report when the Clipboard API is unavailable"
);
await assert.rejects(
    () =>
        copyMarkdownToClipboard(
            {
                async writeText() {
                    throw new Error("clipboard denied");
                },
            },
            exportMarkdown
        ),
    /clipboard denied/,
    "clipboard export should surface write failures"
);

assert.equal(
    isLocalSaveConfirmation(10_000, 6_000),
    true,
    "a modify event inside the local edit window should confirm save"
);
assert.equal(
    isLocalSaveConfirmation(10_000, 4_999),
    false,
    "a modify event outside the local edit window should be treated as external"
);
assert.equal(
    isLocalSaveConfirmation(10_000, 0),
    false,
    "focus without a local edit timestamp should not confirm save"
);
assert.equal(
    shouldShowSaveNotConfirmed(
        10_000 + SAVE_NOT_CONFIRMED_MS - 500,
        10_000
    ),
    true,
    "save status should fall back to not-confirmed near the timeout boundary"
);
assert.equal(
    isTextChangingKey({ key: "a" }),
    true,
    "plain character keydown should mark saving"
);
assert.equal(
    isTextChangingKey({ key: "Backspace" }),
    true,
    "delete-like keydown should mark saving"
);
assert.equal(
    isTextChangingKey({ key: "ArrowLeft" }),
    false,
    "navigation keydown should not mark saving"
);
assert.equal(
    isTextChangingKey({ key: "s", metaKey: true }),
    false,
    "command shortcuts should not mark saving"
);
assert.equal(
    isTextChangingKey({ key: "x", ctrlKey: true }),
    false,
    "control shortcuts should not mark saving"
);
assert.equal(
    isTextChangingKey({ key: "e", altKey: true }),
    false,
    "alt-modified character shortcuts should not mark saving"
);

assert.deepEqual(
    applyExternalChangeState({
        isEditing: true,
        rendered: true,
        shouldRender: true,
        isLocalSave: true,
    }),
    {
        isEditing: true,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: false,
        shouldRefreshPreview: false,
        shouldReloadEditor: false,
        isSavedConfirmation: true,
    },
    "local save confirmation should not block editing or reload the card"
);
assert.deepEqual(
    applyExternalChangeState({
        isEditing: true,
        rendered: true,
        shouldRender: true,
        isLocalSave: false,
    }),
    {
        isEditing: true,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: true,
        shouldRefreshPreview: false,
        shouldReloadEditor: true,
        isSavedConfirmation: false,
    },
    "external change while editing should reload the embedded editor from source"
);
assert.deepEqual(
    applyExternalChangeState({
        isEditing: false,
        rendered: false,
        shouldRender: true,
        isLocalSave: false,
    }),
    {
        isEditing: false,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: false,
        shouldRefreshPreview: true,
        shouldReloadEditor: false,
        isSavedConfirmation: false,
    },
    "external change in preview mode should refresh visible preview content without conflict UI"
);
assert.equal(
    applyExternalChangeState({
        isEditing: false,
        rendered: false,
        shouldRender: false,
        isLocalSave: false,
    }).shouldRefreshPreview,
    false,
    "external change offscreen should not render Markdown preview"
);
assert.equal(
    applyExternalChangeState({
        isEditing: false,
        rendered: false,
        shouldRender: false,
        isLocalSave: false,
    }).showExternalChangeNotice,
    false,
    "external change offscreen should not show conflict UI"
);
assert.deepEqual(
    applyReloadConflictState({
        restoreEditAfterReload: true,
        rendered: false,
    }),
    {
        isEditing: true,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: false,
        shouldRenderPreview: false,
        shouldShowEditor: true,
    },
    "reload should restore edit mode when the external change interrupted an active editor"
);
assert.deepEqual(
    applyReloadConflictState({
        restoreEditAfterReload: false,
        rendered: true,
    }),
    {
        isEditing: false,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: true,
        shouldRenderPreview: true,
        shouldShowEditor: false,
    },
    "reload should return to preview mode when the external change happened outside editing"
);

const customStart = parseDateInputStart("2026-08-12");
assert.equal(customStart.getFullYear(), 2026);
assert.equal(customStart.getMonth(), 7);
assert.equal(customStart.getDate(), 12);
assert.equal(customStart.getHours(), 0);
assert.equal(customStart.getMinutes(), 0);
assert.equal(customStart.getSeconds(), 0);
assert.equal(customStart.getMilliseconds(), 0);

const customEnd = parseDateInputEnd("2026-08-12");
assert.equal(customEnd.getFullYear(), 2026);
assert.equal(customEnd.getMonth(), 7);
assert.equal(customEnd.getDate(), 12);
assert.equal(customEnd.getHours(), 23);
assert.equal(customEnd.getMinutes(), 59);
assert.equal(customEnd.getSeconds(), 59);
assert.equal(customEnd.getMilliseconds(), 999);
assert.throws(
    () => parseDateInputEnd("2026-02-30"),
    /Invalid date input/,
    "custom date input should reject invalid calendar dates"
);
assert.equal(
    tryParseDateInputStart("2026-02-30"),
    null,
    "custom range modal should safely reject invalid start date input"
);
assert.equal(
    tryParseDateInputEnd(""),
    null,
    "custom range modal should safely reject empty end date input"
);

assert.deepEqual(
    pickDate(normalizeCustomRange({
        start: "2026-08-12T00:00:00.000",
        end: "2026-08-12T23:59:59.999",
    })?.start),
    {
        year: 2026,
        month: 8,
        day: 12,
    },
    "custom range normalization should restore serialized dates"
);

const arbitraryTime = new Date(2026, 7, 12, 15, 30, 45, 123);
const defaultCustomStart = startOfLocalDay(arbitraryTime);
const defaultCustomEnd = endOfLocalDay(arbitraryTime);
assert.equal(defaultCustomStart.getHours(), 0);
assert.equal(defaultCustomStart.getMinutes(), 0);
assert.equal(defaultCustomStart.getSeconds(), 0);
assert.equal(defaultCustomStart.getMilliseconds(), 0);
assert.equal(defaultCustomEnd.getHours(), 23);
assert.equal(defaultCustomEnd.getMinutes(), 59);
assert.equal(defaultCustomEnd.getSeconds(), 59);
assert.equal(defaultCustomEnd.getMilliseconds(), 999);

const duplicateBasenameFiles = [
    { basename: "260812", path: "Journal/260812.md" },
    { basename: "260812", path: "Archive/260812.md" },
];
assert.deepEqual(
    removeFileByPath(duplicateBasenameFiles, {
        basename: "260812",
        path: "Journal/260812.md",
    }).map((item) => item.path),
    ["Archive/260812.md"],
    "delete handling should remove only the matching path, not every same-basename file"
);
assert.deepEqual(
    upsertFileByPath(duplicateBasenameFiles, {
        basename: "260812",
        path: "Journal/260812.md",
        updated: true,
    }),
    [
        {
            basename: "260812",
            path: "Journal/260812.md",
            updated: true,
        },
        { basename: "260812", path: "Archive/260812.md" },
    ],
    "create handling should replace a matching path instead of duplicating it"
);
assert.deepEqual(
    upsertFileByPath(
        [
            { basename: "260811", path: "Journal/260811.md" },
            { basename: "260812", path: "Journal/260812.md" },
            { basename: "260813", path: "Journal/260813.md" },
        ],
        {
            basename: "260812",
            path: "Journal/260812.md",
            updated: true,
        }
    ).map((item) => item.path),
    ["Journal/260811.md", "Journal/260812.md", "Journal/260813.md"],
    "upsert should preserve the existing file position when replacing a path"
);
assert.deepEqual(
    upsertFileByPath(duplicateBasenameFiles, {
        basename: "260813",
        path: "Journal/260813.md",
    }).map((item) => item.path),
    ["Journal/260812.md", "Archive/260812.md", "Journal/260813.md"],
    "create handling should append a new path"
);
assert.deepEqual(
    sortJournalFiles(
        upsertFileByPath(
            [
                file("260810"),
                file("260811"),
            ].map((item) => ({
                ...item,
                path: `Journal/${item.basename}.md`,
            })),
            {
                ...file("260812"),
                path: "Journal/260812.md",
            }
        ),
        "journalDateReverse"
    ).map((item) => item.path),
    ["Journal/260810.md", "Journal/260811.md", "Journal/260812.md"],
    "created daily notes should be displayed from the sorted filtered list instead of being forced to the top"
);
assert.equal(
    isMarkdownFile({ path: "Journal/260810.md", extension: "md" }),
    true,
    "Markdown vault events should be accepted"
);
assert.equal(
    isMarkdownFile({ path: "Journal/260810.md" }),
    true,
    "Markdown vault events should fall back to path suffix when extension is absent"
);
assert.equal(
    isMarkdownFile({ path: "Journal/image.png", extension: "png" }),
    false,
    "non-Markdown vault events should be ignored before reaching Journal refresh logic"
);
assert.equal(
    isMarkdownFile({ path: "Journal/archive.MD" }),
    true,
    "path suffix fallback should be case-insensitive"
);
const journalFolderTree = {
    children: [
        { path: "Journal/260812.md", extension: "md" },
        { path: "Journal/image.png", extension: "png" },
        {
            children: [
                { path: "Journal/Nested/260811.md", extension: "md" },
                { path: "Journal/Nested/readme.txt", extension: "txt" },
            ],
        },
    ],
};
assert.deepEqual(
    collectMarkdownFilesFromFolder(journalFolderTree).map((item) => item.path),
    ["Journal/260812.md", "Journal/Nested/260811.md"],
    "folder source loading should walk only the selected folder tree and ignore non-Markdown children"
);
assert.equal(
    isMarkdownPath("Journal/old.md"),
    true,
    "Markdown old paths should be recognized during rename"
);
assert.equal(
    isMarkdownPath("Journal/old.png"),
    false,
    "non-Markdown old paths should not trigger rename refresh alone"
);
assert.equal(
    isMarkdownFile({ path: "Journal/new.png", extension: "png" }) ||
        isMarkdownPath("Journal/old.md"),
    true,
    "renaming Markdown to a non-Markdown file should still refresh to remove the old Journal card"
);
assert.equal(
    isMarkdownFile({ path: "Journal/new.md", extension: "md" }) ||
        isMarkdownPath("Journal/old.png"),
    true,
    "renaming a non-Markdown file to Markdown should refresh to include the new Journal card"
);
assert.equal(
    isMarkdownFile({ path: "Journal/new.png", extension: "png" }) ||
        isMarkdownPath("Journal/old.jpg"),
    false,
    "renaming between non-Markdown files should not refresh Journal views"
);

assert.deepEqual(
    TIME_RANGE_OPTIONS.map((option) => option.value),
    [...TIME_RANGES],
    "view range menu options should cover every supported TimeRange in one shared order"
);
assert.deepEqual(
    INITIAL_RANGE_OPTIONS.map((option) => option.value),
    TIME_RANGE_OPTIONS.filter((option) => option.value !== "custom").map(
        (option) => option.value
    ),
    "initial range settings should expose every non-custom range option"
);
assert.equal(
    INITIAL_RANGE_OPTIONS.some((option) => option.value === "custom"),
    false,
    "initial range settings should not expose custom without persisted custom bounds"
);
assert.deepEqual(
    DEFAULT_SETTINGS,
    {
        hideFrontmatter: false,
        hideBacklinks: false,
        createAndOpenOnStartup: false,
        useArrowUpOrDownToNavigate: false,
        journalFolder: "Journal",
        defaultOpenMode: "journal-folder",
        initialRange: "recent-30",
        showSourcePath: true,
        enableExportMarkdown: true,
        navigationViews: ["journal-stream"],
        navigationConfiguration: { journalName: "Journal stream", journals: [], links: [] },
        additionalJournalsCollapsed: true,
        bookmarkGroupCollapsed: {},
        navigationSectionCollapsed: {
            bookmarks: false,
            recentFiles: false,
            recentTasks: false,
        },
        recentFileClassFilter: [],
        recentFileTagsFilter: [],
        recentFilePropertyFilters: {},
        recentFiles: [],
        showRecentTasks: false,
        recentTaskBlocks: [],
        recentTaskTagsFilter: [],
        recentTaskPagesFilter: [],
        outlinerScope: "stream-only",
        preset: [],
    },
    "default settings should open the Journal folder in a recent-30 bounded window with source paths and export enabled"
);
assert.deepEqual(
    restoreDailyNoteSettings({
        hideFrontmatter: true,
        hideBacklinks: "yes",
        createAndOpenOnStartup: true,
        useArrowUpOrDownToNavigate: null,
        journalFolder: "  Journal/Work  ",
        defaultOpenMode: "bad-mode",
        initialRange: "custom",
        showSourcePath: false,
        enableExportMarkdown: 1,
        navigationViews: [
            "page-stream",
            "bad-view",
            "journal-stream",
            "page-stream",
        ],
        navigationSectionCollapsed: {
            bookmarks: true,
            recentFiles: "yes",
            recentTasks: false,
        },
        recentFileClassFilter: [" ProjectFile ", "ProjectFile", "", 2],
        recentFileTagsFilter: [" work ", "work", null],
        recentFilePropertyFilters: { status: [" text:active ", "text:active"], tags: ["ignored"] },
        recentFiles: [" Journal/one.md ", "Journal/two.md", "Journal/one.md", 2],
        showRecentTasks: true,
        recentTaskBlocks: [
            {
                path: " Task/demo.md ",
                lineHint: 4,
                normalizedRootText: " Demo task ",
                subtreeSignature: " abc123 ",
                lastTouchedAt: 50,
            },
            { path: "", lineHint: -1 },
        ],
        recentTaskTagsFilter: [" waiting ", "waiting"],
        recentTaskPagesFilter: [" Projects/A.md ", "Projects/A.md"],
        preset: [
            { type: "folder", target: "Projects" },
            { type: "folder", target: " Projects " },
            { type: "tag", target: "#journal" },
            { type: "bad", target: "ignored" },
            { type: "tag", target: "   " },
            null,
        ],
    }),
    {
        ...DEFAULT_SETTINGS,
        hideFrontmatter: true,
        createAndOpenOnStartup: true,
        journalFolder: "Journal/Work",
        showSourcePath: false,
        navigationViews: ["journal-stream", "page-stream"],
        navigationSectionCollapsed: {
            bookmarks: true,
            recentFiles: false,
            recentTasks: false,
        },
        recentFileClassFilter: ["ProjectFile"],
        recentFileTagsFilter: ["work"],
        recentFilePropertyFilters: { status: ["text:active"] },
        recentFiles: ["Journal/one.md", "Journal/two.md"],
        showRecentTasks: true,
        recentTaskBlocks: [
            {
                path: "Task/demo.md",
                lineHint: 4,
                normalizedRootText: "Demo task",
                subtreeSignature: "abc123",
                lastTouchedAt: 50,
            },
        ],
        recentTaskTagsFilter: ["waiting"],
        recentTaskPagesFilter: ["Projects/A.md"],
        preset: [
            { type: "folder", target: "Projects" },
            { type: "tag", target: "#journal" },
        ],
    },
    "settings restore should sanitize bad persisted values and keep valid user settings"
);
assert.deepEqual(
    restoreDailyNoteSettings({
        journalFolder: " ",
        defaultOpenMode: "daily",
        initialRange: "recent-7",
        enableExportMarkdown: false,
    }),
    {
        ...DEFAULT_SETTINGS,
        defaultOpenMode: "daily",
        initialRange: "recent-7",
        enableExportMarkdown: false,
    },
    "settings restore should keep valid mode/range toggles while falling back for empty Journal folder"
);
assert.deepEqual(
    restoreRecentPaths([" A.md ", "B.md", "A.md", "", null]),
    ["A.md", "B.md"],
    "recent files restore should trim, deduplicate and reject invalid paths"
);
assert.deepEqual(
    restoreDailyNoteSettings({ navigationViews: [] }).navigationViews,
    [],
    "settings restore should preserve an explicitly empty Navigation view list"
);
assert.deepEqual(
    restoreDailyNoteSettings({
        navigationViews: ["list-heading", "unknown", "journal-stream"],
    }).navigationViews,
    ["journal-stream", "list-heading"],
    "settings restore should discard unknown Navigation ids and use canonical order"
);
assert.equal(
    restoreDailyNoteSettings({ outlinerScope: "vault-wide" }).outlinerScope,
    "vault-wide",
    "settings restore should preserve a valid vault-wide Outliner scope"
);
assert.equal(
    restoreDailyNoteSettings({ outlinerScope: "invalid" }).outlinerScope,
    "stream-only",
    "settings restore should fall back to Stream-only for an unknown Outliner scope"
);
const restoredSingleEngineSettings = restoreDailyNoteSettings({
        journalEngine: "legacy",
        journalV2Rollout: false,
    });
assert.deepEqual(
    restoredSingleEngineSettings,
    DEFAULT_SETTINGS,
    "settings restore should ignore removed dual-engine migration fields"
);
assert.equal("journalEngine" in restoredSingleEngineSettings, false);
assert.equal("journalV2Rollout" in restoredSingleEngineSettings, false);
assert.equal(
    JOURNAL_VIEW_TYPE,
    "daily-note-editor-view",
    "Journal V2 should own the stable canonical workspace view type"
);
const journalV2Query = {
    selectionMode: "folder",
    target: "Journal",
    timeField: "journalDate",
    selectedRange: "recent-30",
    customRange: null,
};
const todayPath = "Journal/260915.md";
const todayFile = file("260915", { path: todayPath });
const historyFile = file("260914", { path: "Journal/260914.md" });
const emptyHistoryFile = file("260913", { path: "Journal/260913.md" });
const emptyTodayRecord = {
    content: "  \n",
    dateLabel: "2026-09-15",
    dateTime: 1789401600000,
    file: todayFile,
    isStrictlyEmpty: true,
    path: todayPath,
};
const historyRecord = {
    content: "- history",
    dateLabel: "2026-09-14",
    dateTime: 1789315200000,
    file: historyFile,
    isStrictlyEmpty: false,
    path: historyFile.path,
};
const emptyHistoryRecord = {
    content: "",
    dateLabel: "2026-09-13",
    dateTime: 1789228800000,
    file: emptyHistoryFile,
    isStrictlyEmpty: true,
    path: emptyHistoryFile.path,
};
const virtualToday = {
    dateLabel: "2026-09-15",
    dateTime: 1789401600000,
    path: todayPath,
    position: "first",
};
let journalV2State = createJournalState(journalV2Query);
journalV2State = reduceJournalState(journalV2State, {
    type: "replace-source",
    records: [emptyTodayRecord, historyRecord, emptyHistoryRecord],
    virtualToday,
});
assert.deepEqual(
    journalV2State.items.map((item) => [item.key, item.isVirtualToday]),
    [
        [todayPath, true],
        [historyFile.path, false],
    ],
    "V2 projection should replace an empty today file with one virtual card and hide empty history"
);
const stableHistoryItem = journalV2State.items[1];
journalV2State = reduceJournalState(journalV2State, {
    type: "replace-source",
    records: [emptyTodayRecord, historyRecord, emptyHistoryRecord],
    virtualToday,
});
assert.strictEqual(
    journalV2State.items[1],
    stableHistoryItem,
    "unchanged Journal paths should keep their projection object across refresh"
);
const nonEmptyTodayRecord = {
    ...emptyTodayRecord,
    content: "- today",
    isStrictlyEmpty: false,
};
journalV2State = reduceJournalState(journalV2State, {
    type: "replace-source",
    records: [nonEmptyTodayRecord, historyRecord],
    virtualToday,
});
assert.deepEqual(
    journalV2State.items.map((item) => [item.key, item.isVirtualToday]),
    [
        [todayPath, false],
        [historyFile.path, false],
    ],
    "a non-empty today source should promote the same path key to a real card"
);
const reverseState = reduceJournalState(createJournalState(journalV2Query), {
    type: "replace-source",
    records: [historyRecord],
    virtualToday: { ...virtualToday, position: "last" },
});
assert.deepEqual(
    reverseState.items.map((item) => item.key),
    [historyFile.path, todayPath],
    "reverse ordering should place the virtual today card after real entries"
);
assert.equal(
    classifyJournalModify(undefined, "external"),
    "external-sync",
    "a clean editor should accept an external file update"
);
assert.equal(
    classifyJournalModify("draft", "draft"),
    "local-save",
    "matching disk and draft content should confirm the local save"
);
assert.equal(
    classifyJournalModify("draft", "external"),
    "external-conflict",
    "different disk content must not overwrite a pending local draft"
);
assert.equal(
    journalContentsEqual("draft", "draft\n"),
    true,
    "one final line break must not create a false save conflict"
);
const earlierFile = file("260912", { path: "Journal/260912.md" });
const earlierRecord = {
    content: "- earlier",
    dateLabel: "2026-09-12",
    dateTime: 1789142400000,
    file: earlierFile,
    isStrictlyEmpty: false,
    path: earlierFile.path,
};
let incrementalState = reduceJournalState(createJournalState(journalV2Query), {
    type: "replace-source",
    records: [historyRecord, earlierRecord],
    virtualToday,
});
const stableEarlierItem = incrementalState.items.find(
    (item) => item.path === earlierFile.path
);
incrementalState = reduceJournalState(incrementalState, {
    type: "upsert-source",
    record: { ...historyRecord, content: "- history updated" },
    virtualToday,
});
assert.strictEqual(
    incrementalState.items.find((item) => item.path === earlierFile.path),
    stableEarlierItem,
    "updating one source path should preserve unrelated projection identity"
);
incrementalState = reduceJournalState(incrementalState, {
    type: "remove-source",
    path: historyFile.path,
    virtualToday,
});
assert.deepEqual(
    incrementalState.items.map((item) => item.path),
    [todayPath, earlierFile.path],
    "removing one source should leave unrelated cards and virtual today in place"
);
const renamedFile = file("260911", { path: "Journal/260911.md" });
const renamedRecord = {
    ...earlierRecord,
    dateLabel: "2026-09-11",
    dateTime: 1789056000000,
    file: renamedFile,
    path: renamedFile.path,
};
incrementalState = reduceJournalState(incrementalState, {
    type: "rename-source",
    oldPath: earlierFile.path,
    record: renamedRecord,
    virtualToday,
});
assert.deepEqual(
    incrementalState.items.map((item) => item.path),
    [todayPath, renamedFile.path],
    "rename should replace only the old source key"
);
const readyEditorInput = {
    actualPath: todayPath,
    editorConnected: true,
    expectedPath: todayPath,
    hostShown: true,
    leafConnected: true,
    sessionId: "journal-v2-editor-1",
    slotConnected: true,
};
assert.deepEqual(resolveJournalEditorReadiness(readyEditorInput), {
    status: "ready",
});
assert.deepEqual(
    resolveJournalEditorReadiness({
        ...readyEditorInput,
        actualPath: historyFile.path,
    }),
    { status: "waiting", reason: "path-not-matched" },
    "a connected editor for the wrong file must not become ready"
);
assert.deepEqual(
    resolveJournalEditorReadiness({
        ...readyEditorInput,
        editorConnected: false,
    }),
    { status: "waiting", reason: "editor-not-connected" },
    "setViewState completion alone must not mark the editor ready"
);
const visibleActivity = {
    collapsed: false,
    distance: 0,
    focused: false,
    visible: true,
};
const offscreenActivity = {
    collapsed: false,
    distance: 100,
    focused: false,
    visible: false,
};
const poolEvictions = [];
const journalEditorPool = new JournalEditorPool(2);
journalEditorPool.acquire(
    "visible",
    () => poolEvictions.push("visible"),
    visibleActivity
);
const farLease = journalEditorPool.acquire(
    "far",
    () => poolEvictions.push("far"),
    { ...offscreenActivity, distance: 500 }
);
farLease.setActivity({
    ...offscreenActivity,
    collapsed: true,
    distance: 500,
});
assert.deepEqual(poolEvictions, [], "collapsing must not release an editor");
assert.equal(journalEditorPool.size, 2, "collapse must preserve the bounded pool entry");
const nearLease = journalEditorPool.acquire(
    "near",
    () => poolEvictions.push("near"),
    offscreenActivity
);
assert.equal(nearLease.granted, true);
assert.deepEqual(
    poolEvictions,
    ["far"],
    "pool pressure should release the farthest unpinned editor"
);
assert.deepEqual(journalEditorPool.keys(), ["visible", "near"]);

const pinnedPool = new JournalEditorPool(2);
pinnedPool.acquire("visible", () => undefined, visibleActivity);
pinnedPool.acquire(
    "focused",
    () => undefined,
    { ...offscreenActivity, focused: true }
);
const deniedLease = pinnedPool.acquire("waiting", () => undefined, offscreenActivity);
assert.equal(deniedLease.granted, false, "all pinned editors must remain mounted");
assert.deepEqual(pinnedPool.keys(), ["visible", "focused"]);
const savingPool = new JournalEditorPool(1);
savingPool.acquire(
    "saving",
    () => { throw new Error("pending save was evicted"); },
    { ...offscreenActivity, pendingSave: true }
);
assert.equal(
    savingPool.acquire("next", () => undefined, offscreenActivity).granted,
    false,
    "a pending native save must keep its editor until the disk catches up"
);
const priorityEvictions = [];
const priorityPool = new JournalEditorPool(2);
priorityPool.acquire(
    "visible",
    () => priorityEvictions.push("visible"),
    visibleActivity
);
priorityPool.acquire(
    "focused",
    () => priorityEvictions.push("focused"),
    { ...offscreenActivity, focused: true }
);
const priorityLease = priorityPool.acquire(
    "today",
    () => priorityEvictions.push("today"),
    visibleActivity,
    { allowVisibleEviction: true }
);
assert.equal(
    priorityLease.granted,
    true,
    "an explicit user activation should preempt a visible but unfocused editor"
);
assert.deepEqual(priorityEvictions, ["visible"]);
assert.deepEqual(priorityPool.keys(), ["focused", "today"]);

const recentEvictions = [];
const recentPool = new JournalEditorPool(2);
const olderLease = recentPool.acquire(
    "older",
    () => recentEvictions.push("older"),
    offscreenActivity
);
recentPool.acquire(
    "newer",
    () => recentEvictions.push("newer"),
    offscreenActivity
);
olderLease.touch();
recentPool.acquire("incoming", () => undefined, offscreenActivity);
assert.deepEqual(
    recentEvictions,
    ["newer"],
    "recent use should protect an otherwise equal offscreen editor"
);
const renamedEvictions = [];
const renamePool = new JournalEditorPool(2);
const staleRenamedLease = renamePool.acquire(
    "Journal/old.md",
    () => renamedEvictions.push("old"),
    offscreenActivity
);
const renamedLease = renamePool.rename(
    "Journal/old.md",
    "Journal/new.md",
    () => renamedEvictions.push("new")
);
assert.ok(renamedLease, "renaming a mounted editor should return its migrated lease");
assert.deepEqual(
    renamePool.keys(),
    ["Journal/new.md"],
    "renaming should preserve one pool entry under the new path"
);
staleRenamedLease.release();
assert.deepEqual(
    renamePool.keys(),
    ["Journal/new.md"],
    "the old lease must not release the migrated editor"
);
renamedLease.release();
assert.deepEqual(renamedEvictions, ["new"]);
assert.deepEqual(
    recordRecentPath(["A.md", "B.md", "C.md"], "C.md"),
    ["C.md", "A.md", "B.md"],
    "recording an edited file should move it to the top without truncating history"
);
const metadataElement = {
    closest: (selector) => selector === ".metadata-container" ? {} : null,
};
const bodyElement = { closest: () => null };
const metadataInfo = {
    contentEl: {
        contains: (element) => element === metadataElement || element === bodyElement,
    },
};
assert.equal(
    shouldRecordRecentEditorChange({ hasFocus: () => true }, {}, null),
    true,
    "focused Markdown editors should update Recent files"
);
assert.equal(
    shouldRecordRecentEditorChange(
        { hasFocus: () => false },
        metadataInfo,
        metadataElement
    ),
    true,
    "focused native Properties controls should update Recent files"
);
assert.equal(
    shouldRecordRecentEditorChange(
        { hasFocus: () => false },
        metadataInfo,
        bodyElement
    ),
    false,
    "unfocused external editor synchronization should not update Recent files"
);
assert.deepEqual(
    resolveOutlinerCapabilities("stream-only", true, true),
    { selection: true, commands: false, paste: true },
    "external Outliner must not disable Stream block selection"
);
assert.deepEqual(
    resolveOutlinerCapabilities("off", true, false),
    { selection: false, commands: false, paste: false },
    "Outliner off scope must disable all built-in capabilities"
);
assert.deepEqual(
    renameRecentPath(["A.md", "B.md", "C.md"], "A.md", "B.md"),
    ["B.md", "C.md"],
    "recent file rename should preserve order and remove collisions"
);
assert.deepEqual(
    removeRecentPath(["A.md", "B.md", "C.md"], "B.md"),
    ["A.md", "C.md"],
    "recent file delete should remove only the deleted path"
);
assert.equal(nextSettingsRevision(0), 1);
assert.equal(
    nextSettingsRevision(nextSettingsRevision(41)),
    43,
    "settings revision should advance monotonically so opened views can refresh settings-backed UI"
);
assert.deepEqual(
    buildDefaultJournalStreamViewState(DEFAULT_SETTINGS),
    {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDate",
        selectedRange: "recent-30",
        customRange: null,
    },
    "default Journal Stream command should persist folder/journalDate/recent-30 state"
);
assert.deepEqual(
    buildDefaultJournalStreamViewState({
        ...DEFAULT_SETTINGS,
        defaultOpenMode: "daily",
        initialRange: "today",
    }),
    {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange: "today",
        customRange: null,
    },
    "Daily default mode should persist journalDate and the configured initial range"
);
assert.deepEqual(
    buildJournalFolderViewState("Journal/Sub", "journalDate", "recent-7"),
    {
        selectionMode: "folder",
        target: "Journal/Sub",
        timeField: "journalDate",
        selectedRange: "recent-7",
        customRange: null,
    },
    "folder entry state should be explicit and restoreable"
);
assert.deepEqual(
    buildDailyViewState("month"),
    {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange: "month",
        customRange: null,
    },
    "daily entry state should be explicit and restoreable"
);
assert.deepEqual(
    buildTagViewState("#journal", "mtime", "recent-30"),
    {
        selectionMode: "tag",
        target: "#journal",
        timeField: "mtime",
        selectedRange: "recent-30",
        customRange: null,
    },
    "tag entry state should persist target/time field/range for workspace restore"
);
assert.equal(
    canCopyJournalStreamMarkdown(true, true),
    true,
    "export command should be enabled only when export is enabled and a Journal view exists"
);
assert.equal(
    canCopyJournalStreamMarkdown(false, true),
    false,
    "export command should be disabled when export setting is off"
);
assert.equal(
    canCopyJournalStreamMarkdown(true, false),
    false,
    "export command should be disabled when no Journal view exists"
);
assert.deepEqual(
    restoreJournalStreamState(
        {
            selectionMode: "folder",
            target: "Journal",
            timeField: "journalDateReverse",
            selectedRange: "recent-7",
            customRange: {
                start: "2026-08-01T00:00:00.000",
                end: "2026-08-07T23:59:59.999",
            },
        },
        { initialRange: "recent-30" }
    ),
    {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDateReverse",
        selectedRange: "recent-7",
        customRange: null,
    },
    "workspace state restore should keep valid non-custom state and clear stale customRange"
);
assert.deepEqual(
    restoreJournalStreamState(undefined, { initialRange: "recent-30" }),
    {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange: "recent-30",
        customRange: null,
    },
    "workspace state restore should build a stable default state when Obsidian passes no state"
);
assert.deepEqual(
    restoreJournalStreamState(null, { initialRange: "recent-7" }),
    {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange: "recent-7",
        customRange: null,
    },
    "workspace state restore should build a stable default state from null state"
);
assert.deepEqual(
    {
        ...restoreJournalStreamState(
            {
                selectionMode: "folder",
                target: "Journal",
                timeField: "journalDate",
                selectedRange: "custom",
                customRange: {
                    start: "2026-08-01T00:00:00.000",
                    end: "2026-08-07T23:59:59.999",
                },
            },
            { initialRange: "recent-30" }
        ),
        customRange: "checked separately",
    },
    {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDate",
        selectedRange: "custom",
        customRange: "checked separately",
    },
    "workspace state restore should keep valid custom state"
);
assert.deepEqual(
    pickDate(
        restoreJournalStreamState(
            {
                selectionMode: "folder",
                target: "Journal",
                timeField: "journalDate",
                selectedRange: "custom",
                customRange: {
                    start: "2026-08-01T00:00:00.000",
                    end: "2026-08-07T23:59:59.999",
                },
            },
            { initialRange: "recent-30" }
        ).customRange?.start
    ),
    {
        year: 2026,
        month: 8,
        day: 1,
    },
    "workspace state restore should normalize serialized custom start dates"
);
assert.deepEqual(
    restoreJournalStreamState(
        {
            selectionMode: "daily",
            target: "Journal",
            timeField: "bad-field",
            selectedRange: "bad-range",
        },
        { initialRange: "recent-30" }
    ),
    {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange: "recent-30",
        customRange: null,
    },
    "workspace state restore should sanitize invalid range/timeField and clear daily target"
);
assert.deepEqual(
    restoreJournalStreamState(
        {
            selectionMode: "bad-mode",
            target: "Journal",
            timeField: "mtime",
            selectedRange: "custom",
            customRange: {
                start: "not-a-date",
                end: "2026-08-07T23:59:59.999",
            },
        },
        { initialRange: "recent-7" }
    ),
    {
        selectionMode: "daily",
        target: "",
        timeField: "mtime",
        selectedRange: "recent-7",
        customRange: null,
    },
    "workspace state restore should fall back when custom range is invalid or mode is unknown"
);

assert.equal(
    isFileInFolder({ parent: { path: "Journal" } }, "Journal"),
    true,
    "folder source should include files directly inside the Journal folder"
);
assert.equal(
    isFileInFolder({ parent: { path: "Journal/Project" } }, "Journal"),
    true,
    "folder source should include files inside Journal subfolders"
);
assert.equal(
    isFileInFolder({ parent: { path: "Journalism" } }, "Journal"),
    false,
    "folder source should not match adjacent path prefixes"
);
assert.equal(
    isFileInFolder({ parent: { path: "Archive/Journal" } }, "Journal"),
    false,
    "folder source should not match folders outside the configured Journal root"
);
assert.equal(
    isFileInFolder({ parent: null }, "Journal"),
    false,
    "folder source should ignore files without a parent folder"
);
assert.equal(normalizeTag("journal"), "#journal");
assert.equal(normalizeTag("#journal"), "#journal");
assert.equal(normalizeTag("  "), null);
assert.equal(
    fileHasTag({ tags: [{ tag: "#journal" }, { tag: "#task" }] }, "journal"),
    true,
    "tag source should normalize missing # prefixes"
);
assert.equal(
    fileHasTag({ tags: [{ tag: "#journal/project" }] }, "#journal"),
    false,
    "tag source should match exact Obsidian tag cache entries"
);
assert.equal(
    fileHasTag({ tags: [] }, "journal"),
    false,
    "tag source should reject empty tag caches"
);
assert.deepEqual(
    sortAndFilterJournalFiles(
        [
            file("260812"),
            file("260810"),
            file("260701"),
            file("unparsed", { mtime: dateTime(2026, 8, 11) }),
        ],
        "journalDate",
        "recent-7",
        dateTime(2026, 8, 12)
    ).map((item) => item.basename),
    ["260812", "unparsed", "260810"],
    "folder/tag source pipeline should sort by Journal date and then apply the bounded range"
);

assert.deepEqual(
    appendRenderBatch([], ["a", "b", "c", "d", "e", "f"], 5),
    {
        renderedFiles: ["a", "b", "c", "d", "e"],
        pendingFiles: ["f"],
        hasMore: true,
    },
    "initial render should append one bounded batch instead of the whole filtered list"
);
assert.deepEqual(
    appendRenderBatch(["a", "b"], ["c"], 5),
    {
        renderedFiles: ["a", "b", "c"],
        pendingFiles: [],
        hasMore: false,
    },
    "batch append should stop when no files remain"
);
assert.deepEqual(
    rebuildRenderWindow(
        ["new-a", "new-b", "new-c", "new-d", "new-e", "new-f"],
        ["old-a", "old-b", "old-c"],
        5
    ),
    {
        renderedFiles: ["new-a", "new-b", "new-c", "new-d", "new-e"],
        pendingFiles: ["new-f"],
        hasMore: true,
    },
    "refresh should keep at least one bounded batch when the existing window is smaller"
);
assert.deepEqual(
    rebuildRenderWindow(
        ["new-a", "new-b", "new-c", "new-d", "new-e", "new-f"],
        ["old-a", "old-b", "old-c", "old-d", "old-e", "old-f"],
        5
    ),
    {
        renderedFiles: ["new-a", "new-b", "new-c", "new-d", "new-e", "new-f"],
        pendingFiles: [],
        hasMore: false,
    },
    "refresh should preserve the current rendered window size without adding an extra batch"
);

assert.equal(
    shouldRenderMarkdownPreview(true, false, false),
    true,
    "visible preview-mode cards should render Markdown preview"
);
assert.equal(
    shouldUnloadMarkdownPreview(false, true),
    true,
    "offscreen preview-mode cards should unload Markdown preview"
);
assert.equal(
    shouldMountMarkdownEditor(true, false),
    true,
    "entering edit mode should mount the Markdown editor"
);
assert.equal(
    shouldUnloadMarkdownEditor(true, true),
    false,
    "offscreen cards that are still in edit mode should keep the Markdown editor mounted"
);
assert.equal(
    shouldUnloadMarkdownEditor(false, true),
    true,
    "leaving edit mode should unload the Markdown editor"
);
assert.equal(
    shouldRefreshPreviewAfterExternalChange(true, false),
    true,
    "visible preview-mode cards should refresh preview after an external change"
);
assert.equal(
    shouldRefreshPreviewAfterExternalChange(false, false),
    false,
    "offscreen preview-mode cards should record external change without rendering Markdown preview"
);
assert.equal(
    shouldRefreshPreviewAfterExternalChange(true, true),
    false,
    "editing cards should reload the editor instead of refreshing preview in place"
);

const evictedEditors = [];
const editorPool = new StreamEditorPool(2);
const leaseA = editorPool.acquire("journal:a", () => evictedEditors.push("a"));
const leaseB = editorPool.acquire("page:b", () => evictedEditors.push("b"));
assert.equal(leaseA.granted, true);
assert.equal(leaseB.granted, true);
assert.deepEqual(editorPool.keys(), ["journal:a", "page:b"]);

leaseA.touch();
const leaseC = editorPool.acquire("journal:c", () => evictedEditors.push("c"));
assert.equal(leaseC.granted, true);
assert.deepEqual(evictedEditors, ["b"], "editor pool should evict the least recently used lease");
assert.deepEqual(editorPool.keys(), ["journal:a", "journal:c"]);

leaseA.setPinned(true);
leaseC.setPinned(true);
const rejectedLease = editorPool.acquire("page:d", () => evictedEditors.push("d"));
assert.equal(rejectedLease.granted, false, "editor pool should not evict active pinned editors");
assert.equal(editorPool.size, 2);

leaseC.setPinned(false);
const leaseD = editorPool.acquire("page:d", () => evictedEditors.push("d"));
assert.equal(leaseD.granted, true);
assert.deepEqual(evictedEditors, ["b", "c"]);
assert.deepEqual(editorPool.keys(), ["journal:a", "page:d"]);

leaseC.release();
assert.deepEqual(
    editorPool.keys(),
    ["journal:a", "page:d"],
    "a stale lease must not release a newer entry"
);
leaseA.release();
assert.deepEqual(editorPool.keys(), ["page:d"]);

const replacementPool = new StreamEditorPool(1);
let originalReplacementEvictions = 0;
let replacementEvictions = 0;
const originalLease = replacementPool.acquire("same-key", () => {
    originalReplacementEvictions += 1;
});
const replacementLease = replacementPool.acquire("same-key", () => undefined);
assert.equal(
    originalReplacementEvictions,
    1,
    "replacing a same-key lease must dispose the previous editor resource"
);
originalLease.release();
originalLease.setPinned(true);
originalLease.touch();
assert.equal(
    replacementPool.has("same-key"),
    true,
    "an older lease must not mutate or release a replacement lease for the same key"
);
const releasePool = new StreamEditorPool(1);
const releaseLease = releasePool.acquire("release", () => {
    replacementEvictions += 1;
});
releaseLease.release();
assert.equal(replacementEvictions, 1, "release must dispose its editor resource");
replacementLease.release();
assert.equal(replacementPool.size, 0);

const isolatedErrors = [];
const errorPool = new StreamEditorPool(2, (error, key) => {
    isolatedErrors.push({ error, key });
});
let successfulCleanupCount = 0;
errorPool.acquire("throws", () => {
    throw new Error("cleanup failed");
});
errorPool.acquire("cleans", () => {
    successfulCleanupCount += 1;
});
errorPool.clear();
assert.equal(successfulCleanupCount, 1, "one cleanup failure must not block later cleanup");
assert.equal(isolatedErrors.length, 1);
assert.equal(isolatedErrors[0].key, "throws");
assert.equal(errorPool.size, 0);

editorPool.clear();
assert.deepEqual(evictedEditors, ["b", "c", "a", "d"]);
assert.equal(editorPool.size, 0);
assert.throws(
    () => new StreamEditorPool(0),
    /integer from 1 to 5/,
    "editor pool should reject an invalid resource limit"
);
assert.equal(new StreamEditorPool().maxEditors, MAX_STREAM_EDITORS);
assert.throws(
    () => new StreamEditorPool(MAX_STREAM_EDITORS + 1),
    /integer from 1 to 5/,
    "editor pool should enforce the product-wide hard editor limit"
);

const firstPageTarget = {
    path: "A.md",
    kind: "file",
    source: "navigation",
    label: "A",
};
const secondPageTarget = {
    path: "B.md",
    kind: "heading",
    source: "link",
    subpath: "#Heading",
    label: "B#Heading",
};
const duplicateFirstTarget = {
    path: "A.md",
    kind: "block",
    source: "link",
    subpath: "#^abc",
    label: "A#^abc",
};

let pageStack = pushPageStreamTarget([], firstPageTarget, 20);
assert.deepEqual(
    pageStack.targets.map((target) => target.path),
    ["A.md"],
    "Page stream should push the first target"
);
assert.equal(pageStack.activePath, "A.md");

pageStack = pushPageStreamTarget(pageStack.targets, secondPageTarget, 20);
assert.deepEqual(
    pageStack.targets.map((target) => target.path),
    ["B.md", "A.md"],
    "Page stream should add new targets to the top"
);
assert.equal(pageStack.activePath, "B.md");

pageStack = pushPageStreamTarget(pageStack.targets, duplicateFirstTarget, 20);
assert.deepEqual(
    pageStack.targets.map((target) => `${target.path}:${target.kind}`),
    ["A.md:block", "B.md:heading"],
    "Page stream should move duplicate pages to top and replace the target"
);
assert.equal(pageStack.activePath, "A.md");

const trimmedStack = pushPageStreamTarget(
    [firstPageTarget, secondPageTarget],
    { path: "C.md", kind: "file", source: "command", label: "C" },
    2
);
assert.deepEqual(
    trimmedStack.targets.map((target) => target.path),
    ["C.md", "A.md"],
    "Page stream should enforce max card limit"
);

assert.deepEqual(
    restorePageStreamTargets(
        [firstPageTarget, secondPageTarget, duplicateFirstTarget],
        new Set(["A.md"]),
        20
    ).map((target) => `${target.path}:${target.kind}`),
    ["A.md:file"],
    "Page stream restore should drop missing files and duplicate paths"
);

const thirdPageTarget = {
    path: "C.md",
    kind: "file",
    source: "command",
    label: "C",
};
assert.deepEqual(
    planPageStreamReconcile(
        [firstPageTarget, secondPageTarget],
        [thirdPageTarget, firstPageTarget, secondPageTarget]
    ),
    [{ type: "insert", index: 0, target: thirdPageTarget }],
    "Page stream reconcile should insert a new top card without moving retained cards"
);
assert.deepEqual(
    planPageStreamReconcile(
        [firstPageTarget, secondPageTarget, thirdPageTarget],
        [thirdPageTarget, firstPageTarget, secondPageTarget]
    ),
    [{ type: "move", index: 0, path: "C.md" }],
    "Page stream reconcile should move only the repeated card to the top"
);
assert.deepEqual(
    planPageStreamReconcile(
        [firstPageTarget, secondPageTarget, thirdPageTarget],
        [firstPageTarget, thirdPageTarget]
    ),
    [{ type: "remove", path: "B.md" }],
    "Page stream reconcile should remove only the closed middle card"
);
assert.deepEqual(
    planPageStreamReconcile(
        [firstPageTarget, secondPageTarget],
        [duplicateFirstTarget, secondPageTarget]
    ),
    [{ type: "update", index: 0, target: duplicateFirstTarget }],
    "Page stream reconcile should update a changed target without replacing its card"
);
const trimPlan = planPageStreamReconcile(
    [firstPageTarget, secondPageTarget],
    [thirdPageTarget, firstPageTarget]
);
assert.deepEqual(
    trimPlan,
    [
        { type: "remove", path: "B.md" },
        { type: "insert", index: 0, target: thirdPageTarget },
    ],
    "Page stream reconcile should trim only the evicted tail before inserting"
);
assert.equal(
    trimPlan.some(
        (operation) =>
            operation.type === "remove" && operation.path === firstPageTarget.path
    ),
    false,
    "Page stream reconcile must not remove an unaffected retained path"
);

const outlineFixture = [
    "---",
    "fake: '# Not outline'",
    "---",
    "# Root",
    "- ## List heading",
    "- top block",
    "\t- child block",
    "\t\t- grand child block",
    "\t\t\t- great grand child block",
    "\t\t\t\t- deepest block",
    "\t\t\t- ## Deep list heading",
    "  - space block",
    "```",
    "- ## fenced fake",
    "```",
    "%%",
    "- ## comment fake",
    "%%",
    "## Second",
    "- [x] done task",
    "- task with block ^block-123",
].join("\n");

assert.deepEqual(
    parseListHeadingItems(outlineFixture).map((item) => ({
        kind: item.kind,
        title: item.title,
        line: item.line,
        indentDepth: item.indentDepth,
    })),
    [
        { kind: "markdown-heading", title: "Root", line: 3, indentDepth: undefined },
        { kind: "list-heading", title: "List heading", line: 4, indentDepth: 0 },
        { kind: "indent-block", title: "top block", line: 5, indentDepth: 0 },
        { kind: "indent-block", title: "child block", line: 6, indentDepth: 1 },
        { kind: "indent-block", title: "grand child block", line: 7, indentDepth: 2 },
        { kind: "indent-block", title: "great grand child block", line: 8, indentDepth: 3 },
        { kind: "indent-block", title: "deepest block", line: 9, indentDepth: 4 },
        { kind: "list-heading", title: "Deep list heading", line: 10, indentDepth: 3 },
        { kind: "markdown-heading", title: "Second", line: 18, indentDepth: undefined },
        { kind: "indent-block", title: "done task", line: 19, indentDepth: 0 },
        { kind: "indent-block", title: "task with block", line: 20, indentDepth: 0 },
    ],
    "List heading parser should skip frontmatter, fenced code, comments, and space-indented list blocks"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, 0).map(
        (item) => `${item.kind}:${item.title}`
    ),
    [
        "markdown-heading:Root",
        "list-heading:List heading",
        "list-heading:Deep list heading",
        "markdown-heading:Second",
    ],
    "Depth 0 should include Markdown headings and list headings at every indent"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, 1).map(
        (item) => `${item.kind}:${item.title}`
    ),
    [
        "markdown-heading:Root",
        "list-heading:List heading",
        "indent-block:top block",
        "list-heading:Deep list heading",
        "markdown-heading:Second",
        "indent-block:done task",
        "indent-block:task with block",
    ],
    "Depth 1 should include only the shallowest actual list depth"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, 2).map(
        (item) => `${item.kind}:${item.title}`
    ),
    [
        "markdown-heading:Root",
        "list-heading:List heading",
        "indent-block:top block",
        "indent-block:child block",
        "list-heading:Deep list heading",
        "markdown-heading:Second",
        "indent-block:done task",
        "indent-block:task with block",
    ],
    "Depth 2 should include the two shallowest actual list depths"
);

assert.deepEqual(
    [3, 4, 5].map((depth) =>
        collectListHeadingItems(outlineFixture, depth).map((item) => item.title)
    ),
    [
        [
            "Root",
            "List heading",
            "top block",
            "child block",
            "grand child block",
            "Deep list heading",
            "Second",
            "done task",
            "task with block",
        ],
        [
            "Root",
            "List heading",
            "top block",
            "child block",
            "grand child block",
            "great grand child block",
            "Deep list heading",
            "Second",
            "done task",
            "task with block",
        ],
        [
            "Root",
            "List heading",
            "top block",
            "child block",
            "grand child block",
            "great grand child block",
            "deepest block",
            "Deep list heading",
            "Second",
            "done task",
            "task with block",
        ],
    ],
    "Depths 3-5 should cumulatively reveal relative list levels"
);

assert.deepEqual(
    summarizeListHeadingDepths(outlineFixture),
    {
        availableDepth: 5,
        cumulativeBlockCounts: [0, 3, 4, 5, 6, 7],
    },
    "Depth summary should report five actual relative levels and cumulative counts"
);

// Fold rank follows actual indentation depths, independently of the display filter.
const batchItems = parseListHeadingItems("# Root\n- A\n\t- A1\n\t\t- A1a\n\t\t\t- A1leaf\n- B\n\t- B1\n## Section\n- C\n\t- C1\n# Tail");
const batchKeys = getListHeadingItemKeys(batchItems);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 0), [0, 7]);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 1), [1, 5, 8]);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 2), [2]);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 3), [3]);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 4), []);
assert.deepEqual(getListHeadingFoldTargets(batchItems, 5), []);
assert.deepEqual(getListHeadingFoldTargets([], 0), []);
assert.deepEqual(getListHeadingFoldTargets(parseListHeadingItems("# Root\n- ## List section\n- Child\n- ### Nested section\n- Leaf"), 0), [0, 1, 3], "Depth 0 targets every heading kind and level with descendants");
const mixedFolds = new Set([batchKeys[0], batchKeys[2], batchKeys[3], batchKeys[5], batchKeys[7]]);
const collapsedRank = applyListHeadingDepthFold(batchItems, batchKeys, mixedFolds, 1, true);
assert.deepEqual([...collapsedRank].sort(), [...new Set([...mixedFolds, batchKeys[1], batchKeys[5], batchKeys[8]])].sort(), "Collapse must add only exact-rank parents and preserve other folds");
assert.deepEqual(applyListHeadingDepthFold(batchItems, batchKeys, collapsedRank, 1, true), collapsedRank, "Collapse is deterministic in mixed states");
const expandedRank = applyListHeadingDepthFold(batchItems, batchKeys, collapsedRank, 2, false);
assert.deepEqual([...expandedRank].sort(), [batchKeys[3], batchKeys[5], batchKeys[7], batchKeys[8]].sort(), "Expand clears target and its ancestors, retaining descendant and other-branch folds");
assert.deepEqual(mixedFolds.size, 5, "Bulk operations must not mutate their input state");
assert.deepEqual([...applyListHeadingDepthFold(batchItems, batchKeys, collapsedRank, 0, false)].sort(), [batchKeys[1], batchKeys[2], batchKeys[3], batchKeys[5], batchKeys[8]].sort(), "Expand all headings must preserve list block folds");
assert.deepEqual(applyListHeadingDepthFold(batchItems, batchKeys, collapsedRank, 5, false), collapsedRank, "A missing/leaf-only rank is a no-op");
const sparseItems = parseListHeadingItems("# Root\n\t\t- Sparse parent\n\t\t\t\t- Sparse child\n\t\t\t\t\t- Leaf");
assert.deepEqual(getListHeadingFoldTargets(sparseItems, 1), [1], "Rank 1 is shallowest actual depth, even when not indent 0");
assert.deepEqual(getListHeadingFoldTargets(sparseItems, 2), [2]);
assert.deepEqual(getListHeadingFoldTargets(parseListHeadingItems("# Root\n- Parent\n### Next heading\n- Child"), 1), [], "The next heading must never become a list parent's descendant");

assert.deepEqual(getListHeadingDescendantEnds([]), [], "An empty outline has no subtrees");
const mixedOutline = collectListHeadingItems("# Root\n- A\n### Section\n- B", 5);
assert.deepEqual(
    getListHeadingDescendantEnds(mixedOutline),
    [4, 2, 4, 4],
    "A list block must not fold the next heading section"
);
assert.deepEqual(
    getListHeadingItemKeys(mixedOutline),
    getListHeadingItemKeys(collectListHeadingItems("\n# Root\n\n- A\n### Section\n- B", 5)),
    "Inserting blank lines must preserve folding identities"
);
const duplicateOutline = parseListHeadingItems("# Root\n- Parent\n\t- Child\n- Parent\n\t- Child\n## Section\n- Parent\n\t- Child");
const duplicateKeys = getListHeadingItemKeys(duplicateOutline);
assert.equal(new Set(duplicateKeys).size, duplicateKeys.length, "Duplicate labels must have distinct folding identities");
const fewerDuplicateKeys = getListHeadingItemKeys(parseListHeadingItems("# Root\n- Parent\n\t- Child\n## Section\n- Parent\n\t- Child"));
assert.deepEqual(
    [...reconcileListHeadingCollapsedKeys(duplicateKeys, fewerDuplicateKeys, new Set([duplicateKeys[1], duplicateKeys[3]]))],
    [],
    "Deleting a duplicate parent must not transfer its collapse state to another sibling"
);
assert.equal(
    reconcileListHeadingCollapsedKeys(duplicateKeys, [], new Set(duplicateKeys)).size,
    0,
    "Clearing an outline must clear removed folding identities"
);
const filteredOffsets = new Set(collectListHeadingItems("# Root\n- Parent\n\t- Child\n- Parent\n\t- Child\n## Section\n- Parent\n\t- Child", 1).map(item => item.offset));
assert.deepEqual(
    duplicateKeys.filter((_, index) => filteredOffsets.has(duplicateOutline[index].offset)),
    getListHeadingItemKeys(duplicateOutline.filter(item => filteredOffsets.has(item.offset))),
    "Changing visible depth must preserve parent folding identities"
);
assert.deepEqual(
    getListHeadingDescendantEnds(collectListHeadingItems(outlineFixture, 5)),
    [11, 7, 7, 7, 7, 7, 7, 8, 11, 10, 11],
    "Subtrees should stop before a same-level sibling, retain nested descendants, and exclude fenced/comment items"
);
assert.deepEqual(
    getListHeadingDescendantEnds(collectListHeadingItems(outlineFixture, 0)),
    [4, 2, 3, 4],
    "Heading-only mode should not offer folds for hidden blocks or leaf headings"
);
assert.deepEqual(
    getListHeadingDescendantEnds(collectListHeadingItems("- A\n\t- A1\n\t\t- A1a\n\t- A2\n- B\n\t- B1\n- C", 5)),
    [4, 3, 3, 4, 6, 6, 7],
    "Block folding should include all descendants without swallowing adjacent parent blocks"
);

const sparseDepthFixture = [
    "# Sparse",
    "\t\t- first actual depth",
    "\t\t\t\t- second actual depth",
].join("\n");
assert.deepEqual(
    summarizeListHeadingDepths(sparseDepthFixture),
    {
        availableDepth: 2,
        cumulativeBlockCounts: [0, 1, 2, 2, 2, 2],
    },
    "List depth should be relative to actual indentation levels, not absolute tab count"
);

assert.deepEqual(
    normalizeOutlinerPaste("alpha\nbeta\n").text,
    "- alpha\n- beta\n",
    "Outliner paste should convert ordinary multiline paragraphs to list items"
);
assert.deepEqual(
    normalizeOutlinerPaste("alpha"),
    { text: "alpha", changed: false, reason: "single-line" },
    "Outliner paste should leave ordinary single-line paste untouched"
);
assert.deepEqual(
    normalizeOutlinerPaste("- alpha\n\t- beta"),
    { text: "- alpha\n\t- beta", changed: false, reason: "unchanged" },
    "Outliner paste should leave already-normalized tab-indented lists untouched"
);
assert.deepEqual(
    normalizeOutlinerPaste("- alpha\n  - beta\n    - gamma").text,
    "- alpha\n\t- beta\n\t\t- gamma",
    "Outliner paste should normalize mixed two/four-space list indentation to tabs"
);
assert.deepEqual(
    normalizeOutlinerPaste("1. alpha\n    2. beta\n\t- gamma").text,
    "- alpha\n\t- beta\n\t- gamma",
    "Outliner paste should normalize ordered and unordered list markers"
);
assert.deepEqual(
    normalizeOutlinerPaste("- [X] done\n- [ ] todo").text,
    "- [x] done\n- [ ] todo",
    "Outliner paste should preserve task checkbox semantics"
);
assert.equal(
    normalizeOutlinerPaste(
        "- A list item copied from a web page\n  with a wrapped continuation\n   - child with unstable indentation\n    another wrapped line"
    ).text,
    "- A list item copied from a web page with a wrapped continuation\n\t- child with unstable indentation another wrapped line",
    "Outliner paste should merge wrapped list continuations and normalize unstable indentation"
);
assert.equal(
    normalizeOutlinerPaste("- root\n - root with one-column drift\n   - child\n    - child with drift").text,
    "- root\n- root with one-column drift\n\t- child\n\t- child with drift",
    "Outliner paste should cluster one-column indentation drift at the same depth"
);
assert.equal(
    normalizeOutlinerPaste("- first\n\nstandalone paragraph\nwrapped after a blank\n\n- second").text,
    "- first\n- standalone paragraph wrapped after a blank\n- second",
    "Outliner paste should use blank lines as block boundaries"
);
assert.equal(
    normalizeOutlinerPaste(
        "This is a sufficiently long paragraph copied with a soft line break\nand this line should remain in the same outliner block"
    ).text,
    "- This is a sufficiently long paragraph copied with a soft line break and this line should remain in the same outliner block",
    "Outliner paste should merge likely soft-wrapped prose"
);
assert.equal(
    normalizeOutlinerPaste("alpha\nbeta\ngamma").text,
    "- alpha\n- beta\n- gamma",
    "Outliner paste should keep short line-oriented lists as separate blocks"
);
const tablePaste = "| a | b |\n|---|---|\n| 1 | 2 |";
assert.deepEqual(
    normalizeOutlinerPaste(tablePaste),
    { text: tablePaste, changed: false, reason: "protected" },
    "Outliner paste should protect Markdown tables"
);
const codePaste = "```js\nconst x = 1;\n```";
assert.deepEqual(
    normalizeOutlinerPaste(codePaste),
    { text: codePaste, changed: false, reason: "protected" },
    "Outliner paste should protect fenced code blocks"
);
const calloutPaste = "> [!note]\n> - keep this";
assert.deepEqual(
    normalizeOutlinerPaste(calloutPaste),
    { text: calloutPaste, changed: false, reason: "protected" },
    "Outliner paste should protect callouts"
);
assert.equal(
    adaptOutlinerPasteToListContext("- alpha\n- beta", {
        lineText: "\t- ",
        cursorColumn: 3,
    }),
    "alpha\n\t- beta",
    "Outliner paste should fill an empty nested item and keep following items at its level"
);
assert.equal(
    adaptOutlinerPasteToListContext("- alpha\n\t- child\n- sibling", {
        lineText: "\t- existing ",
        cursorColumn: 12,
    }),
    "alpha\n\t\t- child\n\t- sibling",
    "Outliner paste should preserve pasted hierarchy relative to the current list depth"
);
assert.equal(
    adaptOutlinerPasteToListContext("- alpha\n- sibling", {
        lineText: "\t- existing",
        cursorColumn: 11,
    }),
    " alpha\n\t- sibling",
    "Outliner paste should separate inserted text from existing list content"
);
assert.equal(
    adaptOutlinerPasteToListContext(tablePaste, {
        lineText: "\t- ",
        cursorColumn: 3,
    }),
    tablePaste,
    "Outliner paste context should not rewrite protected non-list Markdown"
);
const nestedPasteState = EditorState.create({
    doc: "\t- ",
    selection: { anchor: 3 },
    extensions: [createOutlinerPasteNormalizeExtension()],
});
const nestedPasteFilters = nestedPasteState.facet(EditorView.clipboardInputFilter);
assert.equal(nestedPasteFilters.length, 1);
assert.equal(
    nestedPasteFilters[0]("- alpha\n - sibling\n   - child", nestedPasteState),
    "alpha\n\t- sibling\n\t\t- child",
    "CodeMirror clipboard filter should normalize external indentation at the active list depth"
);

const pasteFixtures = JSON.parse(
    await readFile("./scripts/fixtures/outliner/paste-cases.json", "utf8")
);
for (const fixture of pasteFixtures) {
    const actual = builtInOutlinerPaste.normalizeOutlinerPaste(fixture.input);
    assert.equal(actual.text, fixture.expected, `${fixture.name}: normalized text`);
    assert.equal(actual.reason, fixture.reason, `${fixture.name}: reason`);
}
assert.equal(
    builtInOutlinerPaste.adaptPasteToListContext(
        "1. first\n\t2. child\n3. sibling",
        "\t- existing",
        11
    ),
    "\n\t\t- first\n\t\t\t- child\n\t\t- sibling",
    "built-in Outliner should insert normalized roots as children of a nonempty block"
);
assert.deepEqual(
    builtInOutlinerPaste.planListContextPaste(
        "- B\n  - C\n- D",
        "- A",
        3
    ),
    {
        fromColumn: 3,
        toColumn: 3,
        insert: "\n\t- B\n\t\t- C\n\t- D",
        placement: "insert-children",
    },
    "nonempty list blocks should receive pasted roots at the next child level"
);
assert.deepEqual(
    builtInOutlinerPaste.planListContextPaste("B\nC", "\t- ", 3),
    {
        fromColumn: 0,
        toColumn: 3,
        insert: "\t- B\n\t- C",
        placement: "replace-empty",
    },
    "empty list blocks should be replaced at their existing depth"
);
assert.equal(
    builtInOutlinerPaste.planListContextPaste("B\nC", "plain paragraph", 5),
    null,
    "non-list destinations should preserve native paste behavior"
);
assert.equal(
    builtInOutlinerPaste.planListContextPaste(
        "```md\n- literal\n```",
        "- target",
        8
    ),
    null,
    "protected Markdown should preserve native paste behavior in a list block"
);

assert.deepEqual(
    builtInOutlinerModel.indentListSubtree(
        "- first\n- second\n\t- child\n- third",
        1
    ),
    {
        fromLine: 1,
        toLine: 2,
        replacement: "\t- second\n\t\t- child",
    },
    "Tab should indent a list item together with its subtree"
);
assert.deepEqual(
    builtInOutlinerModel.outdentListSubtree(
        "- first\n\t- second\n\t\t- child",
        1
    ),
    {
        fromLine: 1,
        toLine: 2,
        replacement: "- second\n\t- child",
    },
    "Shift-Tab should outdent a list item together with its subtree"
);
assert.deepEqual(
    builtInOutlinerModel.moveListSubtree(
        "- first\n\t- first child\n- second\n\t- second child",
        2,
        "up"
    ),
    {
        text: "- second\n\t- second child\n- first\n\t- first child",
        cursorLine: 0,
    },
    "list movement should keep each subtree intact"
);
assert.equal(
    builtInOutlinerModel.buildNewSiblingPrefix({
        indent: "\t",
        marker: "9.",
        checkbox: "x",
        content: "done",
        prefixLength: 9,
    }),
    "\t10. [ ] ",
    "Enter should increment ordered markers and reset checkbox state"
);
assert.equal(
    builtInOutlinerModel.toggleCheckboxLine("\t- [ ] 中文任务"),
    "\t- [x] 中文任务",
    "checkbox toggle should preserve Chinese content"
);

const blockSelectionLines = [
    "- parent",
    "\t- child",
    "\t\t- grandchild",
    "- sibling",
    "\t- sibling child",
    "- final",
];
const childSelection = builtInOutlinerSelection.createBlockSelection(1);
assert.deepEqual(
    builtInOutlinerSelection.resolveBlockSelection(
        blockSelectionLines,
        childSelection
    ),
    { fromLine: 1, toLine: 2 },
    "clicking a child block should select that child and its descendants"
);
assert.equal(
    builtInOutlinerSelection.serializeBlockSelection(
        blockSelectionLines,
        childSelection
    ),
    "- child\n\t- grandchild",
    "copied child subtrees should be rebased to their shallowest selected indent"
);
const parentSelection = builtInOutlinerSelection.createBlockSelection(0);
const expandedDown = builtInOutlinerSelection.adjustBlockSelection(
    blockSelectionLines,
    parentSelection,
    "down"
);
assert.deepEqual(
    builtInOutlinerSelection.resolveBlockSelection(
        blockSelectionLines,
        expandedDown
    ),
    { fromLine: 0, toLine: 4 },
    "Shift-Down should append the next sibling and its complete subtree"
);
const shrunkUp = builtInOutlinerSelection.adjustBlockSelection(
    blockSelectionLines,
    expandedDown,
    "up"
);
assert.deepEqual(
    builtInOutlinerSelection.resolveBlockSelection(
        blockSelectionLines,
        shrunkUp
    ),
    { fromLine: 0, toLine: 2 },
    "Shift-Up should shrink a downward structural selection by one subtree"
);
const expandedUp = builtInOutlinerSelection.adjustBlockSelection(
    blockSelectionLines,
    childSelection,
    "up"
);
assert.deepEqual(
    builtInOutlinerSelection.resolveBlockSelection(
        blockSelectionLines,
        expandedUp
    ),
    { fromLine: 0, toLine: 2 },
    "Shift-Up from a child should include the preceding parent and its hidden descendants"
);
assert.deepEqual(
    builtInOutlinerSelection.resolveBlockSelection(
        blockSelectionLines,
        builtInOutlinerSelection.adjustBlockSelection(
            blockSelectionLines,
            expandedUp,
            "down"
        )
    ),
    { fromLine: 1, toLine: 2 },
    "Shift-Down should shrink an upward selection back to its anchor subtree"
);

assert.equal(findBlockId("- item ^abc-123"), "abc-123");
assert.equal(findBlockId("- item"), null);
assert.deepEqual(
    appendBlockIdToLine("- [x] done", "b123"),
    {
        line: "- [x] done ^b123",
        blockId: "b123",
        changed: true,
        reason: "inserted",
    },
    "Block link helper should append ids without changing task syntax"
);
assert.deepEqual(
    appendBlockIdToLine("\t- child ^old-id", "new-id"),
    {
        line: "\t- child ^old-id",
        blockId: "old-id",
        changed: false,
        reason: "existing",
    },
    "Block link helper should reuse existing ids"
);
assert.equal(canInsertBlockId(""), false);
assert.equal(canInsertBlockId("| a | b |"), false);
assert.equal(canInsertBlockId("```ts"), false);
assert.equal(buildBlockLink("中文/页面.md", "b123"), "[[中文/页面.md#^b123]]");
assert.equal(buildBlockLink("Page.md", "b123", true), "![[Page.md#^b123]]");
assert.match(
    createBlockId(1_786_630_000_000, 0.5),
    /^b[A-Za-z0-9-]+$/,
    "Generated block ids should use Obsidian-compatible characters"
);

const journalStyles = await readFile("./src/style/index.css", "utf8");
for (const selector of [
    ".journal-v2__source-button[hidden]",
    ".journal-v2__date-icon[hidden]",
    ".journal-v2__virtual-action[hidden]",
    ".journal-v2__card-placeholder[hidden]",
]) {
    assert.match(
        journalStyles,
        new RegExp(
            `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^}]*display:\\s*none`,
            "s"
        ),
        `${selector} must remain hidden even when Obsidian button styles override the HTML default`
    );
}
for (const legacySelector of [".daily-note-view", ".daily-note-container"]) {
    assert.doesNotMatch(
        journalStyles,
        new RegExp(legacySelector.replaceAll(".", "\\.")),
        "Removed Legacy selectors must not remain in the final stylesheet"
    );
}

console.log("journalCore tests passed");

await Promise.allSettled([
    unlink(outfile),
    unlink(exportOutfile),
    unlink(visibleNotesOutfile),
    unlink(modifyQueueOutfile),
    unlink(saveStatusOutfile),
    unlink(conflictStateOutfile),
    unlink(dateInputOutfile),
    unlink(fileListOutfile),
    unlink(viewStateOutfile),
    unlink(settingsOutfile),
    unlink(settingsStateOutfile),
    unlink(recentFilesOutfile),
    unlink(settingsRevisionOutfile),
    unlink(outlinerScopeOutfile),
    unlink(journalV2RoutingOutfile),
    unlink(journalV2StateOutfile),
    unlink(journalV2ConflictOutfile),
    unlink(journalV2EditorReadinessOutfile),
    unlink(journalV2EditorPoolOutfile),
    unlink(fileSourceOutfile),
    unlink(incrementalFileSetOutfile),
    unlink(renderWindowOutfile),
    unlink(renderPolicyOutfile),
    unlink(streamEditorPoolOutfile),
    unlink(pageStreamStackOutfile),
    unlink(pageStreamReconcileOutfile),
    unlink(listHeadingParserOutfile),
    unlink(outlinerPasteOutfile),
    unlink(outlinerPasteExtensionOutfile),
    unlink(builtInOutlinerModelOutfile),
    unlink(builtInOutlinerPasteOutfile),
    unlink(builtInOutlinerSelectionOutfile),
    unlink(blockLinkOutfile),
]);

function pickDateInfo(info) {
    return {
        label: info.label,
        source: info.source,
    };
}

function pickDate(date) {
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
    };
}
