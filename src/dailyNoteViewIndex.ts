import {
    Editor,
    FileSystemAdapter,
    MarkdownView,
    Notice,
    Plugin,
    TFile,
    Workspace,
    WorkspaceLeaf,
    moment,
    TFolder,
    View,
    debounce,
} from "obsidian";

import { EditorView as CodeMirrorEditorView } from "@codemirror/view";
import { installEmbeddedWorkspaceCompatibility } from "./compat/EmbeddedWorkspaceCompatibility";
import { isDailyNoteLeaf } from "./leafView";
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
    buildDefaultJournalStreamViewState,
    buildJournalFolderViewState,
    buildTagViewState,
    canCopyJournalStreamMarkdown,
} from "./utils/viewState";
import { restoreDailyNoteSettings } from "./utils/settingsState";
import { createUpDownNavigationExtension } from "./component/UpAndDownNavigate";
import { OutlinerModule } from "./outliner";
import {
    outlinerBlockSelectionField,
    setOutlinerBlockSelection,
} from "./outliner/extension";
// import { setActiveEditorExt } from "./component/SetActiveEditor";
import {
    JOURNAL_VIEW_TYPE,
    JournalV2View,
} from "./journal-v2";
import { RoamListHeadingView } from "./listHeadingView";
import {
    LIST_HEADING_DEPTHS,
} from "./listHeadingTypes";
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
import {
    adaptPasteToListContext,
    normalizeOutlinerPaste,
    planListContextPaste,
} from "./outliner/paste";
import {
    adjustBlockSelection,
    createBlockSelection,
    resolveBlockSelection,
    serializeBlockSelection,
} from "./outliner/selection";
import {
    recordRecentPath,
    removeRecentPath,
    renameRecentPath,
    shouldRecordRecentEditorChange,
} from "./utils/recentFiles";
import {
    reconcileRecentTaskRecordsForPath,
    removeRecentTaskPath,
    renameRecentTaskPath,
    resolveRecentTaskRecord,
    type RecentTaskBlockRecord,
} from "./navigation/recentTaskBlocks";
import { StreamPropertiesState } from "./utils/streamProperties";
export default class DailyNoteViewPlugin extends Plugin {
    readonly streamProperties = new StreamPropertiesState();
    lastActiveFile: TFile;
    private lastCheckedDay: string;
    private lastUiAuditRequestId = "";
    private processedUiAuditRequests = new Map<string, string>();
    private uiAuditPollingEnabled = false;
    private auditDebugSeq = 0;
    private isProcessingUiAuditRequest = false;
    private outlineSourcePath: string | null = null;
    private outlinerModule?: OutlinerModule;
    private persistRecentFiles = debounce(
        () => void this.saveSettings(),
        500,
        true
    );
    private persistRecentTasks = debounce(
        () => void this.saveSettings(),
        500,
        true
    );

    settings: DailyNoteSettings;

