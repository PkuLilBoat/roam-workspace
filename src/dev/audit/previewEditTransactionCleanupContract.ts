export const INJECTED_PREVIEW_EDIT_FAILURE =
    "injected-preview-edit-failure-after-write";

export interface TargetWriteQuiescence {
    changesObserved: number;
    quietForMs: number;
    revisionAfter: number;
    revisionAtBarrier: number;
    status: "quiescent" | "timeout";
}

export async function waitForNoLateTargetWrites({
    readRevision,
    wait,
    now = Date.now,
    pollMs = 50,
    quietWindowMs = 1000,
    timeoutMs = 4000,
}: {
    readRevision: () => number;
    wait: (milliseconds: number) => Promise<void>;
    now?: () => number;
    pollMs?: number;
    quietWindowMs?: number;
    timeoutMs?: number;
}): Promise<TargetWriteQuiescence> {
    const revisionAtBarrier = readRevision();
    let lastRevision = revisionAtBarrier;
    let changesObserved = 0;
    let quietStartedAt = now();
    const deadline = quietStartedAt + timeoutMs;

    while (now() <= deadline) {
        await wait(pollMs);
        const revision = readRevision();
        if (revision !== lastRevision) {
            changesObserved += Math.max(1, revision - lastRevision);
            lastRevision = revision;
            quietStartedAt = now();
        }
        const quietForMs = now() - quietStartedAt;
        if (quietForMs >= quietWindowMs) {
            return {
                status: "quiescent",
                revisionAtBarrier,
                revisionAfter: lastRevision,
                changesObserved,
                quietForMs,
            };
        }
    }

    return {
        status: "timeout",
        revisionAtBarrier,
        revisionAfter: lastRevision,
        changesObserved,
        quietForMs: now() - quietStartedAt,
    };
}

export async function runInjectedPreviewEditCleanupProbe({
    marker,
    readSource,
    readEditor,
    writeMarker,
    restore,
    waitForQuiescence,
}: {
    marker: string;
    readSource: () => Promise<string>;
    readEditor: () => Promise<string> | string;
    writeMarker: (marker: string) => Promise<void>;
    restore: (originalContent: string) => Promise<void>;
    waitForQuiescence: () => Promise<TargetWriteQuiescence>;
}) {
    const originalSource = await readSource();
    const originalEditor = await readEditor();
    if (originalSource !== originalEditor) {
        return failedBeforeWrite(
            marker,
            originalSource,
            originalEditor,
            "source-editor-mismatch-at-baseline"
        );
    }
    if (originalSource.includes(marker)) {
        return failedBeforeWrite(
            marker,
            originalSource,
            originalEditor,
            "marker-already-present"
        );
    }

    let runError: string | null = null;
    let sourceAfterWrite = originalSource;
    let editorAfterWrite = originalEditor;
    try {
        await writeMarker(marker);
        sourceAfterWrite = await readSource();
        editorAfterWrite = await readEditor();
        if (
            !sourceAfterWrite.includes(marker) ||
            !editorAfterWrite.includes(marker)
        ) {
            throw new Error("marker-write-not-observed");
        }
        throw new Error(INJECTED_PREVIEW_EDIT_FAILURE);
    } catch (error) {
        runError = errorMessage(error);
    }

    let restoreError: string | null = null;
    try {
        await restore(originalSource);
    } catch (error) {
        restoreError = errorMessage(error);
    }

    let quiescenceError: string | null = null;
    let quiescence: TargetWriteQuiescence | null = null;
    try {
        quiescence = await waitForQuiescence();
    } catch (error) {
        quiescenceError = errorMessage(error);
    }

    let verificationError: string | null = null;
    let sourceAfterCleanup = "";
    let editorAfterCleanup = "";
    try {
        sourceAfterCleanup = await readSource();
        editorAfterCleanup = await readEditor();
    } catch (error) {
        verificationError = errorMessage(error);
    }

    const writeObserved =
        sourceAfterWrite.includes(marker) && editorAfterWrite.includes(marker);
    const sourceExact = sourceAfterCleanup === originalSource;
    const editorExact = editorAfterCleanup === originalEditor;
    const markerRemovedFromSource = !sourceAfterCleanup.includes(marker);
    const markerRemovedFromEditor = !editorAfterCleanup.includes(marker);
    const noLateWrites =
        quiescence?.status === "quiescent" &&
        quiescence.changesObserved === 0 &&
        quiescence.revisionAfter === quiescence.revisionAtBarrier;
    const restored =
        restoreError === null &&
        quiescenceError === null &&
        verificationError === null &&
        sourceExact &&
        editorExact &&
        markerRemovedFromSource &&
        markerRemovedFromEditor &&
        noLateWrites;
    const passed =
        runError === INJECTED_PREVIEW_EDIT_FAILURE && writeObserved && restored;

    return {
        status: passed ? ("passed" as const) : ("failed" as const),
        ...(passed ? {} : { reason: failureReason({
            runError,
            writeObserved,
            restoreError,
            quiescence,
            quiescenceError,
            verificationError,
            sourceExact,
            editorExact,
        }) }),
        marker,
        originalSource,
        originalEditor,
        write: {
            attempted: true,
            observed: writeObserved,
            sourceContainsMarker: sourceAfterWrite.includes(marker),
            editorContainsMarker: editorAfterWrite.includes(marker),
        },
        injectedFailure: {
            expected: INJECTED_PREVIEW_EDIT_FAILURE,
            observed: runError,
        },
        cleanup: {
            restoreAttempted: true,
            restoreError,
            quiescenceError,
            verificationError,
            quiescence,
            sourceExact,
            editorExact,
            markerRemovedFromSource,
            markerRemovedFromEditor,
            noLateWrites,
            restored,
        },
    };
}

