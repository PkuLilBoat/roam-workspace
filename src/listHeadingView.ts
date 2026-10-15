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
import {
    collectListHeadingItems,
    getListHeadingDescendantEnds,
    getListHeadingItemKeys,
    parseListHeadingItems,
    reconcileListHeadingCollapsedKeys,
    summarizeListHeadingDepths,
} from "./listHeadingParser";
import type { ListHeadingDepthSummary } from "./listHeadingParser";
import {
    isListHeadingDepth,
    LIST_HEADING_DEPTHS,
    restoreListHeadingDepth,
} from "./listHeadingTypes";
import type { ListHeadingDepth, ListHeadingItem } from "./listHeadingTypes";
import { ROAM_LIST_HEADING_VIEW_TYPE } from "./roamTypes";

const REFRESH_DELAY_MS = 180;

type RenderedInline = {
    component: Component;
    token: number;
};

export class RoamListHeadingView extends ItemView {
    private depth: ListHeadingDepth = 0;
    private refreshTimer: number | null = null;
    private renderedInline = new Map<string, RenderedInline>();
    private inlineRenderToken = 0;
    private lastMainFilePath: string | null = null;
    private refreshRevision = 0;
    private lastRenderSignature = "";
    private collapsedItems = new Set<string>();
    private foldSourcePath: string | null = null;
    private foldItemKeys: string[] = [];

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
                this.trackUserMarkdownView(
                    leaf?.view instanceof MarkdownView ? leaf.view : null
                );
                this.requestRefresh();
            })
        );
        this.registerEvent(
            this.app.workspace.on("file-open", () => {
                this.trackUserMarkdownView(
                    this.getActiveMarkdownView()
                );
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
        this.trackUserMarkdownView(
            this.getActiveMarkdownView()
        );
        void this.refresh();
    }

    async onClose(): Promise<void> {
        this.clearRefreshTimer();
        this.unloadRenderedInline();
    }

    getState(): Record<string, unknown> {
        return {
            depth: this.depth,
        };
    }

    async setState(state: unknown): Promise<void> {
        this.depth = restoreListHeadingDepth(state);
        await this.refresh();
    }

    setDepthForAudit(depth: ListHeadingDepth): void {
        this.clearRefreshTimer();
        this.depth = depth;
    }

    getDepthControlForAudit(): HTMLInputElement | null {
        return this.contentEl.querySelector<HTMLInputElement>(
            ".roam-list-heading-depth-input"
        );
    }

    async getAuditSnapshotForFile(file: TFile): Promise<Record<string, unknown>> {
        const depth = this.depth;
        const content = await this.readCurrentFileText(file);
        const items = collectListHeadingItems(content, depth);
        const summary = summarizeListHeadingDepths(content);
        await this.refresh();
        const depthInput = this.getDepthControlForAudit();
        return {
            depth,
            filePath: file.path,
            itemCount: items.length,
            availableDepth: summary.availableDepth,
            cumulativeBlockCounts: summary.cumulativeBlockCounts,
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
                depthControlCount: this.contentEl.querySelectorAll(
                    ".roam-list-heading-depth-control"
                ).length,
                depthInputCount: this.contentEl.querySelectorAll(
                    ".roam-list-heading-depth-input"
                ).length,
                depthTickCount: this.contentEl.querySelectorAll(
                    ".roam-list-heading-depth-tick"
                ).length,
                depthValue: depthInput?.value ?? null,
                depthAriaValueText:
                    depthInput?.getAttribute("aria-valuetext") ?? null,
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

        const items = content === null ? [] : collectListHeadingItems(content, this.depth);
        const depthSummary = summarizeListHeadingDepths(content ?? "");
        const signature = buildRenderSignature(file, this.depth, items, readFailed);
        if (signature === this.lastRenderSignature) return;
        this.lastRenderSignature = signature;
        if (this.foldSourcePath !== (file?.path ?? null)) {
            this.collapsedItems.clear();
            this.foldItemKeys = [];
            this.foldSourcePath = file?.path ?? null;
        }
        const allItems = parseListHeadingItems(content ?? "");
        const allKeys = getListHeadingItemKeys(allItems);
        this.collapsedItems = reconcileListHeadingCollapsedKeys(
            this.foldItemKeys, allKeys, this.collapsedItems
        );
        this.foldItemKeys = allKeys;

        const container = this.contentEl;
        this.unloadRenderedInline();
        container.empty();
        container.addClass("roam-list-heading-view");

        const header = container.createDiv({ cls: "roam-list-heading-header" });
        const titleRow = header.createDiv({ cls: "roam-list-heading-title-row" });
        titleRow.createDiv({ cls: "roam-list-heading-title", text: "List heading" });
        this.renderIconButton(titleRow, "refresh-cw", "Refresh", () => this.requestRefresh());

        this.renderDepthControl(header, depthSummary);

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
        const descendantEnds = getListHeadingDescendantEnds(items);
        const keysByOffset = new Map(allItems.map((item, index) => [item.offset, allKeys[index]]));
        const foldKeys = items.map((item) => keysByOffset.get(item.offset) ?? getItemKey(item));
        const entries: HTMLElement[] = [];
        const updateVisibility = () => {
            let hiddenUntil = 0;
            items.forEach((item, index) => {
                const hidden = index < hiddenUntil;
                entries[index].hidden = hidden;
                if (!hidden && this.collapsedItems.has(foldKeys[index])) {
                    hiddenUntil = descendantEnds[index];
                }
            });
        };
        items.forEach((item, index) => {
            entries.push(this.renderItem(
                list,
                file,
                item,
                foldKeys[index],
                descendantEnds[index] > index + 1,
                updateVisibility
            ));
        });
        updateVisibility();
    }

    private renderDepthControl(
        parent: HTMLElement,
        summary: ListHeadingDepthSummary
    ): void {
        const control = parent.createDiv({
            cls: "roam-list-heading-depth-control",
            attr: {
                "data-depth": String(this.depth),
                "data-available-depth": String(summary.availableDepth),
            },
        });
        const track = control.createDiv({ cls: "roam-list-heading-depth-track" });
        track.createDiv({ cls: "roam-list-heading-depth-fill" });
        const ticks = control.createDiv({ cls: "roam-list-heading-depth-ticks" });
        for (const depth of LIST_HEADING_DEPTHS) {
            const tick = ticks.createSpan({
                cls: "roam-list-heading-depth-tick",
                attr: {
                    "aria-hidden": "true",
                    "data-depth": String(depth),
                    "data-covered": String(depth <= this.depth),
                    "data-available": String(depth <= summary.availableDepth),
                    "data-current": String(depth === this.depth),
                },
            });
            tick.style.setProperty("--roam-depth-position", String(depth));
            tick.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.applyDepth(depth, true);
            });
            tick.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
        }

        const input = control.createEl("input", {
            cls: "roam-list-heading-depth-input",
            attr: {
                type: "range",
                min: "0",
                max: "5",
                step: "1",
                value: String(this.depth),
                "aria-label": "List depth",
                "aria-valuetext": formatDepthTooltip(this.depth, summary),
                title: formatDepthTooltip(this.depth, summary),
                "data-tooltip-position": "top",
            },
        });
        input.addEventListener("input", () => {
            this.applyDepth(Number(input.value), true);
        });
        input.addEventListener("keydown", (event) => {
            const nextDepth = getKeyboardDepth(this.depth, event.key);
            if (nextDepth === null) return;
            event.preventDefault();
            this.applyDepth(nextDepth, true);
        });
        input.addEventListener("pointermove", (event) => {
            const rect = input.getBoundingClientRect();
            if (rect.width <= 0) return;
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const hoverDepth = Math.round(ratio * 5) as ListHeadingDepth;
            input.setAttr("title", formatDepthTooltip(hoverDepth, summary));
        });
        input.addEventListener("pointerleave", () => {
            input.setAttr("title", formatDepthTooltip(this.depth, summary));
        });
    }

    private applyDepth(value: number, restoreFocus = false): void {
        if (!isListHeadingDepth(value) || value === this.depth) return;
        this.depth = value;
        this.app.workspace.requestSaveLayout();
        void this.refresh().then(() => {
            if (!restoreFocus) return;
            const focusControl = () => {
                this.getDepthControlForAudit()?.focus({ preventScroll: true });
            };
            focusControl();
            window.requestAnimationFrame(focusControl);
        });
    }

    private renderItem(
        parent: HTMLElement,
        file: TFile,
        item: ListHeadingItem,
        foldKey: string,
        hasDescendants: boolean,
        updateVisibility: () => void
    ): HTMLElement {
        const entry = parent.createDiv({ cls: "roam-list-heading-entry" });
        const itemEl = entry.createDiv({
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
        const inlineKey = getItemKey(item);
        void this.renderInlineMarkdown(textEl, file, item, inlineKey);

        if (hasDescendants) {
            const foldButton = entry.createEl("button", {
                cls: "roam-list-heading-fold",
                attr: { type: "button", "data-tooltip-position": "left" },
            });
            const updateButton = () => {
                const collapsed = this.collapsedItems.has(foldKey);
                foldButton.setAttr("aria-expanded", String(!collapsed));
                foldButton.setAttr("aria-label", `${collapsed ? "Expand" : "Collapse"} children of ${item.title}`);
                setIcon(foldButton, collapsed ? "chevron-right" : "chevron-down");
            };
            updateButton();
            foldButton.addEventListener("click", (event) => {
                event.stopPropagation();
                if (!this.collapsedItems.delete(foldKey)) {
                    this.collapsedItems.add(foldKey);
                }
                updateButton();
                updateVisibility();
            });
        }

        itemEl.addEventListener("click", (event) => {
            this.handleItemActivation(event, file, item);
        });
        itemEl.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            this.handleItemActivation(event, file, item);
        });
        return entry;
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
            .find((candidate) =>
                candidate.view instanceof MarkdownView &&
                candidate.view.file?.path === file.path
            );

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
        const activeView = this.getActiveMarkdownView();
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

        const activeView = this.getActiveMarkdownView();
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

    private trackUserMarkdownView(activeView: MarkdownView | null): void {
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

    private getActiveMarkdownView(): MarkdownView | null {
        const workspace = this.app.workspace as unknown as {
            getActiveViewOfType(viewType: unknown): unknown;
        };
        const activeView = workspace.getActiveViewOfType(MarkdownView);
        return activeView instanceof MarkdownView ? activeView : null;
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

function getItemKey(item: ListHeadingItem): string {
    return `${item.line}:${item.col}:${item.title}`;
}

function getVisualIndent(item: ListHeadingItem): number {
    if (item.kind === "indent-block") {
        return Math.max(item.level - 1, 0) * 12;
    }
    return Math.max(item.level - 1, 0) * 10;
}

function buildRenderSignature(
    file: TFile | null,
    depth: ListHeadingDepth,
    items: ListHeadingItem[],
    readFailed: boolean
): string {
    return JSON.stringify({
        path: file?.path ?? null,
        depth,
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

function formatDepthTooltip(
    depth: ListHeadingDepth,
    summary: ListHeadingDepthSummary
): string {
    if (depth === 0) return "Headings · 0 blocks";
    return `List depth ${depth} · ${summary.cumulativeBlockCounts[depth]} blocks`;
}

function getKeyboardDepth(
    current: ListHeadingDepth,
    key: string
): ListHeadingDepth | null {
    if (key === "Home") return 0;
    if (key === "End") return 5;
    if (key === "ArrowLeft" || key === "ArrowDown") {
        return Math.max(0, current - 1) as ListHeadingDepth;
    }
    if (key === "ArrowRight" || key === "ArrowUp") {
        return Math.min(5, current + 1) as ListHeadingDepth;
    }
    return null;
}
