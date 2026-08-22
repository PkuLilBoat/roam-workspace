import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    setIcon,
    TFile,
    WorkspaceLeaf,
} from "obsidian";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { collectListHeadingItems } from "./listHeadingParser";
import {
    ListHeadingItem,
    ListHeadingMode,
} from "./listHeadingTypes";
import { ROAM_LIST_HEADING_VIEW_TYPE } from "./roamTypes";

const REFRESH_DELAY_MS = 180;

const MODE_OPTIONS: Array<{ mode: ListHeadingMode; label: string }> = [
    { mode: "headings-only", label: "Headings" },
    { mode: "top-indent", label: "Top indent" },
    { mode: "top-two-indent", label: "Two indents" },
];

type RenderedInline = {
    component: Component;
    token: number;
};

export class RoamListHeadingView extends ItemView {
    private mode: ListHeadingMode = "headings-only";
    private refreshTimer: number | null = null;
    private renderedInline = new Map<string, RenderedInline>();
    private inlineRenderToken = 0;
    private lastMainFilePath: string | null = null;
    private refreshRevision = 0;
    private lastRenderSignature = "";

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: DailyNoteViewPlugin
    ) {
        super(leaf);
    }

    getViewType(): string {
        return ROAM_LIST_HEADING_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "List heading";
    }

    getIcon(): string {
        return "list-tree";
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass("roam-list-heading-view");
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                this.trackUserMarkdownFile(leaf);
                this.requestRefresh();
            })
        );
        this.registerEvent(
            this.app.workspace.on("file-open", () => {
                this.trackUserMarkdownFile(this.app.workspace.activeLeaf);
                this.requestRefresh();
            })
        );
        this.registerEvent(
            this.app.workspace.on("editor-change", (_editor, info) => {
                if (!(info instanceof MarkdownView) || !(info.file instanceof TFile)) {
                    return;
                }
                const sourcePath = this.plugin.getOutlineSourcePath();
                if (this.isUserWorkspaceMarkdownView(info)) {
                    this.plugin.setOutlineSourcePath(info.file.path, false);
                    this.lastMainFilePath = info.file.path;
                    this.requestRefresh();
                } else if (info.file.path === sourcePath) {
                    this.requestRefresh();
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                const activeFile = this.getCurrentOutlineFile();
                if (
                    file instanceof TFile &&
                    activeFile instanceof TFile &&
                    file.path === activeFile.path
                ) {
                    this.requestRefresh();
                }
            })
        );
        this.trackUserMarkdownFile(this.app.workspace.activeLeaf);
        void this.refresh();
    }

    async onClose(): Promise<void> {
        this.clearRefreshTimer();
        this.unloadRenderedInline();
    }

    getState(): Record<string, unknown> {
        return {
            mode: this.mode,
        };
    }

    async setState(state: unknown): Promise<void> {
        if (isRecord(state) && isListHeadingMode(state.mode)) {
            this.mode = state.mode;
        }
        await this.refresh();
    }

    setModeForAudit(mode: ListHeadingMode): void {
        this.clearRefreshTimer();
        this.mode = mode;
    }

    async getAuditSnapshotForFile(file: TFile): Promise<Record<string, unknown>> {
        const mode = this.mode;
        const content = await this.readCurrentFileText(file);
        const items = collectListHeadingItems(content, mode);
        await this.refresh();
        return {
            mode,
            filePath: file.path,
            itemCount: items.length,
            kinds: items.map((item) => item.kind),
            titles: items.map((item) => item.title),
            targets: items.map((item) => ({
                kind: item.kind,
                title: item.title,
                line: item.line,
                col: item.col,
                indentDepth: item.indentDepth,
            })),
            dom: {
                itemCount: this.contentEl.querySelectorAll(".roam-list-heading-item").length,
                modeButtonCount: this.contentEl.querySelectorAll(
                    ".roam-list-heading-mode-button"
                ).length,
            },
        };
    }

    requestRefresh(): void {
        this.clearRefreshTimer();
        const revision = ++this.refreshRevision;
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.refresh(revision);
        }, REFRESH_DELAY_MS);
    }

    private async refresh(requestedRevision?: number): Promise<void> {
        const revision = requestedRevision ?? ++this.refreshRevision;
        const file = this.getCurrentOutlineFile();
        let content: string | null = null;
        let readFailed = false;
        if (file instanceof TFile && file.extension === "md") {
            try {
                content = await this.readCurrentFileText(file);
            } catch (error) {
                readFailed = true;
                console.error("Failed to read file for List heading:", error);
            }
        }
        if (revision !== this.refreshRevision) return;

        const items = content === null ? [] : collectListHeadingItems(content, this.mode);
        const signature = buildRenderSignature(file, this.mode, items, readFailed);
        if (signature === this.lastRenderSignature) return;
        this.lastRenderSignature = signature;

        const container = this.contentEl;
        this.unloadRenderedInline();
        container.empty();
        container.addClass("roam-list-heading-view");

        const header = container.createDiv({ cls: "roam-list-heading-header" });
        const titleRow = header.createDiv({ cls: "roam-list-heading-title-row" });
        titleRow.createDiv({ cls: "roam-list-heading-title", text: "List heading" });
        this.renderIconButton(titleRow, "refresh-cw", "Refresh", () => this.requestRefresh());

        this.renderModeSwitch(header);

        if (!(file instanceof TFile) || file.extension !== "md") {
            this.renderEmpty(container, "Open a Markdown file to show its outline.");
            return;
        }

        header.createDiv({ cls: "roam-list-heading-file", text: file.path });

        if (readFailed) {
            this.renderEmpty(container, "Could not read this file.");
            return;
        }

        if (!items.length) {
            this.renderEmpty(container, "No headings found in this file.");
            return;
        }

        const list = container.createDiv({ cls: "roam-list-heading-list" });
        for (const item of items) {
            this.renderItem(list, file, item);
        }
    }

    private renderModeSwitch(parent: HTMLElement): void {
        const switcher = parent.createDiv({
            cls: "roam-list-heading-mode",
            attr: {
                role: "group",
                "aria-label": "List heading mode",
            },
        });

        for (const option of MODE_OPTIONS) {
            const button = switcher.createEl("button", {
                cls: "roam-list-heading-mode-button",
                text: option.label,
                attr: {
                    type: "button",
                    "aria-pressed": String(option.mode === this.mode),
                },
            });
            button.addEventListener("click", () => {
                this.mode = option.mode;
                this.app.workspace.requestSaveLayout();
                void this.refresh();
            });
        }
    }

    private renderItem(
        parent: HTMLElement,
        file: TFile,
        item: ListHeadingItem
    ): void {
        const itemEl = parent.createDiv({
            cls: `roam-list-heading-item roam-list-heading-${item.kind}`,
            attr: {
                role: "button",
                tabindex: "0",
                "aria-label": `${item.title}, line ${item.line + 1}`,
                "data-kind": item.kind,
            },
        });
        itemEl.style.setProperty("--roam-list-indent", `${getVisualIndent(item)}px`);

        const marker = itemEl.createSpan({
            cls: "roam-list-heading-marker",
            text: getMarker(item),
        });
        marker.setAttr("aria-hidden", "true");

        const textEl = itemEl.createSpan({ cls: "roam-list-heading-text" });
        const inlineKey = `${item.line}:${item.col}:${item.title}`;
        void this.renderInlineMarkdown(textEl, file, item, inlineKey);

        itemEl.createSpan({
            cls: "roam-list-heading-line",
            text: String(item.line + 1),
        });

        itemEl.addEventListener("click", (event) => {
            this.handleItemActivation(event, file, item);
        });
        itemEl.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.handleItemActivation(event, file, item);
        });
    }

    private handleItemActivation(
        event: MouseEvent | KeyboardEvent,
        file: TFile,
        item: ListHeadingItem
    ): void {
        if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            void this.plugin.pushFileToPageStream(file, "list-heading", {
                kind: "line",
                line: item.line,
                col: item.col,
                label: item.title,
            });
            return;
        }
        void this.navigateToItem(file, item);
    }

    private async renderInlineMarkdown(
        parent: HTMLElement,
        file: TFile,
        item: ListHeadingItem,
        key: string
    ): Promise<void> {
        const component = new Component();
        const token = ++this.inlineRenderToken;
        component.load();
        this.renderedInline.set(key, { component, token });
        try {
            await MarkdownRenderer.render(
                this.app,
                item.title,
                parent,
                file.path,
                component
            );
            if (!this.isCurrentInlineRender(key, parent, token)) {
                component.unload();
                return;
            }
        } catch {
            if (!this.contentEl.contains(parent)) {
                component.unload();
                this.renderedInline.delete(key);
                return;
            }
            parent.setText(item.title);
            component.unload();
            this.renderedInline.delete(key);
        }
    }

    private isCurrentInlineRender(
        key: string,
        parent: HTMLElement,
        token: number
    ): boolean {
        const rendered = this.renderedInline.get(key);
        return rendered?.token === token && this.contentEl.contains(parent);
    }

    private async navigateToItem(file: TFile, item: ListHeadingItem): Promise<void> {
        let leaf = this.app.workspace
            .getLeavesOfType("markdown")
            .find((candidate) => candidate.view?.file?.path === file.path);

        if (!leaf) {
            leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file, {
                eState: { line: item.line },
                active: true,
            });
        } else {
            await this.app.workspace.revealLeaf(leaf);
        }

        if (leaf.view instanceof MarkdownView) {
            const pos = { line: item.line, ch: item.col };
            leaf.view.editor.setCursor(pos);
            leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
            leaf.view.editor.focus();
        }
    }

    private async readCurrentFileText(file: TFile): Promise<string> {
        const activeView = this.app.workspace.activeLeaf?.view;
        if (
            activeView instanceof MarkdownView &&
            activeView.file instanceof TFile &&
            activeView.file.path === file.path &&
            activeView.editor
        ) {
            return activeView.editor.getValue();
        }

        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (
                view instanceof MarkdownView &&
                view.file instanceof TFile &&
                view.file.path === file.path
            ) {
                return view.editor.getValue();
            }
        }
        return this.app.vault.cachedRead(file);
    }

    private getCurrentOutlineFile(): TFile | null {
        const explicitSourcePath = this.plugin.getOutlineSourcePath();
        if (explicitSourcePath) {
            const explicitFile = this.app.vault.getAbstractFileByPath(explicitSourcePath);
            if (explicitFile instanceof TFile && explicitFile.extension === "md") {
                this.lastMainFilePath = explicitFile.path;
                return explicitFile;
            }
        }

        const activeView = this.app.workspace.activeLeaf?.view;
        if (
            activeView instanceof MarkdownView &&
            activeView.file instanceof TFile &&
            activeView.file.extension === "md" &&
            this.isUserWorkspaceMarkdownView(activeView)
        ) {
            this.lastMainFilePath = activeView.file.path;
            this.plugin.setOutlineSourcePath(activeView.file.path, false);
            return activeView.file;
        }

        if (this.lastMainFilePath) {
            const file = this.app.vault.getAbstractFileByPath(this.lastMainFilePath);
            if (file instanceof TFile && file.extension === "md") return file;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile instanceof TFile && activeFile.extension === "md") {
            this.lastMainFilePath = activeFile.path;
            this.plugin.setOutlineSourcePath(activeFile.path, false);
            return activeFile;
        }

        return null;
    }

    private trackUserMarkdownFile(leaf: WorkspaceLeaf | null): void {
        const activeView = leaf?.view;
        if (
            activeView instanceof MarkdownView &&
            activeView.file instanceof TFile &&
            activeView.file.extension === "md" &&
            this.isUserWorkspaceMarkdownView(activeView)
        ) {
            this.lastMainFilePath = activeView.file.path;
            this.plugin.setOutlineSourcePath(activeView.file.path, false);
        }
    }

    private isUserWorkspaceMarkdownView(view: MarkdownView): boolean {
        return view.containerEl.closest(".dn-leaf-view") === null;
    }

    private renderIconButton(
        parent: HTMLElement,
        iconName: string,
        label: string,
        callback: () => void
    ): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "roam-icon-button",
            attr: {
                type: "button",
                "aria-label": label,
                "data-tooltip-position": "top",
            },
        });
        setIcon(button, iconName);
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            callback();
        });
        return button;
    }

    private renderEmpty(parent: HTMLElement, message: string): void {
        parent.createDiv({
            cls: "roam-list-heading-empty",
            text: message,
        });
    }

    private unloadRenderedInline(): void {
        for (const rendered of this.renderedInline.values()) {
            rendered.component.unload();
        }
        this.renderedInline.clear();
    }

    private clearRefreshTimer(): void {
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}

function getMarker(item: ListHeadingItem): string {
    if (item.kind === "markdown-heading") return "#";
    if (item.kind === "list-heading") return "-";
    return "•";
}

function getVisualIndent(item: ListHeadingItem): number {
    if (item.kind === "indent-block") {
        return Math.max(item.level - 1, 0) * 12;
    }
    return Math.max(item.level - 1, 0) * 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isListHeadingMode(value: unknown): value is ListHeadingMode {
    return (
        value === "headings-only" ||
        value === "top-indent" ||
        value === "top-two-indent"
    );
}

function buildRenderSignature(
    file: TFile | null,
    mode: ListHeadingMode,
    items: ListHeadingItem[],
    readFailed: boolean
): string {
    return JSON.stringify({
        path: file?.path ?? null,
        mode,
        readFailed,
        items: items.map((item) => [
            item.kind,
            item.title,
            item.line,
            item.col,
            item.level,
            item.indentDepth,
        ]),
    });
}
