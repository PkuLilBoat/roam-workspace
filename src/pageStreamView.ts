import {
    Component,
    ItemView,
    MarkdownRenderer,
    MarkdownView,
    setIcon,
    TFile,
    TFolder,
    ViewStateResult,
    WorkspaceLeaf,
} from "obsidian";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { DailyNoteEditor, spawnLeafView } from "./leafView";
import { markEditorAsStream } from "./outliner/codeMirrorAdapter";
import {
    StreamEditorLease,
    StreamEditorPool,
} from "./utils/streamEditorPool";
import {
    DEFAULT_PAGE_STREAM_MAX_CARDS,
    pushPageStreamTarget,
    restorePageStreamTargets,
} from "./pageStreamStack";
import {
    pageTargetsEqual,
    planPageStreamReconcile,
} from "./pageStreamReconcile";
import {
    comparePageStreamEditorPriority,
    resolvePageStreamEditorPriority,
    shouldPinPageStreamEditor,
} from "./pageStreamEditorPriority";
import { resolveTargetLineFromCache } from "./pageTargetResolver";
import { StreamSearchModal } from "./streamSearchModal";
import {
    bindStreamProperties,
    isStreamPropertiesInteraction,
    NativeMetadataEditor,
} from "./utils/streamProperties";
import {
    PageStreamState,
    PageTarget,
    ROAM_PAGE_STREAM_VIEW_TYPE,
} from "./roamTypes";

const INITIAL_RENDER_LIMIT = 5;
const RENDER_INCREMENT = 5;

type RenderedCard = {
    editorReady: boolean;
    editorHost: DailyNoteEditor | null;
    editorLeaf: WorkspaceLeaf | null;
    domObserver: MutationObserver | null;
    lease: StreamEditorLease | null;
    mountEl: HTMLElement | null;
    propertiesCleanup: (() => void) | null;
    resizeObserver: ResizeObserver | null;
    timers: number[];
    token: number;
};

type CardElements = {
    card: HTMLElement;
    body: HTMLElement;
    collapseButton: HTMLButtonElement;
    target: PageTarget;
};

type RenderedFallback = {
    component: Component;
    element: HTMLElement;
    token: number;
};

type MutationReference = {
    body: HTMLElement;
    card: HTMLElement;
    editor: Element | null;
};

type MutationSample = {
    editorHostCount: number;
    headerIdentityStable: boolean;
    listIdentityStable: boolean;
    preserved: Record<
        string,
        {
            cardConnected: boolean;
            cardIdentityStable: boolean;
            editorConnected: boolean | null;
            editorIdentityStable: boolean | null;
            cardVisible: boolean;
            editorInPool: boolean;
            fallbackReady: boolean;
            contentAvailable: boolean;
            editing: boolean;
        }
    >;
    timestampMs: number;
};

type AuditCardContent = {
    bodyReady: boolean;
    bodyClientHeight: number;
    bodyOverflowY: string;
    bodyScrollHeight: number;
    cardClientHeight: number;
    cardOverflowY: string;
    cardScrollHeight: number;
    cardVisible: boolean;
    clipped: boolean;
    collapsed: boolean;
    editorVisible: boolean;
    editorHeight: number;
    editorMountClass: string;
    fallbackHeight: number;
    fallbackClass: string;
    fallbackRenderStatus: string;
    fallbackVisible: boolean;
    flexShrink: string;
    hasVisibleContent: boolean;
    markerPresent: boolean;
    path: string;
    placeholderOnly: boolean;
};

