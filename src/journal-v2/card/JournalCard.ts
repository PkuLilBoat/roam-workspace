import { setIcon } from "obsidian";
import type { JournalProjectionItem } from "../contracts";

export interface JournalCardCallbacks {
    onActivateVirtual(key: string): void;
    onConflictAction(
        key: string,
        action: "copy-close" | "discard" | "keep-current" | "reload-disk" | "restore"
    ): void;
    onFocusChange(key: string, focused: boolean): void;
    onLocalEdit(key: string): void;
    onOpenSource(key: string): void;
    onToggleCollapsed(key: string): void;
}

let nextCardId = 0;

export class JournalCard {
    readonly rootEl: HTMLElement;
    private readonly bodyEl: HTMLElement;
    private readonly collapseButtonEl: HTMLButtonElement;
    private readonly dateEl: HTMLElement;
    private readonly dateIconEl: HTMLElement;
    private readonly editorSlotEl: HTMLElement;
    private readonly conflictActionsEl: HTMLElement;
    private readonly conflictEl: HTMLElement;
    private readonly conflictDraftEl: HTMLElement;
    private readonly conflictMessageEl: HTMLElement;
    private readonly saveStatusEl: HTMLElement;
    private readonly sourceButtonEl: HTMLButtonElement;
    private readonly virtualActionEl: HTMLButtonElement;
    private placeholderEl: HTMLElement;
    private collapsed = false;
    private item: JournalProjectionItem;

    constructor(
        containerEl: HTMLElement,
        item: JournalProjectionItem,
        callbacks: JournalCardCallbacks
    ) {
        this.item = item;
        this.rootEl = containerEl.createDiv({ cls: "journal-v2__card" });
        const headerEl = this.rootEl.createDiv({
            cls: "journal-v2__card-header",
        });
        this.collapseButtonEl = headerEl.createEl("button", {
            attr: { type: "button" },
            cls: "journal-v2__collapse-button clickable-icon",
        });
        this.sourceButtonEl = headerEl.createEl("button", {
            attr: { type: "button" },
            cls: "journal-v2__source-button clickable-icon",
        });
        setIcon(this.sourceButtonEl, "book-open");
        this.dateIconEl = headerEl.createSpan({
            attr: { "aria-hidden": "true" },
            cls: "journal-v2__date-icon",
        });
        setIcon(this.dateIconEl, "book-open");
        this.dateEl = headerEl.createEl("h3", {
            cls: "journal-v2__card-date",
        });
        this.bodyEl = this.rootEl.createDiv({ cls: "journal-v2__card-body" });
        this.bodyEl.id = `journal-v2-card-body-${++nextCardId}`;
        this.collapseButtonEl.setAttribute("aria-controls", this.bodyEl.id);
        this.editorSlotEl = this.bodyEl.createDiv({
            cls: "journal-v2__editor-slot",
        });
        this.virtualActionEl = this.bodyEl.createEl("button", {
            attr: { type: "button" },
            cls: "journal-v2__virtual-action",
            text: "Start writing",
        });
        this.conflictEl = this.bodyEl.createDiv({
            attr: { role: "alert" },
            cls: "journal-v2__conflict",
        });
        this.conflictMessageEl = this.conflictEl.createEl("p");
        this.conflictDraftEl = this.conflictEl.createEl("pre", {
            cls: "journal-v2__conflict-draft",
        });
        this.conflictActionsEl = this.conflictEl.createDiv({
            cls: "journal-v2__conflict-actions",
        });
        for (const [action, label] of [
            ["keep-current", "Keep current"],
            ["reload-disk", "Reload from disk"],
            ["restore", "Restore file"],
            ["copy-close", "Copy & close"],
            ["discard", "Discard"],
        ] as const) {
            const button = this.conflictActionsEl.createEl("button", {
                attr: { type: "button" },
                text: label,
            });
            button.dataset.conflictAction = action;
            button.addEventListener("click", () => {
                callbacks.onConflictAction(this.item.key, action);
            });
        }
        this.conflictEl.hidden = true;
        this.placeholderEl = this.bodyEl.createEl("p", {
            cls: "journal-v2__card-placeholder",
        });
        this.saveStatusEl = this.bodyEl.createDiv({
            attr: { "aria-live": "polite", role: "status" },
            cls: "journal-v2__save-status",
        });
        this.collapseButtonEl.addEventListener("click", () => {
            callbacks.onToggleCollapsed(this.item.key);
        });
        this.sourceButtonEl.addEventListener("click", () => {
            callbacks.onOpenSource(this.item.key);
        });
        this.virtualActionEl.addEventListener("click", () => {
            callbacks.onActivateVirtual(this.item.key);
        });
        this.rootEl.addEventListener("focusin", () => {
            callbacks.onFocusChange(this.item.key, true);
        });
        this.rootEl.addEventListener("input", () => {
            callbacks.onLocalEdit(this.item.key);
        });
        this.rootEl.addEventListener("focusout", (event) => {
            const ownerWindow = this.rootEl.ownerDocument.defaultView;
            if (
                ownerWindow &&
                event.relatedTarget instanceof ownerWindow.Node &&
                this.rootEl.contains(event.relatedTarget)
            ) {
                return;
            }
            callbacks.onFocusChange(this.item.key, false);
        });
        this.update(item);
        this.setCollapsed(false);
        this.setEditorStatus(item.isVirtualToday ? "virtual" : "waiting");
    }

