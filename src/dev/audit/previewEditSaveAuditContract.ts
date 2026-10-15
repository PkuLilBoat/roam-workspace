export interface PreviewEditSaveRestoreVerification {
    editorExact: boolean;
    markerRemovedFromEditor: boolean;
    markerRemovedFromSource: boolean;
    propertiesRestored: boolean;
    sourceExact: boolean;
}

export interface PreviewEditSaveCleanup
    extends PreviewEditSaveRestoreVerification {
    markerRemoved: boolean;
    restoreAttempted: boolean;
    restoreError: string | null;
    restored: boolean;
    verificationError: string | null;
}

export type PreviewEditSaveAuditTransactionResult<Result> = {
    cleanup: PreviewEditSaveCleanup;
    originalContent: string;
    reason?: string;
    runCompleted: boolean;
    runError: string | null;
    runResult?: Result;
    status: "passed" | "failed";
};

export async function runPreviewEditSaveAuditTransaction<Result>({
    marker,
    readOriginal,
    restore,
    run,
    verify,
}: {
    marker: string;
    readOriginal: () => Promise<string>;
    restore: (originalContent: string) => Promise<void>;
    run: (originalContent: string) => Promise<Result>;
    verify: (
        originalContent: string,
        marker: string
    ) => Promise<PreviewEditSaveRestoreVerification>;
}): Promise<PreviewEditSaveAuditTransactionResult<Result>> {
    const originalContent = await readOriginal();
    if (originalContent.includes(marker)) {
        return {
            status: "failed",
            reason: "marker-already-present",
            originalContent,
            runCompleted: false,
            runError: null,
            cleanup: emptyCleanup(false),
        };
    }

    let runCompleted = false;
    let runError: string | null = null;
    let runResult: Result | undefined;
    try {
        runResult = await run(originalContent);
        runCompleted = true;
    } catch (error) {
        runError = errorMessage(error);
    }

    let restoreError: string | null = null;
    try {
        await restore(originalContent);
    } catch (error) {
        restoreError = errorMessage(error);
    }

    let verificationError: string | null = null;
    let verification = emptyVerification();
    try {
        verification = await verify(originalContent, marker);
    } catch (error) {
        verificationError = errorMessage(error);
    }
    const markerRemoved =
        verification.markerRemovedFromSource &&
        verification.markerRemovedFromEditor;
    const restored =
        restoreError === null &&
        verificationError === null &&
        verification.sourceExact &&
        verification.editorExact &&
        markerRemoved &&
        verification.propertiesRestored;
    const passed = runCompleted && runError === null && restored;

    return {
        status: passed ? "passed" : "failed",
        reason: passed
            ? undefined
            : runError !== null
              ? "audit-run-failed"
              : restoreError !== null
                ? "fixture-restore-failed"
                : "fixture-restore-verification-failed",
        originalContent,
        runCompleted,
        runError,
        ...(runCompleted ? { runResult } : {}),
        cleanup: {
            ...verification,
            markerRemoved,
            restoreAttempted: true,
            restoreError,
            restored,
            verificationError,
        },
    };
}

function emptyVerification(): PreviewEditSaveRestoreVerification {
    return {
        editorExact: false,
        markerRemovedFromEditor: false,
        markerRemovedFromSource: false,
        propertiesRestored: false,
        sourceExact: false,
    };
}

function emptyCleanup(restoreAttempted: boolean): PreviewEditSaveCleanup {
    return {
        ...emptyVerification(),
        markerRemoved: false,
        restoreAttempted,
        restoreError: null,
        restored: false,
        verificationError: null,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
