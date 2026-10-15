import { App, TFile, TFolder } from "obsidian";
import { getAllDailyNotes } from "obsidian-daily-notes-interface";
import type { JournalQuery, JournalSourceRecord } from "../contracts";
import { getJournalDateInfoFromParts } from "../../utils/journalCore";
import { fileHasTag } from "../../utils/fileSource";
import {
    isFileInFolder,
    sortAndFilterJournalFiles,
} from "../../utils/fileSource";

interface JournalCandidate {
    basename: string;
    file: TFile;
    frontmatter?: { created?: unknown; date?: unknown };
    name: string;
    path: string;
    stat: { ctime: number; mtime: number };
}

// Keep source refreshes within the same read budget as in-view search.
const SOURCE_READ_CONCURRENCY = 12;
const SOURCE_SLOT_WAIT_TIMEOUT_MS = 5000;
const SOURCE_READ_TIMEOUT_MS = 15000;

export class JournalSourceBusyError extends Error {
    constructor() {
        super("Journal source reads are busy; use Refresh to retry");
    }
}

export class JournalSourceReadTimeoutError extends Error {
    constructor() {
        super("Journal source read timed out; use Refresh to retry");
    }
}

export class JournalSourceRepository {
    private activeSourceReads = 0;
    private readonly waitingSourceReads: Array<() => void> = [];

    constructor(
        private readonly app: App,
        private readonly slotWaitTimeoutMs = SOURCE_SLOT_WAIT_TIMEOUT_MS,
        private readonly readTimeoutMs = SOURCE_READ_TIMEOUT_MS
    ) {}

    async query(
        query: JournalQuery,
        now = Date.now(),
        signal?: AbortSignal
    ): Promise<JournalSourceRecord[]> {
        const candidates = this.collectCandidates(query);
        const selected = sortAndFilterJournalFiles(
            candidates,
            query.timeField,
            query.selectedRange,
            now,
            query.customRange
        );

        const records = new Array<JournalSourceRecord>(selected.length);
        let nextIndex = 0;
        let failed = false;
        const readNext = async (): Promise<void> => {
            while (!failed && !signal?.aborted && nextIndex < selected.length) {
                const index = nextIndex++;
                const candidate = selected[index];
                try {
                    if (failed || signal?.aborted) return;
                    const content = await this.readContent(
                        candidate.file,
                        signal,
                        () => failed
                    );
                    const dateInfo = getJournalDateInfoFromParts(candidate);
                    records[index] = {
                        content,
                        dateLabel: dateInfo.label,
                        dateTime: dateInfo.time,
                        file: candidate.file,
                        isStrictlyEmpty: content.trim().length === 0,
                        path: candidate.path,
                    };
                } catch (error) {
                    failed = true;
                    throw error;
                }
            }
        };
        await Promise.all(
            Array.from(
                { length: Math.min(SOURCE_READ_CONCURRENCY, selected.length) },
                readNext
            )
        );
        return records;
    }

    contains(file: TFile, query: JournalQuery, now = Date.now()): boolean {
        if (file.extension !== "md" || !this.matchesSource(file, query)) {
            return false;
        }
        return sortAndFilterJournalFiles(
            [this.toCandidate(file)],
            query.timeField,
            query.selectedRange,
            now,
            query.customRange
        ).length > 0;
    }

    async readIfIncluded(
        file: TFile,
        query: JournalQuery,
        now = Date.now(),
        knownContent?: string
    ): Promise<JournalSourceRecord | null> {
        if (!this.contains(file, query, now)) return null;
        const candidate = this.toCandidate(file);
        const content = knownContent ?? await this.readContent(file);
        const dateInfo = getJournalDateInfoFromParts(candidate);
        return {
            content,
            dateLabel: dateInfo.label,
            dateTime: dateInfo.time,
            file,
            isStrictlyEmpty: content.trim().length === 0,
            path: candidate.path,
        };
    }

