export const LIST_HEADING_DEPTHS = [0, 1, 2, 3, 4, 5] as const;

export type ListHeadingDepth = (typeof LIST_HEADING_DEPTHS)[number];

export type LegacyListHeadingMode =
    | "headings-only"
    | "top-indent"
    | "top-two-indent";

export function isListHeadingDepth(value: unknown): value is ListHeadingDepth {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 5
    );
}

export function restoreListHeadingDepth(state: unknown): ListHeadingDepth {
    if (typeof state !== "object" || state === null) return 0;
    const candidate = state as { depth?: unknown; mode?: unknown };
    if (isListHeadingDepth(candidate.depth)) return candidate.depth;
    if (candidate.mode === "top-indent") return 1;
    if (candidate.mode === "top-two-indent") return 2;
    return 0;
}

export type ListHeadingItemKind =
    | "markdown-heading"
    | "list-heading"
    | "indent-block";

export interface ListHeadingItem {
    kind: ListHeadingItemKind;
    title: string;
    line: number;
    col: number;
    offset: number;
    level: number;
    indentDepth?: number;
    parentHeadingKey?: string;
    source: string;
}
