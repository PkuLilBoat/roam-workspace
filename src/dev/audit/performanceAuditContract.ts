export const PERFORMANCE_FIXTURE_ROOT =
    "Journal/_journal_stream_performance/";

export interface PerformanceEditorState {
    editorMounted?: boolean;
    editorReady?: boolean;
}

export type PerformanceRecentFileRecorder =
    | {
          kind: "recent-file-tracker";
          target: {
              collect(value: unknown): void;
          };
      }
    | {
          kind: "legacy-workspace";
          target: {
              recordMostRecentOpenedFile(value: unknown): void;
          };
      };

export interface PerformanceEditorReadinessOptions<
    State extends PerformanceEditorState,
> {
    now?: () => number;
    pollIntervalMs?: number;
    readState: () => State;
    timeoutMs?: number;
    wait: (milliseconds: number) => Promise<void>;
}

export interface PerformanceAuditQuiescenceOptions {
    now?: () => number;
    pollIntervalMs?: number;
    quietMs?: number;
    readRevision: () => number;
    timeoutMs?: number;
    wait: (milliseconds: number) => Promise<void>;
}

export type PerformanceEditorReadinessResult<
    State extends PerformanceEditorState,
> = {
    elapsedMs: number;
    state: State;
    status: "ready" | "timeout";
};

export type PerformanceAuditQuiescenceResult = {
    elapsedMs: number;
    revision: number;
    status: "quiescent" | "timeout";
};

export async function waitForPerformanceEditorReady<
    State extends PerformanceEditorState,
>({
    now = () => Date.now(),
    pollIntervalMs = 50,
    readState,
    timeoutMs = 30000,
    wait,
}: PerformanceEditorReadinessOptions<State>): Promise<
    PerformanceEditorReadinessResult<State>
> {
    assertPositiveDuration(timeoutMs, "timeoutMs");
    assertPositiveDuration(pollIntervalMs, "pollIntervalMs");

    const startedAt = now();
    let state = readState();
    while (!isEditorReady(state)) {
        const elapsedMs = Math.max(0, now() - startedAt);
        if (elapsedMs >= timeoutMs) {
            return { elapsedMs, state, status: "timeout" };
        }

        await wait(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
        state = readState();
    }

    return {
        elapsedMs: Math.max(0, now() - startedAt),
        state,
        status: "ready",
    };
}

export function isPerformanceFixtureFile(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        "path" in value &&
        typeof value.path === "string" &&
        value.path.startsWith(PERFORMANCE_FIXTURE_ROOT)
    );
}

export function resolvePerformanceRecentFileRecorder(
    workspace: unknown,
    workspacePrototype: unknown
): PerformanceRecentFileRecorder | null {
    const tracker = readUnknownProperty(workspace, "recentFileTracker");
    if (hasCallableProperty(tracker, "collect")) {
        return {
            kind: "recent-file-tracker",
            target: tracker,
        };
    }

    if (hasCallableProperty(workspacePrototype, "recordMostRecentOpenedFile")) {
        return {
            kind: "legacy-workspace",
            target: workspacePrototype,
        };
    }

    return null;
}

export async function waitForPerformanceAuditQuiescence({
    now = () => Date.now(),
    pollIntervalMs = 50,
    quietMs = 2000,
    readRevision,
    timeoutMs = 10000,
    wait,
}: PerformanceAuditQuiescenceOptions): Promise<PerformanceAuditQuiescenceResult> {
    assertPositiveDuration(timeoutMs, "timeoutMs");
    assertPositiveDuration(pollIntervalMs, "pollIntervalMs");
    assertPositiveDuration(quietMs, "quietMs");
    if (quietMs > timeoutMs) {
        throw new Error("quietMs must not exceed timeoutMs");
    }

    const startedAt = now();
    let quietStartedAt = startedAt;
    let revision = readRevision();

    while (true) {
        const currentTime = now();
        if (currentTime - quietStartedAt >= quietMs) {
            return {
                elapsedMs: Math.max(0, currentTime - startedAt),
                revision,
                status: "quiescent",
            };
        }
        if (currentTime - startedAt >= timeoutMs) {
            return {
                elapsedMs: Math.max(0, currentTime - startedAt),
                revision,
                status: "timeout",
            };
        }

        await wait(
            Math.min(
                pollIntervalMs,
                quietMs - (currentTime - quietStartedAt),
                timeoutMs - (currentTime - startedAt)
            )
        );
        const nextRevision = readRevision();
        if (nextRevision !== revision) {
            revision = nextRevision;
            quietStartedAt = now();
        }
    }
}

export async function runPerformanceAuditTransaction<Result>({
    installRecentFileSuppression,
    run,
}: {
    installRecentFileSuppression: (
        shouldSuppress: (value: unknown) => boolean
    ) => () => void;
    run: () => Promise<Result>;
}): Promise<Result> {
    const dispose = installRecentFileSuppression(isPerformanceFixtureFile);
    if (typeof dispose !== "function") {
        throw new Error("recent-file-suppression-disposer-unavailable");
    }

    try {
        return await run();
    } finally {
        dispose();
    }
}

function isEditorReady(state: PerformanceEditorState): boolean {
    return state.editorMounted === true && state.editorReady === true;
}

function readUnknownProperty(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
}

function hasCallableProperty<Key extends string>(
    value: unknown,
    key: Key
): value is Record<Key, (argument: unknown) => void> {
    return typeof readUnknownProperty(value, key) === "function";
}

function assertPositiveDuration(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive finite number`);
    }
}
