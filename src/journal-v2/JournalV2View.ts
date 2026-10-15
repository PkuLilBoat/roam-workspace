import {
    ItemView,
    Notice,
    ViewStateResult,
    WorkspaceLeaf,
} from "obsidian";
import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
import type { SelectionMode, TimeField, TimeRange } from "../types/time";
import { restoreJournalStreamState } from "../utils/viewState";
import {
    buildJournalExportMarkdown,
    copyMarkdownToClipboard,
    readJournalExportEntries,
} from "../utils/journalExport";
import { StreamSearchModal } from "../streamSearchModal";
import { JournalV2Controller } from "./JournalV2Controller";
import type { JournalQuery } from "./contracts";
import { JOURNAL_VIEW_TYPE } from "./routing";
import {
    showJournalRangeMenu,
    showJournalSourceMenu,
    showJournalTimeFieldMenu,
} from "./toolbar/JournalV2Menus";

export class JournalV2View extends ItemView {
    customRange: { start: Date; end: Date } | null = null;
    selectionMode: SelectionMode = "folder";
    selectedRange: TimeRange;
    target: string;
    timeField: TimeField = "journalDate";
    private controller?: JournalV2Controller;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly host: DailyNoteViewPlugin
    ) {
        super(leaf);
        this.selectedRange = host.settings.initialRange;
        this.target = host.settings.journalFolder;
    }

    getViewType(): string {
        return JOURNAL_VIEW_TYPE;
    }

    getDisplayText(): string {
        if (this.selectionMode === "daily") return "Daily notes";
        if (this.selectionMode === "tag") return `Tag: ${this.target}`;
        return this.target === this.host.settings.journalFolder
            ? `Journal: ${this.target}`
            : `Folder: ${this.target}`;
    }

    getIcon(): string {
        return "calendar-range";
    }

    getState(): Record<string, unknown> {
        return {
            ...super.getState(),
            selectionMode: this.selectionMode,
            target: this.target,
            timeField: this.timeField,
            selectedRange: this.selectedRange,
            customRange: this.customRange,
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        const restoredState = restoreJournalStreamState(state, {
            initialRange: this.host.settings.initialRange,
        });
        this.selectionMode = restoredState.selectionMode;
        this.target = restoredState.target || this.host.settings.journalFolder;
        this.timeField = restoredState.timeField;
        this.selectedRange = restoredState.selectedRange;
        this.customRange = restoredState.customRange;
        const controller = this.ensureController();
        try {
            if (!await controller.setQuery(this.getQuery())) return;
        } catch (error) {
            if (!controller.getPendingQuery()) {
                this.restoreAcceptedQuery(controller.getCurrentQuery());
            }
            this.reportSourceError(error, "Journal source could not load");
        }
        this.updateLeafIdentity();
    }

    async onOpen(): Promise<void> {
        this.scope?.register(["Mod"], "f", (event) => {
            event.preventDefault();
            this.openStreamSearch();
        });
        this.addAction("search", "Search journal stream", () => {
            this.openStreamSearch();
        });
        this.addAction("clock", "Select time field", (event) => {
            showJournalTimeFieldMenu(event, this.timeField, (field) => {
                void this.setTimeField(field);
            });
        });
        this.addAction("layers-2", "Select view mode", (event) => {
            showJournalSourceMenu(
                this.app,
                event,
                { mode: this.selectionMode, target: this.target },
                this.host.settings.preset.map((preset) => ({
                    mode: preset.type,
                    target: preset.target,
                })),
                (choice) => {
                    void this.setSelectionMode(choice.mode, choice.target);
                }
            );
        });
        this.addAction("calendar-range", "Select date range", (event) => {
            showJournalRangeMenu(
                this.app,
                event,
                this.selectedRange,
                (range, customRange) => {
                    void this.setSelectedRange(range, customRange ?? null);
                }
            );
        });
        if (this.host.settings.enableExportMarkdown) {
            this.addAction("copy", "Copy journal stream as Markdown", () => {
                void this.copyCurrentJournalMarkdown();
            });
        }
        this.addAction("refresh-cw", "Refresh journal", () => {
            void this.refreshWithNotice();
        });
        await this.refreshWithNotice();
        this.updateLeafIdentity();
    }

    async copyCurrentJournalMarkdown(): Promise<void> {
        const files = this.ensureController().getSourceFiles();
        if (files.length === 0) {
            new Notice("No journal files to export");
            return;
        }
        try {
            const entries = await readJournalExportEntries(
                files,
                (file) => this.app.vault.cachedRead(file)
            );
            const markdown = buildJournalExportMarkdown(entries, this.getQuery());
            const clipboard = this.contentEl.ownerDocument.defaultView?.navigator.clipboard;
            await copyMarkdownToClipboard(clipboard, markdown);
            new Notice(`Copied ${entries.length} files`);
        } catch (error) {
            console.error("Failed to copy Journal V2 Markdown:", error);
            new Notice("Failed to copy journal stream Markdown");
        }
    }

    async onClose(): Promise<void> {
        this.controller?.dispose();
        this.controller = undefined;
        this.contentEl.removeClass("journal-v2");
        this.contentEl.empty();
    }

    async refreshForNewDay(): Promise<void> {
        await this.refreshWithNotice();
    }

    private ensureController(): JournalV2Controller {
        if (this.controller) return this.controller;

        this.contentEl.empty();
        this.contentEl.addClass("journal-v2");
        const listEl = this.contentEl.createDiv({ cls: "journal-v2__card-list" });
        this.controller = new JournalV2Controller(
            this.host,
            this.leaf,
            listEl,
            this.host.settings.journalFolder,
            this.getQuery()
        );
        return this.controller;
    }

    private openStreamSearch(): void {
        const controller = this.ensureController();
        const files = controller.getSourceFiles();
        new StreamSearchModal(
            this.app,
            files.map((file) => ({
                path: file.path,
                title: file.basename,
                read: () => this.app.vault.cachedRead(file),
                activate: async () => {
                    await controller.revealPath(file.path);
                },
            })),
            "Search journal stream"
        ).open();
    }

    private async setSelectedRange(
        range: TimeRange,
        customRange: { start: Date; end: Date } | null
    ): Promise<void> {
        this.selectedRange = range;
        this.customRange = range === "custom" ? customRange : null;
        await this.applyQueryChange();
    }

    private async setSelectionMode(
        mode: SelectionMode,
        target: string
    ): Promise<void> {
        this.selectionMode = mode;
        this.target = mode === "daily" ? "" : target;
        if (this.selectedRange === "custom") {
            this.selectedRange = this.host.settings.initialRange;
            this.customRange = null;
        }
        await this.applyQueryChange();
    }

    private async setTimeField(field: TimeField): Promise<void> {
        this.timeField = field;
        await this.applyQueryChange();
    }

    private async applyQueryChange(): Promise<void> {
        const controller = this.ensureController();
        try {
            if (!await controller.setQuery(this.getQuery())) return;
        } catch (error) {
            if (!controller.getPendingQuery()) {
                this.restoreAcceptedQuery(controller.getCurrentQuery());
            }
            this.reportSourceError(error, "Journal source could not load; keeping previous view");
            this.updateLeafIdentity();
            return;
        }
        this.updateLeafIdentity();
        this.app.workspace.requestSaveLayout();
    }

    private async refreshWithNotice(): Promise<void> {
        const controller = this.ensureController();
        try {
            if (await controller.refresh()) {
                this.restoreAcceptedQuery(controller.getCurrentQuery());
                this.updateLeafIdentity();
            }
        } catch (error) {
            if (!controller.getPendingQuery()) {
                this.restoreAcceptedQuery(controller.getCurrentQuery());
                this.updateLeafIdentity();
            }
            this.reportSourceError(error, "Journal refresh failed; use Refresh to retry");
        }
    }

    private restoreAcceptedQuery(query: JournalQuery): void {
        this.selectionMode = query.selectionMode;
        this.target = query.target;
        this.timeField = query.timeField;
        this.selectedRange = query.selectedRange;
        this.customRange = query.customRange;
    }

    private reportSourceError(error: unknown, message: string): void {
        console.error(message, error);
        new Notice(message);
    }

    private updateLeafIdentity(): void {
        const leaf = this.leaf as WorkspaceLeaf & {
            updateHeader?: () => void;
        };
        const displayText = this.getDisplayText();
        if (typeof leaf.updateHeader === "function") leaf.updateHeader();
        this.titleEl?.setText(displayText);
        leaf.containerEl
            .querySelector<HTMLElement>(".view-header-title")
            ?.setText(displayText);
    }

    private getQuery(): JournalQuery {
        return {
            selectionMode: this.selectionMode,
            target: this.target,
            timeField: this.timeField,
            selectedRange: this.selectedRange,
            customRange: this.customRange,
        };
    }
}
