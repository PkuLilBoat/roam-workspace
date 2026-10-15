export interface ProductReadyBaselineState {
    path: string;
    editorMounted: boolean;
    editorReady: boolean;
    editorMountId: string | null;
    properties: {
        mountStatus: string | null;
    };
}

export interface ProductReadyBaselineOptions<
    State extends ProductReadyBaselineState,
> {
    expectedPath: string;
    expectedPropertiesMountStatus: string;
    now?: () => number;
    pollMs?: number;
    readState: () => State;
    timeoutMs?: number;
    wait: (milliseconds: number) => Promise<void>;
}

export async function waitForProductReadyBaseline<
    State extends ProductReadyBaselineState,
>({
    expectedPath,
    expectedPropertiesMountStatus,
    now = Date.now,
    pollMs = 50,
    readState,
    timeoutMs = 5000,
    wait,
}: ProductReadyBaselineOptions<State>) {
    assertPositiveDuration(timeoutMs, "timeoutMs");
    assertPositiveDuration(pollMs, "pollMs");

    const startedAt = now();
    let polls = 0;
    let state = readState();

    while (true) {
        if (state.path !== expectedPath) {
            return failedResult(
                "unexpected-target-path",
                state,
                startedAt,
                now,
                polls,
                expectedPropertiesMountStatus
            );
        }
        if (isProductReady(state, expectedPropertiesMountStatus)) {
            return {
                status: "ready" as const,
                baseline: state,
                elapsedMs: Math.max(0, now() - startedAt),
                polls,
                unmet: [] as string[],
            };
        }

        const elapsedMs = Math.max(0, now() - startedAt);
        if (elapsedMs >= timeoutMs) {
            return failedResult(
                "product-ready-baseline-timeout",
                state,
                startedAt,
                now,
                polls,
                expectedPropertiesMountStatus
            );
        }

        await wait(Math.min(pollMs, timeoutMs - elapsedMs));
        polls += 1;
        state = readState();
    }
}

function isProductReady(
    state: ProductReadyBaselineState,
    expectedPropertiesMountStatus: string
): boolean {
    return (
        state.editorMounted &&
        state.editorReady &&
        typeof state.editorMountId === "string" &&
        state.editorMountId.length > 0 &&
        state.properties.mountStatus === expectedPropertiesMountStatus
    );
}

function failedResult<State extends ProductReadyBaselineState>(
    reason: "unexpected-target-path" | "product-ready-baseline-timeout",
    state: State,
    startedAt: number,
    now: () => number,
    polls: number,
    expectedPropertiesMountStatus: string
) {
    return {
        status: "failed" as const,
        reason,
        lastState: state,
        elapsedMs: Math.max(0, now() - startedAt),
        polls,
        unmet: collectUnmet(state, expectedPropertiesMountStatus),
    };
}

function collectUnmet(
    state: ProductReadyBaselineState,
    expectedPropertiesMountStatus: string
): string[] {
    const unmet: string[] = [];
    if (!state.editorMounted) unmet.push("editor-mounted");
    if (!state.editorReady) unmet.push("editor-ready");
    if (
        typeof state.editorMountId !== "string" ||
        state.editorMountId.length === 0
    ) {
        unmet.push("editor-mount-id");
    }
    if (state.properties.mountStatus !== expectedPropertiesMountStatus) {
        unmet.push(`properties-${expectedPropertiesMountStatus}`);
    }
    return unmet;
}

function assertPositiveDuration(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive finite number`);
    }
}
