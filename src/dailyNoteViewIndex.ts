import {
    Editor,
    MarkdownView,
    Notice,
    Plugin,
    OpenViewState,
    normalizePath,
    TFile,
    Workspace,
    WorkspaceContainer,
    WorkspaceItem,
    WorkspaceLeaf,
    moment,
    requireApiVersion,
    TFolder,
    debounce,
} from "obsidian";

import { around } from "monkey-around";
import { DailyNoteEditor, isDailyNoteLeaf } from "./leafView";
import "./style/index.css";
import { addIconList } from "./utils/icon";
import {
    DailyNoteSettings,
    DailyNoteSettingTab,
    DEFAULT_SETTINGS,
} from "./dailyNoteSettings";
import { TimeField, TimeRange } from "./types/time";
import {
    buildDailyViewState,
    buildJournalFolderViewState,
    buildTagViewState,
    canCopyJournalStreamMarkdown,
} from "./utils/viewState";
import { restoreDailyNoteSettings } from "./utils/settingsState";
import { nextSettingsRevision } from "./utils/settingsRevision";
import {
    getAllDailyNotes,
    getDailyNote,
    createDailyNote,
} from "obsidian-daily-notes-interface";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import { createOutlinerPasteNormalizeExtension } from "./component/OutlinerPasteNormalize";
// import { setActiveEditorExt } from "./component/SetActiveEditor";
import { DAILY_NOTE_VIEW_TYPE, DailyNoteView } from "./dailyNoteView";
import { RoamListHeadingView } from "./listHeadingView";
import { ListHeadingMode } from "./listHeadingTypes";
import { RoamNavigationView } from "./navigationView";
import { PageStreamView } from "./pageStreamView";
import { PageStreamNativeRouter } from "./pageStreamNativeRouter";
import { buildFileTarget } from "./pageTargetResolver";
import {
    PageTarget,
    PageTargetSource,
    ROAM_LIST_HEADING_VIEW_TYPE,
    ROAM_NAVIGATION_VIEW_TYPE,
    ROAM_PAGE_STREAM_VIEW_TYPE,
} from "./roamTypes";
import {
    appendBlockIdToLine,
    buildBlockLink,
    createBlockId,
} from "./utils/blockLink";
import { normalizeOutlinerPaste } from "./utils/outlinerPaste";
import {
    recordRecentPath,
    removeRecentPath,
    renameRecentPath,
} from "./utils/recentFiles";

export default class DailyNoteViewPlugin extends Plugin {
    lastActiveFile: TFile;
    private lastCheckedDay: string;
    private settingsRevision = 0;
    private lastUiAuditRequestId = "";
    private auditDebugSeq = 0;
    private isProcessingUiAuditRequest = false;
    private outlineSourcePath: string | null = null;
    private persistRecentFiles = debounce(
        () => void this.saveSettings(),
        500,
        true
    );

    settings: DailyNoteSettings;