    private async readContent(
        file: TFile,
        signal?: AbortSignal,
        isObsolete?: () => boolean
    ): Promise<string> {
        await this.acquireSourceReadSlot(signal);
        if (signal?.aborted || isObsolete?.()) {
            this.releaseSourceReadSlot();
            throw new Error("Journal source query was cancelled");
        }

        let nativeRead: Promise<string>;
        try {
            nativeRead = Promise.resolve(this.app.vault.cachedRead(file));
        } catch (error) {
            this.releaseSourceReadSlot();
            throw error;
        }

        // Obsidian's cachedRead cannot be cancelled. Keep the physical slot
        // until the native promise settles, even if our caller times out.
        void nativeRead.then(
            () => this.releaseSourceReadSlot(),
            () => this.releaseSourceReadSlot()
        );
        return this.waitForNativeRead(nativeRead, signal);
    }

    private waitForNativeRead(
        nativeRead: Promise<string>,
        signal?: AbortSignal
    ): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const ownerWindow = this.app.workspace.containerEl.ownerDocument
                .defaultView ?? window;
            let timer = 0;
            let settled = false;
            const cleanup = () => {
                ownerWindow.clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const onAbort = () => finish(() =>
                reject(new Error("Journal source query was cancelled"))
            );
            signal?.addEventListener("abort", onAbort, { once: true });
            timer = ownerWindow.setTimeout(() => finish(() =>
                reject(new JournalSourceReadTimeoutError())
            ), this.readTimeoutMs);
            void nativeRead.then(
                (content) => finish(() => resolve(content)),
                (error: unknown) => finish(() => reject(
                    error instanceof Error ? error : new Error("Journal source read failed")
                ))
            );
            if (signal?.aborted) onAbort();
        });
    }

    private async acquireSourceReadSlot(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) throw new Error("Journal source query was cancelled");
        if (this.activeSourceReads < SOURCE_READ_CONCURRENCY) {
            this.activeSourceReads += 1;
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const ownerWindow = this.app.workspace.containerEl.ownerDocument
                .defaultView ?? window;
            let timer = 0;
            const removeWaiter = () => {
                const index = this.waitingSourceReads.indexOf(grant);
                if (index >= 0) this.waitingSourceReads.splice(index, 1);
            };
            const cleanup = () => {
                ownerWindow.clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
                removeWaiter();
                cleanup();
                reject(new Error("Journal source query was cancelled"));
            };
            const grant = () => {
                cleanup();
                resolve();
            };
            this.waitingSourceReads.push(grant);
            signal?.addEventListener("abort", onAbort, { once: true });
            timer = ownerWindow.setTimeout(() => {
                removeWaiter();
                cleanup();
                reject(new JournalSourceBusyError());
            }, this.slotWaitTimeoutMs);
            if (signal?.aborted) onAbort();
        });
    }

    private releaseSourceReadSlot(): void {
        const next = this.waitingSourceReads.shift();
        // Transfer the occupied slot directly so concurrent queries share the cap.
        if (next) next();
        else this.activeSourceReads -= 1;
    }

    private collectCandidates(query: JournalQuery): JournalCandidate[] {
        const files = this.collectFiles(query);
        return files.map((file) => this.toCandidate(file));
    }

    private matchesSource(file: TFile, query: JournalQuery): boolean {
        if (query.selectionMode === "daily") {
            return Object.values(getAllDailyNotes()).some(
                (dailyFile) => dailyFile.path === file.path
            );
        }
        if (query.selectionMode === "tag") {
            return fileHasTag(
                this.app.metadataCache.getFileCache(file),
                query.target
            );
        }
        return isFileInFolder(file, query.target);
    }

    private toCandidate(file: TFile): JournalCandidate {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return {
            basename: file.basename,
            file,
            frontmatter,
            name: file.name,
            path: file.path,
            stat: file.stat,
        };
    }

    private collectFiles(query: JournalQuery): TFile[] {
        if (query.selectionMode === "daily") {
            return Object.values(getAllDailyNotes());
        }

        if (query.selectionMode === "tag") {
            return this.app.vault
                .getMarkdownFiles()
                .filter((file) =>
                    fileHasTag(
                        this.app.metadataCache.getFileCache(file),
                        query.target
                    )
                );
        }

        const folder = this.app.vault.getAbstractFileByPath(query.target);
        return folder instanceof TFolder
            ? this.collectMarkdownFiles(folder)
            : [];
    }

    private collectMarkdownFiles(folder: TFolder): TFile[] {
        const files: TFile[] = [];
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                files.push(...this.collectMarkdownFiles(child));
            } else if (child instanceof TFile && child.extension === "md") {
                files.push(child);
            }
        }
        return files;
    }
}
