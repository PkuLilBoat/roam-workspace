import { normalizePath, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
import type { JournalQuery, JournalSourceRecord } from "./contracts";
import {
    createJournalState,
    reduceJournalState,
    type JournalState,
    type VirtualTodayProjection,
} from "./model/journalState";
import {
    JournalSourceBusyError,
    JournalSourceRepository,
} from "./source/JournalSourceRepository";
import { JournalCardList } from "./card/JournalCardList";
import type { JournalCard } from "./card/JournalCard";
import {
    JournalEditorSession,
    type JournalEditorState,
} from "./editor/JournalEditorSession";
import { ObsidianEmbeddedEditorAdapter } from "./editor/ObsidianEmbeddedEditorAdapter";
import {
    JournalEditorPool,
    type JournalEditorActivity,
    type JournalEditorLease,
} from "./editor/JournalEditorPool";
import { isTimeInRange, parseTimeField } from "../utils/journalCore";
import {
    JournalFileEvents,
    type JournalFileEvent,
} from "./source/JournalFileEvents";
import {
    classifyJournalModify,
    journalContentsEqual,
} from "./source/journalConflict";

interface JournalConflict {
    diskContent: string | null;
    draft: string;
    kind: "deleted" | "modified";
    path: string;
}

interface JournalDirtyBaseline {
    content: string;
}

// Vault events handle the prompt path; polling is a fallback for missed events.
const JOURNAL_CONFLICT_PROBE_MS = 750;
const SOURCE_QUERY_MAX_FAILURES = 3;
const SOURCE_QUERY_MAX_INVALIDATIONS = 8;

export class JournalV2Controller {
    private readonly activatedEmptyPaths = new Set<string>();
    private readonly abortController = new AbortController();
    private readonly cardList: JournalCardList;
    private readonly editorAdapter: ObsidianEmbeddedEditorAdapter;
    private readonly editorStates = new Map<string, JournalEditorState>();
    private readonly editorPool = new JournalEditorPool(5, (error, key) => {
        console.error(`Failed to evict Journal V2 editor for ${key}:`, error);
    });
    private readonly conflicts = new Map<string, JournalConflict>();
    private readonly conflictActions = new Set<string>();
    private readonly conflictProbeTimers = new Map<string, number>();
    private readonly dirtyBaselineLoads = new Map<string, Promise<void>>();
    private readonly dirtyBaselines = new Map<string, JournalDirtyBaseline>();
    private readonly fileEvents: JournalFileEvents;
    private readonly localDrafts = new Map<string, string>();
    private readonly localEditCaptureTimers = new Map<string, number>();
    private readonly mountPromises = new Map<string, Promise<void>>();
    private readonly pendingMounts = new Map<string, JournalCard>();
    private readonly priorityMounts = new Set<string>();
    private readonly observedCards = new WeakMap<Element, JournalCard>();
    private readonly sessionLeases = new Map<string, JournalEditorLease>();
    private readonly sessions = new Map<string, JournalEditorSession>();
    private readonly virtualCreates = new Map<string, Promise<void>>();
    private readonly repository: JournalSourceRepository;
    private cardObserver: IntersectionObserver | null = null;
    private drainingMountQueue = false;
    private focusedKey: string | null = null;
    private pendingSourceQuery: JournalQuery | null = null;
    private pendingSourceWork: Promise<boolean> | null = null;
    private refreshGeneration = 0;
    private sourceQueryAbort = new AbortController();
    private sourceRevision = 0;
    private state: JournalState;

    constructor(
        private readonly plugin: DailyNoteViewPlugin,
        private readonly parentLeaf: WorkspaceLeaf,
        listEl: HTMLElement,
        private readonly configuredJournalFolder: string,
        query: JournalQuery
    ) {
        this.cardList = new JournalCardList(listEl, {
            onActivateVirtual: (key) => {
                void this.activateVirtualToday(key);
            },
            onConflictAction: (key, action) => {
                void this.handleConflictAction(key, action);
            },
            onFocusChange: (key, focused) => {
                this.handleFocusChange(key, focused);
            },
            onLocalEdit: (key) => {
                this.handleLocalEdit(key);
            },
            onOpenSource: (key) => {
                void this.openSourceFile(key);
            },
            onToggleCollapsed: (key) => {
                this.toggleCollapsed(key);
            },
        });
        this.editorAdapter = new ObsidianEmbeddedEditorAdapter(plugin);
        this.repository = new JournalSourceRepository(plugin.app);
        this.fileEvents = new JournalFileEvents(plugin.app, async (event) => {
            await this.handleFileEvent(event);
        }, (event) => {
            if (this.touchesPendingSource(event)) this.sourceRevision += 1;
        }, (event) => {
            this.handleFailedFileEvent(event);
        });
        this.state = createJournalState(query);
        this.cardObserver = this.createCardObserver(listEl);
        this.fileEvents.start();
    }

    async setQuery(query: JournalQuery): Promise<boolean> {
        const work = this.replaceSource(query);
        this.pendingSourceWork = work;
        try {
            return await work;
        } finally {
            if (this.pendingSourceWork === work) this.pendingSourceWork = null;
        }
    }

    async refresh(): Promise<boolean> {
        if (this.pendingSourceWork) return this.pendingSourceWork;
        return this.setQuery(this.state.query);
    }

    getCurrentQuery(): JournalQuery {
        return this.state.query;
    }

    getPendingQuery(): JournalQuery | null {
        return this.pendingSourceQuery;
    }

    private async replaceSource(query: JournalQuery): Promise<boolean> {
        this.sourceQueryAbort.abort();
        const queryAbort = new AbortController();
        this.sourceQueryAbort = queryAbort;
        const generation = ++this.refreshGeneration;
        this.pendingSourceQuery = query;
        let failedReads = 0;
        let invalidations = 0;
        try {
            while (!this.abortController.signal.aborted) {
                const revision = this.sourceRevision;
                const now = Date.now();
                let records: JournalSourceRecord[];
                try {
                    records = await this.repository.query(query, now, queryAbort.signal);
                    failedReads = 0;
                } catch (error) {
                    if (queryAbort.signal.aborted) return false;
                    if (error instanceof JournalSourceBusyError) throw error;
                    failedReads += 1;
                    if (failedReads >= SOURCE_QUERY_MAX_FAILURES) throw error;
                    const ownerWindow = this.parentLeaf.containerEl.ownerDocument
                        .defaultView ?? window;
                    await new Promise<void>((resolve) => {
                        ownerWindow.setTimeout(resolve, failedReads * 100);
                    });
                    continue;
                }
                if (queryAbort.signal.aborted || generation !== this.refreshGeneration) {
                    return false;
                }
                if (
                    revision !== this.sourceRevision ||
                    records.some((record) => record.file.path !== record.path)
                ) {
                    invalidations += 1;
                    if (invalidations >= SOURCE_QUERY_MAX_INVALIDATIONS) {
                        throw new Error("Journal source changed repeatedly during refresh");
                    }
                    continue;
                }

                // Keep a recovery card visible when a query change excludes a file
                // whose local edits have not yet been confirmed on disk.
                const visibleRecords = records.map((record) =>
                    record.isStrictlyEmpty &&
                    (this.localDrafts.has(record.path) ||
                        this.conflicts.has(record.path) ||
                        this.activatedEmptyPaths.has(record.path))
                        ? { ...record, isStrictlyEmpty: false }
                        : record
                );
                const includedPaths = new Set(visibleRecords.map((record) => record.path));
                const pendingRecords = this.state.records.filter((record) =>
                    !includedPaths.has(record.path) &&
                    (this.localDrafts.has(record.path) || this.conflicts.has(record.path))
                );
                const queriedState = reduceJournalState(this.state, {
                    type: "set-query",
                    query,
                });
                this.state = reduceJournalState(queriedState, {
                    type: "replace-source",
                    records: [...visibleRecords, ...pendingRecords],
                    virtualToday: this.getVirtualTodayProjection(now, query),
                });
                this.reconcileState();
                return true;
            }
            return false;
        } finally {
            if (generation === this.refreshGeneration) this.pendingSourceQuery = null;
        }
    }

    dispose(): void {
        this.refreshGeneration += 1;
        this.sourceQueryAbort.abort();
        this.abortController.abort();
        this.fileEvents.dispose();
        for (const key of this.conflictProbeTimers.keys()) {
            this.clearConflictProbe(key);
        }
        for (const key of this.localEditCaptureTimers.keys()) {
            this.clearLocalEditCapture(key);
        }
        this.cardObserver?.disconnect();
        this.cardObserver = null;
        this.pendingMounts.clear();
        this.editorPool.clear();
        this.sessionLeases.clear();
        for (const session of this.sessions.values()) session.destroy();
        this.sessions.clear();
        this.editorStates.clear();
        this.conflicts.clear();
        this.localDrafts.clear();
        this.mountPromises.clear();
        this.priorityMounts.clear();
        this.activatedEmptyPaths.clear();
        this.virtualCreates.clear();
        this.cardList.destroy();
    }

    getSourceFiles(): TFile[] {
        return this.state.items.flatMap((item) =>
            item.file instanceof TFile ? [item.file] : []
        );
    }

    async revealPath(path: string): Promise<boolean> {
        const card = this.cardList.getCard(path);
        if (!card) return false;
        card.rootEl.scrollIntoView({ block: "center" });
        if (card.isCollapsed()) card.setCollapsed(false);
        this.requestMount(card);
        return true;
    }

    private createCardObserver(listEl: HTMLElement): IntersectionObserver | null {
        const Observer = listEl.ownerDocument.defaultView?.IntersectionObserver;
        if (!Observer) return null;
        return new Observer(
            (entries) => {
                this.refreshEditorActivities();
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const card = this.observedCards.get(entry.target);
                    if (card && !card.isCollapsed()) this.requestMount(card);
                }
            },
            { root: null, rootMargin: "100px 0px" }
        );
    }

    private observeAndMountCards(cards: JournalCard[]): void {
        for (const card of cards) {
            const item = card.getItem();
            const conflict = this.conflicts.get(item.key);
            if (conflict) {
                card.showConflict(conflict.kind, conflict.draft);
                continue;
            }
            if (item.isVirtualToday || !item.file) {
                this.dropSessionState(item.key);
                card.setEditorStatus("virtual");
                continue;
            }
            if (this.sessions.has(item.key)) {
                card.setEditorStatus("ready");
                this.updateEditorActivity(item.key);
                continue;
            }
            this.observedCards.set(card.rootEl, card);
            this.cardObserver?.observe(card.rootEl);
            if (
                !card.isCollapsed() &&
                (!this.cardObserver || this.isNearViewport(card.rootEl))
            ) {
                this.requestMount(card);
            }
        }
        this.refreshEditorActivities();
    }

    private requestMount(card: JournalCard): void {
        const item = card.getItem();
        if (
            item.isVirtualToday ||
            !item.file ||
            card.isCollapsed() ||
            this.conflicts.has(item.key) ||
            this.sessions.has(item.key) ||
            this.mountPromises.has(item.key)
        ) {
            return;
        }
        this.pendingMounts.set(item.key, card);
        void this.drainMountQueue();
    }

    private async drainMountQueue(): Promise<void> {
        if (this.drainingMountQueue) return;
        this.drainingMountQueue = true;
        try {
            while (this.pendingMounts.size > 0 && !this.abortController.signal.aborted) {
                const next = this.pendingMounts.entries().next().value as
                    | [string, JournalCard]
                    | undefined;
                if (!next) break;
                const [key, card] = next;
                this.pendingMounts.delete(key);
                if (
                    this.cardList.getCard(key) !== card ||
                    card.isCollapsed() ||
                    (this.cardObserver && !this.isNearViewport(card.rootEl))
                ) {
                    continue;
                }
                await this.mountCard(card);
                await this.waitForLayout(card.rootEl);
                this.refreshEditorActivities();
            }
        } finally {
            this.drainingMountQueue = false;
        }
    }

    private async waitForLayout(element: HTMLElement): Promise<void> {
        const ownerWindow = element.ownerDocument.defaultView;
        if (!ownerWindow || !element.isConnected) return;
        await new Promise<void>((resolve) => {
            const startedAt = ownerWindow.performance.now();
            let lastHeight = -1;
            let stableFrames = 0;
            const sample = () => {
                if (!element.isConnected) {
                    resolve();
                    return;
                }
                const height = element.getBoundingClientRect().height;
                stableFrames = Math.abs(height - lastHeight) < 0.5
                    ? stableFrames + 1
                    : 0;
                lastHeight = height;
                const elapsed = ownerWindow.performance.now() - startedAt;
                if ((elapsed >= 100 && stableFrames >= 3) || elapsed >= 500) {
                    resolve();
                    return;
                }
                ownerWindow.requestAnimationFrame(sample);
            };
            ownerWindow.requestAnimationFrame(sample);
        });
    }

    private async mountCard(card: JournalCard): Promise<void> {
        const item = card.getItem();
        const file = item.file;
        if (
            item.isVirtualToday ||
            !file ||
            card.isCollapsed() ||
            this.conflicts.has(item.key) ||
            this.sessions.has(item.key) ||
            this.mountPromises.has(item.key)
        ) {
            return;
        }

        const lease = this.editorPool.acquire(
            item.key,
            () => {
                this.handlePoolEviction(item.key);
            },
            this.getEditorActivity(card),
            {
                allowVisibleEviction: this.priorityMounts.has(item.key),
            }
        );
        if (!lease.granted) {
            card.setEditorStatus("waiting");
            return;
        }
        this.sessionLeases.set(item.key, lease);

        const mount = (async () => {
            card.setEditorStatus("loading");
            try {
                const savedState = this.editorStates.get(item.key);
                if (savedState) {
                    this.plugin.streamProperties.setCollapsed(
                        item.key,
                        savedState.propertiesCollapsed
                    );
                }
                const session = await this.editorAdapter.mount(
                    card.getEditorSlot(),
                    file,
                    this.parentLeaf,
                    this.abortController.signal
                );
                const currentCard = this.cardList.getCard(item.key);
                if (
                    this.abortController.signal.aborted ||
                    currentCard !== card ||
                    currentCard.getItem().file?.path !== session.path ||
                    this.sessionLeases.get(item.key) !== lease
                ) {
                    session.destroy();
                    if (this.sessionLeases.get(item.key) === lease) {
                        this.releaseSession(item.key);
                    }
                    return;
                }
                this.sessions.set(item.key, session);
                if (savedState) session.restoreState(savedState);
                card.setEditorStatus("ready");
            } catch (error) {
                if (this.sessionLeases.get(item.key) === lease) {
                    this.releaseSession(item.key);
                }
                if (this.abortController.signal.aborted) return;
                card.setEditorStatus("error");
                console.error(`Failed to mount Journal V2 editor for ${item.path}:`, error);
            }
        })().finally(() => {
            this.mountPromises.delete(item.key);
        });
        this.mountPromises.set(item.key, mount);
        await mount;
    }

    private releaseSession(key: string): void {
        const lease = this.sessionLeases.get(key);
        if (lease) {
            this.sessionLeases.delete(key);
            lease.release();
            return;
        }
        const session = this.sessions.get(key);
        if (!session) return;
        this.sessions.delete(key);
        session.destroy();
    }

    private dropSessionState(key: string): void {
        this.clearLocalEditCapture(key);
        this.clearConflictProbe(key);
        this.pendingMounts.delete(key);
        this.releaseSession(key);
        this.editorStates.delete(key);
        this.dirtyBaselines.delete(key);
        this.localDrafts.delete(key);
        this.conflicts.delete(key);
        if (this.focusedKey === key) this.focusedKey = null;
    }

    private handlePoolEviction(key: string): void {
        this.sessionLeases.delete(key);
        const session = this.sessions.get(key);
        if (session) {
            const state = session.captureState(
                this.plugin.streamProperties.isCollapsed(key)
            );
            if (state) this.editorStates.set(key, state);
            this.sessions.delete(key);
            session.destroy();
        }
        const card = this.cardList.getCard(key);
        if (card && !card.getItem().isVirtualToday) {
            card.setEditorStatus("waiting");
        }
    }

    private toggleCollapsed(key: string): void {
        const card = this.cardList.getCard(key);
        if (!card) return;
        const collapsed = !card.isCollapsed();
        card.setCollapsed(collapsed);
        if (collapsed) this.pendingMounts.delete(key);
        this.updateEditorActivity(key);
        if (!collapsed) {
            this.sessionLeases.get(key)?.touch();
            this.requestMount(card);
        }
    }

    private handleFocusChange(key: string, focused: boolean): void {
        const previousKey = this.focusedKey;
        if (focused) this.focusedKey = key;
        else if (this.focusedKey === key) this.focusedKey = null;
        if (previousKey && previousKey !== this.focusedKey) {
            this.updateEditorActivity(previousKey);
        }
        this.updateEditorActivity(key);
        if (focused) this.sessionLeases.get(key)?.touch();
    }

    private handleLocalEdit(key: string): void {
        this.captureLocalDraft(key);
        this.clearLocalEditCapture(key);
        const ownerWindow = this.parentLeaf.containerEl.ownerDocument.defaultView;
        if (!ownerWindow) return;
        const timer = ownerWindow.setTimeout(() => {
            this.localEditCaptureTimers.delete(key);
            this.captureLocalDraft(key);
        }, 0);
        this.localEditCaptureTimers.set(key, timer);
    }

    private captureLocalDraft(key: string): void {
        const session = this.sessions.get(key);
        if (!session || this.conflicts.has(key)) return;
        const content = session.getContent();
        if (content === null) return;
        this.localDrafts.set(key, content);
        this.cardList.getCard(key)?.setSaveStatus("Saving…");
        this.sessionLeases.get(key)?.touch();
        this.updateEditorActivity(key);
        if (!this.dirtyBaselines.has(key)) {
            const record = this.state.records.find((item) => item.path === key);
            if (record) this.dirtyBaselines.set(key, { content: record.content });
            else this.loadDirtyBaseline(key);
        }
        this.scheduleConflictProbe(key);
    }

    private async handleFileEvent(event: JournalFileEvent): Promise<void> {
        if (this.abortController.signal.aborted) return;
        if (event.type === "delete") {
            const path = this.state.records.some((record) => record.path === event.path) ||
                this.localDrafts.has(event.path) || this.conflicts.has(event.path)
                ? event.path
                : this.trackedPathForFile(event.file) ?? event.path;
            this.handleFileDelete(path);
            return;
        }
        if (event.type === "rename") {
            await this.handleFileRename(event.file, event.oldPath, event.path);
            return;
        }
        if (
            event.file.path !== event.path ||
            this.plugin.app.vault.getAbstractFileByPath(event.path) !== event.file
        ) return;
        if (event.type === "modify") {
            await this.handleFileModify(event.file);
            return;
        }
        await this.upsertFile(event.file, "Added");
    }

    private touchesPendingSource(event: JournalFileEvent): boolean {
        const query = this.pendingSourceQuery;
        if (!query) return false;
        if (query.selectionMode !== "folder") return true;
        const folder = normalizePath(query.target);
        const inFolder = (path: string) => path.startsWith(`${folder}/`);
        return inFolder(event.path) ||
            (event.type === "rename" && inFolder(event.oldPath));
    }

    private handleFailedFileEvent(event: JournalFileEvent): void {
        if (this.abortController.signal.aborted) return;
        if (event.type === "rename") {
            const oldPath = this.trackedPathForFile(event.file) ?? event.oldPath;
            if (oldPath !== event.path) {
                // The native editor follows the TFile across a rename. If its
                // metadata read failed, freeze the old editor before it can
                // save an unresolved draft to the new path.
                const liveContent = this.sessions.get(oldPath)?.getContent();
                const previousContent = this.state.records.find(
                    (record) => record.path === oldPath
                )?.content;
                if (this.localDrafts.get(oldPath) === undefined &&
                    liveContent !== null && liveContent !== undefined &&
                    (previousContent === undefined ||
                        !journalContentsEqual(liveContent, previousContent))) {
                    this.localDrafts.set(oldPath, liveContent);
                }
                this.releaseSession(oldPath);
                const draft = this.localDrafts.get(oldPath);
                if (draft !== undefined) {
                    this.conflicts.set(oldPath, {
                        diskContent: null,
                        draft,
                        kind: "deleted",
                        path: oldPath,
                    });
                    this.sourceRevision += 1;
                    this.cardList.getCard(oldPath)?.showConflict("deleted", draft);
                }
            }
        }
        const card = this.cardList.getCard(event.path) ??
            (event.type === "rename"
                ? this.cardList.getCard(event.oldPath)
                : undefined);
        card?.setSaveStatus("Sync failed; retrying…");
        void this.refresh().catch((error: unknown) => {
            console.error("Failed to refresh Journal V2 after a file event:", error);
            card?.setSaveStatus("Sync failed; use Refresh to retry");
        });
    }

    private async handleFileModify(file: TFile): Promise<void> {
        const path = file.path;
        if (this.conflicts.has(path)) return;
        const included = this.repository.contains(file, this.state.query, Date.now());
        const tracked = this.state.records.some((record) => record.path === path) ||
            this.localDrafts.has(path);
        if (!included && !tracked) return;
        const localDraft = this.localDrafts.get(path);
        if (!included && localDraft === undefined) {
            this.applySourceRemoval(path);
            return;
        }

        const diskContent = await this.plugin.app.vault.adapter.read(path);
        if (
            this.abortController.signal.aborted ||
            file.path !== path ||
            this.plugin.app.vault.getAbstractFileByPath(path) !== file
        ) return;
        if (this.conflicts.has(path) || this.localDrafts.get(path) !== localDraft) {
            this.scheduleConflictProbe(path);
            return;
        }
        const session = this.sessions.get(path);
        if (localDraft === undefined) {
            const liveContent = session?.getContent();
            if (liveContent !== null && liveContent !== undefined &&
                !journalContentsEqual(liveContent, diskContent)) {
                const previousContent = this.state.records.find(
                    (record) => record.path === path
                )?.content;
                if (previousContent !== undefined &&
                    journalContentsEqual(liveContent, previousContent)) {
                    // Obsidian has not synchronized this embedded editor yet.
                    // Remount it from the new disk version before accepting edits.
                    this.releaseSession(path);
                } else {
                    // The native editor can save an older revision before our
                    // input callback observes the latest one. Keep its session.
                    this.captureLocalDraft(path);
                    return;
                }
            }
        }
        if (session && localDraft !== undefined) {
            const liveContent = session.getContent();
            if (liveContent !== null &&
                !journalContentsEqual(localDraft, liveContent)) {
                this.captureLocalDraft(path);
                return;
            }
        }
        if (session && localDraft !== undefined &&
            !journalContentsEqual(localDraft, diskContent)) {
            // Vault modify has no writer identity. During native autosave the
            // disk commonly trails the mounted editor by one or more edits.
            this.scheduleConflictProbe(path);
            return;
        }
        const resolution = classifyJournalModify(localDraft, diskContent);
        if (resolution === "external-conflict" && localDraft !== undefined) {
            this.releaseSession(path);
            this.conflicts.set(path, {
                diskContent,
                draft: localDraft,
                kind: "modified",
                path,
            });
            this.sourceRevision += 1;
            this.clearConflictProbe(path);
            this.cardList.getCard(path)?.showConflict("modified", localDraft);
            return;
        }

        if (resolution === "local-save") {
            this.localDrafts.delete(path);
            this.dirtyBaselines.delete(path);
            this.clearConflictProbe(path);
            this.updateEditorActivity(path);
        }
        await this.upsertFile(
            file,
            resolution === "local-save" ? "Saved" : "Synced",
            diskContent
        );
    }

    private handleFileDelete(path: string): void {
        const draft = this.snapshotLocalDraft(path);
        if (draft !== undefined) {
            this.localDrafts.set(path, draft);
            this.releaseSession(path);
            this.conflicts.set(path, {
                diskContent: null,
                draft,
                kind: "deleted",
                path,
            });
            this.sourceRevision += 1;
            this.clearConflictProbe(path);
            this.cardList.getCard(path)?.showConflict("deleted", draft);
            return;
        }
        if (this.state.records.some((record) => record.path === path)) {
            this.applySourceRemoval(path);
        }
    }

    private snapshotLocalDraft(path: string): string | undefined {
        const liveContent = this.sessions.get(path)?.getContent();
        const recordContent = this.state.records.find((record) => record.path === path)?.content;
        return liveContent !== null && liveContent !== undefined &&
            (this.localDrafts.has(path) || recordContent === undefined ||
                !journalContentsEqual(liveContent, recordContent))
            ? liveContent
            : this.localDrafts.get(path);
    }

    private async handleFileRename(
        file: TFile,
        eventOldPath: string,
        eventPath: string
    ): Promise<void> {
        if (file.path !== eventPath) return;
        let oldPath = this.trackedPathForFile(file) ?? eventOldPath;
        if (oldPath === eventPath) return;
        await this.mountPromises.get(oldPath);
        if (file.path !== eventPath || this.abortController.signal.aborted) return;
        const diskContent = await this.plugin.app.vault.cachedRead(file);
        if (
            file.path !== eventPath ||
            this.abortController.signal.aborted ||
            this.plugin.app.vault.getAbstractFileByPath(eventPath) !== file
        ) return;
        const query = this.state.query;
        const record = await this.repository.readIfIncluded(
            file,
            query,
            Date.now(),
            diskContent
        );
        if (
            file.path !== eventPath ||
            this.abortController.signal.aborted ||
            this.plugin.app.vault.getAbstractFileByPath(eventPath) !== file
        ) return;
        if (query !== this.state.query) {
            await this.handleFileRename(file, eventOldPath, eventPath);
            return;
        }
        oldPath = this.trackedPathForFile(file) ?? oldPath;
        if (oldPath === eventPath) return;
        const previousCard = this.cardList.getCard(oldPath);
        const wasCollapsed = previousCard?.isCollapsed() ?? false;
        const draft = this.snapshotLocalDraft(oldPath);
        const destinationDraft = this.localDrafts.get(eventPath);
        const destinationHasAnotherDraft = draft !== undefined &&
            (this.conflicts.has(eventPath) ||
                (destinationDraft !== undefined &&
                    !journalContentsEqual(draft, destinationDraft)));
        if (draft !== undefined &&
            ((!record && !journalContentsEqual(draft, diskContent)) ||
                destinationHasAnotherDraft)) {
            this.localDrafts.set(oldPath, draft);
            this.releaseSession(oldPath);
            this.conflicts.set(oldPath, {
                diskContent: null,
                draft,
                kind: "deleted",
                path: oldPath,
            });
            this.sourceRevision += 1;
            this.clearConflictProbe(oldPath);
            previousCard?.showConflict("deleted", draft);
            return;
        }
        if (!record && !previousCard && draft === undefined) return;
        if (record) this.migratePathState(oldPath, file.path, draft, diskContent);
        else this.dropSessionState(oldPath);
        const hasConflict = this.conflicts.has(file.path);
        this.localDrafts.delete(oldPath);
        this.conflicts.delete(oldPath);
        this.sourceRevision += 1;
        this.state = reduceJournalState(this.state, {
            type: "rename-source",
            oldPath,
            record,
            virtualToday: this.getVirtualTodayProjection(Date.now()),
        });
        this.reconcileState(() => {
            const nextCard = this.cardList.getCard(file.path);
            if (wasCollapsed) nextCard?.setCollapsed(true);
            if (hasConflict && draft !== undefined) {
                nextCard?.showConflict("modified", draft);
            }
            else nextCard?.setSaveStatus("Renamed");
        });
    }

    private trackedPathForFile(file: TFile): string | undefined {
        const records = this.state.records.filter((record) => record.file === file);
        return records.find((record) => record.path !== file.path)?.path ??
            records[0]?.path;
    }

    private async upsertFile(
        file: TFile,
        status: "Added" | "Saved" | "Synced",
        knownContent?: string
    ): Promise<void> {
        const path = file.path;
        while (!this.abortController.signal.aborted) {
            const query = this.state.query;
            const draft = this.localDrafts.get(path);
            const conflict = this.conflicts.get(path);
            const now = Date.now();
            const record = await this.repository.readIfIncluded(
                file,
                query,
                now,
                knownContent
            );
            if (
                this.abortController.signal.aborted ||
                file.path !== path ||
                this.plugin.app.vault.getAbstractFileByPath(path) !== file
            ) return;
            if (this.state.query !== query) continue;
            if (
                this.localDrafts.get(path) !== draft ||
                this.conflicts.get(path) !== conflict ||
                this.localDrafts.has(path) ||
                this.conflicts.has(path)
            ) return;
            if (!record) {
                if (this.state.records.some((item) => item.path === path)) {
                    this.applySourceRemoval(path);
                }
                return;
            }
            if (record.isStrictlyEmpty && this.activatedEmptyPaths.has(path)) {
                record.isStrictlyEmpty = false;
            } else if (!record.isStrictlyEmpty) {
                this.activatedEmptyPaths.delete(path);
            }
            this.sourceRevision += 1;
            this.state = reduceJournalState(this.state, {
                type: "upsert-source",
                record,
                virtualToday: this.getVirtualTodayProjection(now),
            });
            this.reconcileState();
            const card = this.cardList.getCard(path);
            card?.clearConflict();
            card?.setSaveStatus(status);
            return;
        }
    }

    private applySourceRemoval(path: string): void {
        this.activatedEmptyPaths.delete(path);
        this.conflicts.delete(path);
        this.clearLocalEditCapture(path);
        this.clearConflictProbe(path);
        this.dirtyBaselines.delete(path);
        this.localDrafts.delete(path);
        this.sourceRevision += 1;
        this.state = reduceJournalState(this.state, {
            type: "remove-source",
            path,
            virtualToday: this.getVirtualTodayProjection(Date.now()),
        });
        this.reconcileState();
    }

    private reconcileState(beforeMount?: () => void): void {
        const reconciliation = this.cardList.reconcile(this.state.items);
        for (const key of reconciliation.removedKeys) this.dropSessionState(key);
        beforeMount?.();
        this.observeAndMountCards(reconciliation.cards);
    }

    private async handleConflictAction(
        key: string,
        action: "copy-close" | "discard" | "keep-current" | "reload-disk" | "restore"
    ): Promise<void> {
        const conflict = this.conflicts.get(key);
        if (!conflict || this.abortController.signal.aborted ||
            this.conflictActions.has(key)) return;
        this.conflictActions.add(key);
        this.cardList.getCard(key)?.setRecoveryBusy(true);
        try {
            await this.performConflictAction(key, action, conflict);
        } finally {
            this.conflictActions.delete(key);
            this.cardList.getCard(key)?.setRecoveryBusy(false);
        }
    }

    private async performConflictAction(
        key: string,
        action: "copy-close" | "discard" | "keep-current" | "reload-disk" | "restore",
        conflict: JournalConflict
    ): Promise<void> {
        const isCurrent = () => !this.abortController.signal.aborted &&
            this.conflicts.get(key) === conflict;
        let contentApplied = false;
        const reportProjectionFailure = (error: unknown) => {
            if (this.abortController.signal.aborted || this.conflicts.has(key)) return;
            const card = this.cardList.getCard(key);
            card?.clearConflict();
            card?.setSaveStatus("File updated; refresh journal to reopen");
            console.error(`Failed to project Journal V2 recovered content for ${key}:`, error);
        };
        if (action === "discard") {
            this.applySourceRemoval(key);
            return;
        }
        if (action === "copy-close") {
            try {
                await this.writeClipboard(conflict.draft);
                if (!isCurrent()) return;
                this.applySourceRemoval(key);
            } catch (error) {
                if (!isCurrent()) return;
                this.cardList.getCard(key)?.setSaveStatus("Copy failed; draft retained");
                console.error(`Failed to copy Journal V2 recovery draft for ${key}:`, error);
            }
            return;
        }
        if (action === "reload-disk") {
            const file = this.plugin.app.vault.getAbstractFileByPath(key);
            if (!(file instanceof TFile)) {
                this.releaseSession(key);
                this.conflicts.set(key, {
                    diskContent: null,
                    draft: conflict.draft,
                    kind: "deleted",
                    path: key,
                });
                this.localDrafts.set(key, conflict.draft);
                this.sourceRevision += 1;
                this.cardList.getCard(key)?.showConflict("deleted", conflict.draft);
                this.cardList.getCard(key)?.setSaveStatus("File deleted; draft retained");
                return;
            }
            try {
                const diskContent = await this.plugin.app.vault.adapter.read(key);
                if (!isCurrent() ||
                    this.plugin.app.vault.getAbstractFileByPath(key) !== file) return;
                this.releaseSession(key);
                this.conflicts.delete(key);
                this.clearConflictProbe(key);
                this.dirtyBaselines.delete(key);
                this.localDrafts.delete(key);
                this.editorStates.delete(key);
                contentApplied = true;
                await this.upsertFile(file, "Synced", diskContent);
            } catch (error) {
                if (contentApplied) {
                    reportProjectionFailure(error);
                    return;
                }
                if (!isCurrent()) return;
                this.conflicts.set(key, conflict);
                this.localDrafts.set(key, conflict.draft);
                this.cardList.getCard(key)?.showConflict(conflict.kind, conflict.draft);
                this.cardList.getCard(key)?.setSaveStatus("Reload failed; draft retained");
                console.error(`Failed to reload Journal V2 disk content for ${key}:`, error);
            }
            return;
        }

        this.cardList.getCard(key)?.setSaveStatus("Saving recovery…");
        const existing = this.plugin.app.vault.getAbstractFileByPath(key);
        try {
            let recoveredFile: TFile;
            if (existing instanceof TFile) {
                await this.plugin.app.vault.modify(existing, conflict.draft);
                recoveredFile = existing;
            } else {
                this.releaseSession(key);
                recoveredFile = await this.plugin.app.vault.create(
                    key,
                    conflict.draft
                );
            }
            if (!isCurrent()) return;
            this.clearConflictProbe(key);
            this.dirtyBaselines.delete(key);
            this.conflicts.delete(key);
            this.localDrafts.delete(key);
            contentApplied = true;
            await this.upsertFile(recoveredFile, "Saved", conflict.draft);
        } catch (error) {
            if (contentApplied) {
                reportProjectionFailure(error);
                return;
            }
            if (!isCurrent()) return;
            this.conflicts.set(key, conflict);
            this.localDrafts.set(key, conflict.draft);
            this.cardList.getCard(key)?.showConflict(conflict.kind, conflict.draft);
            this.cardList.getCard(key)?.setSaveStatus("Recovery failed; draft retained");
            console.error(`Failed to recover Journal V2 draft for ${key}:`, error);
        }
    }

    private async activateVirtualToday(key: string): Promise<void> {
        const current = this.virtualCreates.get(key);
        if (current) return current;
        const activation = this.performVirtualTodayActivation(key)
            .finally(() => {
                this.virtualCreates.delete(key);
            });
        this.virtualCreates.set(key, activation);
        return activation;
    }

    private async performVirtualTodayActivation(key: string): Promise<void> {
        const card = this.cardList.getCard(key);
        if (!card?.getItem().isVirtualToday) return;
        card.setSaveStatus("Creating today’s journal…");
        try {
            const folderPath = normalizePath(this.configuredJournalFolder);
            const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                throw new Error(`Journal folder not found: ${folderPath}`);
            }
            const existing = this.plugin.app.vault.getAbstractFileByPath(key);
            const file = existing instanceof TFile
                ? existing
                : await this.plugin.app.vault.create(key, "");
            this.activatedEmptyPaths.add(key);
            this.priorityMounts.add(key);
            await this.upsertFile(file, existing instanceof TFile ? "Synced" : "Added", "");
            const realCard = this.cardList.getCard(key);
            if (!realCard) throw new Error("Today’s journal card was not promoted");
            this.requestMount(realCard);
            await this.waitForSession(key);
            if (!this.sessions.get(key)?.focus()) {
                throw new Error("Today’s journal editor did not receive focus");
            }
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Could not create today’s journal";
            this.activatedEmptyPaths.delete(key);
            const existing = this.plugin.app.vault.getAbstractFileByPath(key);
            if (existing instanceof TFile) {
                try {
                    const content = await this.plugin.app.vault.cachedRead(existing);
                    if (content.trim().length === 0) {
                        await this.upsertFile(existing, "Synced", content);
                    }
                } catch (recoveryError) {
                    console.error(
                        `Failed to restore Journal V2 retry state for ${key}:`,
                        recoveryError
                    );
                }
            }
            const retryCard = this.cardList.getCard(key);
            if (retryCard?.getItem().isVirtualToday) {
                retryCard.setVirtualError(message);
            } else retryCard?.setSaveStatus(message);
            console.error(`Failed to activate Journal V2 today card for ${key}:`, error);
        } finally {
            this.priorityMounts.delete(key);
        }
    }

    private async waitForSession(key: string): Promise<void> {
        const ownerWindow = this.parentLeaf.containerEl.ownerDocument.defaultView;
        if (!ownerWindow) throw new Error("Journal window is unavailable");
        const deadline = Date.now() + 3500;
        while (!this.sessions.has(key) && Date.now() < deadline) {
            if (this.abortController.signal.aborted) {
                throw new Error("Journal view closed while mounting today’s editor");
            }
            await new Promise<void>((resolve) => {
                ownerWindow.setTimeout(resolve, 16);
            });
        }
        if (!this.sessions.has(key)) {
            throw new Error("Today’s journal editor did not become ready");
        }
    }

    private async openSourceFile(key: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(key);
        if (!(file instanceof TFile)) return;
        const leaf = this.plugin.app.workspace.getLeaf(true);
        await leaf.openFile(file, { active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    private async writeClipboard(content: string): Promise<void> {
        const clipboard = this.parentLeaf.containerEl.ownerDocument.defaultView
            ?.navigator.clipboard;
        if (!clipboard) throw new Error("Clipboard API is unavailable");
        await clipboard.writeText(content);
    }

    private migratePathState(
        oldPath: string,
        newPath: string,
        draft: string | undefined,
        diskContent: string
    ): void {
        this.pendingMounts.delete(oldPath);
        const cardMoved = this.cardList.renameKey(oldPath, newPath);
        if (!cardMoved) this.releaseSession(oldPath);

        const session = this.sessions.get(oldPath);
        if (cardMoved && session) {
            this.sessions.delete(oldPath);
            session.renamePath(newPath);
            this.sessions.set(newPath, session);
        }
        const oldLease = this.sessionLeases.get(oldPath);
        if (cardMoved && oldLease) {
            this.sessionLeases.delete(oldPath);
            const nextLease = this.editorPool.rename(
                oldPath,
                newPath,
                () => this.handlePoolEviction(newPath)
            );
            if (nextLease) this.sessionLeases.set(newPath, nextLease);
        }
        const editorState = this.editorStates.get(oldPath);
        this.editorStates.delete(oldPath);
        if (cardMoved && editorState) this.editorStates.set(newPath, editorState);
        if (this.focusedKey === oldPath) {
            this.focusedKey = cardMoved ? newPath : null;
        }
        this.clearConflictProbe(oldPath);
        const dirtyBaseline = this.dirtyBaselines.get(oldPath);
        this.dirtyBaselines.delete(oldPath);
        if (cardMoved && dirtyBaseline) {
            this.dirtyBaselines.set(newPath, dirtyBaseline);
        }
        if (draft === undefined) return;
        this.localDrafts.set(newPath, draft);
        if (!journalContentsEqual(draft, diskContent)) {
            if (this.sessions.has(newPath)) {
                // A native editor still owns this buffer after a rename.
                // Disk lag is not evidence of an external writer.
                this.scheduleConflictProbe(newPath);
                return;
            }
            this.conflicts.set(newPath, {
                diskContent,
                draft,
                kind: "modified",
                path: newPath,
            });
        } else {
            this.localDrafts.delete(newPath);
        }
    }

    private scheduleConflictProbe(key: string): void {
        if (
            this.abortController.signal.aborted ||
            !this.localDrafts.has(key) ||
            this.conflictProbeTimers.has(key) ||
            this.conflicts.has(key)
        ) return;
        const ownerWindow = this.parentLeaf.containerEl.ownerDocument.defaultView;
        if (!ownerWindow) return;
        const timer = ownerWindow.setTimeout(() => {
            this.conflictProbeTimers.delete(key);
            void this.probeDirtyPath(key);
        }, JOURNAL_CONFLICT_PROBE_MS);
        this.conflictProbeTimers.set(key, timer);
    }

    private loadDirtyBaseline(key: string): void {
        if (this.dirtyBaselineLoads.has(key)) return;
        const draftAtStart = this.localDrafts.get(key);
        const fileAtStart = this.plugin.app.vault.getAbstractFileByPath(key);
        if (draftAtStart === undefined || !(fileAtStart instanceof TFile)) return;
        let staleRead = false;
        const load = this.plugin.app.vault.adapter.read(key)
            .then((content) => {
                if (
                    this.abortController.signal.aborted ||
                    this.conflicts.has(key)
                ) {
                    return;
                }
                if (
                    this.localDrafts.get(key) !== draftAtStart ||
                    this.plugin.app.vault.getAbstractFileByPath(key) !== fileAtStart
                ) {
                    staleRead = true;
                    return;
                }
                this.dirtyBaselines.set(key, { content });
                this.scheduleConflictProbe(key);
            })
            .catch(() => undefined)
            .finally(() => {
                this.dirtyBaselineLoads.delete(key);
                if (
                    staleRead &&
                    !this.abortController.signal.aborted &&
                    this.localDrafts.has(key) &&
                    !this.conflicts.has(key)
                ) {
                    this.loadDirtyBaseline(key);
                }
            });
        this.dirtyBaselineLoads.set(key, load);
    }

    private async probeDirtyPath(key: string): Promise<void> {
        const draft = this.localDrafts.get(key);
        const baseline = this.dirtyBaselines.get(key);
        if (
            this.abortController.signal.aborted ||
            draft === undefined ||
            !baseline ||
            this.conflicts.has(key)
        ) return;
        const file = this.plugin.app.vault.getAbstractFileByPath(key);
        if (!(file instanceof TFile)) return;
        const stillCurrent = () =>
            !this.abortController.signal.aborted &&
            this.localDrafts.get(key) === draft &&
            this.dirtyBaselines.get(key) === baseline &&
            !this.conflicts.has(key) &&
            this.plugin.app.vault.getAbstractFileByPath(key) === file;
        let diskContent: string;
        try {
            diskContent = await this.plugin.app.vault.adapter.read(key);
        } catch {
            if (!this.abortController.signal.aborted) this.scheduleConflictProbe(key);
            return;
        }
        if (!stillCurrent()) {
            this.scheduleConflictProbe(key);
            return;
        }
        const liveContent = this.sessions.get(key)?.getContent();
        if (liveContent !== null && liveContent !== undefined &&
            !journalContentsEqual(draft, liveContent)) {
            this.captureLocalDraft(key);
            return;
        }
        if (journalContentsEqual(diskContent, draft)) {
            this.localDrafts.delete(key);
            this.dirtyBaselines.delete(key);
            this.updateEditorActivity(key);
            await this.upsertFile(file, "Saved", diskContent);
            return;
        }
        if (this.sessions.has(key)) {
            this.scheduleConflictProbe(key);
            return;
        }
        if (!journalContentsEqual(diskContent, baseline.content)) {
            this.releaseSession(key);
            this.conflicts.set(key, {
                diskContent,
                draft,
                kind: "modified",
                path: key,
            });
            this.cardList.getCard(key)?.showConflict("modified", draft);
            return;
        }
        this.scheduleConflictProbe(key);
    }

    private clearConflictProbe(key: string): void {
        const timer = this.conflictProbeTimers.get(key);
        if (timer === undefined) return;
        this.parentLeaf.containerEl.ownerDocument.defaultView?.clearTimeout(timer);
        this.conflictProbeTimers.delete(key);
    }

    private clearLocalEditCapture(key: string): void {
        const timer = this.localEditCaptureTimers.get(key);
        if (timer === undefined) return;
        this.parentLeaf.containerEl.ownerDocument.defaultView?.clearTimeout(timer);
        this.localEditCaptureTimers.delete(key);
    }

    private refreshEditorActivities(): void {
        for (const key of this.sessionLeases.keys()) {
            this.updateEditorActivity(key);
        }
    }

    private updateEditorActivity(key: string): void {
        const card = this.cardList.getCard(key);
        const lease = this.sessionLeases.get(key);
        if (card && lease) lease.setActivity(this.getEditorActivity(card));
    }

    private getEditorActivity(card: JournalCard): JournalEditorActivity {
        const ownerWindow = card.rootEl.ownerDocument.defaultView;
        if (!ownerWindow || !card.rootEl.isConnected) {
            return {
                collapsed: card.isCollapsed(),
                distance: Number.POSITIVE_INFINITY,
                focused: this.focusedKey === card.getItem().key,
                pendingSave: this.localDrafts.has(card.getItem().key),
                visible: false,
            };
        }
        const rect = card.rootEl.getBoundingClientRect();
        const visible =
            !card.isCollapsed() &&
            rect.bottom > 0 &&
            rect.top < ownerWindow.innerHeight;
        const distance = visible
            ? 0
            : Math.max(0, rect.top > ownerWindow.innerHeight
                ? rect.top - ownerWindow.innerHeight
                : -rect.bottom);
        return {
            collapsed: card.isCollapsed(),
            distance,
            focused: this.focusedKey === card.getItem().key,
            pendingSave: this.localDrafts.has(card.getItem().key),
            visible,
        };
    }

    private isNearViewport(element: HTMLElement): boolean {
        if (!element.isConnected) return false;
        const ownerWindow = element.ownerDocument.defaultView;
        if (!ownerWindow) return false;
        const rect = element.getBoundingClientRect();
        return (
            rect.bottom >= -100 &&
            rect.top <= ownerWindow.innerHeight + 100
        );
    }

    private getVirtualTodayProjection(
        now: number,
        query: JournalQuery = this.state.query
    ): VirtualTodayProjection | null {
        if (
            query.selectionMode !== "folder" ||
            normalizePath(query.target) !==
                normalizePath(this.configuredJournalFolder) ||
            !isTimeInRange(
                now,
                now,
                query.selectedRange,
                query.customRange
            )
        ) {
            return null;
        }

        const date = new Date(now);
        const year = String(date.getFullYear()).slice(2);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const dateLabel = `${date.getFullYear()}-${month}-${day}`;
        const path = normalizePath(
            `${this.configuredJournalFolder}/${year}${month}${day}.md`
        );
        const { isReverse } = parseTimeField(query.timeField);

        return {
            dateLabel,
            dateTime: new Date(
                date.getFullYear(),
                date.getMonth(),
                date.getDate()
            ).valueOf(),
            path,
            position: isReverse ? "last" : "first",
        };
    }
}