function failedBeforeWrite(
    marker: string,
    originalSource: string,
    originalEditor: string,
    reason: string
) {
    return {
        status: "failed" as const,
        reason,
        marker,
        originalSource,
        originalEditor,
        write: {
            attempted: false,
            observed: false,
            sourceContainsMarker: originalSource.includes(marker),
            editorContainsMarker: originalEditor.includes(marker),
        },
        injectedFailure: {
            expected: INJECTED_PREVIEW_EDIT_FAILURE,
            observed: null,
        },
        cleanup: {
            restoreAttempted: false,
            restoreError: null,
            quiescenceError: null,
            verificationError: null,
            quiescence: null,
            sourceExact: originalSource === originalEditor,
            editorExact: originalSource === originalEditor,
            markerRemovedFromSource: !originalSource.includes(marker),
            markerRemovedFromEditor: !originalEditor.includes(marker),
            noLateWrites: false,
            restored: false,
        },
    };
}

function failureReason(details: {
    runError: string | null;
    writeObserved: boolean;
    restoreError: string | null;
    quiescence: TargetWriteQuiescence | null;
    quiescenceError: string | null;
    verificationError: string | null;
    sourceExact: boolean;
    editorExact: boolean;
}) {
    if (!details.writeObserved || details.runError !== INJECTED_PREVIEW_EDIT_FAILURE) {
        return details.runError ?? "marker-write-not-observed";
    }
    if (details.restoreError) return "fixture-restore-failed";
    if (details.quiescenceError) return "write-quiescence-check-failed";
    if (details.quiescence?.status !== "quiescent") {
        return "write-quiescence-timeout";
    }
    if (
        details.quiescence.changesObserved !== 0 ||
        details.quiescence.revisionAfter !== details.quiescence.revisionAtBarrier
    ) {
        return "late-target-write-after-restore";
    }
    if (details.verificationError || !details.sourceExact || !details.editorExact) {
        return "fixture-restore-verification-failed";
    }
    return "fixture-cleanup-incomplete";
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
