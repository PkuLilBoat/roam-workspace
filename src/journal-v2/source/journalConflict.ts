export type JournalModifyResolution =
    | "external-conflict"
    | "external-sync"
    | "local-save";

export function classifyJournalModify(
    localDraft: string | undefined,
    diskContent: string
): JournalModifyResolution {
    if (localDraft === undefined) return "external-sync";
    return journalContentsEqual(localDraft, diskContent)
        ? "local-save"
        : "external-conflict";
}

export function journalContentsEqual(left: string, right: string): boolean {
    return trimFinalLineBreak(left) === trimFinalLineBreak(right);
}

function trimFinalLineBreak(content: string): string {
    return content.replace(/(?:\r?\n)$/, "");
}
