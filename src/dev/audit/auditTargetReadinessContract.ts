export interface AuditTargetReadinessState {
    path: string;
    editorMounted: boolean;
    editorReady: boolean;
    editorMountId: string | null;
}

export interface AuditTargetOwnershipState {
    auditPinActive: boolean;
    visible: boolean;
    renderRequested: boolean;
}

export interface AuditTargetReadinessProbeOptions {
    expectedPath: string;
    readState: () => AuditTargetReadinessState;
    readOwnership: () => AuditTargetOwnershipState;
    acquire: () => Promise<void> | void;
    release: () => Promise<void> | void;
    wait: (milliseconds: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    pollMs?: number;
}

export async function runAuditTargetReadinessProbe(
    options: AuditTargetReadinessProbeOptions
) {
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? 5000;
    const pollMs = options.pollMs ?? 50;
    const before = options.readState();
    const ownershipBefore = options.readOwnership();
    let ready: AuditTargetReadinessState | null = null;
    let ownershipHeld: AuditTargetOwnershipState | null = null;
    let acquireAttempted = false;
    let acquireError: string | null = null;
    let releaseAttempted = false;
    let releaseError: string | null = null;
    let reason: string | null = validateBaseline(
        options.expectedPath,
        before,
        ownershipBefore
    );

    try {
        if (!reason) {
            acquireAttempted = true;
            try {
                await options.acquire();
            } catch (error) {
                acquireError = errorMessage(error);
                reason = "audit-ownership-acquire-failed";
            }
        }

        if (!reason) {
            ownershipHeld = options.readOwnership();
            if (
                !ownershipHeld.auditPinActive ||
                ownershipHeld.visible ||
                !ownershipHeld.renderRequested
            ) {
                reason = "audit-ownership-invalid";
            }
        }

        if (!reason) {
            const deadline = now() + timeoutMs;
            while (now() <= deadline) {
                const state = options.readState();
                if (isReady(options.expectedPath, state)) {
                    ready = state;
                    break;
                }
                await options.wait(pollMs);
            }
            if (!ready) reason = "target-readiness-timeout";
        }
    } finally {
        releaseAttempted = true;
        try {
            await options.release();
        } catch (error) {
            releaseError = errorMessage(error);
        }
    }

    const ownershipReleased = options.readOwnership();
    const afterRelease = options.readState();
    const ownershipClean =
        !ownershipReleased.auditPinActive &&
        !ownershipReleased.visible &&
        !ownershipReleased.renderRequested;
    if (releaseError) reason ??= "audit-ownership-release-failed";
    if (!ownershipClean) reason ??= "audit-ownership-not-released";

    return {
        status: reason ? ("failed" as const) : ("passed" as const),
        ...(reason ? { reason } : {}),
        expectedPath: options.expectedPath,
        before,
        ownershipBefore,
        ownershipHeld,
        ready,
        afterRelease,
        cleanup: {
            acquireAttempted,
            acquireError,
            releaseAttempted,
            releaseError,
            ownershipReleased,
            ownershipClean,
        },
    };
}

function validateBaseline(
    expectedPath: string,
    state: AuditTargetReadinessState,
    ownership: AuditTargetOwnershipState
) {
    if (state.path !== expectedPath) return "unexpected-target-path";
    if (state.editorMounted || state.editorReady || state.editorMountId !== null) {
        return "target-not-offscreen-at-baseline";
    }
    if (
        ownership.auditPinActive ||
        ownership.visible ||
        ownership.renderRequested
    ) {
        return "target-owned-at-baseline";
    }
    return null;
}

function isReady(expectedPath: string, state: AuditTargetReadinessState) {
    return (
        state.path === expectedPath &&
        state.editorMounted &&
        state.editorReady &&
        typeof state.editorMountId === "string" &&
        state.editorMountId.length > 0
    );
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