    update(item: JournalProjectionItem): void {
        this.item = item;
        this.rootEl.dataset.journalKey = item.key;
        this.rootEl.dataset.path = item.path;
        this.rootEl.toggleClass("is-virtual-today", item.isVirtualToday);
        this.dateEl.setText(item.dateLabel);
        this.sourceButtonEl.hidden = item.isVirtualToday || !item.file;
        this.dateIconEl.hidden = !item.isVirtualToday;
        this.sourceButtonEl.setAttribute(
            "aria-label",
            `Open source file for ${item.dateLabel}`
        );
        this.sourceButtonEl.setAttribute(
            "title",
            `Open source file for ${item.dateLabel}`
        );
        if (item.isVirtualToday) this.virtualActionEl.setText("Start writing");
        this.placeholderEl.setText(
            item.isVirtualToday
                ? "Start writing will be enabled with editor mounting."
                : "Waiting to mount editor."
        );
        if (item.isVirtualToday) this.setEditorStatus("virtual");
    }

    getItem(): JournalProjectionItem {
        return this.item;
    }

    getEditorSlot(): HTMLElement {
        return this.editorSlotEl;
    }

    isCollapsed(): boolean {
        return this.collapsed;
    }

    setCollapsed(collapsed: boolean): void {
        this.collapsed = collapsed;
        this.rootEl.toggleClass("is-collapsed", collapsed);
        this.bodyEl.hidden = collapsed;
        this.collapseButtonEl.setAttribute("aria-expanded", String(!collapsed));
        this.collapseButtonEl.setAttribute(
            "aria-label",
            `${collapsed ? "Expand" : "Collapse"} ${this.item.dateLabel}`
        );
        setIcon(this.collapseButtonEl, collapsed ? "chevron-right" : "chevron-down");
    }

    setEditorStatus(
        status: "conflict" | "error" | "loading" | "ready" | "virtual" | "waiting"
    ): void {
        this.rootEl.dataset.editorStatus = status;
        this.virtualActionEl.hidden = status !== "virtual";
        this.placeholderEl.hidden = status === "ready" || status === "conflict";
        if (status === "virtual") this.placeholderEl.hidden = true;
        if (status === "waiting") {
            this.placeholderEl.setText("Waiting to mount editor.");
        }
        if (status === "loading") this.placeholderEl.setText("Loading editor…");
        if (status === "error") {
            this.placeholderEl.setText(
                "Editor unavailable. Refresh journal to try again."
            );
        }
        if (status === "virtual") {
            this.placeholderEl.setText(
                "Start writing will be enabled with editor mounting."
            );
        }
    }

    clearConflict(): void {
        this.conflictEl.hidden = true;
    }

    setRecoveryBusy(busy: boolean): void {
        this.conflictEl.setAttribute("aria-busy", String(busy));
        for (const button of Array.from(
            this.conflictActionsEl.querySelectorAll<HTMLButtonElement>("button")
        )) {
            button.disabled = busy;
        }
    }

    setSaveStatus(status: string): void {
        const routine = [
            "Added", "Renamed", "Saved", "Saving…", "Saving recovery…", "Synced",
        ].includes(status);
        this.saveStatusEl.hidden = routine;
        this.saveStatusEl.setText(routine ? "" : status);
    }

    setVirtualError(message: string): void {
        this.setEditorStatus("virtual");
        this.setSaveStatus(message);
        this.virtualActionEl.setText("Try again");
    }

    showConflict(kind: "deleted" | "modified", draft: string): void {
        this.setEditorStatus("conflict");
        this.conflictEl.hidden = false;
        this.conflictDraftEl.setText(draft);
        this.conflictMessageEl.setText(
            kind === "deleted"
                ? "This file was deleted outside Journal while local edits were pending."
                : "This file changed outside Journal while local edits were pending."
        );
        for (const button of Array.from(
            this.conflictActionsEl.querySelectorAll<HTMLButtonElement>("button")
        )) {
            const action = button.dataset.conflictAction;
            button.hidden = kind === "deleted"
                ? action !== "restore" && action !== "copy-close" && action !== "discard"
                : action !== "keep-current" && action !== "reload-disk";
        }
        this.setSaveStatus("Conflict requires a choice");
    }

    destroy(): void {
        this.rootEl.remove();
    }
}
