import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    setIcon,
    TFile,
    ViewStateResult,
    WorkspaceLeaf,
} from "obsidian";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { DailyNoteEditor, spawnLeafView } from "./leafView";
import {
    DEFAULT_PAGE_STREAM_MAX_CARDS,
    pushPageStreamTarget,
    restorePageStreamTargets,
} from "./pageStreamStack";
import { resolveTargetLineFromCache } from "./pageTargetResolver";
import { StreamSearchModal } from "./streamSearchModal";
import {
    PageStreamState,
    PageTarget,
    ROAM_PAGE_STREAM_VIEW_TYPE,
} from "./roamTypes";

const INITIAL_RENDER_LIMIT = 5;
const RENDER_INCREMENT = 5;

type RenderedCard = {
    component: Component | null;
    editorReady: boolean;
    editorHost: DailyNoteEditor | null;
    editorLeaf: WorkspaceLeaf | null;
    timers: number[];
    token: number;
};

type CardElements = {
    card: HTMLElement;
    body: HTMLElement;
    collapseButton: HTMLButtonElement;
    target: PageTarget;
};

export class PageStreamView extends ItemView {
    private targets: PageTarget[] = [];
    private activePath: string | null = null;
    private editingPath: string | null = null;
    private collapsedPaths = new Set<string>();
    private renderedCards = new Map<string, RenderedCard>();
    private cardElements = new Map<string, CardElements>();
    private renderToken = 0;
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private scrollTop = 0;
    private maxCards = DEFAULT_PAGE_STREAM_MAX_CARDS;
    private renderLimit = INITIAL_RENDER_LIMIT;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: DailyNoteViewPlugin
    ) {
        super(leaf);
    }

    getViewType(): string {
        return ROAM_PAGE_STREAM_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Page stream";
    }

    getIcon(): string {
        return "panel-right";
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass("roam-page-stream-view");
        this.registerEvent(this.app.vault.on("modify", (file) => this.handleFileModify(file)));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.handleFileRename(file, oldPath)));
        this.registerEvent(this.app.vault.on("delete", (file) => this.handleFileDelete(file)));
        this.registerEvent(
            this.app.workspace.on("editor-change", (_editor, info) => {
                if (info instanceof MarkdownView) {
                    this.handleEditorChange(info);
                }
            })
        );
        this.scope?.register(["Mod"], "f", (event) => {
            event.preventDefault();
            this.openStreamSearch();
        });
        this.render();
    }

    async onClose(): Promise<void> {
        this.unloadRenderedCards();
    }

    getState(): Record<string, unknown> {
        return {
            targets: this.targets,
            activePath: this.activePath,
            editingPath: null,
            collapsedPaths: Array.from(this.collapsedPaths),
            scrollTop: this.listEl?.scrollTop ?? this.scrollTop,
            maxCards: this.maxCards,
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        const restored = this.restoreState(state);
        if (this.hasEquivalentRenderedState(restored)) {
            this.scrollTop = restored.scrollTop;
            this.maxCards = restored.maxCards;
            return;
        }
        this.targets = restored.targets;
        this.activePath = restored.activePath;
        this.editingPath = null;
        this.collapsedPaths = new Set(restored.collapsedPaths);
        this.scrollTop = restored.scrollTop;
        this.maxCards = restored.maxCards;
        this.render();
    }

    private hasEquivalentRenderedState(state: PageStreamState): boolean {
        if (!this.listEl?.isConnected) return false;
        if (state.activePath !== this.activePath || state.maxCards !== this.maxCards) {
            return false;
        }
        if (state.targets.length !== this.targets.length) return false;
        if (
            state.targets.some((target, index) => {
                const current = this.targets[index];
                return (
                    !current ||
                    target.path !== current.path ||
                    target.kind !== current.kind ||
                    target.subpath !== current.subpath ||
                    target.line !== current.line ||
                    target.col !== current.col
                );
            })
        ) {
            return false;
        }
        const restoredCollapsed = new Set(state.collapsedPaths);
        return (
            restoredCollapsed.size === this.collapsedPaths.size &&
            Array.from(restoredCollapsed).every((path) => this.collapsedPaths.has(path))
        );
    }

    pushTarget(target: PageTarget): void {
        const result = pushPageStreamTarget(this.targets, target, this.maxCards);
        this.targets = result.targets;
        this.activePath = result.activePath;
        this.editingPath = null;
        this.renderLimit = Math.max(this.renderLimit, INITIAL_RENDER_LIMIT);
        this.render();
        this.app.workspace.requestSaveLayout();
    }

    enterEditModeForAudit(path: string): void {
        this.enterEditMode(path);
    }

    exitEditModeForAudit(): void {
        this.exitEditMode();
    }

    getEditingMarkdownViewForAudit(path: string): MarkdownView | null {
        const rendered = this.renderedCards.get(path);
        const view = rendered?.editorLeaf?.view;
        return view instanceof MarkdownView ? view : null;
    }

    getEditingCardForAudit(path: string): HTMLElement | null {
        const cards = Array.from(
            this.contentEl.querySelectorAll<HTMLElement>(
                '.roam-page-card[data-editing="true"]'
            )
        );
        return (
            cards.find((card) => card.getAttribute("aria-label") === path) ??
            cards[0] ??
            null
        );
    }

    getCardElementForAudit(path: string): HTMLElement | null {
        return this.cardElements.get(path)?.card ?? null;
    }

    hasEditingLeafForAudit(path: string): boolean {
        const rendered = this.renderedCards.get(path);
        return !!rendered?.editorLeaf;
    }

    isEditingEditorReadyForAudit(path: string): boolean {
        return this.renderedCards.get(path)?.editorReady === true;
    }

    getTargetLineForAudit(path: string): number | null {
        const line = this.targets.find((target) => target.path === path)?.line;
        return typeof line === "number" ? line : null;
    }

    getAuditSnapshot(): Record<string, unknown> {
        return {
            targetCount: this.targets.length,
            activePath: this.activePath,
            editingPath: this.editingPath,
            renderLimit: this.renderLimit,
            dom: {
                cardCount: this.contentEl.querySelectorAll(".roam-page-card").length,
                activeCardCount: this.contentEl.querySelectorAll(
                    '.roam-page-card[data-active="true"]'
                ).length,
                editingCardCount: this.contentEl.querySelectorAll(
                    '.roam-page-card[data-editing="true"]'
                ).length,
                previewBodyCount: this.contentEl.querySelectorAll(
                    ".roam-page-card-body.markdown-preview-view"
                ).length,
                markdownSourceCount: this.contentEl.querySelectorAll(
                    ".markdown-source-view"
                ).length,
                editorHostCount: this.contentEl.querySelectorAll(
                    ".dn-leaf-view"
                ).length,
            },
        };
    }

    private render(): void {
        const container = this.contentEl;
        const previousScroll = this.listEl?.scrollTop ?? this.scrollTop;
        this.unloadRenderedCards();
        this.cardElements.clear();
        container.empty();
        container.addClass("roam-page-stream-view");

        const header = container.createDiv({ cls: "roam-page-stream-header" });
        header.createDiv({ cls: "roam-page-stream-title", text: "Page stream" });
        this.statusEl = header.createDiv({
            cls: "roam-page-stream-status",
            text: `${this.targets.length} page${this.targets.length === 1 ? "" : "s"}`,
            attr: {
                role: "status",
                "aria-live": "polite",
                "aria-atomic": "true",
            },
        });

        const actions = header.createDiv({ cls: "roam-page-stream-actions" });
        this.renderIconButton(actions, "search", "Search Page stream", () => {
            this.openStreamSearch();
        });
        this.renderIconButton(actions, "refresh-cw", "Refresh", () => this.render());
        this.renderIconButton(actions, "trash-2", "Clear all", () => {
            this.targets = [];
            this.activePath = null;
            this.editingPath = null;
            this.render();
            this.app.workspace.requestSaveLayout();
        });

        this.listEl = container.createDiv({ cls: "roam-page-stream-list" });
        if (!this.targets.length) {
            this.listEl.createDiv({
                cls: "roam-page-stream-empty",
                text: "Shift-click an internal link to add it here.",
            });
            return;
        }

        const visibleTargets = this.targets.slice(0, this.renderLimit);
        for (const target of visibleTargets) {
            this.renderCard(this.listEl, target);
        }

        if (this.targets.length > visibleTargets.length) {
            const remainingCount = this.targets.length - visibleTargets.length;
            const button = this.listEl.createEl("button", {
                cls: "roam-page-stream-more",
                text: `Load ${Math.min(RENDER_INCREMENT, remainingCount)} older`,
                attr: {
                    type: "button",
                    "aria-label": `Load ${Math.min(RENDER_INCREMENT, remainingCount)} older pages`,
                },
            });
            button.addEventListener("click", () => {
                this.renderLimit = Math.min(
                    this.targets.length,
                    this.renderLimit + RENDER_INCREMENT
                );
                this.render();
            });
        }

        this.listEl.scrollTop = previousScroll;
    }

    private renderCard(parent: HTMLElement, target: PageTarget): void {
        const file = this.getFile(target.path);
        const isActive = target.path === this.activePath;
        const isEditing = target.path === this.editingPath;
        const isCollapsed = this.collapsedPaths.has(target.path);

        const card = parent.createDiv({
            cls: "roam-page-card",
            attr: {
                "data-active": String(isActive),
                "data-editing": String(isEditing),
                "data-collapsed": String(isCollapsed),
            },
        });
        card.tabIndex = 0;
        card.setAttr("role", "article");
        card.setAttr("aria-label", target.label ?? target.path);
        card.addEventListener("click", (event) => {
            const eventTarget = event.target;
            if (
                eventTarget instanceof Element &&
                eventTarget.closest(
                    'button, a, input, textarea, select, [contenteditable="true"], .markdown-source-view'
                )
            ) {
                return;
            }
            this.enterEditMode(target.path);
        });
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                if (event.target !== card) return;
                event.preventDefault();
                this.enterEditMode(target.path);
            }
            if (event.key === "Escape") {
                event.preventDefault();
                this.exitEditMode();
            }
        });

        const header = card.createDiv({ cls: "roam-page-card-header" });
        const title = header.createEl("button", {
            cls: "roam-page-card-title",
            attr: {
                type: "button",
                "aria-label": `Open ${file?.basename ?? target.label ?? target.path} in main area`,
                title: file ? `Open ${file.path}` : "Source file is missing",
            },
        });
        title.createSpan({
            cls: "roam-page-card-name",
            text: file?.basename ?? target.label ?? target.path,
        });
        title.disabled = !file;
        title.addEventListener("click", (event) => {
            event.stopPropagation();
            if (file) void this.openFileInMainArea(file);
        });

        const actions = header.createDiv({ cls: "roam-page-card-actions" });
        const collapseButton = this.renderIconButton(
            actions,
            isCollapsed ? "chevron-right" : "chevron-down",
            isCollapsed ? "Expand page" : "Collapse page",
            () => this.toggleCollapsed(target.path)
        );
        this.renderIconButton(actions, "x", "Close page", () => {
            this.removeTarget(target.path);
        });

        const bodyId = `roam-page-card-body-${this.cardElements.size + 1}`;
        collapseButton.setAttr("aria-expanded", String(!isCollapsed));
        collapseButton.setAttr("aria-controls", bodyId);
        const body = card.createDiv({
            cls: "roam-page-card-body markdown-preview-view",
            attr: { id: bodyId },
        });
        body.toggleClass("is-collapsed", isCollapsed);
        this.cardElements.set(target.path, {
            card,
            body,
            collapseButton,
            target,
        });
        if (isCollapsed) return;
        if (!file) {
            body.createDiv({
                cls: "roam-page-card-message",
                text: "Source file is missing.",
            });
            return;
        }

        if (isEditing) {
            this.renderEditor(body, file, target);
        } else {
            void this.renderPreview(body, file, target);
        }
    }

    private async renderPreview(body: HTMLElement, file: TFile, target: PageTarget): Promise<void> {
        const token = ++this.renderToken;
        const component = new Component();
        component.load();
        this.renderedCards.set(file.path, {
            component,
            editorReady: true,
            editorHost: null,
            editorLeaf: null,
            timers: [],
            token,
        });

        try {
            const content = await this.app.vault.cachedRead(file);
            if (!this.isCurrentPreview(file.path, body, token)) {
                component.unload();
                return;
            }
            await MarkdownRenderer.render(this.app, content, body, file.path, component);
            if (!this.isCurrentPreview(file.path, body, token)) return;
            this.scrollPreviewToTarget(body, file, target);
        } catch (error) {
            if (!this.isCurrentPreview(file.path, body, token)) return;
            body.empty();
            body.createDiv({
                cls: "roam-page-card-message",
                text: "Preview failed to render.",
            });
            console.error("Failed to render Page stream preview:", error);
        }
    }

    private renderEditor(body: HTMLElement, file: TFile, target: PageTarget): void {
        const [editorLeaf, editorHost] = spawnLeafView(this.plugin, body, this.leaf);
        const token = ++this.renderToken;
        editorLeaf.parentLeaf = this.leaf;
        editorLeaf.setPinned(true);
        const rendered: RenderedCard = {
            component: null,
            editorReady: false,
            editorHost,
            editorLeaf,
            timers: [],
            token,
        };
        this.renderedCards.set(file.path, rendered);
        void editorLeaf.setViewState({
            type: "markdown",
            state: {
                file: file.path,
                mode: "source",
                source: false,
            },
        }).then(() => {
            if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
            const focusTimer = window.setTimeout(() => {
                if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
                this.focusEditor(editorLeaf);
                this.scrollEditorToTarget(editorLeaf, file, target);
                const current = this.renderedCards.get(file.path);
                if (current?.editorLeaf === editorLeaf) {
                    current.editorReady = true;
                }
            }, 160);
            const refocusTimer = window.setTimeout(() => {
                if (this.isCurrentEditorMount(file.path, editorLeaf, token)) {
                    this.focusEditor(editorLeaf);
                }
            }, 420);
            rendered.timers.push(focusTimer, refocusTimer);
        }).catch((error) => {
            if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
            this.showStatus("Editor failed to open.");
            console.error("Failed to open Page stream editor:", error);
        });
    }

    private isCurrentEditorMount(
        path: string,
        editorLeaf: WorkspaceLeaf,
        token: number
    ): boolean {
        const rendered = this.renderedCards.get(path);
        return (
            this.editingPath === path &&
            rendered?.token === token &&
            rendered.editorLeaf === editorLeaf
        );
    }

    private isCurrentPreview(path: string, body: HTMLElement, token: number): boolean {
        const rendered = this.renderedCards.get(path);
        return (
            rendered?.token === token &&
            rendered.component !== null &&
            this.contentEl.contains(body)
        );
    }

    private scrollPreviewToTarget(body: HTMLElement, file: TFile, target: PageTarget): void {
        const cache = this.app.metadataCache.getFileCache(file);
        const resolved = resolveTargetLineFromCache(cache, target);
        if (resolved.missing || typeof resolved.line !== "number") {
            if (resolved.missing) this.showStatus("Target missing; opened full page.");
            return;
        }

        const lineEl = body.querySelector<HTMLElement>(`[data-line="${resolved.line}"]`);
        const targetEl = lineEl ?? body.querySelector<HTMLElement>(`h1, h2, h3, h4, h5, h6`);
        targetEl?.scrollIntoView({ block: "center" });
        targetEl?.addClass("roam-page-target-highlight");
        if (targetEl) {
            window.setTimeout(() => targetEl.removeClass("roam-page-target-highlight"), 1600);
        }
    }

    private focusEditor(leaf: WorkspaceLeaf): void {
        if (!(leaf.view instanceof MarkdownView)) return;
        leaf.view.editor.focus();
    }

    private handleEditorChange(view: MarkdownView): void {
        for (const rendered of this.renderedCards.values()) {
            if (rendered.editorLeaf?.view !== view) continue;
            this.showStatus("Saving...");
            return;
        }
    }

    private scrollEditorToTarget(leaf: WorkspaceLeaf, file: TFile, target: PageTarget): void {
        if (!(leaf.view instanceof MarkdownView)) return;
        const cache = this.app.metadataCache.getFileCache(file);
        const resolved = resolveTargetLineFromCache(cache, target);
        if (typeof resolved.line !== "number") return;

        const pos = { line: resolved.line, ch: resolved.col ?? 0 };
        leaf.view.editor.setCursor(pos);
        leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
        leaf.view.editor.focus();
    }

    private enterEditMode(path: string): void {
        if (this.editingPath === path && this.hasEditingLeafForAudit(path)) {
            const view = this.getEditingMarkdownViewForAudit(path);
            view?.editor.focus();
            return;
        }
        const previousEditingPath = this.editingPath;
        const activeChanged = this.activePath !== path;
        this.activePath = path;
        this.editingPath = path;
        this.collapsedPaths.delete(path);
        this.updateActiveCardState();
        if (previousEditingPath && previousEditingPath !== path) {
            this.refreshCardBody(previousEditingPath);
        }
        this.refreshCardBody(path);
        this.plugin.setOutlineSourcePath(path);
        if (activeChanged) this.app.workspace.requestSaveLayout();
    }

    private async openFileInMainArea(file: TFile): Promise<void> {
        const workspace = this.app.workspace;
        const leaf =
            workspace.getMostRecentLeaf(workspace.rootSplit) ??
            workspace.getLeaf("tab");
        await leaf.openFile(file);
    }

    private exitEditMode(): void {
        const previousEditingPath = this.editingPath;
        this.editingPath = null;
        if (previousEditingPath) this.refreshCardBody(previousEditingPath);
    }

    private selectTarget(path: string): void {
        if (this.activePath === path) {
            this.plugin.setOutlineSourcePath(path);
            return;
        }
        this.activePath = path;
        this.updateActiveCardState();
        this.plugin.setOutlineSourcePath(path);
        this.app.workspace.requestSaveLayout();
    }

    private openStreamSearch(): void {
        const documents = this.targets.flatMap((target) => {
            const file = this.getFile(target.path);
            if (!file) return [];
            return [{
                path: file.path,
                title: file.basename,
                read: () => this.app.vault.cachedRead(file),
                activate: () => this.activateSearchResult(file.path),
            }];
        });
        new StreamSearchModal(this.app, documents, "Search Page stream").open();
    }

    private async activateSearchResult(path: string): Promise<void> {
        const targetIndex = this.targets.findIndex((target) => target.path === path);
        if (targetIndex < 0) return;
        if (targetIndex >= this.renderLimit) {
            this.renderLimit = targetIndex + 1;
            this.render();
            await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        this.selectTarget(path);
        this.cardElements.get(path)?.card.scrollIntoView({
            block: "start",
            behavior: "smooth",
        });
        this.cardElements.get(path)?.card.focus({ preventScroll: true });
    }

    private toggleCollapsed(path: string): void {
        if (this.collapsedPaths.has(path)) {
            this.collapsedPaths.delete(path);
        } else {
            this.collapsedPaths.add(path);
            if (this.editingPath === path) this.editingPath = null;
        }
        this.refreshCardBody(path);
        this.app.workspace.requestSaveLayout();
    }

    private updateActiveCardState(): void {
        for (const [path, elements] of this.cardElements) {
            elements.card.setAttr("data-active", String(path === this.activePath));
        }
    }

    private refreshCardBody(path: string): void {
        const elements = this.cardElements.get(path);
        if (!elements) return;

        this.unloadRenderedCard(path);
        const file = this.getFile(path);
        const isEditing = this.editingPath === path;
        const isCollapsed = this.collapsedPaths.has(path);
        elements.card.setAttr("data-editing", String(isEditing));
        elements.card.setAttr("data-collapsed", String(isCollapsed));
        elements.collapseButton.setAttr(
            "aria-label",
            isCollapsed ? "Expand page" : "Collapse page"
        );
        elements.collapseButton.setAttr("aria-expanded", String(!isCollapsed));
        elements.collapseButton.empty();
        setIcon(elements.collapseButton, isCollapsed ? "chevron-right" : "chevron-down");
        elements.body.toggleClass("is-collapsed", isCollapsed);
        elements.body.empty();

        if (isCollapsed) return;
        if (!file) {
            elements.body.createDiv({
                cls: "roam-page-card-message",
                text: "Source file is missing.",
            });
            return;
        }
        if (isEditing) {
            this.renderEditor(elements.body, file, elements.target);
        } else {
            void this.renderPreview(elements.body, file, elements.target);
        }
    }

    private removeTarget(path: string): void {
        this.targets = this.targets.filter((target) => target.path !== path);
        if (this.activePath === path) this.activePath = this.targets[0]?.path ?? null;
        if (this.editingPath === path) this.editingPath = null;
        this.render();
        this.app.workspace.requestSaveLayout();
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

    private unloadRenderedCards(): void {
        for (const path of Array.from(this.renderedCards.keys())) {
            this.unloadRenderedCard(path);
        }
        this.renderedCards.clear();
    }

    private unloadRenderedCard(path: string): void {
        const rendered = this.renderedCards.get(path);
        if (!rendered) return;
        for (const timer of rendered.timers) window.clearTimeout(timer);
        rendered.component?.unload();
        if (rendered.editorHost) rendered.editorHost.hide();
        else rendered.editorLeaf?.detach();
        this.renderedCards.delete(path);
    }

    private handleFileModify(file: unknown): void {
        if (file instanceof TFile && this.targets.some((target) => target.path === file.path)) {
            this.showStatus("Synced");
            if (this.editingPath === file.path) return;
            this.refreshCardBody(file.path);
        }
    }

    private handleFileRename(file: unknown, oldPath: string): void {
        if (!(file instanceof TFile)) return;
        let changed = false;
        this.targets = this.targets.map((target) => {
            if (target.path !== oldPath) return target;
            changed = true;
            return { ...target, path: file.path, label: target.label ?? file.basename };
        });
        if (this.activePath === oldPath) this.activePath = file.path;
        if (this.editingPath === oldPath) this.editingPath = file.path;
        if (changed) this.render();
    }

    private handleFileDelete(file: unknown): void {
        if (!(file instanceof TFile)) return;
        if (!this.targets.some((target) => target.path === file.path)) return;
        this.targets = this.targets.filter((target) => target.path !== file.path);
        this.activePath = this.targets[0]?.path ?? null;
        if (this.editingPath === file.path) this.editingPath = null;
        this.render();
    }

    private getFile(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile && file.extension === "md" ? file : null;
    }

    private restoreState(state: unknown): PageStreamState {
        const raw = isRecord(state) ? state : {};
        const maxCards =
            typeof raw.maxCards === "number" && raw.maxCards > 0
                ? Math.min(100, Math.floor(raw.maxCards))
                : DEFAULT_PAGE_STREAM_MAX_CARDS;
        const rawTargets = Array.isArray(raw.targets) ? raw.targets : [];
        const targets = rawTargets.filter(isPageTarget);
        const existingPaths = new Set(
            targets
                .map((target) => target.path)
                .filter((path) => this.getFile(path) !== null)
        );
        const restoredTargets = restorePageStreamTargets(targets, existingPaths, maxCards);
        const activePath =
            typeof raw.activePath === "string" &&
            restoredTargets.some((target) => target.path === raw.activePath)
                ? raw.activePath
                : restoredTargets[0]?.path ?? null;
        const collapsedPaths = Array.isArray(raw.collapsedPaths)
            ? raw.collapsedPaths.filter((path): path is string => typeof path === "string")
            : [];
        const scrollTop = typeof raw.scrollTop === "number" ? raw.scrollTop : 0;

        return {
            targets: restoredTargets,
            activePath,
            editingPath: null,
            collapsedPaths,
            scrollTop,
            maxCards,
        };
    }

    private showStatus(text: string): void {
        if (this.statusEl) {
            this.statusEl.setText(text);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPageTarget(value: unknown): value is PageTarget {
    if (!isRecord(value)) return false;
    return (
        typeof value.path === "string" &&
        ["file", "heading", "block", "line"].includes(String(value.kind)) &&
        ["link", "navigation", "list-heading", "command"].includes(String(value.source))
    );
}
