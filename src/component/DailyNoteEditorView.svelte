<script lang="ts">
    import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
    import type { WorkspaceLeaf } from "obsidian";

    import { Notice, TFile, moment } from "obsidian";
    import DailyNote from "./DailyNote.svelte";
    import { inview } from "svelte-inview";
    import { TimeRange, SelectionMode, TimeField } from "../types/time";
    import { onDestroy, onMount, tick as svelteTick } from "svelte";
    import { FileManager, FileManagerOptions } from "../utils/fileManager";
    import {
        buildJournalExportMarkdown,
        copyMarkdownToClipboard,
        readJournalExportEntries,
        selectVisibleExportFiles,
    } from "../utils/journalExport";
    import { normalizeCustomRange } from "../utils/dateInput";
    import { appendRenderBatch, rebuildRenderWindow } from "../utils/renderWindow";
    import { renameVisiblePath } from "../utils/visibleNotes";
    import { drainModifiedFiles, enqueueModifiedFile } from "../utils/modifyQueue";


    export let plugin: DailyNoteViewPlugin;
    export let leaf: WorkspaceLeaf;
    export let selectedRange: TimeRange = "recent-30";
    export let customRange: { start: Date; end: Date } | null = null;
    export let selectionMode: SelectionMode = "daily";
    export let target: string = "";
    export let timeField: TimeField = "mtime"; // 默认使用修改时间
    
    const LOAD_BATCH_SIZE = 5;

    type JournalStreamCopyAuditResult = {
        status: "passed" | "failed";
        reason?: string;
        exportFileCount: number;
        exportedPaths: string[];
        markdownLength?: number;
        markdownStartsWithHeader?: boolean;
        includesSourcePath?: boolean;
        includesDateSource?: boolean;
        clipboardWriteOk?: boolean;
        clipboardReadOk?: boolean;
        clipboardMatchesExport?: boolean;
        clipboardStartsWithHeader?: boolean;
    };

    let renderedFiles: TFile[] = [];
    let filteredFiles: TFile[] = [];
    let modifiedFiles: Record<string, { token: number; mtime: number }> = {};
    let exportStatus = "";
    let modifyRefreshTimeout: number | null = null;
    let fillViewportTimeout: number | null = null;
    let exportStatusTimeout: number | null = null;
    let isDestroying = false;
    let pendingModifiedFiles: Map<string, TFile> = new Map();
    let noteComponents: Record<string, DailyNote> = {};
    
    // Track which notes are in viewport
    let visibleNotes: Set<string> = new Set();

    let hasMore = true;
    let firstLoaded = true;
    let loaderRef: HTMLDivElement;

    // Create the file manager
    let fileManager: FileManager;
    
    $: fileManagerOptions = {
        mode: selectionMode,
        target: target,
        timeRange: selectedRange,
        customRange: customRange,
        app: plugin.app,
        timeField: timeField
    } as FileManagerOptions;

    $: if (fileManager && (selectedRange !== fileManager.options.timeRange || 
                          customRange !== fileManager.options.customRange ||
                          selectionMode !== fileManager.options.mode ||
                          target !== fileManager.options.target ||
                          timeField !== fileManager.options.timeField)) {
        fileManager.updateOptions({
            timeRange: selectedRange,
            customRange: customRange,
            mode: selectionMode,
            target: target,
            timeField: timeField
        });
        
        // Reset rendered files and start filling viewport again
        renderedFiles = [];
        visibleNotes.clear();
        filteredFiles = fileManager.getFilteredFiles();
        hasMore = filteredFiles.length > 0;
        firstLoaded = true;
        loadNextBatch();
        
        // Update the title element with the new range information
        updateTitleElement();
    }

    onMount(() => {
        fileManager = new FileManager(fileManagerOptions);
        filteredFiles = fileManager.getFilteredFiles();
        hasMore = filteredFiles.length > 0;
        loadNextBatch();
        
        // Initialize the title element
        updateTitleElement();
    });

    onDestroy(() => {
        isDestroying = true;
        clearModifyRefreshTimeout();
        clearFillViewportTimeout();
        clearExportStatusTimeout();
    });

    // Function to update the title element with range information
    function updateTitleElement() {
        if (!leaf || !leaf.view || !leaf.view.titleEl) return;
         
        // Get the title element and clear it
        const titleEl = leaf.view.titleEl;
        titleEl.empty();

        const rangeFieldLabel = timeField.startsWith("journalDate")
            ? "journal date"
            : timeField === "ctime"
                ? "created"
                : "modified";
        
        // Set the base title
        let titleText = '';
        
        // Add range information based on the current selection mode and range
        if (selectionMode === "daily") {
            titleText = "Daily Notes";
            const normalizedCustomRange = normalizeCustomRange(customRange);
            if (selectedRange === 'custom' && normalizedCustomRange) {
                titleText = `Daily Notes: ${moment(normalizedCustomRange.start).format('YYYY-MM-DD')} to ${moment(normalizedCustomRange.end).format('YYYY-MM-DD')}`;
            } else if (selectedRange !== 'all') {
                titleText = `Daily Notes: ${selectedRange}`;
            }
        } else if (selectionMode === "folder") {
            titleText = target === plugin.settings.journalFolder
                ? `Journal: ${target}`
                : `Folder: ${target}`;
            if (selectedRange !== 'all') {
                titleText += ` (${rangeFieldLabel} ${selectedRange})`;
            }
        } else if (selectionMode === "tag") {
            titleText = `Tag: ${target}`;
            if (selectedRange !== 'all') {
                titleText += ` (${rangeFieldLabel} ${selectedRange})`;
            }
        }
        
        // Set the title text
        titleEl.setText(titleText || "Journal Stream");
    }

    function syncRenderedFilesToFilteredList() {
        filteredFiles = fileManager.getFilteredFiles();
        const renderedPaths = new Set(renderedFiles.map((file) => file.path));
        const nextWindow = rebuildRenderWindow(
            filteredFiles,
            renderedFiles,
            LOAD_BATCH_SIZE
        );

        renderedFiles = nextWindow.renderedFiles;
        filteredFiles = nextWindow.pendingFiles;
        hasMore = nextWindow.hasMore;

        visibleNotes = new Set(
            Array.from(visibleNotes).filter((path) =>
                renderedFiles.some((file) => file.path === path)
            )
        );

        if (renderedFiles.some((file) => !renderedPaths.has(file.path))) {
            firstLoaded = true;
        }

        if (hasMore) {
            ensureViewFilled();
        }
    }

    function resetRenderedWindow() {
        filteredFiles = fileManager.getFilteredFiles();
        renderedFiles = [];
        visibleNotes.clear();
        hasMore = filteredFiles.length > 0;
        firstLoaded = true;
        loadNextBatch();
    }

    export function refresh() {
        if (!fileManager) return;

        clearModifyRefreshTimeout();

        fileManager.refreshFiles();
        resetRenderedWindow();
        updateTitleElement();
    }

    export function getSearchFiles(): TFile[] {
        return fileManager?.getFilteredFiles() ?? [];
    }

    export async function revealSearchResult(path: string): Promise<boolean> {
        if (!fileManager) return false;
        const exists = fileManager.getFilteredFiles().some((file) => file.path === path);
        if (!exists) return false;

        while (!renderedFiles.some((file) => file.path === path) && hasMore) {
            loadNextBatch();
        }
        await svelteTick();
        plugin.setOutlineSourcePath(path);

        const targetId = `dn-editor-${path}`;
        const targetEl = Array.from(
            leaf.view.contentEl.querySelectorAll<HTMLElement>(".daily-note-container")
        ).find((element) => element.dataset.id === targetId);
        targetEl?.scrollIntoView({ block: "start", behavior: "smooth" });
        targetEl?.focus({ preventScroll: true });
        return targetEl !== undefined;
    }

    function scheduleModifyRefresh(file: TFile) {
        pendingModifiedFiles = enqueueModifiedFile(pendingModifiedFiles, file);
        clearModifyRefreshTimeout();

        modifyRefreshTimeout = window.setTimeout(() => {
            if (isDestroying) return;
            const drainedFiles = drainModifiedFiles(pendingModifiedFiles);
            pendingModifiedFiles = drainedFiles.pendingFiles;
            for (const modifiedFile of drainedFiles.files) {
                fileManager.fileModify(modifiedFile);
            }
            syncRenderedFilesToFilteredList();
            modifyRefreshTimeout = null;
        }, 200);
    }

    function loadNextBatch() {
        if (!fileManager || !hasMore) return;
        if (filteredFiles.length === 0) {
            hasMore = false;
        } else {
            const previousPaths = new Set(renderedFiles.map((file) => file.path));
            const nextWindow = appendRenderBatch(
                renderedFiles,
                filteredFiles,
                LOAD_BATCH_SIZE
            );
            renderedFiles = nextWindow.renderedFiles;
            filteredFiles = nextWindow.pendingFiles;
            hasMore = nextWindow.hasMore;
            visibleNotes = new Set([
                ...visibleNotes,
                ...nextWindow.renderedFiles
                    .filter((file) => !previousPaths.has(file.path))
                    .map((file) => file.path),
            ]);
            if (firstLoaded) {
                clearFillViewportTimeout();
                fillViewportTimeout = window.setTimeout(() => {
                    fillViewportTimeout = null;
                    if (isDestroying) return;
                    ensureViewFilled();
                    firstLoaded = false;
                }, 100);
            }
        }
    }

    function ensureViewFilled() {
        if (!loaderRef) return;
        
        // Get the loader element's position
        const loaderRect = loaderRef.getBoundingClientRect();
        
        // Get the viewport height
        const viewportHeight = window.innerHeight;
        
        // Get the content element's height (with fallback)
        const contentHeight = leaf.view.contentEl.clientHeight || leaf.view.contentEl.innerHeight || viewportHeight;
        
        // Use the maximum of viewport height and content height with a buffer
        const effectiveHeight = Math.max(viewportHeight, contentHeight) + 200;
        
        // Check if we need to load more content
        if (loaderRect.top < effectiveHeight) {
            loadNextBatch();
            
            // Recursively check again after a short delay to ensure the view is filled
            clearFillViewportTimeout();
            fillViewportTimeout = window.setTimeout(() => {
                fillViewportTimeout = null;
                if (isDestroying) return;
                if (hasMore && loaderRef && loaderRef.getBoundingClientRect().top < effectiveHeight) {
                    ensureViewFilled();
                }
            }, 50);
        }
    }

    async function createNewDailyNote() {
        const newNote = await fileManager.createNewDailyNote();
        if (newNote) {
            syncRenderedFilesToFilteredList();
        }
    }

    export function tick() {
        // First check if we need to update for a new day
        check();
        
        // Force a refresh of the view
        renderedFiles = renderedFiles;
    }

    export function check() {
        if (!fileManager) return;

        // Check if there's a new daily note (e.g., after day change)
        const hadDailyNote = fileManager.hasCurrentDayNote();
        fileManager.checkDailyNote();
        const hasDailyNote = fileManager.hasCurrentDayNote();
        
        // If the daily note status changed (e.g., we just crossed midnight),
        // refresh the file list to ensure we show the current day's daily note
        if (hadDailyNote !== hasDailyNote || 
            (selectionMode === "daily" && selectedRange !== "all")) {
            // Reset rendered files and start filling viewport again if in daily mode
            if (selectionMode === "daily") {
                resetRenderedWindow();
            }
        }
    }

    export function fileCreate(file: TFile) {
        fileManager.fileCreate(file);
        syncRenderedFilesToFilteredList();
    }

    export function fileDelete(file: TFile) {
        fileManager.fileDelete(file);
        syncRenderedFilesToFilteredList();
        delete modifiedFiles[file.path];
        modifiedFiles = { ...modifiedFiles };
    }

    export function fileModify(file: TFile) {
        const wasRendered = renderedFiles.some((dailyNote) => dailyNote.path === file.path);

        if (wasRendered) {
            modifiedFiles = {
                ...modifiedFiles,
                [file.path]: {
                    token: Date.now(),
                    mtime: file.stat.mtime,
                },
            };
        }

        scheduleModifyRefresh(file);
    }

    export function fileRename(file: TFile, oldPath: string) {
        fileManager.fileRename(file, oldPath);
        syncRenderedFilesToFilteredList();
        delete modifiedFiles[oldPath];
        modifiedFiles = { ...modifiedFiles };

        visibleNotes = renameVisiblePath(
            visibleNotes,
            oldPath,
            file.path,
            new Set(renderedFiles.map((renderedFile) => renderedFile.path))
        );
    }
    
    // Handle note visibility change
    function handleNoteVisibilityChange(file: TFile, isVisible: boolean) {
        if (isVisible) {
            visibleNotes.add(file.path);
        } else {
            visibleNotes.delete(file.path);
        }
        visibleNotes = visibleNotes;
    }

    function handleLoaderVisibilityChange(isVisible: boolean) {
        if (isVisible) {
            loadNextBatch();
        }
    }

    function getVisibleExportFiles(): TFile[] {
        return selectVisibleExportFiles(renderedFiles, visibleNotes);
    }

    function getAuditFile(pathPrefix = "Journal/_journal_stream_regression_fixture/260812.md"): TFile | null {
        return (
            renderedFiles.find((file) => file.path === pathPrefix) ??
            renderedFiles.find((file) =>
                file.path.startsWith("Journal/_journal_stream_regression_fixture/")
            ) ??
            renderedFiles[0] ??
            null
        );
    }

    async function prepareAuditNote(file: TFile) {
        visibleNotes.add(file.path);
        visibleNotes = visibleNotes;
        await svelteTick();
        const note = noteComponents[file.path];
        if (!note) return null;

        const deadline = Date.now() + 2500;
        let state = note.getAuditState();
        while (!state.previewRendered && Date.now() < deadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            state = note.getAuditState();
        }

        return note;
    }

    export async function previewEditSaveForAudit(marker: string) {
        const file = getAuditFile();
        if (!file) {
            return {
                status: "failed",
                reason: "no-rendered-file",
            };
        }

        const note = await prepareAuditNote(file);
        if (!note) {
            return {
                status: "failed",
                reason: "note-component-not-found",
                path: file.path,
            };
        }

        let before = note.getAuditState();
        let reloadBeforeEdit: unknown = null;
        if (before.showExternalChangeNotice) {
            reloadBeforeEdit = await note.reloadForAudit();
            before = note.getAuditState();
        }
        const editState = await note.enterEditModeForAudit();
        const saveState = await note.appendMarkerForAudit(marker);
        const previewRestoreState = await note.enterPreviewModeForAudit();
        return {
            status:
                before.isEditing === false &&
                editState.isEditing &&
                saveState.status === "passed" &&
                previewRestoreState.isEditing === false &&
                previewRestoreState.previewRendered === true
                    ? "passed"
                    : "failed",
            reason:
                before.isEditing === false &&
                editState.isEditing &&
                saveState.status === "passed" &&
                previewRestoreState.isEditing === false &&
                previewRestoreState.previewRendered === true
                    ? undefined
                    : "preview-edit-save-state-check-failed",
            path: file.path,
            reloadBeforeEdit,
            before,
            editState,
            saveState,
            previewRestoreState,
        };
    }

    export async function externalChangeReloadForAudit(marker: string) {
        const file = getAuditFile();
        if (!file) {
            return {
                status: "failed",
                reason: "no-rendered-file",
            };
        }

        const note = await prepareAuditNote(file);
        if (!note) {
            return {
                status: "failed",
                reason: "note-component-not-found",
                path: file.path,
            };
        }

        const conflictState = await note.createExternalChangeForAudit(marker);
        const reloadState = await note.reloadAfterExternalChangeForAudit(marker);
        return {
            status:
                conflictState.status === "passed" &&
                reloadState.status === "passed"
                    ? "passed"
                    : "failed",
            reason:
                conflictState.status === "passed" &&
                reloadState.status === "passed"
                    ? undefined
                    : "external-change-autosync-state-check-failed",
            path: file.path,
            syncState: conflictState,
            reloadState,
        };
    }

    export async function renameRefreshForAudit() {
        const sourcePath = "Journal/_journal_stream_regression_fixture/260812.md";
        const nonMarkdownPath =
            "Journal/_journal_stream_regression_fixture/260812-renamed.png";
        const newMarkdownPath =
            "Journal/_journal_stream_regression_fixture/260814.md";
        const adjacentPath =
            "Journal/_journal_stream_regression_fixture/adjacent-rename-source.txt";

        try {
            for (const stalePath of [newMarkdownPath, adjacentPath]) {
                const staleFile = plugin.app.vault.getAbstractFileByPath(stalePath);
                if (staleFile) {
                    try {
                        await plugin.app.vault.delete(staleFile, true);
                    } catch {
                        // Fixture preparation may remove the file before Obsidian refreshes its index.
                    }
                    await waitForAudit(100);
                }
            }
            const staleNonMarkdown =
                plugin.app.vault.getAbstractFileByPath(nonMarkdownPath);
            const existingSource =
                plugin.app.vault.getAbstractFileByPath(sourcePath);
            if (staleNonMarkdown && existingSource) {
                try {
                    await plugin.app.vault.delete(staleNonMarkdown, true);
                } catch {
                    // Ignore stale vault index entries left by previous interrupted runs.
                }
                await waitForAudit(100);
            } else if (staleNonMarkdown && !existingSource) {
                try {
                    await plugin.app.vault.rename(staleNonMarkdown, sourcePath);
                } catch {
                    // Continue to the normal source check below.
                }
                await waitForAudit(100);
            }

            const sourceFile = plugin.app.vault.getAbstractFileByPath(sourcePath);
            if (!(sourceFile instanceof TFile)) {
                return {
                    status: "failed",
                    reason: "source-fixture-file-not-found",
                    sourcePath,
                };
            }

            await plugin.app.vault.rename(sourceFile, nonMarkdownPath);
            await waitForAudit(600);
            await prepareAuditSnapshot();
            const afterRenameOut = getAuditSnapshot();

            const renamedNonMarkdown =
                plugin.app.vault.getAbstractFileByPath(nonMarkdownPath);
            if (!renamedNonMarkdown) {
                return {
                    status: "failed",
                    reason: "non-markdown-renamed-file-not-found",
                };
            }
            await plugin.app.vault.rename(renamedNonMarkdown, sourcePath);
            await waitForAudit(600);
            await prepareAuditSnapshot();
            const afterRenameBack = getAuditSnapshot();

            await plugin.app.vault.create(adjacentPath, "adjacent rename source\n");
            const adjacentFile = plugin.app.vault.getAbstractFileByPath(adjacentPath);
            if (!(adjacentFile instanceof TFile)) {
                return {
                    status: "failed",
                    reason: "adjacent-source-file-not-created",
                };
            }
            await plugin.app.vault.rename(adjacentFile, newMarkdownPath);
            await waitForAudit(600);
            await prepareAuditSnapshot();
            const afterNewMarkdown = getAuditSnapshot();

            const outRemoved =
                !afterRenameOut.renderedFilePaths.includes(sourcePath) &&
                !afterRenameOut.renderedFilePaths.includes(nonMarkdownPath);
            const backAppeared =
                afterRenameBack.renderedFilePaths.includes(sourcePath);
            const newMarkdownAppeared =
                afterNewMarkdown.renderedFilePaths.includes(newMarkdownPath);
            const uniquePaths =
                new Set(afterNewMarkdown.renderedFilePaths).size ===
                afterNewMarkdown.renderedFilePaths.length;

            return {
                status:
                    outRemoved && backAppeared && newMarkdownAppeared && uniquePaths
                        ? "passed"
                        : "failed",
                reason:
                    outRemoved && backAppeared && newMarkdownAppeared && uniquePaths
                        ? undefined
                        : "rename-refresh-state-check-failed",
                sourcePath,
                nonMarkdownPath,
                newMarkdownPath,
                afterRenameOut: {
                    renderedFilePaths: afterRenameOut.renderedFilePaths,
                },
                afterRenameBack: {
                    renderedFilePaths: afterRenameBack.renderedFilePaths,
                },
                afterNewMarkdown: {
                    renderedFilePaths: afterNewMarkdown.renderedFilePaths,
                },
                outRemoved,
                backAppeared,
                newMarkdownAppeared,
                uniquePaths,
            };
        } catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    export async function copyVisibleJournalMarkdown() {
        const exportFiles = getVisibleExportFiles();

        if (!plugin?.app || exportFiles.length === 0) {
            new Notice("No Journal files to export");
            return;
        }

        try {
            const entries = await readJournalExportEntries(
                exportFiles,
                (file) => plugin.app.vault.cachedRead(file)
            );
            const markdown = buildJournalExportMarkdown(entries, {
                selectionMode,
                target,
                selectedRange,
                timeField,
                customRange,
            });

            await copyMarkdownToClipboard(navigator.clipboard, markdown);
            if (isDestroying) return;
            exportStatus = `Copied ${entries.length} files`;
            new Notice(exportStatus);
        } catch (error) {
            console.error("Failed to copy Journal Stream Markdown:", error);
            if (isDestroying) return;
            exportStatus = "Copy failed";
            new Notice("Failed to copy Journal Stream Markdown");
            throw error;
        } finally {
            clearExportStatusTimeout();
            exportStatusTimeout = window.setTimeout(() => {
                exportStatusTimeout = null;
                if (isDestroying) return;
                exportStatus = "";
            }, 2500);
        }
    }

    export async function copyVisibleJournalMarkdownForAudit(): Promise<JournalStreamCopyAuditResult> {
        const exportFiles = getVisibleExportFiles();
        const baseResult = {
            exportFileCount: exportFiles.length,
            exportedPaths: exportFiles.map((file) => file.path),
        };

        if (!plugin?.app) {
            return {
                status: "failed",
                reason: "plugin-app-unavailable",
                ...baseResult,
            };
        }
        if (exportFiles.length === 0) {
            return {
                status: "failed",
                reason: "no-journal-files-to-export",
                ...baseResult,
            };
        }

        try {
            const entries = await readJournalExportEntries(
                exportFiles,
                (file) => plugin.app.vault.cachedRead(file)
            );
            const markdown = buildJournalExportMarkdown(entries, {
                selectionMode,
                target,
                selectedRange,
                timeField,
                customRange,
            });
            const exportResult = {
                ...baseResult,
                markdownLength: markdown.length,
                markdownStartsWithHeader: markdown.startsWith("# Journal Stream Export"),
                includesSourcePath: markdown.includes("- source_path: "),
                includesDateSource: markdown.includes("- date_source: "),
            };

            await copyMarkdownToClipboard(navigator.clipboard, markdown);

            if (!navigator.clipboard?.readText) {
                return {
                    status: "failed",
                    reason: "clipboard-read-api-unavailable",
                    ...exportResult,
                    clipboardWriteOk: true,
                    clipboardReadOk: false,
                };
            }

            const clipboardText = await navigator.clipboard.readText();
            const clipboardMatchesExport = clipboardText === markdown;
            return {
                status: clipboardMatchesExport ? "passed" : "failed",
                reason: clipboardMatchesExport
                    ? undefined
                    : "clipboard-content-mismatch",
                ...exportResult,
                clipboardWriteOk: true,
                clipboardReadOk: true,
                clipboardMatchesExport,
                clipboardStartsWithHeader: clipboardText.startsWith(
                    "# Journal Stream Export"
                ),
            };
        } catch (error) {
            console.error("Failed to audit Journal Stream Markdown copy:", error);
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
                ...baseResult,
                clipboardWriteOk: false,
            };
        }
    }

    export function getAuditSnapshot() {
        const container = leaf.view.contentEl;
        const noteContainers = Array.from(
            container.querySelectorAll<HTMLElement>(".daily-note-container")
        );
        const sourceMetaEls = Array.from(
            container.querySelectorAll<HTMLElement>(".daily-note-source")
        );
        const visibleNotePaths = Array.from(visibleNotes);

        return {
            selectionMode,
            target,
            selectedRange,
            timeField,
            customRange: normalizeCustomRange(customRange),
            renderedFileCount: renderedFiles.length,
            pendingFileCount: filteredFiles.length,
            hasMore,
            visibleNoteCount: visibleNotePaths.length,
            visibleNotePaths,
            renderedFilePaths: renderedFiles.map((file) => file.path),
            dom: {
                noteContainerCount: noteContainers.length,
                previewCount: container.querySelectorAll(".daily-note-preview").length,
                editorCount: container.querySelectorAll(".daily-note-editor").length,
                editingCount: container.querySelectorAll(
                    '.daily-note-editor[data-editing="true"]'
                ).length,
                conflictCount: container.querySelectorAll(".daily-note-conflict").length,
                sourceMetaCount: container.querySelectorAll(".daily-note-source").length,
                sourceWarningCount: container.querySelectorAll(
                    '.daily-note-source[data-warning="true"]'
                ).length,
                exportButtonCount: container.querySelectorAll(
                    ".journal-stream-icon-button"
                ).length,
            },
            sourceMetaTexts: sourceMetaEls.map((sourceMeta) =>
                sourceMeta.innerText.trim()
            ),
            titles: noteContainers
                .map((note) =>
                    note
                        .querySelector<HTMLElement>(".daily-note-title-link")
                        ?.innerText.trim()
                )
                .filter(Boolean),
        };
    }

    export async function prepareAuditSnapshot() {
        if (!fileManager) return;
        if (renderedFiles.length === 0 && filteredFiles.length > 0) {
            const nextWindow = appendRenderBatch(
                renderedFiles,
                filteredFiles,
                LOAD_BATCH_SIZE
            );
            renderedFiles = nextWindow.renderedFiles;
            filteredFiles = nextWindow.pendingFiles;
            hasMore = nextWindow.hasMore;
            firstLoaded = false;
        }

        await svelteTick();
    }

    function clearModifyRefreshTimeout() {
        if (modifyRefreshTimeout) {
            window.clearTimeout(modifyRefreshTimeout);
            modifyRefreshTimeout = null;
        }
        pendingModifiedFiles = new Map();
    }

    function clearFillViewportTimeout() {
        if (fillViewportTimeout) {
            window.clearTimeout(fillViewportTimeout);
            fillViewportTimeout = null;
        }
    }

    function clearExportStatusTimeout() {
        if (exportStatusTimeout) {
            window.clearTimeout(exportStatusTimeout);
            exportStatusTimeout = null;
        }
    }

    function waitForAudit(ms: number) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
