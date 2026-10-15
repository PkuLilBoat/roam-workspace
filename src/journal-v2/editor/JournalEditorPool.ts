import { MAX_STREAM_EDITORS } from "../../utils/streamEditorPool";

export interface JournalEditorActivity {
    collapsed: boolean;
    distance: number;
    focused: boolean;
    pendingSave?: boolean;
    visible: boolean;
}

export interface JournalEditorLease {
    readonly granted: boolean;
    release(): void;
    setActivity(activity: JournalEditorActivity): void;
    touch(): void;
}

export interface JournalEditorAcquireOptions {
    allowVisibleEviction?: boolean;
}

interface JournalEditorPoolEntry {
    activity: JournalEditorActivity;
    evict: () => void;
    generation: number;
    key: string;
    lastUsed: number;
}

const DEFAULT_ACTIVITY: JournalEditorActivity = {
    collapsed: false,
    distance: Number.POSITIVE_INFINITY,
    focused: false,
    visible: false,
};

export class JournalEditorPool {
    private readonly entries = new Map<string, JournalEditorPoolEntry>();
    private sequence = 0;

    constructor(
        readonly maxEditors = MAX_STREAM_EDITORS,
        private readonly onEvictError: (error: unknown, key: string) => void =
            () => undefined
    ) {
        if (
            !Number.isInteger(maxEditors) ||
            maxEditors < 1 ||
            maxEditors > MAX_STREAM_EDITORS
        ) {
            throw new Error(
                `Journal editor pool size must be an integer from 1 to ${MAX_STREAM_EDITORS}.`
            );
        }
    }

    acquire(
        key: string,
        evict: () => void,
        activity: JournalEditorActivity = DEFAULT_ACTIVITY,
        options: JournalEditorAcquireOptions = {}
    ): JournalEditorLease {
        this.assertActivity(activity);
        const current = this.entries.get(key);
        if (current) {
            this.entries.delete(key);
            this.evictSafely(current);
        }

        if (
            this.entries.size >= this.maxEditors &&
            !this.evictFarthestUnpinned(options.allowVisibleEviction ?? false)
        ) {
            return this.createLease(key, 0, false);
        }

        const generation = this.nextSequence();
        this.entries.set(key, {
            activity: { ...activity },
            evict,
            generation,
            key,
            lastUsed: this.nextSequence(),
        });
        return this.createLease(key, generation, true);
    }

    clear(): void {
        const entries = [...this.entries.values()];
        this.entries.clear();
        for (const entry of entries) this.evictSafely(entry);
    }

    has(key: string): boolean {
        return this.entries.has(key);
    }

    keys(): string[] {
        return [...this.entries.keys()];
    }

    rename(
        oldKey: string,
        newKey: string,
        evict: () => void
    ): JournalEditorLease | null {
        if (oldKey === newKey) {
            const current = this.entries.get(oldKey);
            return current
                ? this.createLease(oldKey, current.generation, true)
                : null;
        }
        const entry = this.entries.get(oldKey);
        if (!entry || this.entries.has(newKey)) return null;
        this.entries.delete(oldKey);
        const generation = this.nextSequence();
        entry.evict = evict;
        entry.generation = generation;
        entry.key = newKey;
        this.entries.set(newKey, entry);
        return this.createLease(newKey, generation, true);
    }

    get size(): number {
        return this.entries.size;
    }

    private assertActivity(activity: JournalEditorActivity): void {
        if (Number.isNaN(activity.distance) || activity.distance < 0) {
            throw new Error("Journal editor distance must be non-negative.");
        }
    }

    private createLease(
        key: string,
        generation: number,
        granted: boolean
    ): JournalEditorLease {
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
            setActivity: (activity) => {
                if (!granted) return;
                this.assertActivity(activity);
                const entry = getEntry();
                if (!entry) return;
                const becameImportant =
                    (!entry.activity.focused && activity.focused) ||
                    (!entry.activity.visible && activity.visible) ||
                    (entry.activity.collapsed && !activity.collapsed);
                entry.activity = { ...activity };
                if (becameImportant) entry.lastUsed = this.nextSequence();
            },
            touch: () => {
                if (!granted) return;
                const entry = getEntry();
                if (entry) entry.lastUsed = this.nextSequence();
            },
        };
    }

    private evictFarthestUnpinned(allowVisibleEviction: boolean): boolean {
        let candidate: JournalEditorPoolEntry | null = null;
        for (const entry of this.entries.values()) {
            if (
                entry.activity.focused ||
                entry.activity.pendingSave ||
                (!allowVisibleEviction && this.isPinned(entry.activity))
            ) {
                continue;
            }
            if (!candidate || this.shouldEvictBefore(entry, candidate)) {
                candidate = entry;
            }
        }
        if (!candidate) return false;
        this.entries.delete(candidate.key);
        this.evictSafely(candidate);
        return true;
    }

    private isPinned(activity: JournalEditorActivity): boolean {
        return activity.focused || !!activity.pendingSave ||
            (!activity.collapsed && activity.visible);
    }

    private shouldEvictBefore(
        left: JournalEditorPoolEntry,
        right: JournalEditorPoolEntry
    ): boolean {
        if (left.activity.distance !== right.activity.distance) {
            return left.activity.distance > right.activity.distance;
        }
        if (left.activity.collapsed !== right.activity.collapsed) {
            return left.activity.collapsed;
        }
        return left.lastUsed < right.lastUsed;
    }

    private evictSafely(entry: JournalEditorPoolEntry): void {
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