export class PageStreamView extends ItemView {
    private targets: PageTarget[] = [];
    private activePath: string | null = null;
    private editingPath: string | null = null;
    private collapsedPaths = new Set<string>();
    private renderedCards = new Map<string, RenderedCard>();
    private renderedFallbacks = new Map<string, RenderedFallback>();
    private cardElements = new Map<string, CardElements>();
    private readonly editorPool = new StreamEditorPool(5, (error, key) => {
        console.error(`Failed to release Page stream editor for ${key}:`, error);
    });
    private cardObserver: IntersectionObserver | null = null;
    private readonly nearViewportPaths = new Set<string>();
    private readonly estimatedHeights = new Map<string, number>();
    private readonly fallbackRendering = new Set<string>();
    private readonly fallbackRefreshQueued = new Set<string>();
    private readonly fallbackRefreshTimers = new Map<string, number>();
    private fallbackToken = 0;
    private renderToken = 0;
    private cardIdSequence = 0;
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private scrollTop = 0;
    private maxCards = DEFAULT_PAGE_STREAM_MAX_CARDS;
    private renderLimit = INITIAL_RENDER_LIMIT;
    private editorUpdateFrame: number | null = null;

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
        this.scope?.register(["Mod"], "f", (event) => {
            event.preventDefault();
            this.openStreamSearch();
        });
        this.render();
    }

    async onClose(): Promise<void> {
        this.cardObserver?.disconnect();
        this.cardObserver = null;
        this.cancelEditorUpdate();
        this.unloadRenderedCards();
        this.unloadRenderedFallbacks();
        this.editorPool.clear();
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
        const previousCollapsedPaths = this.collapsedPaths;
        this.targets = restored.targets;
        this.activePath = restored.activePath;
        this.editingPath = null;
        this.collapsedPaths = new Set(restored.collapsedPaths);
        this.scrollTop = restored.scrollTop;
        this.maxCards = restored.maxCards;
        this.reconcileCards({ preserveScroll: true });
        for (const path of this.cardElements.keys()) {
            if (
                previousCollapsedPaths.has(path) !==
                this.collapsedPaths.has(path)
            ) {
                this.refreshCardBody(path);
            }
        }
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
        // Once mounted, the live collapse state is newer than workspace snapshots
        // that can be replayed while requestSaveLayout() is still settling.
        return true;
    }

    pushTarget(target: PageTarget): void {
        const result = pushPageStreamTarget(this.targets, target, this.maxCards);
        this.targets = result.targets;
        this.activePath = result.activePath;
        this.editingPath = null;
        this.renderLimit = Math.max(this.renderLimit, INITIAL_RENDER_LIMIT);
        this.reconcileCards({ revealTop: true });
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

    async auditMutationStabilityForAudit(): Promise<Record<string, unknown>> {
        const originalState = this.getState();
        const originalRenderLimit = this.renderLimit;
        const fixturePrefix = `tmp/roam-page-stream-mutation-${Date.now()}`;
        const fixturePaths = ["a", "b", "c", "d", "e", "f"].map(
            (suffix) => `${fixturePrefix}-${suffix}.md`
        );
        const createdFiles: TFile[] = [];
        let result: Record<string, unknown>;

        try {
            await this.ensureAuditFolder();
            for (const [index, path] of fixturePaths.entries()) {
                if (this.app.vault.getAbstractFileByPath(path)) {
                    throw new Error(`Page stream mutation fixture already exists: ${path}`);
                }
                const file = await this.app.vault.create(
                    path,
                    [`# Mutation fixture ${index + 1}`, `- stable body ${index + 1}`].join(
                        "\n"
                    )
                );
                createdFiles.push(file);
            }

            const targets = fixturePaths.map<PageTarget>((path, index) => ({
                path,
                kind: "file",
                source: "command",
                label: `Mutation fixture ${index + 1}`,
            }));
            this.maxCards = 5;
            this.renderLimit = 5;
            this.targets = targets.slice(0, 4);
            this.activePath = this.targets[0]?.path ?? null;
            this.editingPath = null;
            this.collapsedPaths.clear();
            this.render();

            const baselineReady = await this.waitForAuditEditors(
                this.targets.map((target) => target.path)
            );
            if (!baselineReady) {
                throw new Error("Page stream mutation baseline editors did not become ready");
            }

            const actions: Record<string, unknown> = {};
            actions.insert = await this.auditMutationAction(
                "insert",
                () => this.pushTarget(targets[4]),
                new Set<string>()
            );
            actions.moveExisting = await this.auditMutationAction(
                "move-existing",
                () => this.pushTarget(targets[2]),
                new Set<string>()
            );
            actions.removeTop = await this.auditMutationAction(
                "remove-top",
                () => this.removeTarget(targets[2].path),
                new Set([targets[2].path])
            );
            actions.removeMiddle = await this.auditMutationAction(
                "remove-middle",
                () => this.removeTarget(targets[1].path),
                new Set([targets[1].path])
            );

            this.pushTarget(targets[2]);
            this.pushTarget(targets[1]);
            await this.waitForAuditEditors(
                this.targets.slice(0, 5).map((target) => target.path)
            );
            const trimmedPath = this.targets.at(-1)?.path;
            actions.trim = await this.auditMutationAction(
                "trim",
                () => this.pushTarget(targets[5]),
                new Set(trimmedPath ? [trimmedPath] : [])
            );
            const continuousTargets = [...this.targets];
            actions.continuousReorder = await this.auditMutationAction(
                "continuous-reorder",
                () => {
                    for (let index = 0; index < 20; index += 1) {
                        this.pushTarget(
                            continuousTargets[index % continuousTargets.length]
                        );
                    }
                },
                new Set<string>()
            );

            const actionValues = Object.values(actions);
            const passed =
                actionValues.length === 6 &&
                actionValues.every(
                    (action) =>
                        isRecord(action) && action.status === "passed"
                );
            result = {
                status: passed ? "passed" : "failed",
                reason: passed
                    ? undefined
                    : "page-stream-mutation-stability-mismatch",
                fixturePaths,
                actions,
            };
        } catch (error) {
            result = {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
                fixturePaths,
            };
        } finally {
            const restored = this.restoreState(originalState);
            this.targets = restored.targets;
            this.activePath = restored.activePath;
            this.editingPath = null;
            this.collapsedPaths = new Set(restored.collapsedPaths);
            this.scrollTop = restored.scrollTop;
            this.maxCards = restored.maxCards;
            this.renderLimit = originalRenderLimit;
            this.render();
            for (const file of createdFiles.reverse()) {
                const current = this.app.vault.getAbstractFileByPath(file.path);
                if (current instanceof TFile) {
                    await this.app.fileManager.trashFile(current);
                }
            }
        }

        return result;
    }

    async auditVisibleContentContinuityForAudit(): Promise<Record<string, unknown>> {
        const originalState = this.getState();
        const originalRenderLimit = this.renderLimit;
        const fixturePrefix = `tmp/roam-page-stream-content-${Date.now()}`;
        const fixturePaths = Array.from(
            { length: 8 },
            (_, index) => `${fixturePrefix}-${index + 1}.md`
        );
        const createdFiles: TFile[] = [];
        let result: Record<string, unknown>;

        try {
            await this.ensureAuditFolder();
            for (const [index, path] of fixturePaths.entries()) {
                if (this.app.vault.getAbstractFileByPath(path)) {
                    throw new Error(`Page stream content fixture already exists: ${path}`);
                }
                const marker = `visible-content-marker-${index + 1}`;
                const file = await this.app.vault.create(
                    path,
                    [
                        `# Visible content fixture ${index + 1}`,
                        `- ${marker}`,
                        ...Array.from(
                            { length: 24 },
                            (_, line) => `  - fixture block ${index + 1}.${line + 1}`
                        ),
                    ].join("\n")
                );
                createdFiles.push(file);
            }

            this.maxCards = fixturePaths.length;
            this.renderLimit = fixturePaths.length;
            this.targets = fixturePaths.map<PageTarget>((path, index) => ({
                path,
                kind: "file",
                source: "command",
                label: `Visible content fixture ${index + 1}`,
            }));
            this.activePath = this.targets[0]?.path ?? null;
            this.editingPath = null;
            this.collapsedPaths = new Set([fixturePaths[1], fixturePaths[5]]);
            this.render();
            // Exercise a refresh while the first fallback render is still in flight.
            this.render();

            await this.waitForAuditContentLayers(fixturePaths);
            const scrollSamples: Record<string, unknown>[] = [];
            const listLayout = this.captureAuditListLayout();
            const maxScroll = Math.max(
                0,
                listLayout.scrollHeight - listLayout.clientHeight
            );
            for (const [label, scrollTop] of [
                ["top", 0],
                ["middle", Math.round(maxScroll / 2)],
                ["bottom", maxScroll],
            ] as const) {
                if (this.listEl) this.listEl.scrollTop = scrollTop;
                this.updateEditorScheduling();
                await new Promise((resolve) => window.setTimeout(resolve, 450));
                const sampleCards = fixturePaths.map((path, index) =>
                    this.captureAuditCardContent(
                        path,
                        `visible-content-marker-${index + 1}`
                    )
                );
                const visibleExpandedCards = sampleCards.filter(
                    (card) => card.cardVisible === true && card.collapsed === false
                );
                scrollSamples.push({
                    label,
                    scrollTop: this.listEl?.scrollTop ?? 0,
                    visibleExpandedCount: visibleExpandedCards.length,
                    passed:
                        visibleExpandedCards.length > 0 &&
                        visibleExpandedCards.every(
                            (card) =>
                                card.hasVisibleContent === true &&
                                card.placeholderOnly === false
                        ),
                    cards: sampleCards,
                });
            }
            const cards = fixturePaths.map((path, index) =>
                this.captureAuditCardContent(path, `visible-content-marker-${index + 1}`)
            );
            const poolWithinLimit = this.editorPool.size <= this.editorPool.maxEditors;
            const expandedCardsHaveContent = cards.every(
                (card) =>
                    card.collapsed === true ||
                    (card.hasVisibleContent === true && card.placeholderOnly === false)
            );
            const expandedCards = cards.filter((card) => !card.collapsed);
            const waterfallLayoutPassed =
                expandedCards.length >= 6 &&
                expandedCards.every(
                    (card) =>
                        card.flexShrink === "0" &&
                        card.clipped === false &&
                        !["auto", "scroll"].includes(card.cardOverflowY) &&
                        !["auto", "scroll"].includes(card.bodyOverflowY)
                );
            const instrumentationNeutral = !listLayout.auditLayoutClassPresent;
            const scrollSamplesPassed = scrollSamples.every(
                (sample) => sample.passed === true
            );
            const scrollable = maxScroll > 0;
            const passed =
                poolWithinLimit &&
                expandedCardsHaveContent &&
                waterfallLayoutPassed &&
                instrumentationNeutral &&
                scrollSamplesPassed &&
                scrollable;
            result = {
                status: passed ? "passed" : "failed",
                reason: passed
                    ? undefined
                    : "page-stream-visible-content-continuity-mismatch",
                fixturePaths,
                editorPool: {
                    size: this.editorPool.size,
                    max: this.editorPool.maxEditors,
                    paths: this.editorPool.keys(),
                },
                poolWithinLimit,
                listLayout,
                maxScroll,
                scrollable,
                expandedCount: expandedCards.length,
                collapsedCount: cards.length - expandedCards.length,
                expandedCardsHaveContent,
                waterfallLayoutPassed,
                instrumentationNeutral,
                scrollSamplesPassed,
                scrollSamples,
                cards,
            };
        } catch (error) {
            result = {
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
                fixturePaths,
            };
        } finally {
            const restored = this.restoreState(originalState);
            this.targets = restored.targets;
            this.activePath = restored.activePath;
            this.editingPath = null;
            this.collapsedPaths = new Set(restored.collapsedPaths);
            this.scrollTop = restored.scrollTop;
            this.maxCards = restored.maxCards;
            this.renderLimit = originalRenderLimit;
            this.render();
            for (const file of createdFiles.reverse()) {
                const current = this.app.vault.getAbstractFileByPath(file.path);
                if (current instanceof TFile) {
                    await this.app.fileManager.trashFile(current);
                }
            }
        }

        return result;
    }

    getAuditSnapshot(): Record<string, unknown> {
        const propertiesByCard = Array.from(
            this.contentEl.querySelectorAll<HTMLElement>(".roam-page-card")
        ).map((card) => {
            const visibleContainers = Array.from(
                card.querySelectorAll<HTMLElement>(".metadata-container")
            ).filter((container) => {
                if (container.closest(".is-staging")) return false;
                const rect = container.getBoundingClientRect();
                const style = window.getComputedStyle(container);
                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    style.display !== "none" &&
                    style.visibility !== "hidden"
                );
            });
            return {
                path: card.getAttribute("aria-label") ?? "",
                visibleContainerCount: visibleContainers.length,
                collapsed: visibleContainers[0]?.hasClass("is-collapsed") ?? null,
                errorContainerCount: visibleContainers.filter((container) =>
                    container.hasClass("mod-error")
                ).length,
            };
        });
        return {
            targetCount: this.targets.length,
            activePath: this.activePath,
            editingPath: this.editingPath,
            renderLimit: this.renderLimit,
            editorPool: {
                size: this.editorPool.size,
                max: this.editorPool.maxEditors,
                paths: this.editorPool.keys(),
            },
            dom: {
                cardCount: this.contentEl.querySelectorAll(".roam-page-card").length,
                activeCardCount: this.contentEl.querySelectorAll(
                    '.roam-page-card[data-active="true"]'
                ).length,
                editingCardCount: this.contentEl.querySelectorAll(
                    '.roam-page-card[data-editing="true"]'
                ).length,
                previewBodyCount: this.contentEl.querySelectorAll(
                    ".roam-page-card-preview.markdown-preview-view"
                ).length,
                markdownSourceCount: this.contentEl.querySelectorAll(
                    ".markdown-source-view"
                ).length,
                editorHostCount: this.contentEl.querySelectorAll(
                    ".dn-leaf-view"
                ).length,
                editorPlaceholderCount: this.contentEl.querySelectorAll(
                    ".roam-page-card-editor-placeholder"
                ).length,
                propertiesContainerCount: propertiesByCard.reduce(
                    (count, item) => count + item.visibleContainerCount,
                    0
                ),
            },
            propertiesByCard,
        };
    }

    private async waitForAuditContentLayers(paths: string[]): Promise<void> {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
            const settled = paths.every((path) => {
                if (this.collapsedPaths.has(path)) return true;
                const body = this.cardElements.get(path)?.body;
                if (!body) return false;
                const editorReady = this.renderedCards.get(path)?.editorReady === true;
                const fallback = body.querySelector<HTMLElement>(
                    '.roam-page-card-fallback[data-render-status="ready"]'
                );
                const placeholder = body.querySelector<HTMLElement>(
                    ".roam-page-card-editor-placeholder"
                );
                return editorReady || !!fallback || !!placeholder;
            });
            if (settled) return;
            await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
    }

    private captureAuditCardContent(
        path: string,
        marker: string
    ): AuditCardContent {
        const elements = this.cardElements.get(path);
        const card = elements?.card ?? null;
        const body = elements?.body ?? null;
        const editor = body?.querySelector<HTMLElement>(
            ".roam-page-card-editor-mount .cm-editor"
        ) ?? null;
        const fallback = body?.querySelector<HTMLElement>(
            ".roam-page-card-fallback"
        ) ?? null;
        const placeholder = body?.querySelector<HTMLElement>(
            ".roam-page-card-editor-placeholder"
        ) ?? null;
        const cardVisible = this.isCardVisible(path);
        const collapsed = this.collapsedPaths.has(path);
        const editorVisible =
            body?.getAttribute("data-editor-ready") === "true" &&
            this.isAuditElementVisible(editor);
        const fallbackVisible = this.isAuditElementVisible(fallback);
        const markerPresent =
            (editorVisible && editor?.textContent?.includes(marker) === true) ||
            (fallbackVisible && fallback?.textContent?.includes(marker) === true);
        const hasVisibleContent = markerPresent;
        const cardStyle = card ? window.getComputedStyle(card) : null;
        const bodyStyle = body ? window.getComputedStyle(body) : null;
        const cardClientHeight = card?.clientHeight ?? 0;
        const cardScrollHeight = card?.scrollHeight ?? 0;
        const bodyClientHeight = body?.clientHeight ?? 0;
        const bodyScrollHeight = body?.scrollHeight ?? 0;
        const clipped =
            !collapsed &&
            (cardScrollHeight > cardClientHeight + 1 ||
                bodyScrollHeight > bodyClientHeight + 1);
        return {
            path,
            bodyReady: body?.getAttribute("data-editor-ready") === "true",
            cardVisible,
            collapsed,
            editorVisible,
            editorHeight: editor?.getBoundingClientRect().height ?? 0,
            editorMountClass: editor?.parentElement?.className ?? "",
            fallbackVisible,
            fallbackHeight: fallback?.getBoundingClientRect().height ?? 0,
            fallbackClass: fallback?.className ?? "",
            fallbackRenderStatus: fallback?.getAttribute("data-render-status") ?? "",
            markerPresent,
            hasVisibleContent,
            placeholderOnly: !!placeholder && !hasVisibleContent,
            flexShrink: cardStyle?.flexShrink ?? "",
            cardClientHeight,
            cardScrollHeight,
            cardOverflowY: cardStyle?.overflowY ?? "",
            bodyClientHeight,
            bodyScrollHeight,
            bodyOverflowY: bodyStyle?.overflowY ?? "",
            clipped,
        };
    }

    private captureAuditListLayout(): {
        auditLayoutClassPresent: boolean;
        clientHeight: number;
        overflowY: string;
        scrollHeight: number;
    } {
        const list = this.listEl;
        const style = list ? window.getComputedStyle(list) : null;
        return {
            auditLayoutClassPresent:
                !!list &&
                Array.from(list.classList).some((className) =>
                    /(?:audit|fixture|test)/i.test(className)
                ),
            clientHeight: list?.clientHeight ?? 0,
            overflowY: style?.overflowY ?? "",
            scrollHeight: list?.scrollHeight ?? 0,
        };
    }

    private isAuditElementVisible(element: HTMLElement | null): boolean {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
        );
    }

    private render(): void {
        const container = this.contentEl;
        const previousScroll = this.listEl?.scrollTop ?? this.scrollTop;
        this.cardObserver?.disconnect();
        this.cardObserver = null;
        this.cancelEditorUpdate();
        this.nearViewportPaths.clear();
        this.unloadRenderedCards();
        this.unloadRenderedFallbacks();
        this.cardElements.clear();
        container.empty();
        container.addClass("roam-page-stream-view");

        const header = container.createDiv({ cls: "roam-page-stream-header" });
        header.createDiv({ cls: "roam-page-stream-title", text: "Page stream" });
        // The native MarkdownView owns persistence. Only report state this view
        // can verify: its card count or a concrete editor error.
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
            this.reconcileCards({ preserveScroll: true });
            this.app.workspace.requestSaveLayout();
        });

        this.listEl = container.createDiv({ cls: "roam-page-stream-list" });
        this.listEl.addEventListener(
            "scroll",
            () => this.scheduleEditorUpdate(),
            { passive: true }
        );
        if (!this.targets.length) {
            this.listEl.createDiv({
                cls: "roam-page-stream-empty",
                text: "Shift-click an internal link to add it here.",
            });
            return;
        }

        const visibleTargets = this.targets.slice(0, this.renderLimit);
        for (const [index, target] of visibleTargets.entries()) {
            this.renderCard(this.listEl, target, index < INITIAL_RENDER_LIMIT);
        }
        this.observeCards();

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
                this.reconcileCards({ preserveScroll: true });
            });
        }

        this.listEl.scrollTop = previousScroll;
    }

    private reconcileCards({
        preserveScroll = false,
        revealTop = false,
    }: {
        preserveScroll?: boolean;
        revealTop?: boolean;
    } = {}): void {
        if (!this.listEl?.isConnected || !this.statusEl?.isConnected) {
            this.render();
            return;
        }

        const list = this.listEl;
        const previousScrollTop = list.scrollTop;
        const scrollAnchor = preserveScroll ? this.captureScrollAnchor() : null;
        const previousTargets = this.getRenderedTargetOrder();
        const nextTargets = this.targets.slice(0, this.renderLimit);
        const operations = planPageStreamReconcile(previousTargets, nextTargets);

        for (const operation of operations) {
            if (operation.type === "remove") {
                this.removeCard(operation.path);
                continue;
            }
            if (operation.type === "insert") {
                this.insertCard(operation.target, operation.index);
                continue;
            }
            if (operation.type === "move") {
                this.moveCard(operation.path, operation.index);
                continue;
            }
            this.updateCardTarget(operation.target);
        }

        this.updateActiveCardState();
        for (const [path, elements] of this.cardElements) {
            elements.card.setAttr("data-editing", String(path === this.editingPath));
        }
        this.updateListControls();
        this.showStatus(
            `${this.targets.length} page${this.targets.length === 1 ? "" : "s"}`
        );
        this.observeCards();

        if (revealTop) {
            list.scrollTop = 0;
        } else if (scrollAnchor) {
            this.restoreScrollAnchor(scrollAnchor, previousScrollTop);
        } else {
            list.scrollTop = previousScrollTop;
        }
    }

    private getRenderedTargetOrder(): PageTarget[] {
        if (!this.listEl) return [];
        return Array.from(
            this.listEl.querySelectorAll<HTMLElement>(":scope > .roam-page-card")
        ).flatMap((card) => {
            const path = card.dataset.path;
            const target = path ? this.cardElements.get(path)?.target : null;
            return target ? [target] : [];
        });
    }

    private insertCard(target: PageTarget, index: number): void {
        if (!this.listEl) return;
        this.renderCard(this.listEl, target, index < INITIAL_RENDER_LIMIT);
        const inserted = this.cardElements.get(target.path)?.card;
        if (!inserted) return;
        const siblings = this.getDirectCardElements().filter(
            (card) => card !== inserted
        );
        const reference = siblings[index] ?? this.getFirstListControl();
        this.listEl.insertBefore(inserted, reference ?? null);
    }

    private moveCard(path: string, index: number): void {
        if (!this.listEl) return;
        const card = this.cardElements.get(path)?.card;
        if (!card) return;
        const siblings = this.getDirectCardElements().filter(
            (candidate) => candidate !== card
        );
        const reference = siblings[index] ?? this.getFirstListControl();
        this.listEl.insertBefore(card, reference ?? null);
    }

    private updateCardTarget(target: PageTarget): void {
        const elements = this.cardElements.get(target.path);
        if (!elements || pageTargetsEqual(elements.target, target)) return;
        elements.target = target;
        elements.card.setAttr("aria-label", target.label ?? target.path);
        const rendered = this.renderedCards.get(target.path);
        const file = this.getFile(target.path);
        if (rendered?.editorReady && rendered.editorLeaf && file) {
            this.scrollEditorToTarget(rendered.editorLeaf, file, target);
        }
    }

    private removeCard(path: string): void {
        const elements = this.cardElements.get(path);
        if (!elements) return;
        this.cardObserver?.unobserve(elements.card);
        this.nearViewportPaths.delete(path);
        this.unloadRenderedCard(path);
        this.unloadRenderedFallback(path);
        this.cardElements.delete(path);
        elements.card.remove();
        this.scheduleEditorUpdate();
    }

    private getDirectCardElements(): HTMLElement[] {
        if (!this.listEl) return [];
        return Array.from(this.listEl.children).filter(
            (child): child is HTMLElement =>
                child.instanceOf(HTMLElement) && child.hasClass("roam-page-card")
        );
    }

    private getFirstListControl(): Element | null {
        return (
            this.listEl?.querySelector(
                ":scope > .roam-page-stream-empty, :scope > .roam-page-stream-more"
            ) ?? null
        );
    }

    private updateListControls(): void {
        if (!this.listEl) return;
        for (const control of Array.from(
            this.listEl.querySelectorAll(
                ":scope > .roam-page-stream-empty, :scope > .roam-page-stream-more"
            )
        )) {
            control.remove();
        }
        if (!this.targets.length) {
            this.listEl.createDiv({
                cls: "roam-page-stream-empty",
                text: "Shift-click an internal link to add it here.",
            });
            return;
        }
        const visibleCount = Math.min(this.targets.length, this.renderLimit);
        if (this.targets.length <= visibleCount) return;
        const remainingCount = this.targets.length - visibleCount;
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
            this.reconcileCards({ preserveScroll: true });
        });
    }

    private captureScrollAnchor(): { offset: number; path: string } | null {
        if (!this.listEl) return null;
        const listTop = this.listEl.getBoundingClientRect().top;
        const card = this.getDirectCardElements().find(
            (candidate) => candidate.getBoundingClientRect().bottom > listTop
        );
        const path = card?.dataset.path;
        return card && path
            ? { path, offset: card.getBoundingClientRect().top - listTop }
            : null;
    }

    private restoreScrollAnchor(
        anchor: { offset: number; path: string },
        fallbackScrollTop: number
    ): void {
        if (!this.listEl) return;
        const card = this.cardElements.get(anchor.path)?.card;
        if (!card?.isConnected) {
            this.listEl.scrollTop = fallbackScrollTop;
            return;
        }
        const listTop = this.listEl.getBoundingClientRect().top;
        const nextOffset = card.getBoundingClientRect().top - listTop;
        this.listEl.scrollTop += nextOffset - anchor.offset;
    }

    private async auditMutationAction(
        label: string,
        action: () => void,
        removedPaths: Set<string>
    ): Promise<Record<string, unknown>> {
        const header = this.contentEl.querySelector<HTMLElement>(
            ".roam-page-stream-header"
        );
        const list = this.listEl;
        if (!header || !list) {
            return { status: "failed", reason: `${label}-shell-not-ready` };
        }

        const references = new Map<string, MutationReference>();
        for (const [path, elements] of this.cardElements) {
            if (removedPaths.has(path)) continue;
            references.set(path, {
                body: elements.body,
                card: elements.card,
                editor: elements.body.querySelector(".cm-editor"),
            });
        }

        const removedNodes: Node[] = [];
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                removedNodes.push(...Array.from(record.removedNodes));
            }
        });
        observer.observe(this.contentEl, { childList: true, subtree: true });

        const frames: MutationSample[] = [];
        const startedAt = performance.now();
        try {
            action();
            frames.push(
                this.captureMutationSample(startedAt, header, list, references)
            );
            await this.sampleMutationFrames(
                startedAt,
                header,
                list,
                references,
                frames
            );
        } finally {
            observer.disconnect();
        }

        const removedPreservedPaths = Array.from(references.entries())
            .filter(([path, reference]) => {
                const ElementConstructor =
                    reference.card.ownerDocument.defaultView?.Element;
                const observedRemoval = removedNodes.some(
                    (node) =>
                        node === reference.card ||
                        (ElementConstructor &&
                            node.instanceOf(ElementConstructor) &&
                            node.contains(reference.card))
                );
                const current = this.cardElements.get(path)?.card;
                return (
                    observedRemoval &&
                    (!reference.card.isConnected || current !== reference.card)
                );
            })
            .map(([path]) => path);
        const unstablePaths = Array.from(references.keys()).filter((path) =>
            frames.some((frame) => {
                const state = frame.preserved[path];
                return (
                    !state?.cardConnected ||
                    !state.cardIdentityStable ||
                    !state.contentAvailable ||
                    (state.editing && state.editorIdentityStable === false)
                );
            })
        );
        const recycledEditorPaths = Array.from(references.keys()).filter((path) =>
            frames.some((frame) =>
                frame.preserved[path]?.editorIdentityStable === false
            )
        );
        const headerStable = frames.every((frame) => frame.headerIdentityStable);
        const listStable = frames.every((frame) => frame.listIdentityStable);
        const editorHostsNeverEmpty = frames.every(
            (frame) => frame.editorHostCount > 0
        );
        const domOrder = Array.from(
            this.listEl?.querySelectorAll<HTMLElement>(":scope > .roam-page-card") ?? []
        ).map((card) => card.dataset.path ?? "");
        const expectedOrder = this.targets
            .slice(0, this.renderLimit)
            .map((target) => target.path);
        const orderMatches =
            domOrder.length === expectedOrder.length &&
            domOrder.every((path, index) => path === expectedOrder[index]);
        const uniquePaths = new Set(domOrder).size === domOrder.length;
        const poolWithinLimit = this.editorPool.size <= this.editorPool.maxEditors;
        const passed =
            headerStable &&
            listStable &&
            editorHostsNeverEmpty &&
            unstablePaths.length === 0 &&
            removedPreservedPaths.length === 0 &&
            orderMatches &&
            uniquePaths &&
            poolWithinLimit;

        return {
            status: passed ? "passed" : "failed",
            reason: passed ? undefined : `${label}-dom-identity-changed`,
            frameCount: frames.length,
            headerStable,
            listStable,
            editorHostsNeverEmpty,
            unstablePaths,
            recycledEditorPaths,
            removedPreservedPaths,
            orderMatches,
            uniquePaths,
            poolWithinLimit,
            expectedOrder,
            domOrder,
            frames,
        };
    }

    private captureMutationSample(
        startedAt: number,
        header: HTMLElement,
        list: HTMLElement,
        references: Map<string, MutationReference>
    ): MutationSample {
        const preserved: MutationSample["preserved"] = {};
        for (const [path, reference] of references) {
            const current = this.cardElements.get(path);
            const currentEditor = current?.body.querySelector(".cm-editor") ?? null;
            const fallback = current?.body.querySelector<HTMLElement>(
                '.roam-page-card-fallback[data-render-status="ready"]'
            );
            const fallbackReady = !!fallback;
            const fallbackVisible = !!fallback &&
                fallback.ownerDocument.defaultView?.getComputedStyle(fallback).display !== "none" &&
                fallback.textContent?.includes("stable body") === true;
            const editorVisible = currentEditor !== null &&
                current?.body.getAttribute("data-editor-ready") === "true" &&
                currentEditor.textContent?.includes("stable body") === true;
            preserved[path] = {
                cardConnected: reference.card.isConnected,
                cardIdentityStable: current?.card === reference.card,
                editorConnected: reference.editor
                    ? reference.editor.isConnected
                    : null,
                editorIdentityStable: reference.editor
                    ? currentEditor === reference.editor
                    : null,
                cardVisible: this.isCardVisible(path),
                editorInPool: this.editorPool.has(path),
                fallbackReady,
                contentAvailable: editorVisible || fallbackVisible,
                editing: this.editingPath === path,
            };
        }
        return {
            timestampMs: Math.round((performance.now() - startedAt) * 100) / 100,
            headerIdentityStable:
                this.contentEl.querySelector(".roam-page-stream-header") === header,
            listIdentityStable: this.listEl === list && list.isConnected,
            editorHostCount: this.contentEl.querySelectorAll(".cm-editor").length,
            preserved,
        };
    }

    private async sampleMutationFrames(
        startedAt: number,
        header: HTMLElement,
        list: HTMLElement,
        references: Map<string, MutationReference>,
        frames: MutationSample[]
    ): Promise<void> {
        await new Promise<void>((resolve) => {
            const sample = () => {
                frames.push(
                    this.captureMutationSample(startedAt, header, list, references)
                );
                if (performance.now() - startedAt >= 600) {
                    resolve();
                    return;
                }
                window.requestAnimationFrame(sample);
            };
            window.requestAnimationFrame(sample);
        });
    }

    private async waitForAuditEditors(
        paths: string[],
        timeoutMs = 8000
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() <= deadline) {
            if (
                paths.every(
                    (path) => this.renderedCards.get(path)?.editorReady === true
                )
            ) {
                return true;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        return false;
    }

    private async ensureAuditFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath("tmp");
        if (folder instanceof TFolder) return;
        if (folder) throw new Error("tmp exists but is not a folder");
        await this.app.vault.createFolder("tmp");
    }

    private renderCard(
        parent: HTMLElement,
        target: PageTarget,
        mountImmediately: boolean
    ): void {
        const file = this.getFile(target.path);
        const isActive = target.path === this.activePath;
        const isCollapsed = this.collapsedPaths.has(target.path);

        const card = parent.createDiv({
            cls: "roam-page-card",
            attr: {
                "data-active": String(isActive),
                "data-editing": String(target.path === this.editingPath),
                "data-collapsed": String(isCollapsed),
                "data-path": target.path,
            },
        });
        card.setAttr("role", "article");
        card.setAttr("aria-label", target.label ?? target.path);
        card.addEventListener("click", (event) => {
            const eventTarget = event.target;
            const ElementConstructor = card.ownerDocument.defaultView?.Element;
            if (
                ElementConstructor &&
                eventTarget instanceof ElementConstructor &&
                (isStreamPropertiesInteraction(eventTarget) ||
                    eventTarget.closest(
                        'button, a, input, textarea, select, [contenteditable="true"]'
                    ))
            ) {
                return;
            }
            this.enterEditMode(target.path);
        });
        card.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                this.exitEditMode();
            }
        });

        const header = card.createDiv({ cls: "roam-page-card-header" });
        const leadingActions = header.createDiv({
            cls: "roam-page-card-actions roam-page-card-actions-start",
        });
        const collapseButton = this.renderIconButton(
            leadingActions,
            isCollapsed ? "chevron-right" : "chevron-down",
            isCollapsed ? "Expand page" : "Collapse page",
            () => this.toggleCollapsed(target.path)
        );
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

        const trailingActions = header.createDiv({
            cls: "roam-page-card-actions roam-page-card-actions-end",
        });
        this.renderIconButton(trailingActions, "x", "Close page", () => {
            this.removeTarget(target.path);
        });

        const bodyId = `roam-page-card-body-${++this.cardIdSequence}`;
        collapseButton.setAttr("aria-expanded", String(!isCollapsed));
        collapseButton.setAttr("aria-controls", bodyId);
        const body = card.createDiv({
            cls: "roam-page-card-body",
            attr: {
                id: bodyId,
                role: "region",
                "data-editor-ready": "false",
                "aria-label": `Edit ${file?.basename ?? target.label ?? target.path}`,
            },
        });
        body.tabIndex = 0;
        body.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.target !== body) return;
            event.preventDefault();
            this.enterEditMode(target.path);
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

        this.applyEstimatedHeight(target.path, body);
        void this.renderFallback(body, file);
        if (mountImmediately) {
            this.renderEditor(body, file, target, false);
        }
    }

    private observeCards(): void {
        const Observer = this.contentEl.ownerDocument.defaultView?.IntersectionObserver;
        if (!Observer || !this.listEl) return;
        if (!this.cardObserver) {
            this.cardObserver = new Observer(
                (entries) => {
                    for (const entry of entries) {
                        const card = entry.target;
                        if (!card.instanceOf(HTMLElement)) continue;
                        const path = card.dataset.path;
                        if (!path) continue;
                        if (entry.isIntersecting) this.nearViewportPaths.add(path);
                        else this.nearViewportPaths.delete(path);
                    }
                    this.scheduleEditorUpdate();
                },
                {
                    root: this.listEl,
                    rootMargin: "80% 0px",
                }
            );
        }
        for (const { card } of this.cardElements.values()) {
            this.cardObserver.observe(card);
        }
        this.scheduleEditorUpdate();
    }

    private renderEditor(
        body: HTMLElement,
        file: TFile,
        target: PageTarget,
        focusWhenReady: boolean
    ): void {
        if (this.renderedCards.has(file.path)) {
            if (focusWhenReady) {
                const current = this.renderedCards.get(file.path);
                if (current?.editorReady && current.editorLeaf) {
                    this.focusEditor(current.editorLeaf);
                }
            }
            return;
        }

        void this.renderFallback(body, file);
        this.refreshEditorPriorities();
        let rendered: RenderedCard | null = null;
        const lease = this.editorPool.acquire(file.path, () => {
            if (rendered) this.evictCardEditor(file.path, rendered);
        });
        if (!lease.granted) {
            return;
        }

        body.querySelector(".roam-page-card-editor-placeholder")?.remove();
        body.setAttr("data-editor-ready", "false");
        body.removeAttribute("data-editor-error");
        const mountEl = body.createDiv({
            cls: "roam-page-card-editor-mount is-loading",
        });
        let viewReady = false;
        let hostShown = false;
        const revealEditorWhenReady = () => {
            if (!viewReady || !hostShown) return;
            const readyTimer = window.setTimeout(() => {
                if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
                if (!mountEl.querySelector(".cm-editor")) return;
                const current = this.renderedCards.get(file.path);
                if (current?.editorLeaf !== editorLeaf) return;
                if (editorLeaf.view instanceof MarkdownView) {
                    markEditorAsStream(editorLeaf.view.editor);
                }
                this.scrollEditorToTarget(editorLeaf, file, target);
                current.editorReady = true;
                mountEl.removeClass("is-loading");
                mountEl.addClass("is-ready");
                body.setAttr("data-editor-ready", "true");
                this.observeEditorHeight(file.path, body, current);
                this.refreshEditorPriorities();
                if (focusWhenReady) this.focusEditor(editorLeaf);
            }, 0);
            rendered?.timers.push(readyTimer);
        };
        const [editorLeaf, editorHost] = spawnLeafView(
            this.plugin,
            mountEl,
            this.leaf,
            () => {
                hostShown = true;
                revealEditorWhenReady();
            },
            { independentFromParent: true }
        );
        const propertiesCleanup = bindStreamProperties(
            mountEl,
            file.path,
            this.plugin.streamProperties,
            () =>
                (
                    editorLeaf.view as MarkdownView & {
                        metadataEditor?: NativeMetadataEditor;
                    }
                ).metadataEditor ?? null
        );
        const token = ++this.renderToken;
        editorLeaf.parentLeaf = this.leaf;
        editorLeaf.setPinned(true);
        rendered = {
            editorReady: false,
            editorHost,
            editorLeaf,
            domObserver: null,
            lease,
            mountEl,
            propertiesCleanup,
            resizeObserver: null,
            timers: [],
            token,
        };
        const Observer = mountEl.ownerDocument.defaultView?.MutationObserver;
        if (Observer) {
            let recoveryPending = false;
            rendered.domObserver = new Observer(() => {
                if (recoveryPending || !rendered?.editorReady) return;
                if (mountEl.querySelector(".cm-editor")) return;
                recoveryPending = true;
                const recoveryTimer = window.setTimeout(() => {
                    recoveryPending = false;
                    if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
                    if (mountEl.querySelector(".cm-editor")) return;
                    rendered?.lease?.release();
                }, 50);
                rendered?.timers.push(recoveryTimer);
            });
            rendered.domObserver.observe(mountEl, { childList: true, subtree: true });
        }
        this.renderedCards.set(file.path, rendered);
        this.refreshEditorPriorities();
        void editorLeaf.setViewState({
            type: "markdown",
            state: {
                file: file.path,
                mode: "source",
                source: false,
            },
        }).then(() => {
            if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
            viewReady = true;
            revealEditorWhenReady();
        }).catch((error) => {
            if (!this.isCurrentEditorMount(file.path, editorLeaf, token)) return;
            lease.release();
            body.setAttr("data-editor-error", "true");
            void this.renderFallback(body, file);
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
            rendered?.token === token &&
            rendered.editorLeaf === editorLeaf
        );
    }

    private focusEditor(leaf: WorkspaceLeaf): void {
        if (!(leaf.view instanceof MarkdownView)) return;
        this.refreshEditorPriorities(leaf);
        leaf.view.editor.focus();
    }

    private applyEstimatedHeight(path: string, body: HTMLElement): void {
        const estimatedHeight = this.estimatedHeights.get(path);
        if (estimatedHeight) {
            body.style.setProperty("min-height", `${estimatedHeight}px`);
        }
    }

    private async renderFallback(
        body: HTMLElement,
        file: TFile,
        force = false
    ): Promise<void> {
        const path = file.path;
        const existing = this.renderedFallbacks.get(path);
        if (
            !force &&
            existing?.element.isConnected &&
            existing.element.parentElement === body
        ) {
            return;
        }
        if (this.fallbackRendering.has(path)) {
            if (
                force ||
                !existing?.element.isConnected ||
                existing.element.parentElement !== body
            ) {
                this.fallbackRefreshQueued.add(path);
            }
            return;
        }

        this.fallbackRendering.add(path);
        const component = new Component();
        const token = ++this.fallbackToken;
        const element = body.createDiv({
            cls: "roam-page-card-fallback markdown-preview-view",
            attr: {
                "data-render-status": "loading",
                "aria-label": `Preview ${file.basename}`,
            },
        });
        const renderRoot = element.createDiv({
            cls: "markdown-preview-sizer markdown-preview-section",
        });
        const entry: RenderedFallback = { component, element, token };
        if (existing) {
            element.addClass("is-staging");
        } else {
            renderRoot.createDiv({
                cls: "roam-page-card-fallback-loading",
                text: "Loading page...",
            });
            this.renderedFallbacks.set(path, entry);
        }
        component.load();

        try {
            const markdown = await this.app.vault.cachedRead(file);
            renderRoot.empty();
            await MarkdownRenderer.render(
                this.app,
                markdown,
                renderRoot,
                file.path,
                component
            );
            const currentBody = this.cardElements.get(path)?.body;
            if (currentBody !== body || !body.isConnected) {
                component.unload();
                element.remove();
                return;
            }
            const current = this.renderedFallbacks.get(path);
            if (existing && current !== existing) {
                component.unload();
                element.remove();
                return;
            }
            if (!existing && current !== entry) {
                component.unload();
                element.remove();
                return;
            }
            element.setAttr("data-render-status", "ready");
            element.removeClass("is-staging");
            if (existing) {
                existing.component.unload();
                existing.element.remove();
                this.renderedFallbacks.set(path, entry);
            }
            if (body.getAttribute("data-editor-ready") !== "true") {
                const height = Math.ceil(element.getBoundingClientRect().height);
                if (height > 0) {
                    body.style.setProperty("min-height", `${height}px`);
                }
            }
        } catch (error) {
            if (!existing && this.renderedFallbacks.get(path) === entry) {
                renderRoot.empty();
                renderRoot.createDiv({
                    cls: "roam-page-card-message",
                    text: "Unable to render page.",
                });
                element.setAttr("data-render-status", "error");
            } else {
                component.unload();
                element.remove();
            }
            console.error(`Failed to render Page stream fallback for ${path}:`, error);
        } finally {
            this.fallbackRendering.delete(path);
            if (this.fallbackRefreshQueued.delete(path)) {
                const currentBody = this.cardElements.get(path)?.body;
                const currentFile = this.getFile(path);
                if (currentBody && currentFile) {
                    void this.renderFallback(currentBody, currentFile, true);
                }
            }
        }
    }

    private scheduleFallbackRefresh(file: TFile): void {
        const currentTimer = this.fallbackRefreshTimers.get(file.path);
        if (currentTimer !== undefined) window.clearTimeout(currentTimer);
        const timer = window.setTimeout(() => {
            this.fallbackRefreshTimers.delete(file.path);
            const body = this.cardElements.get(file.path)?.body;
            if (body) void this.renderFallback(body, file, true);
        }, 150);
        this.fallbackRefreshTimers.set(file.path, timer);
    }

    private scheduleEditorUpdate(): void {
        if (this.editorUpdateFrame !== null) return;
        this.editorUpdateFrame = window.requestAnimationFrame(() => {
            this.editorUpdateFrame = null;
            this.updateEditorScheduling();
        });
    }

    private cancelEditorUpdate(): void {
        if (this.editorUpdateFrame === null) return;
        window.cancelAnimationFrame(this.editorUpdateFrame);
        this.editorUpdateFrame = null;
    }

    private updateEditorScheduling(): void {
        this.refreshEditorPriorities();
        const candidates = Array.from(this.cardElements.entries())
            .flatMap(([path, elements]) => {
                if (this.renderedCards.has(path) || this.collapsedPaths.has(path)) {
                    return [];
                }
                const file = this.getFile(path);
                if (!file) return [];
                const priority = this.getEditorPriority(path);
                if (priority === "collapsed-offscreen") return [];
                return [{ elements, file, path, priority }];
            })
            .sort((left, right) =>
                comparePageStreamEditorPriority(left.priority, right.priority)
            );

        for (const candidate of candidates) {
            if (
                candidate.priority === "near-viewport" &&
                this.editorPool.size >= this.editorPool.maxEditors
            ) {
                continue;
            }
            this.renderEditor(
                candidate.elements.body,
                candidate.file,
                candidate.elements.target,
                this.editingPath === candidate.path
            );
        }
        this.refreshEditorPriorities();
    }

    private refreshEditorPriorities(focusedLeaf: WorkspaceLeaf | null = null): void {
        for (const [path, rendered] of this.renderedCards) {
            const priority = this.getEditorPriority(
                path,
                focusedLeaf !== null && rendered.editorLeaf === focusedLeaf
            );
            rendered.lease?.setPinned(shouldPinPageStreamEditor(priority));
            if (priority === "editing" || priority === "visible-expanded") {
                rendered.lease?.touch();
            }
        }
    }

    private getEditorPriority(path: string, focused = false) {
        return resolvePageStreamEditorPriority({
            collapsed: this.collapsedPaths.has(path),
            editing: focused || this.editingPath === path,
            nearViewport: this.nearViewportPaths.has(path),
            visible: this.isCardVisible(path),
        });
    }

    private isCardVisible(path: string): boolean {
        if (this.collapsedPaths.has(path) || !this.listEl?.isConnected) return false;
        const card = this.cardElements.get(path)?.card;
        if (!card?.isConnected) return false;
        const listRect = this.listEl.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        return (
            cardRect.bottom > listRect.top &&
            cardRect.top < listRect.bottom &&
            cardRect.right > listRect.left &&
            cardRect.left < listRect.right
        );
    }

    private observeEditorHeight(
        path: string,
        body: HTMLElement,
        rendered: RenderedCard
    ): void {
        const update = () => {
            if (this.renderedCards.get(path) !== rendered) return;
            const height = Math.ceil(body.getBoundingClientRect().height);
            if (height <= 0) return;
            this.estimatedHeights.set(path, height);
            body.style.setProperty("min-height", `${height}px`);
        };
        update();
        const Observer = body.ownerDocument.defaultView?.ResizeObserver;
        if (!Observer) return;
        rendered.resizeObserver = new Observer(update);
        rendered.resizeObserver.observe(body);
    }

    private evictCardEditor(path: string, rendered: RenderedCard): void {
        const body = this.cardElements.get(path)?.body;
        if (body) {
            const height = Math.ceil(body.getBoundingClientRect().height);
            if (height > 0) this.estimatedHeights.set(path, height);
        }
        if (this.renderedCards.get(path) === rendered) {
            this.renderedCards.delete(path);
        }
        rendered.lease = null;
        this.disposeRenderedCardResources(rendered);
        if (body?.isConnected && !this.collapsedPaths.has(path)) {
            body.setAttr("data-editor-ready", "false");
            const fallback = this.renderedFallbacks.get(path)?.element;
            const fallbackHeight = fallback?.getBoundingClientRect().height ?? 0;
            if (fallbackHeight > 0) {
                body.style.setProperty("min-height", `${Math.ceil(fallbackHeight)}px`);
            } else {
                body.style.removeProperty("min-height");
            }
            const file = this.getFile(path);
            if (file) void this.renderFallback(body, file);
        }
        this.scheduleEditorUpdate();
    }

    private scrollEditorToTarget(leaf: WorkspaceLeaf, file: TFile, target: PageTarget): void {
        if (!(leaf.view instanceof MarkdownView)) return;
        const cache = this.app.metadataCache.getFileCache(file);
        const resolved = resolveTargetLineFromCache(cache, target);
        if (typeof resolved.line !== "number") return;

        const pos = { line: resolved.line, ch: resolved.col ?? 0 };
        leaf.view.editor.setCursor(pos);
        leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
    }

    private enterEditMode(path: string): void {
        if (this.editingPath === path && this.hasEditingLeafForAudit(path)) {
            const view = this.getEditingMarkdownViewForAudit(path);
            view?.editor.focus();
            return;
        }
        const activeChanged = this.activePath !== path;
        this.activePath = path;
        this.editingPath = path;
        const wasCollapsed = this.collapsedPaths.delete(path);
        this.updateActiveCardState();
        for (const [cardPath, elements] of this.cardElements) {
            elements.card.setAttr("data-editing", String(cardPath === path));
        }
        const elements = this.cardElements.get(path);
        const file = this.getFile(path);
        const rendered = this.renderedCards.get(path);
        if (wasCollapsed) {
            this.refreshCardBody(path);
        } else if (rendered?.editorLeaf) {
            this.focusEditor(rendered.editorLeaf);
        } else if (elements && file) {
            this.renderEditor(elements.body, file, elements.target, true);
        }
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
        if (previousEditingPath) {
            this.cardElements
                .get(previousEditingPath)
                ?.card.setAttr("data-editing", "false");
        }
        this.refreshEditorPriorities();
        const activeElement = this.contentEl.ownerDocument.activeElement;
        if (activeElement?.instanceOf(HTMLElement)) activeElement.blur();
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
            this.reconcileCards({ preserveScroll: true });
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
        this.scheduleEditorUpdate();
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

        const file = this.getFile(path);
        const isCollapsed = this.collapsedPaths.has(path);
        const rendered = this.renderedCards.get(path);
        elements.card.setAttr("data-editing", String(this.editingPath === path));
        elements.card.setAttr("data-collapsed", String(isCollapsed));
        elements.collapseButton.setAttr(
            "aria-label",
            isCollapsed ? "Expand page" : "Collapse page"
        );
        elements.collapseButton.setAttr("aria-expanded", String(!isCollapsed));
        elements.collapseButton.empty();
        setIcon(elements.collapseButton, isCollapsed ? "chevron-right" : "chevron-down");
        elements.body.toggleClass("is-collapsed", isCollapsed);

        if (isCollapsed) {
            rendered?.lease?.setPinned(false);
            elements.body.style.removeProperty("min-height");
            this.scheduleEditorUpdate();
            return;
        }
        if (rendered?.editorLeaf) {
            rendered.lease?.touch();
            this.applyEstimatedHeight(path, elements.body);
            this.refreshEditorPriorities();
            if (this.editingPath === path) this.focusEditor(rendered.editorLeaf);
            return;
        }

        if (!file) {
            this.unloadRenderedFallback(path);
            elements.body.empty();
            elements.body.createDiv({
                cls: "roam-page-card-message",
                text: "Source file is missing.",
            });
            return;
        }
        this.applyEstimatedHeight(path, elements.body);
        void this.renderFallback(elements.body, file);
        this.renderEditor(
            elements.body,
            file,
            elements.target,
            this.editingPath === path
        );
    }

    private removeTarget(path: string): void {
        this.targets = this.targets.filter((target) => target.path !== path);
        this.estimatedHeights.delete(path);
        if (this.activePath === path) this.activePath = this.targets[0]?.path ?? null;
        if (this.editingPath === path) this.editingPath = null;
        this.reconcileCards({ preserveScroll: true });
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

    private unloadRenderedFallbacks(): void {
        for (const timer of this.fallbackRefreshTimers.values()) {
            window.clearTimeout(timer);
        }
        this.fallbackRefreshTimers.clear();
        this.fallbackRefreshQueued.clear();
        for (const path of Array.from(this.renderedFallbacks.keys())) {
            this.unloadRenderedFallback(path);
        }
        this.renderedFallbacks.clear();
    }

    private unloadRenderedFallback(path: string): void {
        const timer = this.fallbackRefreshTimers.get(path);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            this.fallbackRefreshTimers.delete(path);
        }
        this.fallbackRefreshQueued.delete(path);
        const rendered = this.renderedFallbacks.get(path);
        if (!rendered) return;
        this.renderedFallbacks.delete(path);
        rendered.component.unload();
        rendered.element.remove();
    }

    private unloadRenderedCard(path: string): void {
        const rendered = this.renderedCards.get(path);
        if (!rendered) return;
        this.renderedCards.delete(path);
        const lease = rendered.lease;
        rendered.lease = null;
        if (lease) {
            lease.release();
        } else {
            this.disposeRenderedCardResources(rendered);
        }
    }

    private disposeRenderedCardResources(rendered: RenderedCard): void {
        const mountEl = rendered.mountEl;
        for (const timer of rendered.timers) window.clearTimeout(timer);
        rendered.domObserver?.disconnect();
        rendered.domObserver = null;
        rendered.resizeObserver?.disconnect();
        rendered.resizeObserver = null;
        rendered.propertiesCleanup?.();
        rendered.propertiesCleanup = null;
        if (rendered.editorHost) rendered.editorHost.hide();
        else rendered.editorLeaf?.detach();
        mountEl?.remove();
        rendered.editorHost = null;
        rendered.editorLeaf = null;
        rendered.mountEl = null;
    }

    private handleFileModify(file: unknown): void {
        if (file instanceof TFile && this.targets.some((target) => target.path === file.path)) {
            this.scheduleFallbackRefresh(file);
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
        if (this.collapsedPaths.delete(oldPath)) {
            this.collapsedPaths.add(file.path);
        }
        const estimatedHeight = this.estimatedHeights.get(oldPath);
        if (estimatedHeight !== undefined) {
            this.estimatedHeights.delete(oldPath);
            this.estimatedHeights.set(file.path, estimatedHeight);
        }
        if (changed) this.reconcileCards({ preserveScroll: true });
    }

    private handleFileDelete(file: unknown): void {
        if (!(file instanceof TFile)) return;
        if (!this.targets.some((target) => target.path === file.path)) return;
        this.targets = this.targets.filter((target) => target.path !== file.path);
        this.collapsedPaths.delete(file.path);
        this.estimatedHeights.delete(file.path);
        this.activePath = this.targets[0]?.path ?? null;
        if (this.editingPath === file.path) this.editingPath = null;
        this.reconcileCards({ preserveScroll: true });
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
