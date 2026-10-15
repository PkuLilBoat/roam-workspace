export type StreamEditorEvict = () => void;
export type StreamEditorEvictErrorHandler = (error: unknown, key: string) => void;
export const MAX_STREAM_EDITORS = 5;

export interface StreamEditorLease {
    readonly granted: boolean;
    release(): void;
    setPinned(pinned: boolean): void;
    touch(): void;
}

type PoolEntry = {
    evict: StreamEditorEvict;
    generation: number;
    key: string;
    lastUsed: number;
    pinned: boolean;
};

export class StreamEditorPool {
    private readonly entries = new Map<string, PoolEntry>();
    private sequence = 0;

    constructor(
        readonly maxEditors = MAX_STREAM_EDITORS,
        private readonly onEvictError: StreamEditorEvictErrorHandler = () => undefined
    ) {
        if (
            !Number.isInteger(maxEditors) ||
            maxEditors < 1 ||
            maxEditors > MAX_STREAM_EDITORS
        ) {
            throw new Error(
                `Stream editor pool size must be an integer from 1 to ${MAX_STREAM_EDITORS}.`
            );
        }
    }

    acquire(key: string, evict: StreamEditorEvict): StreamEditorLease {
        const current = this.entries.get(key);
        if (current) {
            this.entries.delete(key);
            this.evictSafely(current);
            current.generation = this.nextSequence();
            current.evict = evict;
            current.lastUsed = this.nextSequence();
            current.pinned = false;
            this.entries.set(key, current);
            return this.createLease(key, current.generation, true);
        }

        if (this.entries.size >= this.maxEditors && !this.evictLeastRecentlyUsed()) {
            return this.createLease(key, 0, false);
        }

        const generation = this.nextSequence();
        this.entries.set(key, {
            evict,
            generation,
            key,
            lastUsed: this.nextSequence(),
            pinned: false,
        });
        return this.createLease(key, generation, true);
    }

    clear(): void {
        const entries = Array.from(this.entries.values());
        this.entries.clear();
        for (const entry of entries) this.evictSafely(entry);
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    get size(): number {
        return this.entries.size;
    }

    keys(): string[] {
        return Array.from(this.entries.keys());
    }

    private createLease(
        key: string,
        generation: number,
        granted: boolean
    ): StreamEditorLease {
        const getEntry = () => {
            const entry = this.entries.get(key);
            return entry?.generation === generation ? entry : null;
        };
        return {
            granted,
            release: () => {
                if (!granted) return;
                const entry = getEntry();
                if (!entry) return;
                this.entries.delete(key);
                this.evictSafely(entry);
            },
            setPinned: (pinned) => {
                if (!granted) return;
                const entry = getEntry();
                if (!entry) return;
                entry.pinned = pinned;
            },
            touch: () => {
                if (!granted) return;
                const entry = getEntry();
                if (entry) entry.lastUsed = this.nextSequence();
            },
        };
    }

    private evictLeastRecentlyUsed(): boolean {
        let candidate: PoolEntry | null = null;
        for (const entry of this.entries.values()) {
            if (entry.pinned) continue;
            if (!candidate || entry.lastUsed < candidate.lastUsed) candidate = entry;
        }
        if (!candidate) return false;

        this.entries.delete(candidate.key);
        this.evictSafely(candidate);
        return true;
    }

    private evictSafely(entry: PoolEntry): void {
        try {
            entry.evict();
        } catch (error) {
            this.onEvictError(error, entry.key);
        }
    }

    private nextSequence(): number {
        this.sequence += 1;
        return this.sequence;
    }
}
