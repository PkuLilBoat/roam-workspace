export interface JournalEditorReadinessInput {
    actualPath: string | null;
    editorConnected: boolean;
    expectedPath: string;
    hostShown: boolean;
    leafConnected: boolean;
    sessionId: string;
    slotConnected: boolean;
}

export type JournalEditorReadiness =
    | { status: "ready" }
    | {
          status: "waiting";
          reason:
              | "editor-not-connected"
              | "host-not-shown"
              | "leaf-not-connected"
              | "path-not-matched"
              | "session-id-missing"
              | "slot-not-connected";
      };

export function resolveJournalEditorReadiness(
    input: JournalEditorReadinessInput
): JournalEditorReadiness {
    if (!input.sessionId) {
        return { status: "waiting", reason: "session-id-missing" };
    }
    if (!input.slotConnected) {
        return { status: "waiting", reason: "slot-not-connected" };
    }
    if (!input.hostShown) {
        return { status: "waiting", reason: "host-not-shown" };
    }
    if (!input.leafConnected) {
        return { status: "waiting", reason: "leaf-not-connected" };
    }
    if (input.actualPath !== input.expectedPath) {
        return { status: "waiting", reason: "path-not-matched" };
    }
    if (!input.editorConnected) {
        return { status: "waiting", reason: "editor-not-connected" };
    }
    return { status: "ready" };
}