</script>

<div class="daily-note-view">
    {#if exportStatus}
        <div class="journal-stream-toolbar">
            <span class="journal-stream-export-status">{exportStatus}</span>
        </div>
    {/if}
    {#if renderedFiles.length === 0 && !hasMore}
        <div class="dn-stock">
            <div class="dn-stock-text">
                No files found
            </div>
        </div>
    {/if}
    {#if selectionMode === "daily" && !fileManager?.hasCurrentDayNote() && (selectedRange === 'all' || selectedRange === 'today' || selectedRange === 'recent-7' || selectedRange === 'recent-30' || selectedRange === 'week' || selectedRange === 'month' || selectedRange === 'year' || selectedRange === 'quarter')}
        <button
            type="button"
            class="dn-blank-day"
            on:click={createNewDailyNote}
        >
            <span class="dn-blank-day-text">
                Create a daily note for today
            </span>
        </button>
    {/if}
    {#each renderedFiles as file (file.path)}
        <div class="daily-note-wrapper" use:inview={{
            rootMargin: "80%",
            unobserveOnEnter: false
        }} on:inview_change={({ detail }) => handleNoteVisibilityChange(file, detail.inView)}>
            <DailyNote 
                bind:this={noteComponents[file.path]}
                file={file} 
                plugin={plugin} 
                leaf={leaf} 
                shouldRender={true}
                fileChange={modifiedFiles[file.path]}
            />
        </div>
    {/each}
    <div bind:this={loaderRef} class="dn-view-loader" use:inview={{
        root: leaf.view.containerEl
    }} on:inview_change={({ detail }) => handleLoaderVisibilityChange(detail.inView)}/>
    {#if !hasMore}
        <div class="no-more-text">No more results</div>
    {/if}
</div>


<style>
    .dn-stock {
        height: 1000px;
        width: 100%;

        display: flex;
        justify-content: center;
        align-items: center;
    }

    .dn-stock-text {
        text-align: center;
    }

    .no-more-text {
        margin-left: auto;
        margin-right: auto;
        text-align: center;
    }

    .dn-blank-day {
        display: flex;
        margin-left: auto;
        margin-right: auto;
        width: 100%;
        max-width: var(--file-line-width);
        color: var(--color-base-40);
        background: transparent;
        border: 0;
        padding-top: 20px;
        padding-bottom: 20px;
        transition: all 300ms;
        cursor: pointer;
    }

    .dn-blank-day:hover,
    .dn-blank-day:focus-visible {
        padding-top: 40px;
        padding-bottom: 40px;
        transition: padding 300ms;
        color: var(--text-normal);
    }

    .dn-blank-day-text {
        margin-left: auto;
        margin-right: auto;
        text-align: center;
    }
    
    .daily-note-wrapper {
        width: 100%;
    }

    .journal-stream-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: var(--file-line-width);
        margin: 0 auto;
        padding: 8px 0 4px;
    }

    .journal-stream-export-status {
        color: var(--text-muted);
        font-size: var(--font-ui-small);
    }
</style>