    async onload() {
        this.addSettingTab(new DailyNoteSettingTab(this.app, this));
        await this.loadSettings();
        this.uiAuditPollingEnabled = await this.app.vault.adapter.exists(
            `.obsidian/plugins/${this.manifest.id}/ui-audit-enabled`
        );
        if (this.uiAuditPollingEnabled) {
            void this.writeAuditDebug("onload", {
                version: this.manifest.version,
                journalFolder: this.settings.journalFolder,
            });
        }
        installEmbeddedWorkspaceCompatibility(this);
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
        this.outlinerModule = new OutlinerModule(this);
        this.outlinerModule.load();

        this.registerView(
            JOURNAL_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new JournalV2View(leaf, this)
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
            this.app.workspace.on("editor-change", (editor, info) => {
                const file = info.file;
                const contentEl = info instanceof MarkdownView
                    ? info.contentEl
                    : undefined;
                const activeElement =
                    contentEl?.ownerDocument.activeElement ?? document.activeElement;
                if (
                    file instanceof TFile &&
                    shouldRecordRecentEditorChange(
                        editor,
                        { contentEl },
                        activeElement
                    )
                ) {
                    this.recordRecentFile(file);
                    if (editor.hasFocus()) {
                        this.recordRecentTask(editor, file);
                    }
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (file instanceof TFile) {
                    this.renameRecentFile(oldPath, file.path);
                    this.renameRecentTasks(oldPath, file.path);
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => {
                if (file instanceof TFile) {
                    this.removeRecentFile(file.path);
                    this.removeRecentTasks(file.path);
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (file instanceof TFile && file.extension === "md") {
                    void this.reconcileRecentTasksForFile(file);
                }
            })
        );
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.showRecentTasks) void this.reconcileAllRecentTasks();
        });

        this.addRibbonIcon(
            "layout-dashboard",
            "Open roam navigation",
            () => this.openRoamNavigationView()
        );
        this.addRibbonIcon(
            "calendar-range",
            "Open journal stream",
            () => this.openDefaultJournalView()
        );
        this.addRibbonIcon(
            "panel-right-open",
            "Open page stream",
            () => this.openPageStreamView()
        );
        this.addRibbonIcon(
            "list-tree",
            "Open list heading",
            () => this.openListHeadingView()
        );
        this.addCommand({
            id: "open-roam-navigation",
            name: "Open roam navigation",
            callback: () => this.openRoamNavigationView(),
        });
        this.addCommand({
            id: "open-journal-stream",
            name: "Open journal stream",
            callback: () => this.openDefaultJournalView(),
        });
        this.addCommand({
            id: "open-page-stream",
            name: "Open page stream",
            callback: () => this.openPageStreamView(),
        });
        this.addCommand({
            id: "open-list-heading",
            name: "Open list heading",
            callback: () => this.openListHeadingView(),
        });
        this.addCommand({
            id: "open-current-file-in-page-stream",
            name: "Open current file in page stream",
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
            name: "Copy journal stream as Markdown",
            checkCallback: (checking) => {
                const view = this.getCurrentJournalExportView();
                const canCopy = canCopyJournalStreamMarkdown(
                    this.settings.enableExportMarkdown,
                    !!view
                );
                if (checking) return canCopy;
                if (canCopy && view) {
                    void view.copyCurrentJournalMarkdown();
                }
                return canCopy;
            },
        });
        this.addCommand({
            id: "write-ui-audit",
            name: "Write UI audit",
            callback: () => this.writeRoamWorkspaceUiAuditFromRequest(),
        });
        this.app.workspace.onLayoutReady(() => {
            void this.restoreJournalView().catch((error) => {
                console.error("Failed to restore Journal view:", error);
                new Notice("Could not finish restoring the journal view.");
            });
        });

        // Also check periodically (every 15 minutes) for day changes
        this.registerInterval(
            window.setInterval(() => {
                void this.checkDayChange().catch((error: unknown) => {
                    console.error("Failed to refresh journal for a new day:", error);
                    new Notice("Could not refresh the journal for the new day.");
                });
            }, 1000 * 60 * 15)
        );
        if (this.uiAuditPollingEnabled) {
            const auditRequestTimer = window.setTimeout(() => {
                void this.writeAuditDebug("audit-timer-start", {
                    lastUiAuditRequestId: this.lastUiAuditRequestId,
                });
                void this.checkAllJournalStreamUiAuditRequests();
                this.registerInterval(
                    window.setInterval(
                        () => {
                            void this.checkAllJournalStreamUiAuditRequests();
                        },
                        2000
                    )
                );
            }, 8000);
            this.register(() => window.clearTimeout(auditRequestTimer));
        }

        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setIcon("calendar-range");
                        item.setTitle("Open journal stream for this folder");
                        item.onClick(() => {
                            void this.openFolderView(
                                file.path,
                                "journalDate",
                                this.settings.initialRange
                            ).catch((error: unknown) => {
                                console.error("Failed to open journal folder:", error);
                                new Notice("Could not open the journal folder.");
                            });
                        });
                    });
                }
            })
        );
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
        const pageStreamLeaves = workspace.getLeavesOfType(
            ROAM_PAGE_STREAM_VIEW_TYPE
        );
        let leaf =
            pageStreamLeaves.find((candidate) =>
                candidate.containerEl.isShown()
            ) ?? pageStreamLeaves[0];
        let layoutChanged = false;
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
            await leaf.setViewState({
                type: ROAM_PAGE_STREAM_VIEW_TYPE,
                active,
            });
            layoutChanged = true;
        }
        const isVisible = leaf.containerEl.isShown();
        if (reveal && (active || !isVisible)) {
            await workspace.revealLeaf(leaf);
            layoutChanged = true;
        }
        if (layoutChanged) workspace.requestSaveLayout();
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
    ): Promise<boolean> {
        const previousLeaf = options.active === false
            ? this.app.workspace.getActiveViewOfType(View)?.leaf ?? null
            : null;
        const activeEditor = this.app.workspace.activeEditor;
        const embeddedLeaf = activeEditor instanceof MarkdownView
            ? activeEditor.leaf
            : null;
        const focusLeaf = embeddedLeaf && previousLeaf &&
            embeddedLeaf.parentLeaf === previousLeaf &&
            isDailyNoteLeaf(embeddedLeaf)
            ? embeddedLeaf
            : previousLeaf;
        const view = await this.openPageStreamView(options);
        if (!view) return false;
        view.pushTarget({
            ...buildFileTarget(file, source),
            ...target,
            path: file.path,
            source,
        });
        if (focusLeaf) {
            this.app.workspace.setActiveLeaf(focusLeaf, { focus: true });
            window.setTimeout(() => {
                const focusRestored = focusLeaf === previousLeaf
                    ? this.app.workspace.getActiveViewOfType(View)?.leaf === previousLeaf
                    : this.app.workspace.activeEditor === activeEditor;
                if (!focusRestored) {
                    this.app.workspace.setActiveLeaf(focusLeaf, { focus: true });
                }
            }, 80);
        }
        return true;
    }

    private canCopyCurrentBlockLink(editor: Editor): boolean {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        return appendBlockIdToLine(line, createBlockId()).reason !== "unsupported";
    }

    async copyCurrentBlockLinkFromActiveMarkdown(): Promise<void> {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
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
            new Notice("Current line cannot receive a block ID.");
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
            new Notice("Current line cannot receive a block ID.");
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
        const range = selectedRange ?? this.settings.initialRange;
        await this.openJournalState(buildDailyViewState(range));
    }

    async openDefaultJournalView() {
        await this.openJournalState(
            buildDefaultJournalStreamViewState(this.settings),
            true
        );
    }

    private async openJournalState(
        state: Record<string, unknown>,
        configuredView = false
    ): Promise<void> {
        const workspace = this.app.workspace;
        const selectionMode = state.selectionMode as "daily" | "folder" | "tag";
        const target = typeof state.target === "string" ? state.target : "";
        const timeField = state.timeField as TimeField;
        const matchingLeaf = this.getMatchingViewLeaf(
            selectionMode,
            target,
            timeField
        );
        const configuredLeaves = configuredView
            ? this.getConfiguredJournalLeaves()
            : [];
        const leaf = configuredLeaves[0] ?? matchingLeaf;

        await leaf.setViewState({
            type: JOURNAL_VIEW_TYPE,
            state,
        });
        if (!(leaf.view instanceof JournalV2View)) {
            throw new Error("Journal view did not become active");
        }

        if (configuredView) this.detachOtherConfiguredJournalLeaves(leaf);
        await workspace.revealLeaf(leaf);
        workspace.requestSaveLayout();
    }

    private getConfiguredJournalLeaves(): WorkspaceLeaf[] {
        return this.app.workspace
            .getLeavesOfType(JOURNAL_VIEW_TYPE)
            .filter(
                (leaf) =>
                    leaf.view instanceof JournalV2View &&
                    this.isConfiguredJournalView(leaf.view)
            );
    }

    private detachOtherConfiguredJournalLeaves(keepLeaf: WorkspaceLeaf): void {
        for (const leaf of this.getConfiguredJournalLeaves()) {
            if (leaf !== keepLeaf) leaf.detach();
        }
    }

    private isConfiguredJournalView(view: JournalV2View): boolean {
        if (this.settings.defaultOpenMode === "daily") {
            return view.selectionMode === "daily" && view.timeField === "journalDate";
        }
        return (
            view.selectionMode === "folder" &&
            view.target === this.settings.journalFolder &&
            view.timeField === "journalDate"
        );
    }

    private async restoreJournalView(): Promise<void> {
        if (!this.settings.createAndOpenOnStartup) return;
        if (this.app.workspace.getLeavesOfType(JOURNAL_VIEW_TYPE).length > 0) return;
        await this.openDefaultJournalView();
    }

    async openFolderView(
        folderPath: string,
        timeField: TimeField = "mtime",
        selectedRange?: TimeRange
    ) {
        const range = selectedRange ?? this.settings.initialRange;
        await this.openJournalState(
            buildJournalFolderViewState(folderPath, timeField, range)
        );
    }

    async openTagView(
        tagName: string,
        timeField: TimeField = "mtime",
        selectedRange?: TimeRange
    ) {
        const range = selectedRange ?? this.settings.initialRange;
        await this.openJournalState(buildTagViewState(tagName, timeField, range));
    }

    getMatchingViewLeaf(
        selectionMode: "daily" | "folder" | "tag",
        target: string,
        timeField: TimeField
    ): WorkspaceLeaf {
        const journalLeaves = this.app.workspace.getLeavesOfType(JOURNAL_VIEW_TYPE);
        for (const leaf of journalLeaves) {
            const state = leaf.getViewState().state as {
                selectionMode?: "daily" | "folder" | "tag";
                target?: string;
                timeField?: TimeField;
            };
            const view = leaf.view as JournalV2View;
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

    getCurrentJournalView(): JournalV2View | null {
        const activeView = this.app.workspace.getActiveViewOfType(JournalV2View);
        if (activeView && this.isUsableJournalView(activeView)) {
            return activeView;
        }

        const leaves = this.app.workspace.getLeavesOfType(JOURNAL_VIEW_TYPE);
        const configuredView = leaves
            .map((leaf) => leaf.view)
            .find(
                (view): view is JournalV2View =>
                    view instanceof JournalV2View &&
                    this.isUsableJournalView(view)
            );
        if (configuredView) return configuredView;

        const view = leaves[0]?.view;
        return view instanceof JournalV2View ? view : null;
    }

    private getCurrentJournalExportView(): JournalV2View | null {
        return this.getCurrentJournalView();
    }

    isUsableJournalView(view: JournalV2View): boolean {
        return (
            view.selectionMode === "folder" &&
            view.target === this.settings.journalFolder &&
            view.timeField === "journalDate"
        );
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
        if (options.pageStreamAudit) {
            const pageStreamView = await this.openPageStreamView({
                active: true,
                reveal: true,
            });
            if (pageStreamView) {
                this.app.workspace.setActiveLeaf(pageStreamView.leaf, { focus: false });
                await this.app.workspace.revealLeaf(pageStreamView.leaf);
                await new Promise((resolve) => window.setTimeout(resolve, 250));
            }
            actions.pageStreamMutationStability = pageStreamView
                ? await pageStreamView.auditMutationStabilityForAudit()
                : { status: "failed", reason: "page-stream-view-not-open" };
            actions.pageStreamVisibleContentContinuity = pageStreamView
                ? await pageStreamView.auditVisibleContentContinuityForAudit()
                : { status: "failed", reason: "page-stream-view-not-open" };
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
            const viewEntryStyles = Array.from(
                contentEl.querySelectorAll<HTMLElement>(".roam-nav-entry")
            ).map((entry) => {
                const style = window.getComputedStyle(entry);
                const rect = entry.getBoundingClientRect();
                const iconRect = entry
                    .querySelector<HTMLElement>(".roam-nav-entry-icon")
                    ?.getBoundingClientRect();
                const label = entry.querySelector<HTMLElement>(
                    ".roam-nav-entry-label"
                );
                const labelRect = label?.getBoundingClientRect();
                const labelStyle = label ? window.getComputedStyle(label) : null;
                return {
                    interactive:
                        entry.matches(":hover") || entry.matches(":focus-visible"),
                    backgroundColor: style.backgroundColor,
                    backgroundImage: style.backgroundImage,
                    borderWidth: style.borderWidth,
                    boxShadow: style.boxShadow,
                    height: rect.height,
                    paddingLeft: style.paddingLeft,
                    columnGap: style.columnGap,
                    iconWidth: iconRect?.width ?? null,
                    iconLeftDelta: iconRect ? iconRect.left - rect.left : null,
                    labelLeftDelta: labelRect ? labelRect.left - rect.left : null,
                    labelFontSize: labelStyle?.fontSize ?? null,
                    labelFontWeight: labelStyle?.fontWeight ?? null,
                };
            });
            const inactiveViewEntryStyles = viewEntryStyles.filter(
                (style) => !style.interactive
            );
            const viewEntriesAreContainerless =
                viewEntryStyles.length === this.settings.navigationViews.length &&
                inactiveViewEntryStyles.every(
                    (style) =>
                        (style.backgroundColor === "rgba(0, 0, 0, 0)" ||
                            style.backgroundColor === "transparent") &&
                        style.backgroundImage === "none" &&
                        style.borderWidth === "0px" &&
                        style.boxShadow === "none"
                );
            const fileEntryStyles = Array.from(
                contentEl.querySelectorAll<HTMLElement>(".roam-nav-file")
            ).map((entry) => {
                const style = window.getComputedStyle(entry);
                const beforeStyle = window.getComputedStyle(entry, "::before");
                const afterStyle = window.getComputedStyle(entry, "::after");
                return {
                    interactive:
                        entry.matches(":hover") || entry.matches(":focus-visible"),
                    backgroundColor: style.backgroundColor,
                    backgroundImage: style.backgroundImage,
                    borderWidth: style.borderWidth,
                    boxShadow: style.boxShadow,
                    before: {
                        content: beforeStyle.content,
                        backgroundColor: beforeStyle.backgroundColor,
                        backgroundImage: beforeStyle.backgroundImage,
                        borderWidth: beforeStyle.borderWidth,
                        boxShadow: beforeStyle.boxShadow,
                    },
                    after: {
                        content: afterStyle.content,
                        backgroundColor: afterStyle.backgroundColor,
                        backgroundImage: afterStyle.backgroundImage,
                        borderWidth: afterStyle.borderWidth,
                        boxShadow: afterStyle.boxShadow,
                    },
                };
            });
            const inactiveFileEntryStyles = fileEntryStyles.filter(
                (style) => !style.interactive
            );
            const fileEntriesAreContainerless = inactiveFileEntryStyles.every(
                (style) =>
                    (style.backgroundColor === "rgba(0, 0, 0, 0)" ||
                        style.backgroundColor === "transparent") &&
                    style.backgroundImage === "none" &&
                    style.borderWidth === "0px" &&
                    style.boxShadow === "none"
            );
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
            const sectionTitle = contentEl.querySelector<HTMLElement>(
                ".roam-nav-section-title"
            );
            const sectionTitleStyle = sectionTitle
                ? window.getComputedStyle(sectionTitle)
                : null;
            const sectionTitleRect = sectionTitle?.getBoundingClientRect();
            const firstViewStyle = viewEntryStyles[0];
            const navigationPixelContract = {
                sectionTitleHeight: sectionTitleRect?.height ?? null,
                sectionTitleFontSize: sectionTitleStyle?.fontSize ?? null,
                sectionTitleFontWeight: sectionTitleStyle?.fontWeight ?? null,
                sectionTitlePaddingLeft: sectionTitleStyle?.paddingLeft ?? null,
                viewEntryHeight: firstViewStyle?.height ?? null,
                viewEntryPaddingLeft: firstViewStyle?.paddingLeft ?? null,
                viewEntryGap: firstViewStyle?.columnGap ?? null,
                iconWidth: firstViewStyle?.iconWidth ?? null,
                iconLeftDelta: firstViewStyle?.iconLeftDelta ?? null,
                labelLeftDelta: firstViewStyle?.labelLeftDelta ?? null,
                labelFontSize: firstViewStyle?.labelFontSize ?? null,
                labelFontWeight: firstViewStyle?.labelFontWeight ?? null,
            };
            const navigationPixelContractPassed =
                navigationPixelContract.sectionTitleHeight === 22 &&
                navigationPixelContract.sectionTitleFontSize === "10px" &&
                navigationPixelContract.sectionTitleFontWeight === "700" &&
                navigationPixelContract.sectionTitlePaddingLeft === "8px" &&
                navigationPixelContract.viewEntryHeight === 44 &&
                navigationPixelContract.viewEntryPaddingLeft === "8px" &&
                navigationPixelContract.viewEntryGap === "10px" &&
                navigationPixelContract.iconWidth === 16 &&
                navigationPixelContract.iconLeftDelta === 8 &&
                navigationPixelContract.labelLeftDelta === 34 &&
                navigationPixelContract.labelFontSize === "13px" &&
                navigationPixelContract.labelFontWeight === "600";
            const passed =
                leavesAfterFirstOpen.length >= 1 &&
                !duplicateCreated &&
                contentEl.classList.contains("roam-nav-view") &&
                contentEl.querySelector(".roam-nav-title")?.textContent?.trim() ===
                    "Roam workspace" &&
                onlyConfiguredViewsRendered &&
                viewEntriesAreContainerless &&
                fileEntriesAreContainerless &&
                navigationPixelContractPassed &&
                sectionTitles.includes("Navigation") &&
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
                viewEntriesAreContainerless,
                viewEntryStyles,
                navigationPixelContract,
                navigationPixelContractPassed,
                fileEntriesAreContainerless,
                fileEntryStyles,
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
            "\t\t- grand child block",
            "\t\t\t- great grand child block",
            "\t\t\t\t- deepest block",
            "\t\t\t- ## Deep list heading",
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

            const snapshots: Record<string, Record<string, unknown>> = {};
            for (const depth of LIST_HEADING_DEPTHS) {
                listView.setDepthForAudit(depth);
                snapshots[`depth-${depth}`] =
                    await listView.getAuditSnapshotForFile(file);
            }

            await listView.setState({ mode: "top-two-indent" });
            const migratedLegacyDepth = listView.getState().depth;
            await listView.setState({ depth: 2 });
            let depthInput = listView.getDepthControlForAudit();
            depthInput?.focus();
            depthInput?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "ArrowRight",
                    bubbles: true,
                    cancelable: true,
                })
            );
            const arrowRightDepth = listView.getState().depth;
            await listView.getAuditSnapshotForFile(file);
            const arrowRightFocusRestored =
                document.activeElement === listView.getDepthControlForAudit();
            depthInput = listView.getDepthControlForAudit();
            depthInput?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Home",
                    bubbles: true,
                    cancelable: true,
                })
            );
            const homeDepth = listView.getState().depth;
            await listView.getAuditSnapshotForFile(file);
            const homeFocusRestored =
                document.activeElement === listView.getDepthControlForAudit();
            depthInput = listView.getDepthControlForAudit();
            depthInput?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "End",
                    bubbles: true,
                    cancelable: true,
                })
            );
            const endDepth = listView.getState().depth;
            await listView.getAuditSnapshotForFile(file);
            const endFocusRestored =
                document.activeElement === listView.getDepthControlForAudit();
            depthInput = listView.getDepthControlForAudit();
            if (depthInput) {
                depthInput.value = "4";
                depthInput.dispatchEvent(
                    new InputEvent("input", {
                        bubbles: true,
                        cancelable: true,
                    })
                );
            }
            const inputDepth = listView.getState().depth;
            await listView.getAuditSnapshotForFile(file);
            const inputFocusRestored =
                document.activeElement === listView.getDepthControlForAudit();
            const sliderInteraction = {
                migratedLegacyDepth,
                arrowRightDepth,
                homeDepth,
                endDepth,
                inputDepth,
                persistedDepth: listView.getState().depth,
                arrowRightFocusRestored,
                homeFocusRestored,
                endFocusRestored,
                inputFocusRestored,
            };

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
            const targets = readPageStreamAuditTargets(pageStreamState);
            const topTarget = targets[0];
            const fixtureTargets = targets.filter(
                (target) => isRecord(target) && target.path === fixturePath
            );
            const pageStreamEditSave = pageStreamView
                ? await this.auditPageStreamEditSave(pageStreamView, file)
                : { status: "failed", reason: "page-stream-view-not-open" };
            const pageStreamFocusRestore = await this.auditPageStreamFocusRestore(file);
            const pageStreamReadingShiftClick =
                await this.auditPageStreamRenderedShiftClick(file, "preview");
            const pageStreamLivePreviewShiftClick =
                await this.auditPageStreamRenderedShiftClick(file, "live-preview");

            const depthTitles = LIST_HEADING_DEPTHS.map((depth) =>
                getSnapshotTitles(snapshots[`depth-${depth}`])
            );
            const sliderDomContract = LIST_HEADING_DEPTHS.every((depth) => {
                const snapshot = snapshots[`depth-${depth}`];
                return (
                    getNestedNumberOrFallback(snapshot, ["dom", "depthControlCount"], -1) === 1 &&
                    getNestedNumberOrFallback(snapshot, ["dom", "depthInputCount"], -1) === 1 &&
                    getNestedNumberOrFallback(snapshot, ["dom", "depthTickCount"], -1) === 6 &&
                    snapshot.availableDepth === 5
                );
            });
            const passed =
                depthTitles[0].join("|") ===
                    "Root|List heading|Deep list heading|Second" &&
                depthTitles[1].includes("top block") &&
                depthTitles[1].includes("done task") &&
                !depthTitles[1].includes("child block") &&
                depthTitles[2].includes("child block") &&
                !depthTitles[2].includes("grand child block") &&
                depthTitles[3].includes("grand child block") &&
                !depthTitles[3].includes("great grand child block") &&
                depthTitles[4].includes("great grand child block") &&
                !depthTitles[4].includes("deepest block") &&
                depthTitles[5].includes("deepest block") &&
                sliderDomContract &&
                migratedLegacyDepth === 2 &&
                arrowRightDepth === 3 &&
                homeDepth === 0 &&
                endDepth === 5 &&
                inputDepth === 4 &&
                arrowRightFocusRestored &&
                homeFocusRestored &&
                endFocusRestored &&
                inputFocusRestored &&
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
                isRecord(pageStreamReadingShiftClick) &&
                pageStreamReadingShiftClick.status === "passed" &&
                isRecord(pageStreamLivePreviewShiftClick) &&
                pageStreamLivePreviewShiftClick.status === "passed";

            return {
                status: passed ? "passed" : "failed",
                reason: passed ? undefined : "list-heading-audit-mismatch",
                fixturePath,
                snapshots,
                sliderInteraction,
                sliderDomContract,
                pageStreamTopTarget: topTarget ?? null,
                pageStreamFixtureTargetCount: fixtureTargets.length,
                exercisedPageStreamTargets: [
                    { kind: "heading", subpath: "#Second" },
                    { kind: "block", subpath: "#^stream-block" },
                    { kind: "line", line: 4, col: 2 },
                ],
                pageStreamEditSave,
                pageStreamFocusRestore,
                pageStreamReadingShiftClick,
                pageStreamLivePreviewShiftClick,
            };
        } catch (error) {
            return {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
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

        const before = getActiveMarkdownAuditState(this.app.workspace);
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
        const targets = readPageStreamAuditTargets(state);
        const topTarget = targets[0];
        const after = getActiveMarkdownAuditState(this.app.workspace);
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
        const before = getActiveMarkdownAuditState(this.app.workspace);

        await this.pushFileToPageStream(
            targetFile,
            "link",
            { kind: "heading", subpath: "#Second", label: "Second" },
            { active: false, reveal: true }
        );
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const after = getActiveMarkdownAuditState(this.app.workspace);
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
        const initialEditorDeadline = Date.now() + 30000;
        while (
            !pageStreamView.isEditingEditorReadyForAudit(file.path) &&
            Date.now() < initialEditorDeadline
        ) {
            await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        const before = pageStreamView.getAuditSnapshot();
        const cardBeforeEdit = pageStreamView.getCardElementForAudit(file.path);
        const titleButton = cardBeforeEdit?.querySelector<HTMLButtonElement>(
            ".roam-page-card-title"
        );
        const collapseButton = cardBeforeEdit?.querySelector<HTMLButtonElement>(
            '.roam-page-card-actions-start button[aria-label="Collapse page"]'
        );
        const cardActionLabels = Array.from(
            cardBeforeEdit?.querySelectorAll<HTMLButtonElement>(
                ".roam-page-card-actions button"
            ) ?? []
        ).map((button) => button.getAttribute("aria-label"));
        const headerButtonLabels = Array.from(
            cardBeforeEdit?.querySelectorAll<HTMLButtonElement>(
                ".roam-page-card-header button"
            ) ?? []
        ).map((button) => button.getAttribute("aria-label"));
        const headerHeight =
            cardBeforeEdit
                ?.querySelector<HTMLElement>(".roam-page-card-header")
                ?.getBoundingClientRect().height ?? null;
        const headerEl = cardBeforeEdit?.querySelector<HTMLElement>(
            ".roam-page-card-header"
        );
        const headerStyle = headerEl ? window.getComputedStyle(headerEl) : null;
        const headerActionSizes = Array.from(
            headerEl?.querySelectorAll<HTMLElement>(".roam-icon-button") ?? []
        ).map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
        });
        const expectedCompactHeaderHeight = window.innerWidth <= 600 ? 44 : 28;
        const expectedCompactHeaderWidth = window.innerWidth <= 600 ? 44 : 36;
        const titleNameEl = titleButton?.querySelector<HTMLElement>(
            ".roam-page-card-name"
        );
        const titleNameStyle = titleNameEl
            ? window.getComputedStyle(titleNameEl)
            : null;
        const bodyBeforeEdit = cardBeforeEdit?.querySelector<HTMLElement>(
            ".roam-page-card-body"
        );
        const cardRectBeforeEdit = getRectAuditSnapshot(cardBeforeEdit);
        const bodyRectBeforeEdit = getRectAuditSnapshot(bodyBeforeEdit);
        const editorContentRectBeforeFocus = getRectAuditSnapshot(
            cardBeforeEdit?.querySelector<HTMLElement>(
                ".roam-page-card-editor-mount .cm-line"
            )
        );
        const editorDomBeforeFocus = cardBeforeEdit?.querySelector(".cm-editor") ?? null;
        const streamListBeforeEdit = cardBeforeEdit?.closest<HTMLElement>(
            ".roam-page-stream-list"
        );
        const streamScrollTopBeforeEdit = streamListBeforeEdit?.scrollTop ?? null;
        const cardStyleBeforeEdit = cardBeforeEdit
            ? window.getComputedStyle(cardBeforeEdit)
            : null;
        const streamHeaderEl = pageStreamView.contentEl.querySelector<HTMLElement>(
            ".roam-page-stream-header"
        );
        const streamTitleEl = streamHeaderEl?.querySelector<HTMLElement>(
            ".roam-page-stream-title"
        );
        const streamStatusEl = streamHeaderEl?.querySelector<HTMLElement>(
            ".roam-page-stream-status"
        );
        const streamListEl = pageStreamView.contentEl.querySelector<HTMLElement>(
            ".roam-page-stream-list"
        );
        const editorMountEl = cardBeforeEdit?.querySelector<HTMLElement>(
            ".roam-page-card-editor-mount"
        );
        const streamTitleStyle = streamTitleEl
            ? window.getComputedStyle(streamTitleEl)
            : null;
        const streamStatusStyle = streamStatusEl
            ? window.getComputedStyle(streamStatusEl)
            : null;
        const streamListStyle = streamListEl
            ? window.getComputedStyle(streamListEl)
            : null;
        const bodyStyleBeforeEdit = bodyBeforeEdit
            ? window.getComputedStyle(bodyBeforeEdit)
            : null;
        const editorMountStyle = editorMountEl
            ? window.getComputedStyle(editorMountEl)
            : null;
        const pageStreamRootStyle = window.getComputedStyle(
            pageStreamView.contentEl
        );
        const themeProbe = pageStreamView.contentEl.createDiv({
            cls: "roam-page-stream-theme-probe",
        });
        const secondaryThemeProbe = pageStreamView.contentEl.createDiv({
            cls: "roam-page-stream-theme-probe-secondary",
        });
        const themeProbeStyle = window.getComputedStyle(themeProbe);
        const secondaryThemeProbeStyle = window.getComputedStyle(
            secondaryThemeProbe
        );
        const themeContractExpected = {
            paneBackgroundColor: secondaryThemeProbeStyle.backgroundColor,
            cardBackgroundColor: themeProbeStyle.backgroundColor,
            panelHeaderBackground: themeProbeStyle.backgroundImage,
            borderColor: themeProbeStyle.borderTopColor,
            textColor: themeProbeStyle.color,
            shadow: themeProbeStyle.boxShadow,
            cardBorderRadius: themeProbeStyle.borderRadius,
            paneHeaderFontSize: themeProbeStyle.fontSize,
            panelHeaderFontSize: secondaryThemeProbeStyle.fontSize,
        };
        themeProbe.remove();
        secondaryThemeProbe.remove();
        const pageStreamPixelContract = {
            paneBackgroundColor: pageStreamRootStyle.backgroundColor,
            paneHeaderHeight: streamHeaderEl?.getBoundingClientRect().height ?? null,
            paneTitleFontSize: streamTitleStyle?.fontSize ?? null,
            paneTitleFontWeight: streamTitleStyle?.fontWeight ?? null,
            paneStatusFontSize: streamStatusStyle?.fontSize ?? null,
            paneStatusFontWeight: streamStatusStyle?.fontWeight ?? null,
            listGap: streamListStyle?.rowGap ?? null,
            listPadding: streamListStyle
                ? [
                    streamListStyle.paddingTop,
                    streamListStyle.paddingRight,
                    streamListStyle.paddingBottom,
                    streamListStyle.paddingLeft,
                ]
                : null,
            cardBorderRadius: cardStyleBeforeEdit?.borderRadius ?? null,
            cardBackgroundColor: cardStyleBeforeEdit?.backgroundColor ?? null,
            cardBorderColor: cardStyleBeforeEdit?.borderTopColor ?? null,
            cardBoxShadow: cardStyleBeforeEdit?.boxShadow ?? null,
            panelHeaderHeight: headerHeight,
            panelHeaderBackground: headerStyle?.backgroundImage ?? null,
            panelTitleFontSize: titleNameStyle?.fontSize ?? null,
            panelTitleColor: titleNameStyle?.color ?? null,
            panelActionSizes: headerActionSizes,
            bodyBackgroundColor: bodyStyleBeforeEdit?.backgroundColor ?? null,
            bodyPadding: bodyStyleBeforeEdit?.padding ?? null,
            editorPadding: editorMountStyle
                ? [
                    editorMountStyle.paddingTop,
                    editorMountStyle.paddingRight,
                    editorMountStyle.paddingBottom,
                    editorMountStyle.paddingLeft,
                ]
                : null,
        };
        const pageStreamPixelContractPassed =
            pageStreamPixelContract.paneHeaderHeight === 40 &&
            pageStreamPixelContract.paneTitleFontSize ===
                themeContractExpected.paneHeaderFontSize &&
            pageStreamPixelContract.paneTitleFontWeight === "500" &&
            pageStreamPixelContract.paneStatusFontSize ===
                themeContractExpected.paneHeaderFontSize &&
            pageStreamPixelContract.paneStatusFontWeight === "400" &&
            pageStreamPixelContract.listGap === "10px" &&
            pageStreamPixelContract.listPadding?.join("|") ===
                "12px|10px|26px|10px" &&
            pageStreamPixelContract.cardBorderRadius ===
                themeContractExpected.cardBorderRadius &&
            pageStreamPixelContract.cardBoxShadow !== "none" &&
            pageStreamPixelContract.panelHeaderHeight ===
                expectedCompactHeaderHeight &&
            pageStreamPixelContract.panelTitleFontSize ===
                themeContractExpected.panelHeaderFontSize &&
            pageStreamPixelContract.bodyPadding === "0px" &&
            pageStreamPixelContract.editorPadding?.join("|") ===
                "17px|14px|20px|14px";
        const pageStreamThemeContractPassed =
            pageStreamPixelContract.paneBackgroundColor ===
                themeContractExpected.paneBackgroundColor &&
            pageStreamPixelContract.cardBackgroundColor ===
                themeContractExpected.cardBackgroundColor &&
            pageStreamPixelContract.bodyBackgroundColor ===
                themeContractExpected.cardBackgroundColor &&
            pageStreamPixelContract.panelHeaderBackground ===
                themeContractExpected.panelHeaderBackground &&
            pageStreamPixelContract.cardBorderColor ===
                themeContractExpected.borderColor &&
            pageStreamPixelContract.panelTitleColor ===
                themeContractExpected.textColor &&
            pageStreamPixelContract.cardBoxShadow ===
                themeContractExpected.shadow;
        const interactiveAccent = window.getComputedStyle(document.body)
            .getPropertyValue("--interactive-accent")
            .trim();
        const activeBorderIsNeutral =
            cardStyleBeforeEdit !== null &&
            cardStyleBeforeEdit.borderTopColor !== interactiveAccent;
        const headerVisualContract =
            headerStyle !== null &&
            headerStyle.backgroundImage.startsWith("linear-gradient") &&
            headerStyle.borderBottomLeftRadius === "0px" &&
            headerStyle.borderBottomRightRadius === "0px" &&
            headerActionSizes.length === 2 &&
            headerActionSizes.every(
                (size) =>
                    Math.abs(size.width - expectedCompactHeaderWidth) <= 0.5 &&
                    Math.abs(size.height - expectedCompactHeaderHeight) <= 0.5
            ) &&
            (headerEl?.scrollWidth ?? 1) <= (headerEl?.clientWidth ?? 0) &&
            titleNameStyle?.overflow === "hidden" &&
            titleNameStyle.textOverflow === "ellipsis" &&
            titleNameStyle.whiteSpace === "nowrap";
        const keyboardOrderMatchesLayout =
            cardBeforeEdit?.tabIndex === -1 && bodyBeforeEdit?.tabIndex === 0;
        const immersiveHeader =
            titleButton?.getAttribute("aria-label")?.startsWith("Open ") === true &&
            cardActionLabels.length === 2 &&
            headerButtonLabels.length === 3 &&
            (headerButtonLabels[0] === "Collapse page" ||
                headerButtonLabels[0] === "Expand page") &&
            headerButtonLabels[1]?.startsWith("Open ") === true &&
            headerButtonLabels[2] === "Close page" &&
            headerHeight !== null &&
            Math.abs(headerHeight - expectedCompactHeaderHeight) <= 0.5 &&
            headerVisualContract &&
            keyboardOrderMatchesLayout &&
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
        const cardRectDuringEdit = getRectAuditSnapshot(editingCard);
        const editingBody = editingCard?.querySelector<HTMLElement>(
            ".roam-page-card-body"
        );
        const bodyRectDuringEdit = getRectAuditSnapshot(editingBody);
        const editorContentRectDuringEdit = getRectAuditSnapshot(
            editingCard?.querySelector<HTMLElement>(
                ".roam-page-card-editor-mount .cm-line"
            )
        );
        const streamScrollTopDuringEdit =
            editingCard?.closest<HTMLElement>(".roam-page-stream-list")?.scrollTop ?? null;
        const shellGeometryStable =
            rectOriginWithinTolerance(cardRectBeforeEdit, cardRectDuringEdit, 1) &&
            rectOriginWithinTolerance(bodyRectBeforeEdit, bodyRectDuringEdit, 1) &&
            numbersWithinTolerance(streamScrollTopBeforeEdit, streamScrollTopDuringEdit, 1);
        const contentOriginStable = rectOriginWithinTolerance(
            editorContentRectBeforeFocus,
            editorContentRectDuringEdit,
            1
        );
        const editorDomDuringFocus = editingCard?.querySelector(".cm-editor") ?? null;
        const singleEditorDomDuringFocus =
            editorDomBeforeFocus !== null &&
            editorDomDuringFocus === editorDomBeforeFocus;
        const stableCardDuringEdit =
            cardBeforeEdit instanceof HTMLElement &&
            pageStreamView.getCardElementForAudit(file.path) === cardBeforeEdit;
        const hadEditingLeafBeforeEscape = pageStreamView.hasEditingLeafForAudit(file.path);
        const blockSelectionAudit = await this.auditOutlinerBlockSelection(
            auditEditorView,
            editingCard
        );
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
        const editorDomAfterEscape =
            pageStreamView
                .getCardElementForAudit(file.path)
                ?.querySelector(".cm-editor") ?? null;
        const stableCardAfterEscape =
            cardBeforeEdit instanceof HTMLElement &&
            pageStreamView.getCardElementForAudit(file.path) === cardBeforeEdit;
        const hasEditingLeafAfterEscape = pageStreamView.hasEditingLeafForAudit(file.path);
        if (getNestedNumberOrFallback(previewState, ["dom", "editingCardCount"], -1) !== 0) {
            pageStreamView.exitEditModeForAudit();
        }
        const editorDomBeforeCollapse =
            getPageStreamEditorDom(pageStreamView, file.path);
        collapseButton?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        const cardWhileCollapsed = pageStreamView.getCardElementForAudit(file.path);
        const bodyWhileCollapsed = cardWhileCollapsed?.querySelector<HTMLElement>(
            ".roam-page-card-body"
        );
        const bodyChildCountWhileCollapsed =
            bodyWhileCollapsed?.childElementCount ?? -1;
        const bodyHiddenWhileCollapsed =
            bodyWhileCollapsed?.hasClass("is-collapsed") === true;
        const editorDomWhileCollapsed =
            getPageStreamEditorDom(pageStreamView, file.path);
        const collapsedSnapshot = pageStreamView.getAuditSnapshot();
        collapseButton?.click();
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const cardAfterExpand = pageStreamView.getCardElementForAudit(file.path);
        const bodyAfterExpand = cardAfterExpand?.querySelector<HTMLElement>(
            ".roam-page-card-body"
        );
        const editorDomAfterExpand =
            getPageStreamEditorDom(pageStreamView, file.path);
        const expandedSnapshot = pageStreamView.getAuditSnapshot();
        const collapseCacheState = {
            bodyChildCountWhileCollapsed,
            bodyHiddenWhileCollapsed,
            cardRetained:
                cardBeforeEdit instanceof HTMLElement &&
                cardWhileCollapsed === cardBeforeEdit &&
                cardAfterExpand === cardBeforeEdit,
            editorDomRetainedWhileCollapsed:
                editorDomBeforeCollapse !== null &&
                editorDomWhileCollapsed === editorDomBeforeCollapse,
            editorDomReusedAfterExpand:
                editorDomBeforeCollapse !== null &&
                editorDomAfterExpand === editorDomBeforeCollapse,
            poolRetainedPath:
                getNestedStringArray(collapsedSnapshot, ["editorPool", "paths"])
                    .includes(file.path),
            expandedWithoutPlaceholder:
                bodyAfterExpand?.querySelector(
                    ".roam-page-card-editor-placeholder"
                ) === null,
            bodyVisibleAfterExpand:
                bodyAfterExpand?.hasClass("is-collapsed") === false,
        };
        const passed =
            getNestedNumberOrFallback(before, ["dom", "editingCardCount"], -1) === 0 &&
            getNestedNumberOrFallback(editState, ["dom", "editingCardCount"], -1) === 1 &&
            editState.editingPath === file.path &&
            immersiveHeader &&
            pageStreamPixelContractPassed &&
            pageStreamThemeContractPassed &&
            activeBorderIsNeutral &&
            editingCardFound &&
            shellGeometryStable &&
            contentOriginStable &&
            singleEditorDomDuringFocus &&
            stableCardDuringEdit &&
            hadEditingLeafBeforeEscape &&
            blockSelectionAudit.status === "passed" &&
            editorContainsMarker &&
            continuousSaveState.sourceContainsAllMarkers === true &&
            continuousSaveState.hasEditingLeafAfterContinuousSave === true &&
            continuousSaveState.editingCardCountAfterContinuousSave === 1 &&
            continuousSaveState.markdownSourceCountAfterContinuousSave >= 1 &&
            continuousSaveState.markdownSourceCountAfterContinuousSave <= 5 &&
            getNestedNumberOrFallback(
                editSnapshotAfterContinuousSave,
                ["dom", "editorHostCount"],
                -1
            ) >= 1 &&
            getNestedNumberOrFallback(
                editSnapshotAfterContinuousSave,
                ["dom", "editorHostCount"],
                -1
            ) <= 5 &&
            cursorAfterContinuousSave.line === baselineCursorBeforeContinuousSave.line &&
            cursorAfterContinuousSave.ch === baselineCursorBeforeContinuousSave.ch &&
            escapeDispatched &&
            stableCardAfterEscape &&
            hasEditingLeafAfterEscape &&
            editorDomAfterEscape === editorDomBeforeFocus &&
            getNestedNumberOrFallback(previewState, ["dom", "editingCardCount"], -1) === 0 &&
            getNestedNumberOrFallback(previewState, ["dom", "editorHostCount"], -1) >= 1 &&
            getNestedNumberOrFallback(previewState, ["dom", "editorHostCount"], -1) <= 5 &&
            getNestedNumberOrFallback(previewState, ["dom", "previewBodyCount"], -1) === 0 &&
            getNestedNumberOrFallback(previewState, ["editorPool", "size"], -1) <= 5 &&
            collapseCacheState.bodyChildCountWhileCollapsed > 0 &&
            collapseCacheState.bodyHiddenWhileCollapsed &&
            collapseCacheState.cardRetained &&
            collapseCacheState.editorDomRetainedWhileCollapsed &&
            collapseCacheState.editorDomReusedAfterExpand &&
            collapseCacheState.poolRetainedPath &&
            collapseCacheState.expandedWithoutPlaceholder &&
            collapseCacheState.bodyVisibleAfterExpand;

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
            collapsedSnapshot,
            expandedSnapshot,
            collapseCacheState,
            editorHasFocus,
            editingCardFound,
            enteredEditByCardClick: editState.editingPath === file.path,
            immersiveHeader,
            titleAriaLabel: titleButton?.getAttribute("aria-label") ?? null,
            cardActionLabels,
            headerButtonLabels,
            headerHeight,
            headerVisualContract,
            headerActionSizes,
            headerBackgroundImage: headerStyle?.backgroundImage ?? null,
            pageStreamPixelContract,
            pageStreamPixelContractPassed,
            pageStreamThemeContractPassed,
            themeContractExpected,
            keyboardOrderMatchesLayout,
            activeBorderIsNeutral,
            activeBorderColor: cardStyleBeforeEdit?.borderTopColor ?? null,
            interactiveAccent,
            geometry: {
                cardRectBeforeEdit,
                cardRectDuringEdit,
                bodyRectBeforeEdit,
                bodyRectDuringEdit,
                editorContentRectBeforeFocus,
                editorContentRectDuringEdit,
                streamScrollTopBeforeEdit,
                streamScrollTopDuringEdit,
                shellGeometryStable,
                contentOriginStable,
            },
            stableCardDuringEdit,
            stableCardAfterEscape,
            singleEditorDomDuringFocus,
            singleEditorDomAfterEscape: editorDomAfterEscape === editorDomBeforeFocus,
            escapeDispatched,
            escapeEventCanceled,
            hadEditingLeafBeforeEscape,
            hasEditingLeafAfterEscape,
            blockSelectionAudit,
            editorContainsMarker,
            sourceContainsMarker: source.includes(
                continuousMarkers[continuousMarkers.length - 1]
            ),
        };
    }

    private async auditOutlinerBlockSelection(
        markdownView: MarkdownView,
        card: HTMLElement | null
    ): Promise<Record<string, unknown>> {
        const codeMirror = (markdownView.editor as Editor & {
            cm?: CodeMirrorEditorView;
        }).cm;
        if (!(codeMirror instanceof CodeMirrorEditorView)) {
            return { status: "failed", reason: "codemirror-view-not-found" };
        }
        const enableDeadline = Date.now() + 1000;
        while (
            !codeMirror.dom.hasClass("roam-outliner-enabled") &&
            Date.now() < enableDeadline
        ) {
            await new Promise((resolve) => window.setTimeout(resolve, 16));
        }
        if (!codeMirror.dom.hasClass("roam-outliner-enabled")) {
            return { status: "failed", reason: "outliner-not-enabled" };
        }

        const sourceBefore = markdownView.editor.getValue();
        const lines = sourceBefore.split("\n");
        const childLine = lines.findIndex((line) => line.includes("- child block"));
        if (childLine < 0) {
            return { status: "failed", reason: "child-fixture-not-found" };
        }
        const selection = createBlockSelection(childLine);
        const expectedMarkdown = serializeBlockSelection(lines, selection);
        const expectedRange = resolveBlockSelection(lines, selection);
        if (!expectedMarkdown || !expectedRange) {
            return { status: "failed", reason: "child-selection-not-resolved" };
        }

        const childDocumentLine = codeMirror.state.doc.line(childLine + 1);
        const childLineDom = codeMirror.domAtPos(childDocumentLine.from).node;
        const childLineElement =
            childLineDom.instanceOf(Element)
                ? childLineDom.closest(".cm-line")
                : childLineDom.parentElement?.closest(".cm-line") ?? null;
        const blockMarker = childLineElement?.querySelector(
            ".list-bullet, .cm-formatting-list"
        );
        if (!blockMarker?.instanceOf(HTMLElement)) {
            return { status: "failed", reason: "block-marker-not-found" };
        }
        const pointerDownEvent = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        const pointerDownDispatchResult = blockMarker.dispatchEvent(
            pointerDownEvent
        );
        const pointerClickEvent = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
        });
        const pointerClickDispatchResult = blockMarker.dispatchEvent(
            pointerClickEvent
        );
        const pointerSelectedState = codeMirror.state.field(
            outlinerBlockSelectionField,
            false
        );

        codeMirror.dispatch({
            effects: setOutlinerBlockSelection.of(selection),
        });
        const selectedLineCount = card?.querySelectorAll(
            ".cm-line.roam-outliner-block-selected"
        ).length ?? 0;
        const selectedState = codeMirror.state.field(
            outlinerBlockSelectionField,
            false
        );

        const copyTransfer = new DataTransfer();
        const copyEvent = new ClipboardEvent("copy", {
            bubbles: true,
            cancelable: true,
            clipboardData: copyTransfer,
        });
        const copyDispatchResult = codeMirror.contentDOM.dispatchEvent(copyEvent);
        const copiedMarkdown = copyTransfer.getData("text/plain");
        const copyClearedSelection =
            codeMirror.state.field(outlinerBlockSelectionField, false) === null;

        codeMirror.dispatch({
            effects: setOutlinerBlockSelection.of(selection),
        });
        const cutTransfer = new DataTransfer();
        const cutEvent = new ClipboardEvent("cut", {
            bubbles: true,
            cancelable: true,
            clipboardData: cutTransfer,
        });
        const cutDispatchResult = codeMirror.contentDOM.dispatchEvent(cutEvent);
        const sourceAfterCut = markdownView.editor.getValue();
        const cutRemovedCompleteSubtree = expectedMarkdown
            .split("\n")
            .every((line) => !sourceAfterCut.includes(line.trim()));
        markdownView.editor.undo();
        const sourceAfterUndo = markdownView.editor.getValue();
        const passed =
            pointerSelectedState?.anchorLine === childLine &&
            pointerDownDispatchResult === false &&
            pointerDownEvent.defaultPrevented &&
            pointerClickDispatchResult === false &&
            pointerClickEvent.defaultPrevented &&
            selectedState?.anchorLine === childLine &&
            selectedLineCount === expectedRange.toLine - expectedRange.fromLine + 1 &&
            copyDispatchResult === false &&
            copyEvent.defaultPrevented &&
            copiedMarkdown === expectedMarkdown &&
            copyClearedSelection &&
            cutDispatchResult === false &&
            cutEvent.defaultPrevented &&
            cutTransfer.getData("text/plain") === expectedMarkdown &&
            cutRemovedCompleteSubtree &&
            sourceAfterUndo === sourceBefore;

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : "block-selection-transaction-mismatch",
            childLine,
            markerClassName: blockMarker.className,
            pointerDownDispatchResult,
            pointerDownDefaultPrevented: pointerDownEvent.defaultPrevented,
            pointerClickDispatchResult,
            pointerClickDefaultPrevented: pointerClickEvent.defaultPrevented,
            pointerSelectedAnchorLine: pointerSelectedState?.anchorLine ?? null,
            expectedRange,
            selectedLineCount,
            copiedMarkdown,
            expectedMarkdown,
            copyDispatchResult,
            copyDefaultPrevented: copyEvent.defaultPrevented,
            copyClearedSelection,
            cutDispatchResult,
            cutDefaultPrevented: cutEvent.defaultPrevented,
            cutClipboardMarkdown: cutTransfer.getData("text/plain"),
            cutRemovedCompleteSubtree,
            undoRestoredSource: sourceAfterUndo === sourceBefore,
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
        const orderedListPaste = normalizeOutlinerPaste(
            "1. first\n   2. second"
        );
        const nestedContextPaste = adaptPasteToListContext(
            mixedIndentPaste.text,
            "\t- ",
            3
        );
        const childPastePlan = planListContextPaste(
            "- child\n  - grandchild\n- sibling",
            "- parent",
            8
        );
        const paragraphPastePlan = planListContextPaste(
            "alpha\nbeta",
            "plain paragraph",
            4
        );
        const selectionLines = [
            "- parent",
            "\t- child",
            "\t\t- grandchild",
            "- sibling",
            "\t- sibling child",
        ];
        const childSelection = createBlockSelection(1);
        const childSelectionRange = resolveBlockSelection(
            selectionLines,
            childSelection
        );
        const childSelectionMarkdown = serializeBlockSelection(
            selectionLines,
            childSelection
        );
        const expandedSelection = adjustBlockSelection(
            selectionLines,
            createBlockSelection(0),
            "down"
        );
        const expandedSelectionRange = expandedSelection
            ? resolveBlockSelection(selectionLines, expandedSelection)
            : null;
        const passed =
            paragraphPaste.changed === true &&
            paragraphPaste.text === "- alpha\n- beta" &&
            singleLinePaste.changed === true &&
            singleLinePaste.text === "- alpha" &&
            singleLinePaste.reason === "single-line" &&
            normalizedListPaste.changed === false &&
            normalizedListPaste.reason === "unchanged" &&
            mixedIndentPaste.text === "- alpha\n\t- beta\n\t\t- gamma" &&
            wrappedListPaste.text ===
                "- parent copied from the web wrapped continuation\n\t- child child continuation" &&
            driftedIndentPaste.text ===
                "- root\n- root drift\n\t- child\n\t- child drift" &&
            orderedListPaste.text === "- first\n\t- second" &&
            nestedContextPaste ===
                "\t- alpha\n\t\t- beta\n\t\t\t- gamma" &&
            childPastePlan?.placement === "insert-children" &&
            childPastePlan.insert ===
                "\n\t- child\n\t\t- grandchild\n\t- sibling" &&
            paragraphPastePlan === null &&
            childSelectionRange?.fromLine === 1 &&
            childSelectionRange.toLine === 2 &&
            childSelectionMarkdown === "- child\n\t- grandchild" &&
            expandedSelectionRange?.fromLine === 0 &&
            expandedSelectionRange.toLine === 4 &&
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
            orderedListPaste,
            nestedContextPaste,
            childPastePlan,
            paragraphPastePlan,
            blockSelection: {
                childSelectionRange,
                childSelectionMarkdown,
                expandedSelectionRange,
            },
            protectedTablePaste,
            module: this.outlinerModule?.getAuditState() ?? null,
            scope: "Built-in Outliner uses a Stream context state field; external Outliner pauses duplicate keys and decorations while list-context paste normalization remains active.",
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
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
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
            buildFingerprint: {
                head: import.meta.env.VITE_JOURNAL_STREAM_BUILD_HEAD,
                dirty:
                    import.meta.env.VITE_JOURNAL_STREAM_BUILD_DIRTY === "true",
                sourceStateHash:
                    import.meta.env.VITE_JOURNAL_STREAM_SOURCE_STATE_HASH,
                buildId: import.meta.env.VITE_JOURNAL_STREAM_BUILD_ID,
                builtAt: import.meta.env.VITE_JOURNAL_STREAM_BUILD_TIME,
                manifestId: import.meta.env.VITE_JOURNAL_STREAM_MANIFEST_ID,
                manifestVersion:
                    import.meta.env.VITE_JOURNAL_STREAM_MANIFEST_VERSION,
            },
            obsidianVersion: this.getRuntimeObsidianVersionForAudit(),
            vaultRoot:
                this.app.vault.adapter instanceof FileSystemAdapter
                    ? this.app.vault.adapter.getBasePath()
                    : this.app.vault.getName(),
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
            },
            processId: this.getRendererProcessId(),
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

    async checkJournalStreamUiAuditRequest(
        requestPath = `.obsidian/plugins/${this.manifest.id}/ui-audit-request.json`
    ) {
        if (this.isProcessingUiAuditRequest) return;
        if (!(await this.app.vault.adapter.exists(requestPath))) return;
        let consumeRequest = false;
        try {
            const {
                runId,
                requestedAt,
                listHeadingAudit,
                pageStreamAudit,
                blockLinkAudit,
                targetProcessId,
            } = await this.readJournalStreamUiAuditRequest(requestPath);
            if (
                targetProcessId !== undefined &&
                targetProcessId !== this.getRendererProcessId()
            ) {
                return;
            }
            const requestedAtMs = requestedAt ? Date.parse(requestedAt) : Number.NaN;
            if (
                Number.isFinite(requestedAtMs) &&
                Date.now() - requestedAtMs > 10 * 60 * 1000
            ) {
                consumeRequest = true;
                await this.writeAuditDebug("audit-request-expired", {
                    runId,
                    requestPath,
                    requestedAt,
                });
                return;
            }
            if (this.processedUiAuditRequests.get(requestPath) === runId) return;

            await this.writeAuditDebug("audit-request-read", {
                runId,
                lastUiAuditRequestId: this.lastUiAuditRequestId,
                listHeadingAudit,
                pageStreamAudit,
                blockLinkAudit,
                requestPath,
            });

            this.lastUiAuditRequestId = runId;
            this.processedUiAuditRequests.set(requestPath, runId);
            this.isProcessingUiAuditRequest = true;
            consumeRequest = true;
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
            await this.writeJournalStreamUiAuditPayload(
                `.obsidian/plugins/${this.manifest.id}/ui-audit-latest.json`,
                {
                runId,
                    status: "failed",
                    reason: "legacy-journal-audit-removed",
                }
            );
        } catch (error) {
            console.error("Failed to process Journal Stream UI audit request:", error);
            await this.writeAuditDebug("audit-request-error", {
                reason: error instanceof Error ? error.message : String(error),
            });
        } finally {
            this.isProcessingUiAuditRequest = false;
            if (consumeRequest) {
                try {
                    if (await this.app.vault.adapter.exists(requestPath)) {
                        await this.app.vault.adapter.remove(requestPath);
                    }
                } catch (error) {
                    console.error("Failed to consume Journal Stream audit request:", error);
                }
            }
        }
    }

    private async checkAllJournalStreamUiAuditRequests(): Promise<void> {
        await this.checkJournalStreamUiAuditRequest();
        const processId = this.getRendererProcessId();
        if (!processId) return;
        await this.checkJournalStreamUiAuditRequest(
            `.obsidian/plugins/${this.manifest.id}/ui-audit-request-${processId}.json`
        );
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
        requestedAt?: string;
        openDefaultView: boolean;
        targetFolder?: string;
        selectedRange?: TimeRange;
        copyExport?: boolean;
            settingsToggle?: boolean;
            previewEditSave?: boolean;
            auditTargetReadiness?: boolean;
            previewEditTransactionCleanup?: boolean;
            productReadyBaseline?: boolean;
            externalChangeReload?: boolean;
            renameRefresh?: boolean;
            listHeadingAudit?: boolean;
            pageStreamAudit?: boolean;
            blockLinkAudit?: boolean;
            performanceAudit?: boolean;
            targetProcessId?: number;
        }> {
        if (!(await this.app.vault.adapter.exists(requestPath))) {
            return { runId: "manual", openDefaultView: false };
        }

        const request = JSON.parse(
            await this.app.vault.adapter.read(requestPath)
        ) as {
            runId?: unknown;
            requestedAt?: unknown;
            openDefaultView?: unknown;
            targetFolder?: unknown;
            selectedRange?: unknown;
            copyExport?: unknown;
            settingsToggle?: unknown;
            previewEditSave?: unknown;
            auditTargetReadiness?: unknown;
            previewEditTransactionCleanup?: unknown;
            productReadyBaseline?: unknown;
            externalChangeReload?: unknown;
            renameRefresh?: unknown;
            listHeadingAudit?: unknown;
            pageStreamAudit?: unknown;
            blockLinkAudit?: unknown;
            performanceAudit?: unknown;
            targetProcessId?: unknown;
        };
        const runId =
            typeof request.runId === "string" && request.runId.trim()
                ? request.runId
                : "default";
        return {
            runId,
            requestedAt:
                typeof request.requestedAt === "string" && request.requestedAt.trim()
                    ? request.requestedAt
                    : undefined,
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
            auditTargetReadiness: request.auditTargetReadiness === true,
            previewEditTransactionCleanup:
                request.previewEditTransactionCleanup === true,
            productReadyBaseline: request.productReadyBaseline === true,
            externalChangeReload: request.externalChangeReload === true,
            renameRefresh: request.renameRefresh === true,
            listHeadingAudit: request.listHeadingAudit === true,
            pageStreamAudit: request.pageStreamAudit === true,
            blockLinkAudit: request.blockLinkAudit === true,
            performanceAudit: request.performanceAudit === true,
            targetProcessId:
                typeof request.targetProcessId === "number" &&
                Number.isInteger(request.targetProcessId) &&
                request.targetProcessId > 0
                    ? request.targetProcessId
                    : undefined,
        };
    }

    private getRendererProcessId(): number | null {
        const processId = (
            window as Window & { process?: { pid?: unknown } }
        ).process?.pid;
        return typeof processId === "number" ? processId : null;
    }

    private getRuntimeObsidianVersionForAudit(): string {
        const appWithVersion = this.app as unknown as {
            getVersion?: () => unknown;
        };
        const apiVersion = appWithVersion.getVersion?.();
        if (typeof apiVersion === "string" && apiVersion.trim()) {
            return apiVersion;
        }

        const titleMatch = document.title.match(/Obsidian\s+([0-9]+(?:\.[0-9]+)+)/i);
        return titleMatch?.[1] ?? "unknown";
    }

    async openListHeadingViewForAudit(): Promise<RoamListHeadingView | null> {
        await this.openListHeadingView();
        const leaf = this.app.workspace.getLeavesOfType(ROAM_LIST_HEADING_VIEW_TYPE)[0];
        return leaf?.view instanceof RoamListHeadingView ? leaf.view : null;
    }

    public async loadSettings() {
        const storedSettings: unknown = await this.loadData();
        this.settings = restoreDailyNoteSettings(storedSettings, DEFAULT_SETTINGS);
        if (
            !isRecord(storedSettings) ||
            "journalEngine" in storedSettings ||
            "journalV2Rollout" in storedSettings
        ) {
            await this.saveData(this.settings);
        }
    }

    private recordRecentFile(file: TFile): void {
        if (file.extension !== "md") return;
        const next = recordRecentPath(this.settings.recentFiles, file.path);
        if (next === this.settings.recentFiles) return;
        this.settings.recentFiles = next;
        this.promoteRecentFileInViews(file);
        this.persistRecentFiles();
    }

    private recordRecentTask(editor: Editor, file: TFile): void {
        if (!this.settings.showRecentTasks || file.extension !== "md") return;
        const next = reconcileRecentTaskRecordsForPath(
            this.settings.recentTaskBlocks,
            file.path,
            editor.getValue(),
            editor.getCursor().line,
            Date.now()
        );
        if (recentTaskRecordsEqual(next, this.settings.recentTaskBlocks)) return;
        this.settings.recentTaskBlocks = next;
        this.refreshRecentTaskViews();
        this.persistRecentTasks();
    }

    private async reconcileRecentTasksForFile(file: TFile): Promise<void> {
        if (!this.settings.showRecentTasks || file.extension !== "md") return;
        const text = await this.app.vault.cachedRead(file);
        const next = reconcileRecentTaskRecordsForPath(
            this.settings.recentTaskBlocks,
            file.path,
            text
        );
        if (recentTaskRecordsEqual(next, this.settings.recentTaskBlocks)) return;
        this.settings.recentTaskBlocks = next;
        this.refreshRecentTaskViews();
        this.persistRecentTasks();
    }

    private async reconcileAllRecentTasks(): Promise<void> {
        let next = this.settings.recentTaskBlocks;
        const paths = new Set(next.map((record) => record.path));
        for (const path of paths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile) || file.extension !== "md") {
                next = removeRecentTaskPath(next, path);
                continue;
            }
            next = reconcileRecentTaskRecordsForPath(
                next,
                path,
                await this.app.vault.cachedRead(file)
            );
        }
        if (recentTaskRecordsEqual(next, this.settings.recentTaskBlocks)) return;
        this.settings.recentTaskBlocks = next;
        this.refreshRecentTaskViews();
        await this.saveSettings();
    }

    private renameRecentTasks(oldPath: string, newPath: string): void {
        const next = renameRecentTaskPath(
            this.settings.recentTaskBlocks,
            oldPath,
            newPath
        );
        if (recentTaskRecordsEqual(next, this.settings.recentTaskBlocks)) return;
        this.settings.recentTaskBlocks = next;
        this.refreshRecentTaskViews();
        this.persistRecentTasks();
    }

    private removeRecentTasks(path: string): void {
        const next = removeRecentTaskPath(this.settings.recentTaskBlocks, path);
        if (recentTaskRecordsEqual(next, this.settings.recentTaskBlocks)) return;
        this.settings.recentTaskBlocks = next;
        this.refreshRecentTaskViews();
        this.persistRecentTasks();
    }

    getRecentTaskBlocks(): readonly RecentTaskBlockRecord[] {
        return this.settings.recentTaskBlocks;
    }

    async openRecentTask(record: RecentTaskBlockRecord): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(record.path);
        if (!(file instanceof TFile) || file.extension !== "md") {
            this.removeRecentTasks(record.path);
            return;
        }
        const resolved = resolveRecentTaskRecord(
            await this.app.vault.cachedRead(file),
            record
        );
        if (!resolved) {
            this.settings.recentTaskBlocks = this.settings.recentTaskBlocks.filter(
                (candidate) => candidate !== record
            );
            this.refreshRecentTaskViews();
            await this.saveSettings();
            new Notice("Recent task could not be safely located.");
            return;
        }

        const updated: RecentTaskBlockRecord = {
            ...record,
            lineHint: resolved.rootLine,
            subtreeSignature: resolved.subtreeSignature,
        };
        this.settings.recentTaskBlocks = this.settings.recentTaskBlocks.map(
            (candidate) => candidate === record ? updated : candidate
        );
        const existing = this.app.workspace
            .getLeavesOfType("markdown")
            .find((leaf) =>
                leaf.view instanceof MarkdownView &&
                leaf.view.file?.path === file.path
            );
        const leaf = existing ?? this.app.workspace.getLeaf(false);
        if (!existing) {
            await leaf.openFile(file, {
                eState: { line: resolved.rootLine },
                active: true,
            });
        } else {
            await this.app.workspace.revealLeaf(leaf);
        }
        if (leaf.view instanceof MarkdownView) {
            const position = { line: resolved.rootLine, ch: 0 };
            leaf.view.editor.setCursor(position);
            leaf.view.editor.scrollIntoView(
                { from: position, to: position },
                true
            );
            leaf.view.editor.focus();
        }
        this.persistRecentTasks();
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

    private refreshRecentTaskViews(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(
            ROAM_NAVIGATION_VIEW_TYPE
        )) {
            if (leaf.view instanceof RoamNavigationView) {
                leaf.view.refreshRecentTasks();
            }
        }
    }

    private promoteRecentFileInViews(file: TFile): void {
        for (const leaf of this.app.workspace.getLeavesOfType(
            ROAM_NAVIGATION_VIEW_TYPE
        )) {
            if (leaf.view instanceof RoamNavigationView) {
                leaf.view.promoteRecentFile(file);
            }
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    notifySettingsChanged() {
        this.outlinerModule?.updateScope();

        if (this.settings.showRecentTasks) void this.reconcileAllRecentTasks();

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

            for (const leaf of this.app.workspace.getLeavesOfType(
                JOURNAL_VIEW_TYPE
            )) {
                if (leaf.view instanceof JournalV2View) {
                    await leaf.view.refreshForNewDay();
                }
            }
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readPageStreamAuditTargets(state: unknown): unknown[] {
    if (!isRecord(state)) return [];
    const targets: unknown = state.targets;
    return Array.isArray(targets) ? targets as unknown[] : [];
}

function recentTaskRecordsEqual(
    left: readonly RecentTaskBlockRecord[],
    right: readonly RecentTaskBlockRecord[]
): boolean {
    if (left.length !== right.length) return false;
    return left.every((record, index) => {
        const candidate = right[index];
        return (
            candidate?.path === record.path &&
            candidate.lineHint === record.lineHint &&
            candidate.normalizedRootText === record.normalizedRootText &&
            candidate.subtreeSignature === record.subtreeSignature &&
            candidate.lastTouchedAt === record.lastTouchedAt
        );
    });
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

function getNestedStringArray(
    record: Record<string, unknown>,
    path: string[]
): string[] {
    let current: unknown = record;
    for (const key of path) {
        if (!isRecord(current)) return [];
        current = current[key];
    }
    return Array.isArray(current)
        ? current.filter((item): item is string => typeof item === "string")
        : [];
}

function getPageStreamEditorDom(
    view: PageStreamView,
    path: string
): Element | null {
    return view.getCardElementForAudit(path)?.querySelector(".cm-editor") ?? null;
}

type RectAuditSnapshot = {
    left: number;
    top: number;
};

function getRectAuditSnapshot(
    element: Element | null | undefined
): RectAuditSnapshot | null {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
}

function numbersWithinTolerance(
    before: number | null,
    after: number | null,
    tolerance: number
): boolean {
    return before !== null && after !== null && Math.abs(before - after) <= tolerance;
}

function rectOriginWithinTolerance(
    before: RectAuditSnapshot | null,
    after: RectAuditSnapshot | null,
    tolerance: number
): boolean {
    return (
        before !== null &&
        after !== null &&
        numbersWithinTolerance(before.left, after.left, tolerance) &&
        numbersWithinTolerance(before.top, after.top, tolerance)
    );
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
    if (typeof value === "symbol" || typeof value === "bigint") {
        return value.toString();
    }
    if (typeof value !== "object") return "[Unsupported audit value]";
    if (value instanceof HTMLElement) {
        return `[HTMLElement:${value.tagName.toLowerCase()}]`;
    }
    if (depth > 12) return "[MaxDepth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeAuditValue(item, seen, depth + 1));
    }
    const prototype = Reflect.getPrototypeOf(value);
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

function getActiveMarkdownAuditState(workspace: Workspace): {
    path: string | null;
    cursor: { line: number; ch: number } | null;
} {
    return getMarkdownLeafAuditState(
        workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null
    );
}
