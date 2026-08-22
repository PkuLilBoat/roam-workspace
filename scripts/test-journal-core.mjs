import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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

const listHeadingParserOutfile = "./.tmp-list-heading-parser-test.mjs";
await build({
    entryPoints: ["./src/listHeadingParser.ts"],
    outfile: listHeadingParserOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { collectListHeadingItems, parseListHeadingItems } = await import(
    `${pathToFileURL(listHeadingParserOutfile).href}?t=${Date.now()}`
);

const pageStreamNativeRouterOutfile = "./.tmp-page-stream-native-router-test.mjs";
await build({
    entryPoints: ["./src/pageStreamRoutePolicy.ts"],
    outfile: pageStreamNativeRouterOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { shouldRouteSplitToPageStream } = await import(
    `${pathToFileURL(pageStreamNativeRouterOutfile).href}?t=${Date.now()}`
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

const { normalizeOutlinerPaste } = await import(
    `${pathToFileURL(outlinerPasteOutfile).href}?t=${Date.now()}`
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
        recentFiles: [],
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
        recentFiles: [" Journal/one.md ", "Journal/two.md", "Journal/one.md", 2],
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
        recentFiles: ["Journal/one.md", "Journal/two.md"],
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
assert.deepEqual(
    recordRecentPath(["A.md", "B.md", "C.md"], "C.md"),
    ["C.md", "A.md", "B.md"],
    "opening a recent file should move it to the top without truncating history"
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

const outlineFixture = [
    "---",
    "fake: '# Not outline'",
    "---",
    "# Root",
    "- ## List heading",
    "- top block",
    "\t- child block",
    "\t\t- grand child block",
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
        { kind: "markdown-heading", title: "Second", line: 15, indentDepth: undefined },
        { kind: "indent-block", title: "done task", line: 16, indentDepth: 0 },
        { kind: "indent-block", title: "task with block", line: 17, indentDepth: 0 },
    ],
    "List heading parser should skip frontmatter, fenced code, comments, and space-indented list blocks"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, "headings-only").map(
        (item) => `${item.kind}:${item.title}`
    ),
    ["markdown-heading:Root", "list-heading:List heading", "markdown-heading:Second"],
    "Headings-only mode should include Markdown headings and list headings"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, "top-indent").map(
        (item) => `${item.kind}:${item.title}`
    ),
    [
        "markdown-heading:Root",
        "list-heading:List heading",
        "indent-block:top block",
        "markdown-heading:Second",
        "indent-block:done task",
        "indent-block:task with block",
    ],
    "Top indent mode should include only the shallowest tab/list depth"
);

assert.deepEqual(
    collectListHeadingItems(outlineFixture, "top-two-indent").map(
        (item) => `${item.kind}:${item.title}`
    ),
    [
        "markdown-heading:Root",
        "list-heading:List heading",
        "indent-block:top block",
        "indent-block:child block",
        "markdown-heading:Second",
        "indent-block:done task",
        "indent-block:task with block",
    ],
    "Top two indent mode should include the two shallowest tab/list depths"
);

const nativeRouteState = {
    triggeredAt: 1_000,
    sourcePath: "Source.md",
};
assert.equal(
    shouldRouteSplitToPageStream(nativeRouteState, 1_100, "split"),
    true,
    "Native Page stream router should capture fresh split opens"
);
assert.equal(
    shouldRouteSplitToPageStream(nativeRouteState, 1_800, "split"),
    false,
    "Native Page stream router should ignore stale split opens"
);
assert.equal(
    shouldRouteSplitToPageStream(nativeRouteState, 1_100, "tab"),
    false,
    "Native Page stream router should only capture split opens"
);
assert.equal(
    shouldRouteSplitToPageStream(null, 1_100, "split"),
    false,
    "Native Page stream router should ignore absent route state"
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
    unlink(fileSourceOutfile),
    unlink(incrementalFileSetOutfile),
    unlink(renderWindowOutfile),
    unlink(renderPolicyOutfile),
    unlink(pageStreamStackOutfile),
    unlink(listHeadingParserOutfile),
    unlink(pageStreamNativeRouterOutfile),
    unlink(outlinerPasteOutfile),
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
