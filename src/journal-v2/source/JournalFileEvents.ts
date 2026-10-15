import type { App, EventRef, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import {
    JournalSourceBusyError,
    JournalSourceReadTimeoutError,
} from "./JournalSourceRepository";

export type JournalFileEvent =
    | { type: "create"; file: TFile; path: string }
    | { type: "delete"; file: TFile; path: string }
    | { type: "modify"; file: TFile; path: string }
    | { type: "rename"; file: TFile; oldPath: string; path: string };

const EVENT_RETRY_DELAYS_MS = [0, 80, 240] as const;

export class JournalFileEvents {
    private readonly metadataRefs: EventRef[] = [];
    private readonly vaultRefs: EventRef[] = [];
    private disposed = false;
    private eventChain = Promise.resolve();

    constructor(
        private readonly app: App,
        private readonly handle: (event: JournalFileEvent) => Promise<void>,
        private readonly onEnqueue?: (event: JournalFileEvent) => void,
        private readonly onFailure?: (event: JournalFileEvent, error: unknown) => void
    ) {}

    start(): void {
        if (this.vaultRefs.length > 0 || this.disposed) return;
        this.vaultRefs.push(
            this.app.vault.on("create", (file) => {
                if (file instanceof ObsidianTFile) {
                    this.enqueue({ type: "create", file, path: file.path });
                }
            }),
            this.app.vault.on("delete", (file) => {
                if (file instanceof ObsidianTFile) {
                    this.enqueue({ type: "delete", file, path: file.path });
                }
            }),
            this.app.vault.on("modify", (file) => {
                if (file instanceof ObsidianTFile) {
                    this.enqueue({ type: "modify", file, path: file.path });
                }
            }),
            this.app.vault.on("rename", (file, oldPath) => {
                if (file instanceof ObsidianTFile) {
                    this.enqueue({ type: "rename", file, oldPath, path: file.path });
                }
            })
        );
        this.metadataRefs.push(
            this.app.metadataCache.on("changed", (file) => {
                this.enqueue({ type: "modify", file, path: file.path });
            })
        );
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const ref of this.vaultRefs) this.app.vault.offref(ref);
        for (const ref of this.metadataRefs) this.app.metadataCache.offref(ref);
        this.vaultRefs.length = 0;
        this.metadataRefs.length = 0;
    }

    private enqueue(event: JournalFileEvent): void {
        if (this.disposed) return;
        try {
            this.onEnqueue?.(event);
        } catch (error) {
            console.error("Failed to observe Journal V2 file event:", error);
        }
        this.eventChain = this.eventChain
            .then(async () => {
                for (const delay of EVENT_RETRY_DELAYS_MS) {
                    if (this.disposed) return;
                    if (delay > 0) {
                        const ownerWindow = this.app.workspace.containerEl.ownerDocument
                            .defaultView ?? window;
                        await new Promise<void>((resolve) => {
                            ownerWindow.setTimeout(resolve, delay);
                        });
                    }
                    if (this.disposed) return;
                    try {
                        await this.handle(event);
                        return;
                    } catch (error) {
                        if (
                            error instanceof JournalSourceBusyError ||
                            error instanceof JournalSourceReadTimeoutError ||
                            delay === EVENT_RETRY_DELAYS_MS.at(-1)
                        ) throw error;
                    }
                }
            })
            .catch((error: unknown) => {
                console.error("Failed to process Journal V2 file event:", error);
                try {
                    this.onFailure?.(event, error);
                } catch (recoveryError) {
                    console.error("Failed to recover Journal V2 file event:", recoveryError);
                }
            });
    }
}
