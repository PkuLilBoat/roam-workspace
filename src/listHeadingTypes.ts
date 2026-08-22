export type ListHeadingMode = "headings-only" | "top-indent" | "top-two-indent";

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