    async onload() {
        this.addSettingTab(new DailyNoteSettingTab(this.app, this));
        await this.loadSettings();
        if (!this.settings.recentFiles.length) {
            this.settings.recentFiles = this.app.workspace
                .getLastOpenFiles()
                .filter((path) => {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    return file instanceof TFile && file.extension === "md";
                });
            this.persistRecentFiles();
        }
        void this.writeAuditDebug("onload", {
            version: this.manifest.version,
            journalFolder: this.settings.journalFolder,
        });
        this.patchWorkspace();
        this.patchWorkspaceLeaf();
        new PageStreamNativeRouter(this).install();
        addIconList();

        this.lastCheckedDay = moment().format("YYYY-MM-DD");

        // Register the up and down navigation extension
        this.settings.useArrowUpOrDownToNavigate &&
            this.registerEditorExtension([
                createUpDownNavigationExtension({
                    app: this.app,
                    plugin: this,
                }),
                // setActiveEditorExt({ app: this.app, plugin: this }),
            ]);
        this.registerEditorExtension(createOutlinerPasteNormalizeExtension());

        this.registerView(
            DAILY_NOTE_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new DailyNoteView(leaf, this)
        );
        this.registerView(
            ROAM_NAVIGATION_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new RoamNavigationView(leaf, this)
        );
        this.registerView(
            ROAM_PAGE_STREAM_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new PageStreamView(leaf, this)
        );
        this.registerView(
            ROAM_LIST_HEADING_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new RoamListHeadingView(leaf, this)
        );
        this.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (file instanceof TFile) this.recordRecentFile(file);
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (file instanceof TFile) this.renameRecentFile(oldPath, file.path);
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile) this.removeRecentFile(file.path);
            })
        );

        this.addRibbonIcon(
            "layout-dashboard",
            "Open Roam navigation",
            () => this.openRoamNavigationView()
        );
        this.addRibbonIcon(
            "calendar-range",
            "Open Journal stream",
            () => this.openDefaultJournalView()
        );
        this.addRibbonIcon(
            "panel-right-open",
            "Open Page stream",
            () => this.openPageStreamView()
        );
        this.addRibbonIcon(
            "list-tree",
            "Open List heading",
            () => this.openListHeadingView()
        );
        this.addCommand({
            id: "open-roam-navigation",
            name: "Open Roam navigation",
            callback: () => this.openRoamNavigationView(),
        });
        this.addCommand({
            id: "open-journal-stream",
            name: "Open Journal stream",
            callback: () => this.openDefaultJournalView(),
        });
        this.addCommand({
            id: "open-page-stream",
            name: "Open Page stream",
            callback: () => this.openPageStreamView(),
        });
        this.addCommand({
            id: "open-list-heading",
            name: "Open List heading",
            callback: () => this.openListHeadingView(),
        });
        this.addCommand({
            id: "open-current-file-in-page-stream",
            name: "Open current file in Page stream",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                const canOpen = file instanceof TFile && file.extension === "md";
                if (checking) return canOpen;
                if (canOpen) void this.pushFileToPageStream(file, "command");
                return canOpen;
            },
        });
        this.addCommand({
            id: "copy-current-block-link",
            name: "Copy current block link",
            editorCheckCallback: (checking, editor, view) => {
                if (!(view instanceof MarkdownView)) return false;
                const file = view.file;
                const canCopy =
                    file instanceof TFile &&
                    file.extension === "md" &&
                    !editor.somethingSelected() &&
                    this.canCopyCurrentBlockLink(editor);
                if (checking) return canCopy;
                if (canCopy) void this.copyCurrentBlockLink(editor, view);
                return canCopy;
            },
        });
        this.addCommand({
            id: "open-daily-note-editor",
            name: "Open daily notes editor",
            callback: () => this.openDailyNoteEditor(),
        });
        this.addCommand({
            id: "copy-journal-stream-markdown",
            name: "Copy Journal stream as Markdown",
            checkCallback: (checking) => {
                const view = this.getCurrentJournalView();
                const canCopy = canCopyJournalStreamMarkdown(
                    this.settings.enableExportMarkdown,
                    !!view
                );
                if (checking) return canCopy;
                if (canCopy && view) {
                    view.copyCurrentJournalMarkdown();
                }
                return canCopy;
            },
        });
        this.addCommand({
            id: "write-journal-stream-ui-audit",
            name: "Write Journal stream UI audit",
            callback: () => this.writeJournalStreamUiAuditFromRequest(),
        });
        this.addCommand({
            id: "write-roam-workspace-ui-audit",
            name: "Write Roam workspace UI audit",
            callback: () => this.writeRoamWorkspaceUiAuditFromRequest(),
        });
        this.initCssRules();

        // Create daily note and open the Daily Notes Editor on startup if enabled
        if (this.settings.createAndOpenOnStartup) {
            this.app.workspace.onLayoutReady(async () => {
                // First ensure today's daily note exists
                if (this.settings.defaultOpenMode === "daily") {
                    await this.ensureTodaysDailyNoteExists();
                }
                if (
                    this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE)
                        .length > 0
                )
                    return;
                await this.openDefaultJournalView();
            });
        }

        // Also check periodically (every 15 minutes) for day changes
        this.registerInterval(
            window.setInterval(this.checkDayChange.bind(this), 1000 * 60 * 15)
        );
        const auditRequestTimer = window.setTimeout(() => {
            void this.writeAuditDebug("audit-timer-start", {
                lastUiAuditRequestId: this.lastUiAuditRequestId,
            });
            void this.checkJournalStreamUiAuditRequest();
            this.registerInterval(
                window.setInterval(
                    () => {
                        void this.checkJournalStreamUiAuditRequest();
                    },
                    2000
                )
            );
        }, 8000);
        this.register(() => window.clearTimeout(auditRequestTimer));

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setIcon("calendar-range");
                        item.setTitle("Open Journal Stream for this folder");
                        item.onClick(() => {
                            this.openFolderView(
                                file.path,
                                "journalDate",
                                this.settings.initialRange
                            );
                        });
                    });
                }
            })
        );
    }

    onunload() {
        document.body.toggleClass("daily-notes-hide-frontmatter", false);
        document.body.toggleClass("daily-notes-hide-backlinks", false);
    }

    async openRoamNavigationView(): Promise<void> {
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType(ROAM_NAVIGATION_VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
            await leaf.setViewState({
                type: ROAM_NAVIGATION_VIEW_TYPE,
                active: true,
            });
        }
        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    async openPageStreamView(
        options: { reveal?: boolean; active?: boolean } = {}
    ): Promise<PageStreamView | null> {
        const { reveal = true, active = true } = options;
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType(ROAM_PAGE_STREAM_VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
            await leaf.setViewState({
                type: ROAM_PAGE_STREAM_VIEW_TYPE,
                active,
            });
        }
        const isVisible = leaf.containerEl.isShown();
        if (reveal && (active || !isVisible)) {
            await workspace.revealLeaf(leaf);
        }
        workspace.requestSaveLayout();
        return leaf.view instanceof PageStreamView ? leaf.view : null;
    }

    async openListHeadingView(): Promise<void> {
        const workspace = this.app.workspace;
        let leaf = workspace.getLeavesOfType(ROAM_LIST_HEADING_VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
            await leaf.setViewState({
                type: ROAM_LIST_HEADING_VIEW_TYPE,
                active: true,
            });
        }
        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    setOutlineSourcePath(path: string, refresh = true): void {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.outlineSourcePath = file.path;
        if (!refresh) return;

        for (const leaf of this.app.workspace.getLeavesOfType(
            ROAM_LIST_HEADING_VIEW_TYPE
        )) {
            if (leaf.view instanceof RoamListHeadingView) {
                leaf.view.requestRefresh();
            }
        }
    }

    getOutlineSourcePath(): string | null {
        return this.outlineSourcePath;
    }

    async pushFileToPageStream(
        file: TFile,
        source: PageTargetSource,
        target?: Partial<PageTarget>,
        options: { reveal?: boolean; active?: boolean } = {}
    ): Promise<void> {
        const previousLeaf = options.active === false ? this.app.workspace.activeLeaf : null;
        const view = await this.openPageStreamView(options);
        if (!view) return;
        view.pushTarget({
            ...buildFileTarget(file, source),
            ...target,
            path: file.path,
            source,
        });
        if (previousLeaf) {
            this.app.workspace.setActiveLeaf(previousLeaf, { focus: true });
            window.setTimeout(() => {
                if (this.app.workspace.activeLeaf !== previousLeaf) {
                    this.app.workspace.setActiveLeaf(previousLeaf, { focus: true });
                }
            }, 80);
        }
    }

    private canCopyCurrentBlockLink(editor: Editor): boolean {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        return appendBlockIdToLine(line, createBlockId()).reason !== "unsupported";
    }

    async copyCurrentBlockLinkFromActiveMarkdown(): Promise<void> {
        const view = this.app.workspace.activeLeaf?.view;
        if (!(view instanceof MarkdownView)) {
            new Notice("Open a Markdown file to copy a block link.");
            return;
        }
        const file = view.file;
        if (!(file instanceof TFile) || file.extension !== "md") {
            new Notice("Open a Markdown file to copy a block link.");
            return;
        }
        const editor = view.editor;
        if (editor.somethingSelected() || !this.canCopyCurrentBlockLink(editor)) {
            new Notice("Current line cannot receive a block id.");
            return;
        }
        await this.copyCurrentBlockLink(editor, view);
    }

    private async copyCurrentBlockLink(
        editor: Editor,
        view: MarkdownView
    ): Promise<void> {
        const file = view.file;
        if (!(file instanceof TFile) || file.extension !== "md") {
            new Notice("Open a Markdown file to copy a block link.");
            return;
        }
        if (editor.somethingSelected()) return;

        const cursor = editor.getCursor();
        const originalLine = editor.getLine(cursor.line);
        const result = appendBlockIdToLine(originalLine, createBlockId());
        if (result.reason === "unsupported") {
            new Notice("Current line cannot receive a block id.");
            return;
        }

        if (result.changed) {
            editor.replaceRange(
                result.line,
                { line: cursor.line, ch: 0 },
                { line: cursor.line, ch: originalLine.length }
            );
            editor.setCursor({
                line: cursor.line,
                ch: Math.min(cursor.ch, result.line.length),
            });
        }

        await navigator.clipboard.writeText(buildBlockLink(file.path, result.blockId));
        new Notice("Copied block link.");
    }

    async openDailyNoteEditor(selectedRange?: TimeRange) {
        const workspace = this.app.workspace;
        const leaf = this.getMatchingViewLeaf("daily", "", "journalDate");
        const range = selectedRange ?? this.settings.initialRange;
        await leaf.setViewState({
            type: DAILY_NOTE_VIEW_TYPE,
            state: buildDailyViewState(range),
        });
        const view = leaf.view as DailyNoteView;
        view.setSelectionMode("daily", "", false);
        view.setTimeField("journalDate", false);
        view.setSelectedRange(range, false);
        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    async openDefaultJournalView() {
        if (this.settings.defaultOpenMode === "daily") {
            await this.openDailyNoteEditor(this.settings.initialRange);
            return;
        }

        await this.ensureTodaysJournalFileExists();
        this.detachNonMatchingJournalStreamLeaves(
            "folder",
            this.settings.journalFolder,
            "journalDate"
        );
        await this.openFolderView(
            this.settings.journalFolder,
            "journalDate",
            this.settings.initialRange
        );
    }

    async ensureTodaysJournalFileExists(): Promise<TFile | null> {
        const folderPath = normalizePath(this.settings.journalFolder);
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) {
            new Notice(`Journal folder not found: ${folderPath}`);
            return null;
        }

        const filePath = normalizePath(`${folderPath}/${formatJournalDateFilename(new Date())}.md`);
        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) return existingFile;

        try {
            return await this.app.vault.create(filePath, "");
        } catch (error) {
            console.error("Failed to create today's Journal file:", error);
            new Notice(`Failed to create today's Journal file: ${filePath}`);
            return null;
        }
    }

    async openFolderView(
        folderPath: string,
        timeField: TimeField = "mtime",
        selectedRange?: TimeRange
    ) {
        const workspace = this.app.workspace;
        const leaf = this.getMatchingViewLeaf("folder", folderPath, timeField);
        await leaf.setViewState({
            type: DAILY_NOTE_VIEW_TYPE,
            state: buildJournalFolderViewState(
                folderPath,
                timeField,
                selectedRange ?? this.settings.initialRange
            ),
        });

        // Get the view and set the selection mode to folder
        const view = leaf.view as DailyNoteView;
        view.setSelectionMode("folder", folderPath, false);
        view.setTimeField(timeField, false);
        view.setSelectedRange(selectedRange ?? this.settings.initialRange, false);

        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    async openTagView(
        tagName: string,
        timeField: TimeField = "mtime",
        selectedRange?: TimeRange
    ) {
        const workspace = this.app.workspace;
        const leaf = this.getMatchingViewLeaf("tag", tagName, timeField);
        const range = selectedRange ?? this.settings.initialRange;
        await leaf.setViewState({
            type: DAILY_NOTE_VIEW_TYPE,
            state: buildTagViewState(tagName, timeField, range),
        });

        // Get the view and set the selection mode to tag
        const view = leaf.view as DailyNoteView;
        view.setSelectionMode("tag", tagName, false);
        view.setTimeField(timeField, false);
        view.setSelectedRange(range, false);

        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    getMatchingViewLeaf(
        selectionMode: "daily" | "folder" | "tag",
        target: string,
        timeField: TimeField
    ): WorkspaceLeaf {
        for (const leaf of this.app.workspace.getLeavesOfType(
            DAILY_NOTE_VIEW_TYPE
        )) {
            const state = leaf.getViewState().state as {
                selectionMode?: "daily" | "folder" | "tag";
                target?: string;
                timeField?: TimeField;
            };
            const view = leaf.view as DailyNoteView;
            const leafSelectionMode =
                state?.selectionMode ?? view?.selectionMode ?? "daily";
            const leafTarget = state?.target ?? view?.target ?? "";
            const leafTimeField =
                state?.timeField ?? view?.timeField ?? "journalDate";

            if (
                leafSelectionMode === selectionMode &&
                leafTarget === target &&
                leafTimeField === timeField
            ) {
                return leaf;
            }
        }

        return this.app.workspace.getLeaf(true);
    }

    detachNonMatchingJournalStreamLeaves(
        selectionMode: "daily" | "folder" | "tag",
        target: string,
        timeField: TimeField
    ) {
        const leaves = this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE);
        for (const leaf of leaves) {
            const view = leaf.view as DailyNoteView;
            if (
                view instanceof DailyNoteView &&
                view.selectionMode === selectionMode &&
                view.target === target &&
                view.timeField === timeField
            ) {
                continue;
            }
            leaf.detach();
        }
    }

    getCurrentJournalView(): DailyNoteView | null {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (
            activeLeaf?.view instanceof DailyNoteView &&
            this.isUsableJournalView(activeLeaf.view)
        ) {
            return activeLeaf.view;
        }

        const leaves = this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE);
        const journalLeaf = leaves.find(
            (leaf) =>
                leaf.view instanceof DailyNoteView &&
                this.isUsableJournalView(leaf.view)
        );
        if (journalLeaf?.view instanceof DailyNoteView) return journalLeaf.view;

        const leaf = leaves[0];
        return leaf?.view instanceof DailyNoteView ? leaf.view : null;
    }

    isUsableJournalView(view: DailyNoteView): boolean {
        return (
            view.selectionMode === "folder" &&
            view.target === this.settings.journalFolder &&
            view.timeField === "journalDate"
        );
    }

    async writeJournalStreamUiAudit(
        options: {
            silent?: boolean;
            runId?: string;
            view?: DailyNoteView | null;
            copyExport?: boolean;
            settingsToggle?: boolean;
            previewEditSave?: boolean;
            externalChangeReload?: boolean;
            renameRefresh?: boolean;
        } = {}
    ) {
        const outputPath = `.obsidian/plugins/${this.manifest.id}/ui-audit-latest.json`;
        const view = options.view ?? this.getCurrentJournalView();
        if (!view) {
            await this.writeJournalStreamUiAuditPayload(outputPath, {
                runId: options.runId ?? null,
                status: "failed",
                reason: "no-open-journal-stream-view",
            });
            if (!options.silent) new Notice("No open Journal Stream view to audit");
            return;
        }

        await view.prepareAuditSnapshot();
        const actions: Record<string, unknown> = {};
        if (options.copyExport) {
            actions.copyExport = await view.copyCurrentJournalMarkdownForAudit();
        }
        if (options.settingsToggle) {
            actions.settingsToggle = await this.auditSettingsToggle(view);
        }
        if (options.previewEditSave) {
            actions.previewEditSave = await view.previewEditSaveForAudit(
                `journal-stream-preview-edit-save-${options.runId ?? Date.now()}`
            );
        }
        if (options.externalChangeReload) {
            actions.externalChangeReload =
                await view.externalChangeReloadForAudit(
                    `journal-stream-external-change-${options.runId ?? Date.now()}`
                );
        }
        if (options.renameRefresh) {
            actions.renameRefresh = await view.renameRefreshForAudit();
        }
        const snapshot = view.getAuditSnapshot();
        if (!snapshot) {
            await this.writeJournalStreamUiAuditPayload(outputPath, {
                runId: options.runId ?? null,
                status: "failed",
                reason: "journal-stream-view-not-ready",
                viewState: view.getState(),
                actions,
            });
            if (!options.silent) new Notice("Journal Stream view is not ready to audit");
            return;
        }

        await this.writeJournalStreamUiAuditPayload(outputPath, {
            runId: options.runId ?? null,
            status: "passed",
            viewState: view.getState(),
            snapshot,
            ...(Object.keys(actions).length > 0 ? { actions } : {}),
        });
        if (!options.silent) {
            new Notice(`Journal Stream UI audit written: ${outputPath}`);
        }
    }

    async writeJournalStreamUiAuditFromRequest() {
        const request = await this.readJournalStreamUiAuditRequest();
        let requestedView: DailyNoteView | null = null;
        if (request.openDefaultView) {
            if (request.targetFolder) {
                await this.openFolderView(
                    request.targetFolder,
                    "journalDate",
                    request.selectedRange
                );
            } else {
                await this.openDefaultJournalView();
            }
            requestedView = await this.waitForJournalStreamView(
                request.targetFolder,
                request.selectedRange
            );
        }
        await this.writeJournalStreamUiAudit({
            runId: request.runId,
            view: requestedView,
            copyExport: request.copyExport,
            settingsToggle: request.settingsToggle,
            previewEditSave: request.previewEditSave,
            externalChangeReload: request.externalChangeReload,
            renameRefresh: request.renameRefresh,
        });
    }

    async writeRoamWorkspaceUiAuditFromRequest() {
        const request = await this.readJournalStreamUiAuditRequest();
        await this.writeRoamWorkspaceUiAudit({
            runId: request.runId,
            listHeadingAudit: request.listHeadingAudit,
            pageStreamAudit: request.pageStreamAudit,
            blockLinkAudit: request.blockLinkAudit,
        });
    }

    async writeRoamWorkspaceUiAudit(options: {
        silent?: boolean;
        runId?: string;
        listHeadingAudit?: boolean;
        pageStreamAudit?: boolean;
        blockLinkAudit?: boolean;
    }) {
        const outputPath = `.obsidian/plugins/${this.manifest.id}/ui-audit-latest.json`;
        const actions: Record<string, unknown> = {};
        actions.navigation = await this.auditRoamNavigationView();
        if (options.listHeadingAudit || options.pageStreamAudit) {
            await this.writeAuditDebug("roam-audit-list-heading-start", {
                runId: options.runId ?? null,
            });
            actions.listHeading = await this.auditListHeadingAndPageStream();
            await this.writeAuditDebug("roam-audit-list-heading-end", {
                runId: options.runId ?? null,
                status: isRecord(actions.listHeading)
                    ? actions.listHeading.status
                    : "unknown",
                reason: isRecord(actions.listHeading)
                    ? actions.listHeading.reason
                    : undefined,
            });
        }
        if (options.blockLinkAudit) {
            await this.writeAuditDebug("roam-audit-block-link-start", {
                runId: options.runId ?? null,
            });
            actions.blockLink = await this.auditBlockLinkCommand();
            await this.writeAuditDebug("roam-audit-block-link-end", {
                runId: options.runId ?? null,
                status: isRecord(actions.blockLink)
                    ? actions.blockLink.status
                    : "unknown",
                reason: isRecord(actions.blockLink)
                    ? actions.blockLink.reason
                    : undefined,
            });
        }
        actions.outlinerPaste = this.auditOutlinerPasteIntegration();

        const failedAction = Object.values(actions).find(
            (action) =>
                isRecord(action) &&
                typeof action.status === "string" &&
                action.status !== "passed"
        );

        await this.writeJournalStreamUiAuditPayload(outputPath, {
            runId: options.runId ?? null,
            status: failedAction ? "failed" : "passed",
            ...(failedAction ? { reason: "roam-workspace-action-failed" } : {}),
            actions,
        });
        if (!options.silent) {
            new Notice(`Roam workspace UI audit written: ${outputPath}`);
        }
    }

    async auditRoamNavigationView(): Promise<Record<string, unknown>> {
        try {
            const beforeCount = this.app.workspace.getLeavesOfType(
                ROAM_NAVIGATION_VIEW_TYPE
            ).length;
            await this.openRoamNavigationView();
            await new Promise((resolve) => window.setTimeout(resolve, 600));
            const leavesAfterFirstOpen = this.app.workspace.getLeavesOfType(
                ROAM_NAVIGATION_VIEW_TYPE
            );

            await this.openRoamNavigationView();
            await new Promise((resolve) => window.setTimeout(resolve, 600));
            const leavesAfterSecondOpen = this.app.workspace.getLeavesOfType(
                ROAM_NAVIGATION_VIEW_TYPE
            );

            const leaf = leavesAfterSecondOpen[0];
            if (!leaf || !(leaf.view instanceof RoamNavigationView)) {
                return {
                    status: "failed",
                    reason: "navigation-view-not-open",
                    beforeCount,
                    afterFirstCount: leavesAfterFirstOpen.length,
                    afterSecondCount: leavesAfterSecondOpen.length,
                };
            }

            const contentEl = leaf.view.contentEl;
            const entryLabels = Array.from(
                contentEl.querySelectorAll(".roam-nav-entry-label")
            )
                .map((el) => el.textContent?.trim() ?? "")
                .filter(Boolean);
            const sectionTitles = Array.from(
                contentEl.querySelectorAll(".roam-nav-section-title")
            )
                .map((el) => el.textContent?.trim() ?? "")
                .filter(Boolean);
            const buttons = Array.from(contentEl.querySelectorAll("button"));
            const ariaLabels = buttons
                .map((el) => el.getAttribute("aria-label") ?? "")
                .filter(Boolean);
            const recentFileCount =
                contentEl.querySelectorAll(".roam-nav-recent-file").length;
            const bookmarkCount =
                contentEl.querySelectorAll(".roam-nav-bookmark").length;
            const hasEmptyRecent =
                contentEl.querySelector(
                    ".roam-nav-recent-section .roam-nav-empty"
                ) !== null;
            const duplicateCreated =
                leavesAfterSecondOpen.length > leavesAfterFirstOpen.length;
            const viewLabels = {
                "journal-stream": "Journal stream",
                "page-stream": "Page stream",
                "list-heading": "List heading",
            } as const;
            const configuredEntryLabels = this.settings.navigationViews.map(
                (id) => viewLabels[id]
            );
            const onlyConfiguredViewsRendered =
                entryLabels.join("|") === configuredEntryLabels.join("|") &&
                configuredEntryLabels.every((label) => ariaLabels.includes(label));
            const passed =
                leavesAfterFirstOpen.length >= 1 &&
                !duplicateCreated &&
                contentEl.classList.contains("roam-nav-view") &&
                contentEl.querySelector(".roam-nav-title")?.textContent?.trim() ===
                    "Roam workspace" &&
                onlyConfiguredViewsRendered &&
                sectionTitles.includes("Views") &&
                sectionTitles.includes("Recent files") &&
                sectionTitles.includes("Bookmarks") &&
                (recentFileCount > 0 || hasEmptyRecent);

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "navigation-view-audit-mismatch",
                beforeCount,
                afterFirstCount: leavesAfterFirstOpen.length,
                afterSecondCount: leavesAfterSecondOpen.length,
                duplicateCreated,
                displayText: leaf.view.getDisplayText(),
                icon: leaf.view.getIcon(),
                entryLabels,
                configuredEntryLabels,
                onlyConfiguredViewsRendered,
                sectionTitles,
                ariaLabels,
                recentFileCount,
                bookmarkCount,
                hasEmptyRecent,
            };
        } catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async auditListHeadingAndPageStream(): Promise<Record<string, unknown>> {
        const fixturePath = "tmp/roam-list-heading-audit.md";
        const fixtureContent = [
            "---",
            "fake: '# hidden'",
            "---",
            "# Root",
            "- ## List heading",
            "- top block",
            "\t- child block",
            "\t\t- hidden grand child",
            "```",
            "- ## hidden fenced",
            "```",
            "## Second",
            "- [x] done task ^stream-block",
        ].join("\n");

        try {
            await this.ensureAuditFolder();
            let file = this.app.vault.getAbstractFileByPath(fixturePath);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, fixtureContent);
            } else {
                file = await this.app.vault.create(fixturePath, fixtureContent);
            }
            if (!(file instanceof TFile)) {
                return { status: "failed", reason: "fixture-not-created" };
            }

            await this.app.workspace.getLeaf(false).openFile(file);
            const listView = await this.openListHeadingViewForAudit();
            if (!listView) {
                return { status: "failed", reason: "list-heading-view-not-open" };
            }

            const snapshots: Record<ListHeadingMode, Record<string, unknown>> = {
                "headings-only": {},
                "top-indent": {},
                "top-two-indent": {},
            };
            for (const mode of [
                "headings-only",
                "top-indent",
                "top-two-indent",
            ] as ListHeadingMode[]) {
                listView.setModeForAudit(mode);
                snapshots[mode] = await listView.getAuditSnapshotForFile(file);
            }

            await this.pushFileToPageStream(file, "link", {
                kind: "heading",
                subpath: "#Second",
                label: "Second",
            });
            await this.pushFileToPageStream(file, "link", {
                kind: "block",
                subpath: "#^stream-block",
                label: "stream-block",
            });
            await this.pushFileToPageStream(file, "list-heading", {
                kind: "line",
                line: 4,
                col: 2,
                label: "List heading",
            });
            const pageStreamView = await this.openPageStreamView();
            const pageStreamState = pageStreamView?.getState();
            const targets = isRecord(pageStreamState) && Array.isArray(pageStreamState.targets)
                ? pageStreamState.targets
                : [];
            const topTarget = targets[0];
            const fixtureTargets = targets.filter(
                (target) => isRecord(target) && target.path === fixturePath
            );
            const pageStreamEditSave = pageStreamView
                ? await this.auditPageStreamEditSave(pageStreamView, file)
                : { status: "failed", reason: "page-stream-view-not-open" };
            const pageStreamFocusRestore = await this.auditPageStreamFocusRestore(file);
            const pageStreamDomShiftClick = await this.auditPageStreamDomShiftClick(file);
            const pageStreamReadingShiftClick =
                await this.auditPageStreamRenderedShiftClick(file, "preview");
            const pageStreamLivePreviewShiftClick =
                await this.auditPageStreamRenderedShiftClick(file, "live-preview");
            const pageStreamOpenFileShiftClick =
                await this.auditPageStreamOpenFileShiftClick(file);
            const pageStreamSidebarLikeShiftClick =
                await this.auditPageStreamSidebarLikeOpenFileShiftClick(file);

            const headingsOnlyTitles = getSnapshotTitles(snapshots["headings-only"]);
            const topIndentTitles = getSnapshotTitles(snapshots["top-indent"]);
            const topTwoTitles = getSnapshotTitles(snapshots["top-two-indent"]);
            const passed =
                headingsOnlyTitles.join("|") === "Root|List heading|Second" &&
                topIndentTitles.includes("top block") &&
                topIndentTitles.includes("done task") &&
                !topIndentTitles.includes("child block") &&
                topTwoTitles.includes("child block") &&
                !topTwoTitles.includes("hidden grand child") &&
                isRecord(topTarget) &&
                topTarget.path === fixturePath &&
                topTarget.kind === "line" &&
                topTarget.source === "list-heading" &&
                topTarget.line === 4 &&
                fixtureTargets.length === 1 &&
                isRecord(pageStreamEditSave) &&
                pageStreamEditSave.status === "passed" &&
                isRecord(pageStreamFocusRestore) &&
                pageStreamFocusRestore.status === "passed" &&
                isRecord(pageStreamDomShiftClick) &&
                pageStreamDomShiftClick.status === "passed" &&
                isRecord(pageStreamReadingShiftClick) &&
                pageStreamReadingShiftClick.status === "passed" &&
                isRecord(pageStreamLivePreviewShiftClick) &&
                pageStreamLivePreviewShiftClick.status === "passed" &&
                isRecord(pageStreamOpenFileShiftClick) &&
                pageStreamOpenFileShiftClick.status === "passed" &&
                isRecord(pageStreamSidebarLikeShiftClick) &&
                pageStreamSidebarLikeShiftClick.status === "passed";

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "list-heading-audit-mismatch",
                fixturePath,
                snapshots,
                pageStreamTopTarget: topTarget ?? null,
                pageStreamFixtureTargetCount: fixtureTargets.length,
                exercisedPageStreamTargets: [
                    { kind: "heading", subpath: "#Second" },
                    { kind: "block", subpath: "#^stream-block" },
                    { kind: "line", line: 4, col: 2 },
                ],
                pageStreamEditSave,
                pageStreamFocusRestore,
                pageStreamDomShiftClick,
                pageStreamReadingShiftClick,
                pageStreamLivePreviewShiftClick,
                pageStreamOpenFileShiftClick,
                pageStreamSidebarLikeShiftClick,
            };
        } catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async auditPageStreamSidebarLikeOpenFileShiftClick(
        targetFile: TFile
    ): Promise<Record<string, unknown>> {
        const sourcePath = "tmp/roam-page-stream-sidebar-shift-click-source.md";
        const sourceContent = ["# Sidebar shift source", "- keep active"].join("\n");
        let sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
            await this.app.vault.modify(sourceFile, sourceContent);
        } else {
            sourceFile = await this.app.vault.create(sourcePath, sourceContent);
        }
        if (!(sourceFile instanceof TFile)) {
            return { status: "failed", reason: "sidebar-source-not-created" };
        }

        const sourceLeaf = this.app.workspace.getLeaf(false);
        await sourceLeaf.openFile(sourceFile, { active: true });
        this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
        if (sourceLeaf.view instanceof MarkdownView) {
            sourceLeaf.view.editor.focus();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));

        const sidebarContainer = this.app.workspace.containerEl.createDiv({
            cls: "workspace-leaf-content nav-files-container roam-page-stream-audit-sidebar",
        });
        sidebarContainer.style.setProperty("position", "fixed");
        sidebarContainer.style.setProperty("left", "-10000px");
        sidebarContainer.style.setProperty("top", "0");
        const sidebarRow = sidebarContainer.createDiv({
            cls: "nav-file-title search-result-file-title bookmark-item",
            attr: {
                role: "button",
                tabindex: "0",
                "aria-label": `Open ${targetFile.basename}`,
                "data-path": targetFile.path,
            },
        });
        sidebarRow.createDiv({
            cls: "nav-file-title-content",
            text: targetFile.basename,
        });

        try {
            const before = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            sidebarRow.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    shiftKey: true,
                    button: 0,
                    buttons: 1,
                    view: window,
                })
            );
            await sourceLeaf.openFile(targetFile, { active: true });
            await new Promise((resolve) => window.setTimeout(resolve, 900));

            const pageStreamView = await this.openPageStreamView({
                active: false,
                reveal: false,
            });
            const state = pageStreamView?.getState();
            const targets = isRecord(state) && Array.isArray(state.targets)
                ? state.targets
                : [];
            const topTarget = targets[0];
            const after = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            const sourceLeafAfter = getMarkdownLeafAuditState(sourceLeaf);
            const passed =
                isRecord(topTarget) &&
                topTarget.path === targetFile.path &&
                topTarget.kind === "file" &&
                topTarget.source === "navigation" &&
                before.path === sourcePath &&
                after.path === sourcePath &&
                sourceLeafAfter.path === sourcePath;

            return {
                status: passed ? "passed" : "failed",
                reason: passed
                    ? undefined
                    : "page-stream-sidebar-like-shift-click-mismatch",
                sourcePath,
                targetPath: targetFile.path,
                before,
                after,
                sourceLeafAfter,
                rowClass: sidebarRow.className,
                rowRole: sidebarRow.getAttribute("role"),
                rowDataPath: sidebarRow.getAttribute("data-path"),
                pageStreamTopTarget: topTarget ?? null,
            };
        } finally {
            sidebarContainer.remove();
        }
    }

    async auditPageStreamDomShiftClick(targetFile: TFile): Promise<Record<string, unknown>> {
        const sourcePath = "tmp/roam-page-stream-shift-click-source.md";
        const sourceContent = [
            "# Shift click source",
            `[[${targetFile.path}#Second|Open target]]`,
        ].join("\n");
        let sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
            await this.app.vault.modify(sourceFile, sourceContent);
        } else {
            sourceFile = await this.app.vault.create(sourcePath, sourceContent);
        }
        if (!(sourceFile instanceof TFile)) {
            return { status: "failed", reason: "shift-click-source-not-created" };
        }

        const sourceLeaf = this.app.workspace.getLeaf(false);
        await sourceLeaf.openFile(sourceFile, { active: true });
        this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
        if (sourceLeaf.view instanceof MarkdownView) {
            sourceLeaf.view.editor.focus();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));

        if (!(sourceLeaf.view instanceof MarkdownView)) {
            return { status: "failed", reason: "shift-click-source-not-markdown" };
        }
        const renderContainer = this.app.workspace.containerEl.createDiv({
            cls: "roam-page-stream-audit-render",
        });
        renderContainer.style.setProperty("position", "fixed");
        renderContainer.style.setProperty("left", "-10000px");
        renderContainer.style.setProperty("top", "0");
        const linkEl = renderContainer.createEl("a", {
            cls: "internal-link",
            text: "Open target",
            attr: {
                href: `${targetFile.path}#Second`,
                "data-href": `${targetFile.path}#Second`,
            },
        });
        try {
            const before = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            linkEl.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    shiftKey: true,
                    button: 0,
                    buttons: 1,
                    view: window,
                })
            );
            await new Promise((resolve) => window.setTimeout(resolve, 800));
            const pageStreamView = await this.openPageStreamView({
                active: false,
                reveal: false,
            });
            const state = pageStreamView?.getState();
            const targets = isRecord(state) && Array.isArray(state.targets)
                ? state.targets
                : [];
            const topTarget = targets[0];
            const after = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            const passed =
                isRecord(topTarget) &&
                topTarget.path === targetFile.path &&
                topTarget.kind === "heading" &&
                topTarget.subpath === "#Second" &&
                before.path === sourcePath &&
                after.path === sourcePath;

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "page-stream-dom-shift-click-mismatch",
                sourcePath,
                targetPath: targetFile.path,
                before,
                after,
                linkText: linkEl.textContent,
                linkDataHref: linkEl.getAttribute("data-href"),
                linkHref: linkEl.getAttribute("href"),
                pageStreamTopTarget: topTarget ?? null,
            };
        } finally {
            renderContainer.remove();
        }
    }

    async auditPageStreamOpenFileShiftClick(targetFile: TFile): Promise<Record<string, unknown>> {
        const sourcePath = "tmp/roam-page-stream-open-file-shift-click-source.md";
        const sourceContent = ["# Open file shift source", "- keep active"].join("\n");
        let sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
            await this.app.vault.modify(sourceFile, sourceContent);
        } else {
            sourceFile = await this.app.vault.create(sourcePath, sourceContent);
        }
        if (!(sourceFile instanceof TFile)) {
            return { status: "failed", reason: "open-file-source-not-created" };
        }

        const sourceLeaf = this.app.workspace.getLeaf(false);
        await sourceLeaf.openFile(sourceFile, { active: true });
        this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
        if (sourceLeaf.view instanceof MarkdownView) {
            sourceLeaf.view.editor.focus();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));

        const trigger = this.app.workspace.containerEl.createEl("button", {
            text: "Open file route trigger",
            attr: { type: "button" },
        });
        trigger.addClass("roam-page-stream-audit-open-file-trigger");
        trigger.style.setProperty("position", "fixed");
        trigger.style.setProperty("left", "-10000px");
        trigger.style.setProperty("top", "0");

        try {
            const before = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            trigger.dispatchEvent(
                new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    shiftKey: true,
                    button: 0,
                    buttons: 1,
                    view: window,
                })
            );
            await sourceLeaf.openFile(targetFile, { active: true });
            await new Promise((resolve) => window.setTimeout(resolve, 900));

            const pageStreamView = await this.openPageStreamView({
                active: false,
                reveal: false,
            });
            const state = pageStreamView?.getState();
            const targets = isRecord(state) && Array.isArray(state.targets)
                ? state.targets
                : [];
            const topTarget = targets[0];
            const after = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
            const sourceLeafAfter = getMarkdownLeafAuditState(sourceLeaf);
            const passed =
                isRecord(topTarget) &&
                topTarget.path === targetFile.path &&
                topTarget.kind === "file" &&
                topTarget.source === "navigation" &&
                before.path === sourcePath &&
                after.path === sourcePath &&
                sourceLeafAfter.path === sourcePath;

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "page-stream-open-file-shift-click-mismatch",
                sourcePath,
                targetPath: targetFile.path,
                before,
                after,
                sourceLeafAfter,
                pageStreamTopTarget: topTarget ?? null,
            };
        } finally {
            trigger.remove();
        }
    }

    async auditPageStreamRenderedShiftClick(
        targetFile: TFile,
        mode: "preview" | "live-preview"
    ): Promise<Record<string, unknown>> {
        const sourcePath =
            mode === "preview"
                ? "tmp/roam-page-stream-reading-shift-click-source.md"
                : "tmp/roam-page-stream-live-preview-shift-click-source.md";
        const sourceContent = [
            `# ${mode === "preview" ? "Reading" : "Live preview"} shift source`,
            `[[${targetFile.path}#Second|Open target]]`,
        ].join("\n");
        let sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
            await this.app.vault.modify(sourceFile, sourceContent);
        } else {
            sourceFile = await this.app.vault.create(sourcePath, sourceContent);
        }
        if (!(sourceFile instanceof TFile)) {
            return { status: "failed", reason: "shift-click-source-not-created" };
        }

        const sourceLeaf = this.app.workspace.getLeaf(false);
        await sourceLeaf.setViewState({
            type: "markdown",
            state: {
                file: sourcePath,
                mode: mode === "preview" ? "preview" : "source",
                source: mode === "live-preview" ? false : undefined,
            },
            active: true,
        });
        this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
        await new Promise((resolve) => window.setTimeout(resolve, 1200));

        if (!(sourceLeaf.view instanceof MarkdownView)) {
            return { status: "failed", reason: "shift-click-source-not-markdown" };
        }

        const linkEl = this.findRenderedAuditLink(sourceLeaf.view.containerEl);
        if (!linkEl) {
            return {
                status: "failed",
                reason: "rendered-internal-link-not-found",
                mode,
                sourcePath,
                viewMode: sourceLeaf.view.getMode(),
                sourceText: sourceLeaf.view.containerEl.textContent?.slice(0, 800) ?? "",
            };
        }

        const before = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
        linkEl.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                shiftKey: true,
                button: 0,
                buttons: 1,
                view: window,
            })
        );
        await new Promise((resolve) => window.setTimeout(resolve, 900));

        const pageStreamView = await this.openPageStreamView({
            active: false,
            reveal: false,
        });
        const state = pageStreamView?.getState();
        const targets = isRecord(state) && Array.isArray(state.targets)
            ? state.targets
            : [];
        const topTarget = targets[0];
        const after = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
        const passed =
            isRecord(topTarget) &&
            topTarget.path === targetFile.path &&
            topTarget.kind === "heading" &&
            topTarget.subpath === "#Second" &&
            before.path === sourcePath &&
            after.path === sourcePath;

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : "page-stream-rendered-shift-click-mismatch",
            mode,
            sourcePath,
            targetPath: targetFile.path,
            viewMode: sourceLeaf.view.getMode(),
            before,
            after,
            linkText: linkEl.textContent,
            linkDataHref: linkEl.getAttribute("data-href"),
            linkHref: linkEl.getAttribute("href"),
            linkAriaLabel: linkEl.getAttribute("aria-label"),
            linkClass: linkEl.className,
            pageStreamTopTarget: topTarget ?? null,
        };
    }

    private findRenderedAuditLink(container: HTMLElement): HTMLElement | null {
        const candidates = Array.from(
            container.querySelectorAll<HTMLElement>(".internal-link, .cm-hmd-internal-link")
        );
        return candidates.find((el) => {
            const text = el.textContent ?? "";
            const dataHref = el.getAttribute("data-href") ?? "";
            const href = el.getAttribute("href") ?? "";
            const ariaLabel = el.getAttribute("aria-label") ?? "";
            return [text, dataHref, href, ariaLabel].some((value) =>
                value.includes("roam-list-heading-audit") ||
                value.includes("Open target")
            );
        }) ?? candidates[0] ?? null;
    }

    async auditPageStreamFocusRestore(targetFile: TFile): Promise<Record<string, unknown>> {
        const sourcePath = "tmp/roam-page-stream-focus-source.md";
        const sourceContent = ["# Focus source", "- keep cursor here"].join("\n");
        const cursor = { line: 1, ch: 4 };
        const existingPageStreamView = await this.openPageStreamView({
            active: false,
            reveal: false,
        });
        existingPageStreamView?.exitEditModeForAudit();
        let sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
            await this.app.vault.modify(sourceFile, sourceContent);
        } else {
            sourceFile = await this.app.vault.create(sourcePath, sourceContent);
        }
        if (!(sourceFile instanceof TFile)) {
            return { status: "failed", reason: "focus-source-not-created" };
        }

        const sourceLeaf = this.app.workspace.getLeaf(true);
        await sourceLeaf.openFile(sourceFile);
        if (sourceLeaf.view instanceof MarkdownView) {
            sourceLeaf.view.editor.setCursor(cursor);
            sourceLeaf.view.editor.focus();
        }
        this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
        const before = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);

        await this.pushFileToPageStream(
            targetFile,
            "link",
            { kind: "heading", subpath: "#Second", label: "Second" },
            { active: false, reveal: true }
        );
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const after = getMarkdownLeafAuditState(this.app.workspace.activeLeaf);
        const passed =
            before.path === sourcePath &&
            after.path === sourcePath &&
            after.cursor?.line === cursor.line &&
            after.cursor?.ch === cursor.ch;

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : "page-stream-focus-restore-mismatch",
            sourcePath,
            targetPath: targetFile.path,
            before,
            after,
        };
    }

    async auditPageStreamEditSave(
        pageStreamView: PageStreamView,
        file: TFile
    ): Promise<Record<string, unknown>> {
        const marker = `page-stream-edit-audit-${Date.now()}`;
        const continuousMarkers = [0, 1, 2].map(
            (index) => `${marker}-continuous-${index + 1}`
        );
        const before = pageStreamView.getAuditSnapshot();
        const cardBeforeEdit = pageStreamView.getCardElementForAudit(file.path);
        const titleButton = cardBeforeEdit?.querySelector<HTMLButtonElement>(
            ".roam-page-card-title"
        );
        const cardActionLabels = Array.from(
            cardBeforeEdit?.querySelectorAll<HTMLButtonElement>(
                ".roam-page-card-actions button"
            ) ?? []
        ).map((button) => button.getAttribute("aria-label"));
        const immersiveHeader =
            titleButton?.getAttribute("aria-label")?.startsWith("Open ") === true &&
            cardActionLabels.length === 2 &&
            cardActionLabels.includes("Close page") &&
            !cardActionLabels.includes("Edit selected page") &&
            !cardActionLabels.includes("Open in main area");
        cardBeforeEdit?.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                button: 0,
                view: window,
            })
        );
        const editorDeadline = Date.now() + 30000;
        const expectedTargetLine = pageStreamView.getTargetLineForAudit(file.path);
        let editorView = pageStreamView.getEditingMarkdownViewForAudit(file.path);
        while (
            (!(editorView instanceof MarkdownView) ||
                editorView.file?.path !== file.path ||
                editorView.editor.getValue().length === 0 ||
                !pageStreamView.isEditingEditorReadyForAudit(file.path) ||
                (expectedTargetLine !== null &&
                    editorView.editor.getCursor().line !== expectedTargetLine)) &&
            Date.now() < editorDeadline
        ) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            editorView = pageStreamView.getEditingMarkdownViewForAudit(file.path);
        }
        const editState = pageStreamView.getAuditSnapshot();

        if (
            !(editorView instanceof MarkdownView) ||
            !pageStreamView.isEditingEditorReadyForAudit(file.path) ||
            (expectedTargetLine !== null &&
                editorView.editor.getCursor().line !== expectedTargetLine)
        ) {
            pageStreamView.exitEditModeForAudit();
            return {
                status: "failed",
                reason: "embedded-editor-not-ready",
                before,
                editState,
                expectedTargetLine,
                cursor:
                    editorView instanceof MarkdownView
                        ? editorView.editor.getCursor()
                        : null,
            };
        }
        const auditEditorView = editorView;

        auditEditorView.editor.focus();
        const editorHasFocus = auditEditorView.editor.hasFocus();
        const editingCard = pageStreamView.getEditingCardForAudit(file.path);
        const editingCardFound = editingCard instanceof HTMLElement;
        const stableCardDuringEdit =
            cardBeforeEdit instanceof HTMLElement &&
            pageStreamView.getCardElementForAudit(file.path) === cardBeforeEdit;
        const hadEditingLeafBeforeEscape = pageStreamView.hasEditingLeafForAudit(file.path);
        const baselineCursorBeforeContinuousSave = auditEditorView.editor.getCursor();
        for (const continuousMarker of continuousMarkers) {
            const lastLine = auditEditorView.editor.lastLine();
            const insertAt = {
                line: lastLine,
                ch: auditEditorView.editor.getLine(lastLine).length,
            };
            auditEditorView.editor.replaceRange(`\n- ${continuousMarker}`, insertAt);
            auditEditorView.containerEl.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    data: continuousMarker,
                    inputType: "insertText",
                })
            );
            auditEditorView.requestSave();
        }
        const editorContainsMarker = continuousMarkers.every((continuousMarker) =>
            auditEditorView.editor.getValue().includes(continuousMarker)
        );
        await new Promise((resolve) => window.setTimeout(resolve, 2600));
        const source = await this.waitForFileContent(
            file,
            continuousMarkers[continuousMarkers.length - 1],
            8000
        );
        const cursorAfterContinuousSave = auditEditorView.editor.getCursor();
        const editSnapshotAfterContinuousSave = pageStreamView.getAuditSnapshot();
        const hasEditingLeafAfterContinuousSave =
            pageStreamView.hasEditingLeafForAudit(file.path);
        const continuousSaveState = {
            sourceContainsAllMarkers: continuousMarkers.every((continuousMarker) =>
                source.includes(continuousMarker)
            ),
            cursorAfterContinuousSave,
            baselineCursorBeforeContinuousSave,
            hasEditingLeafAfterContinuousSave,
            editingCardCountAfterContinuousSave: getNestedNumberOrFallback(
                editSnapshotAfterContinuousSave,
                ["dom", "editingCardCount"],
                -1
            ),
            markdownSourceCountAfterContinuousSave: getNestedNumberOrFallback(
                editSnapshotAfterContinuousSave,
                ["dom", "markdownSourceCount"],
                -1
            ),
        };
        editingCard?.focus();
        let escapeDispatched = false;
        let escapeEventCanceled = false;
        if (editingCard) {
            const dispatchResult = editingCard.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Escape",
                    bubbles: true,
                    cancelable: true,
                })
            );
            escapeDispatched = true;
            escapeEventCanceled = !dispatchResult;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const previewState = pageStreamView.getAuditSnapshot();
        const stableCardAfterEscape =
            cardBeforeEdit instanceof HTMLElement &&
            pageStreamView.getCardElementForAudit(file.path) === cardBeforeEdit;
        const hasEditingLeafAfterEscape = pageStreamView.hasEditingLeafForAudit(file.path);
        if (getNestedNumberOrFallback(previewState, ["dom", "editingCardCount"], -1) !== 0) {
            pageStreamView.exitEditModeForAudit();
        }
        const passed =
            getNestedNumberOrFallback(before, ["dom", "editingCardCount"], -1) === 0 &&
            getNestedNumberOrFallback(editState, ["dom", "editingCardCount"], -1) === 1 &&
            editState.editingPath === file.path &&
            immersiveHeader &&
            editingCardFound &&
            stableCardDuringEdit &&
            hadEditingLeafBeforeEscape &&
            editorContainsMarker &&
            continuousSaveState.sourceContainsAllMarkers === true &&
            continuousSaveState.hasEditingLeafAfterContinuousSave === true &&
            continuousSaveState.editingCardCountAfterContinuousSave === 1 &&
            continuousSaveState.markdownSourceCountAfterContinuousSave === 1 &&
            getNestedNumberOrFallback(
                editSnapshotAfterContinuousSave,
                ["dom", "editorHostCount"],
                -1
            ) === 1 &&
            cursorAfterContinuousSave.line === baselineCursorBeforeContinuousSave.line &&
            cursorAfterContinuousSave.ch === baselineCursorBeforeContinuousSave.ch &&
            escapeDispatched &&
            stableCardAfterEscape &&
            !hasEditingLeafAfterEscape &&
            getNestedNumberOrFallback(previewState, ["dom", "editingCardCount"], -1) === 0 &&
            getNestedNumberOrFallback(previewState, ["dom", "editorHostCount"], -1) === 0 &&
            getNestedNumberOrFallback(previewState, ["dom", "previewBodyCount"], 0) >= 1;

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : "page-stream-edit-save-mismatch",
            marker,
            continuousMarkers,
            baselineCursorBeforeContinuousSave,
            continuousSaveState,
            before,
            editState,
            previewState,
            editorHasFocus,
            editingCardFound,
            enteredEditByCardClick: editState.editingPath === file.path,
            immersiveHeader,
            titleAriaLabel: titleButton?.getAttribute("aria-label") ?? null,
            cardActionLabels,
            stableCardDuringEdit,
            stableCardAfterEscape,
            escapeDispatched,
            escapeEventCanceled,
            hadEditingLeafBeforeEscape,
            hasEditingLeafAfterEscape,
            editorContainsMarker,
            sourceContainsMarker: source.includes(
                continuousMarkers[continuousMarkers.length - 1]
            ),
        };
    }

    auditOutlinerPasteIntegration(): Record<string, unknown> {
        const appWithPlugins = this.app as unknown as {
            plugins?: { plugins?: Record<string, unknown> };
        };
        const enabledPluginIds = Object.keys(appWithPlugins.plugins?.plugins ?? {});
        const outlinerEnabled = enabledPluginIds.includes("obsidian-outliner");
        const paragraphPaste = normalizeOutlinerPaste("alpha\nbeta\n");
        const singleLinePaste = normalizeOutlinerPaste("alpha");
        const normalizedListPaste = normalizeOutlinerPaste("- alpha\n\t- beta");
        const mixedIndentPaste = normalizeOutlinerPaste(
            "- alpha\n  - beta\n    - gamma"
        );
        const wrappedListPaste = normalizeOutlinerPaste(
            "- parent copied from the web\n  wrapped continuation\n   - child\n    child continuation"
        );
        const driftedIndentPaste = normalizeOutlinerPaste(
            "- root\n - root drift\n   - child\n    - child drift"
        );
        const tablePaste = "| a | b |\n|---|---|\n| 1 | 2 |";
        const protectedTablePaste = normalizeOutlinerPaste(tablePaste);
        const passed =
            paragraphPaste.changed === true &&
            paragraphPaste.text === "- alpha\n- beta\n" &&
            singleLinePaste.changed === false &&
            singleLinePaste.reason === "single-line" &&
            normalizedListPaste.changed === false &&
            normalizedListPaste.reason === "unchanged" &&
            mixedIndentPaste.text === "- alpha\n\t- beta\n\t\t- gamma" &&
            wrappedListPaste.text ===
                "- parent copied from the web wrapped continuation\n\t- child child continuation" &&
            driftedIndentPaste.text ===
                "- root\n- root drift\n\t- child\n\t- child drift" &&
            protectedTablePaste.changed === false &&
            protectedTablePaste.reason === "protected";

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : "outliner-paste-integration-mismatch",
            outlinerEnabled,
            journalStreamPasteFilterRegistered: true,
            enabledPluginIds: enabledPluginIds.filter((id) =>
                ["obsidian-outliner", this.manifest.id].includes(id)
            ),
            paragraphPaste,
            singleLinePaste,
            normalizedListPaste,
            mixedIndentPaste,
            wrappedListPaste,
            driftedIndentPaste,
            protectedTablePaste,
            scope: "Built-in CodeMirror clipboardInputFilter; compatible with Outliner but does not require it or replace its Enter/Tab/Shift+Tab keymaps.",
        };
    }

    private async waitForFileContent(
        file: TFile,
        marker: string,
        timeoutMs: number
    ): Promise<string> {
        const deadline = Date.now() + timeoutMs;
        let source = await this.app.vault.read(file);
        while (!source.includes(marker) && Date.now() < deadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 150));
            source = await this.app.vault.read(file);
        }
        return source;
    }

    async auditBlockLinkCommand(): Promise<Record<string, unknown>> {
        const fixturePath = "tmp/roam-block-link-audit.md";
        const originalLine = "- [x] audit task";
        const blockId = "baudit123";
        const fixtureContent = [originalLine, "- existing ^old-id", "| a | b |"].join("\n");

        try {
            await this.ensureAuditFolder();
            let file = this.app.vault.getAbstractFileByPath(fixturePath);
            if (file instanceof TFile) {
                await this.app.vault.modify(file, fixtureContent);
            } else {
                file = await this.app.vault.create(fixturePath, fixtureContent);
            }
            if (!(file instanceof TFile)) {
                return { status: "failed", reason: "fixture-not-created" };
            }

            await this.app.workspace.getLeaf(false).openFile(file);
            const activeView = this.app.workspace.activeLeaf?.view;
            if (
                !(activeView instanceof MarkdownView) ||
                activeView.file?.path !== fixturePath
            ) {
                return { status: "failed", reason: "markdown-view-not-active" };
            }

            const editor = activeView.editor;
            editor.setValue(fixtureContent);
            editor.setCursor({ line: 0, ch: 4 });
            const inserted = appendBlockIdToLine(editor.getLine(0), blockId);
            if (inserted.changed) {
                editor.replaceRange(
                    inserted.line,
                    { line: 0, ch: 0 },
                    { line: 0, ch: originalLine.length }
                );
            }

            const existing = appendBlockIdToLine(editor.getLine(1), "new-id");
            const unsupported = appendBlockIdToLine(editor.getLine(2), "table-id");
            const text = editor.getValue();
            const link = buildBlockLink(fixturePath, inserted.blockId);
            const passed =
                inserted.changed &&
                inserted.line === `${originalLine} ^${blockId}` &&
                existing.blockId === "old-id" &&
                !existing.changed &&
                unsupported.reason === "unsupported" &&
                text.includes(`${originalLine} ^${blockId}`) &&
                link === `[[${fixturePath}#^${blockId}]]`;

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "block-link-audit-mismatch",
                fixturePath,
                inserted,
                existing,
                unsupported,
                link,
                text,
            };
        } catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private async ensureAuditFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath("tmp");
        if (folder instanceof TFolder) return;
        if (folder) throw new Error("tmp exists but is not a folder");
        await this.app.vault.createFolder("tmp");
    }

    async writeJournalStreamUiAuditPayload(
        outputPath: string,
        details: Record<string, unknown>
    ) {
        const payload = {
            runAt: new Date().toISOString(),
            pluginId: this.manifest.id,
            pluginVersion: this.manifest.version,
            obsidianVersion:
                (this.app as any)?.getVersion?.() ??
                (window as any)?.app?.version ??
                "unknown",
            vaultRoot: this.app.vault.getName(),
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
            },
            settings: {
                journalFolder: this.settings.journalFolder,
                defaultOpenMode: this.settings.defaultOpenMode,
                initialRange: this.settings.initialRange,
                enableExportMarkdown: this.settings.enableExportMarkdown,
            },
            ...details,
        };

        await this.app.vault.adapter.write(
            outputPath,
            safeStringify(payload)
        );
    }

    async checkJournalStreamUiAuditRequest() {
        if (this.isProcessingUiAuditRequest) return;
        const requestPath = `.obsidian/plugins/${this.manifest.id}/ui-audit-request.json`;
        try {
            const {
                runId,
                openDefaultView,
                targetFolder,
                selectedRange,
                copyExport,
                settingsToggle,
                previewEditSave,
                externalChangeReload,
                renameRefresh,
                listHeadingAudit,
                pageStreamAudit,
                blockLinkAudit,
            } = await this.readJournalStreamUiAuditRequest(requestPath);
            if (runId === this.lastUiAuditRequestId) return;

            await this.writeAuditDebug("audit-request-read", {
                runId,
                lastUiAuditRequestId: this.lastUiAuditRequestId,
                listHeadingAudit,
                pageStreamAudit,
                blockLinkAudit,
                requestPath,
            });

            this.lastUiAuditRequestId = runId;
            this.isProcessingUiAuditRequest = true;
            if (listHeadingAudit || pageStreamAudit || blockLinkAudit) {
                await this.writeRoamWorkspaceUiAudit({
                    silent: true,
                    runId,
                    listHeadingAudit,
                    pageStreamAudit,
                    blockLinkAudit,
                });
                return;
            }
            let requestedView: DailyNoteView | null = null;
            if (openDefaultView) {
                if (targetFolder) {
                    await this.openFolderView(
                        targetFolder,
                        "journalDate",
                        selectedRange
                    );
                } else {
                    await this.openDefaultJournalView();
                }
                requestedView = await this.waitForJournalStreamView(
                    targetFolder,
                    selectedRange
                );
            }
            await this.writeJournalStreamUiAudit({
                silent: true,
                runId,
                view: requestedView,
                copyExport,
                settingsToggle,
                previewEditSave,
                externalChangeReload,
                renameRefresh,
            });
        } catch (error) {
            console.error("Failed to process Journal Stream UI audit request:", error);
            await this.writeAuditDebug("audit-request-error", {
                reason: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.isProcessingUiAuditRequest = false;
        }
    }

    async writeAuditDebug(event: string, details: Record<string, unknown> = {}) {
        try {
            await this.app.vault.adapter.write(
                `.obsidian/plugins/${this.manifest.id}/ui-audit-debug.json`,
                safeStringify(
                    {
                        event,
                        seq: ++this.auditDebugSeq,
                        at: new Date().toISOString(),
                        pluginId: this.manifest.id,
                        ...details,
                    }
                )
            );
        } catch (error) {
            console.error("Failed to write Journal Stream audit debug:", error);
        }
    }

    async readJournalStreamUiAuditRequest(
        requestPath = `.obsidian/plugins/${this.manifest.id}/ui-audit-request.json`
    ): Promise<{
        runId: string;
        openDefaultView: boolean;
        targetFolder?: string;
        selectedRange?: TimeRange;
        copyExport?: boolean;
        settingsToggle?: boolean;
        previewEditSave?: boolean;
        externalChangeReload?: boolean;
            renameRefresh?: boolean;
            listHeadingAudit?: boolean;
            pageStreamAudit?: boolean;
            blockLinkAudit?: boolean;
        }> {
        if (!(await this.app.vault.adapter.exists(requestPath))) {
            return { runId: "manual", openDefaultView: false };
        }

        const request = JSON.parse(
            await this.app.vault.adapter.read(requestPath)
        ) as {
            runId?: unknown;
            openDefaultView?: unknown;
            targetFolder?: unknown;
            selectedRange?: unknown;
            copyExport?: unknown;
            settingsToggle?: unknown;
            previewEditSave?: unknown;
            externalChangeReload?: unknown;
            renameRefresh?: unknown;
            listHeadingAudit?: unknown;
            pageStreamAudit?: unknown;
            blockLinkAudit?: unknown;
        };
        const runId =
            typeof request.runId === "string" && request.runId.trim()
                ? request.runId
                : "default";
        return {
            runId,
            openDefaultView: request.openDefaultView === true,
            targetFolder:
                typeof request.targetFolder === "string" &&
                request.targetFolder.trim()
                    ? request.targetFolder
                    : undefined,
            selectedRange:
                typeof request.selectedRange === "string"
                    ? (request.selectedRange as TimeRange)
                    : undefined,
            copyExport: request.copyExport === true,
            settingsToggle: request.settingsToggle === true,
            previewEditSave: request.previewEditSave === true,
            externalChangeReload: request.externalChangeReload === true,
            renameRefresh: request.renameRefresh === true,
            listHeadingAudit: request.listHeadingAudit === true,
            pageStreamAudit: request.pageStreamAudit === true,
            blockLinkAudit: request.blockLinkAudit === true,
        };
    }

    async openListHeadingViewForAudit(): Promise<RoamListHeadingView | null> {
        await this.openListHeadingView();
        const leaf = this.app.workspace.getLeavesOfType(ROAM_LIST_HEADING_VIEW_TYPE)[0];
        return leaf?.view instanceof RoamListHeadingView ? leaf.view : null;
    }

    async auditSettingsToggle(view: DailyNoteView): Promise<Record<string, unknown>> {
        const originalSettings = { ...this.settings };
        try {
            await view.prepareAuditSnapshot();
            const before = view.getAuditSnapshot();

            this.settings = {
                ...this.settings,
                enableExportMarkdown: false,
            };
            this.notifySettingsChanged();
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            await view.prepareAuditSnapshot();
            const afterDisabled = view.getAuditSnapshot();

            this.settings = originalSettings;
            this.notifySettingsChanged();
            await this.saveSettings();
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            await view.prepareAuditSnapshot();
            const afterRestore = view.getAuditSnapshot();

            const beforeExportButtons = before?.dom?.exportButtonCount ?? -1;
            const disabledExportButtons =
                afterDisabled?.dom?.exportButtonCount ?? -1;
            const restoredExportButtons = afterRestore?.dom?.exportButtonCount ?? -1;
            const passed =
                disabledExportButtons === 0 &&
                restoredExportButtons === beforeExportButtons &&
                this.settings.enableExportMarkdown ===
                    originalSettings.enableExportMarkdown;

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "settings-toggle-did-not-update-dom",
                before: {
                    exportButtonCount: beforeExportButtons,
                },
                afterDisabled: {
                    exportButtonCount: disabledExportButtons,
                },
                afterRestore: {
                    exportButtonCount: restoredExportButtons,
                },
                restoredSettings: {
                    journalFolder: this.settings.journalFolder,
                    defaultOpenMode: this.settings.defaultOpenMode,
                    initialRange: this.settings.initialRange,
                    enableExportMarkdown: this.settings.enableExportMarkdown,
                },
            };
        } catch (error) {
            this.settings = originalSettings;
            this.notifySettingsChanged();
            await this.saveSettings();
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    async waitForJournalStreamView(
        targetFolder?: string,
        selectedRange?: TimeRange
    ): Promise<DailyNoteView | null> {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const view = this.findJournalStreamView(targetFolder, selectedRange);
            if (view) {
                await view.prepareAuditSnapshot();
                return view;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        return null;
    }

    private findJournalStreamView(
        targetFolder?: string,
        selectedRange?: TimeRange
    ): DailyNoteView | null {
        if (!targetFolder && !selectedRange) return this.getCurrentJournalView();

        for (const leaf of this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE)) {
            if (!(leaf.view instanceof DailyNoteView)) continue;
            if (targetFolder && leaf.view.target !== targetFolder) continue;
            if (selectedRange && leaf.view.selectedDaysRange !== selectedRange) continue;
            return leaf.view;
        }
        return null;
    }

    async ensureTodaysDailyNoteExists() {
        try {
            const currentDate = moment();
            const allDailyNotes = getAllDailyNotes();
            const currentDailyNote = getDailyNote(currentDate, allDailyNotes);

            if (!currentDailyNote) {
                await createDailyNote(currentDate);
            }
        } catch (error) {
            console.error("Failed to create daily note:", error);
        }
    }

    initCssRules() {
        document.body.toggleClass(
            "daily-notes-hide-frontmatter",
            this.settings.hideFrontmatter
        );
        document.body.toggleClass(
            "daily-notes-hide-backlinks",
            this.settings.hideBacklinks
        );
    }

    patchWorkspace() {
        let layoutChanging = false;
        const uninstaller = around(Workspace.prototype, {
            getActiveViewOfType: (next: any) =>
                function (t: any) {
                    const result = next.call(this, t);
                    if (!result) {
                        if (t?.VIEW_TYPE === "markdown") {
                            const activeLeaf = this.activeLeaf;
                            if (activeLeaf?.view instanceof DailyNoteView) {
                                return activeLeaf.view.editMode;
                            } else {
                                return result;
                            }
                        }
                    }
                    return result;
                },
            changeLayout(old) {
                return async function (workspace: unknown) {
                    layoutChanging = true;
                    try {
                        // Don't consider hover popovers part of the workspace while it's changing
                        await old.call(this, workspace);
                    } finally {
                        layoutChanging = false;
                    }
                };
            },
            iterateLeaves(old) {
                type leafIterator = (item: WorkspaceLeaf) => boolean | void;
                return function (arg1, arg2) {
                    // Fast exit if desired leaf found
                    if (old.call(this, arg1, arg2)) return true;

                    // Handle old/new API parameter swap
                    const cb: leafIterator = (
                        typeof arg1 === "function" ? arg1 : arg2
                    ) as leafIterator;
                    const parent: WorkspaceItem = (
                        typeof arg1 === "function" ? arg2 : arg1
                    ) as WorkspaceItem;

                    if (!parent) return false; // <- during app startup, rootSplit can be null
                    if (layoutChanging) return false; // Don't let HEs close during workspace change

                    // 0.14.x doesn't have WorkspaceContainer; this can just be an instanceof check once 15.x is mandatory:
                    if (!requireApiVersion("0.15.0")) {
                        if (
                            parent === this.app.workspace.rootSplit ||
                            (WorkspaceContainer &&
                                parent instanceof WorkspaceContainer)
                        ) {
                            for (const popover of DailyNoteEditor.popoversForWindow(
                                (parent as WorkspaceContainer).win
                            )) {
                                // Use old API here for compat w/0.14.x
                                if (old.call(this, cb, popover.rootSplit))
                                    return true;
                            }
                        }
                    }
                    return false;
                };
            },
            setActiveLeaf: (next: any) =>
                function (e: WorkspaceLeaf, t?: any) {
                    if ((e as any).parentLeaf) {
                        const parentLeaf = (e as any).parentLeaf;
                        if ((e.view as any).editMode) {
                            this.activeEditor = e.view;
                            parentLeaf.view.editMode = e.view;
                        }
                        next.call(this, parentLeaf, t);
                        return;
                    }
                    return next.call(this, e, t);
                },
        });
        this.register(uninstaller);
    }

    // Used for patch workspaceleaf pinned behaviors
    patchWorkspaceLeaf() {
        this.register(
            around(WorkspaceLeaf.prototype, {
                getRoot(old) {
                    return function () {
                        const top = old.call(this);
                        return top?.getRoot === this.getRoot
                            ? top
                            : top?.getRoot();
                    };
                },
                setPinned(old) {
                    return function (pinned: boolean) {
                        old.call(this, pinned);
                        if (isDailyNoteLeaf(this) && !pinned)
                            this.setPinned(true);
                    };
                },
                openFile(old) {
                    return function (file: TFile, openState?: OpenViewState) {
                        if (isDailyNoteLeaf(this)) {
                            setTimeout(
                                around(Workspace.prototype, {
                                    recordMostRecentOpenedFile(old) {
                                        return function (_file: TFile) {
                                            // Don't update the quick switcher's recent list
                                            if (_file !== file) {
                                                return old.call(this, _file);
                                            }
                                        };
                                    },
                                }),
                                1
                            );
                            const recentFiles =
                                this.app.plugins.plugins[
                                    "recent-files-obsidian"
                                ];
                            if (recentFiles)
                                setTimeout(
                                    around(recentFiles, {
                                        shouldAddFile(old) {
                                            return function (_file: TFile) {
                                                // Don't update the Recent Files plugin
                                                return (
                                                    _file !== file &&
                                                    old.call(this, _file)
                                                );
                                            };
                                        },
                                    }),
                                    1
                                );
                        }
                        return old.call(this, file, openState);
                    };
                },
            })
        );
    }

    public async loadSettings() {
        this.settings = restoreDailyNoteSettings(
            await this.loadData(),
            DEFAULT_SETTINGS
        );
    }

    private recordRecentFile(file: TFile): void {
        if (file.extension !== "md") return;
        const next = recordRecentPath(this.settings.recentFiles, file.path);
        if (next === this.settings.recentFiles) return;
        this.settings.recentFiles = next;
        this.refreshRecentFileViews();
        this.persistRecentFiles();
    }

    private renameRecentFile(oldPath: string, newPath: string): void {
        const next = renameRecentPath(
            this.settings.recentFiles,
            oldPath,
            newPath
        );
        if (next === this.settings.recentFiles) return;
        this.settings.recentFiles = next;
        this.refreshRecentFileViews();
        this.persistRecentFiles();
    }

    private removeRecentFile(path: string): void {
        const next = removeRecentPath(this.settings.recentFiles, path);
        if (next === this.settings.recentFiles) return;
        this.settings.recentFiles = next;
        this.refreshRecentFileViews();
        this.persistRecentFiles();
    }

    private refreshRecentFileViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(
            ROAM_NAVIGATION_VIEW_TYPE
        )) {
            if (leaf.view instanceof RoamNavigationView) {
                leaf.view.refreshRecentFiles();
            }
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    notifySettingsChanged() {
        this.settingsRevision = nextSettingsRevision(this.settingsRevision);

        for (const leaf of this.app.workspace.getLeavesOfType(
            DAILY_NOTE_VIEW_TYPE
        )) {
            const view = leaf.view;
            if (view instanceof DailyNoteView) {
                view.applySettingsRevision(this.settingsRevision);
            }
        }

        for (const leaf of this.app.workspace.getLeavesOfType(
            ROAM_NAVIGATION_VIEW_TYPE
        )) {
            if (leaf.view instanceof RoamNavigationView) {
                leaf.view.render();
            }
        }
    }

    private async checkDayChange(): Promise<void> {
        const currentDay = moment().format("YYYY-MM-DD");

        if (currentDay !== this.lastCheckedDay) {
            this.lastCheckedDay = currentDay;

            await this.ensureTodaysDailyNoteExists();

            const dailyNoteLeaves =
                this.app.workspace.getLeavesOfType(DAILY_NOTE_VIEW_TYPE);
            if (dailyNoteLeaves.length > 0) {
                for (const leaf of dailyNoteLeaves) {
                    const view = leaf.view as DailyNoteView;
                    if (view) {
                        view.refreshForNewDay();
                    }
                }
            }
        }
    }
}

function formatJournalDateFilename(date: Date): string {
    const year = String(date.getFullYear()).slice(2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getSnapshotTitles(snapshot: Record<string, unknown>): string[] {
    return Array.isArray(snapshot.titles)
        ? snapshot.titles.filter((title): title is string => typeof title === "string")
        : [];
}

function getNestedNumber(
    record: Record<string, unknown>,
    path: string[],
    fallback: number | null = null
): number | null {
    let current: unknown = record;
    for (const key of path) {
        if (!isRecord(current)) return fallback;
        current = current[key];
    }
    return typeof current === "number" ? current : fallback;
}

function getNestedNumberOrFallback(
    record: Record<string, unknown>,
    path: string[],
    fallback: number
): number {
    return getNestedNumber(record, path, fallback) ?? fallback;
}

function safeStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(sanitizeAuditValue(value, seen), null, 2);
}

function sanitizeAuditValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }
    if (typeof value === "undefined") return undefined;
    if (typeof value === "function") return "[Function]";
    if (typeof value !== "object") return String(value);
    if (value instanceof HTMLElement) {
        return `[HTMLElement:${value.tagName.toLowerCase()}]`;
    }
    if (depth > 12) return "[MaxDepth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeAuditValue(item, seen, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return `[${value.constructor?.name ?? "Object"}]`;
    }
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        result[key] = sanitizeAuditValue(nestedValue, seen, depth + 1);
    }
    return result;
}

function getMarkdownLeafAuditState(leaf: WorkspaceLeaf | null): {
    path: string | null;
    cursor: { line: number; ch: number } | null;
} {
    if (!(leaf?.view instanceof MarkdownView)) {
        return { path: null, cursor: null };
    }
    const cursor = leaf.view.editor.getCursor();
    return {
        path: leaf.view.file?.path ?? null,
        cursor: {
            line: cursor.line,
            ch: cursor.ch,
        },
    };
}
