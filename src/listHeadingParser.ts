import type { ListHeadingItem, ListHeadingMode } from "./listHeadingTypes";

const MARKDOWN_HEADING_RE = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_HEADING_RE =
    /^(\t*)([-*+][ \t]+(?:\[[^\]\n]*\][ \t]+)?)(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM_RE = /^(\t*)([-*+][ \t]+)(?:\[([ xX])\][ \t]+)?(.+?)\s*$/;

type ParserState = {
    inFrontmatter: boolean;
    frontmatterClosed: boolean;
    inFence: boolean;
    fenceMarker: string;
    inComment: boolean;
    headingStack: ListHeadingItem[];
};

export function collectListHeadingItems(
    text: string,
    mode: ListHeadingMode = "headings-only"
): ListHeadingItem[] {
    const rawItems = parseListHeadingItems(text);
    if (mode === "headings-only") {
        return rawItems.filter((item) => item.kind !== "indent-block");
    }

    const visibleDepths = getVisibleIndentDepths(rawItems, mode);
    return rawItems.filter(
        (item) =>
            item.kind !== "indent-block" ||
            visibleDepths.has(item.indentDepth ?? Number.POSITIVE_INFINITY)
    );
}

export function parseListHeadingItems(text: string): ListHeadingItem[] {
    const lines = text.split(/\n/);
    const items: ListHeadingItem[] = [];
    const state: ParserState = {
        inFrontmatter: lines[0]?.trim() === "---",
        frontmatterClosed: lines[0]?.trim() !== "---",
        inFence: false,
        fenceMarker: "",
        inComment: false,
        headingStack: [],
    };

    let offset = 0;
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
        const line = lines[lineNumber];
        const trimmed = line.trim();
        const shouldSkip = updateSkippableState(state, lineNumber, trimmed, line);
        if (!shouldSkip) {
            const item = parseLine(line, lineNumber, offset, state.headingStack);
            if (item) {
                items.push(item);
                if (item.kind !== "indent-block") {
                    updateHeadingStack(state.headingStack, item);
                }
            }
        }
        offset += line.length + 1;
    }

    return items.sort((a, b) => {
        const lineDelta = a.line - b.line;
        return lineDelta !== 0 ? lineDelta : a.col - b.col;
    });
}

function updateSkippableState(
    state: ParserState,
    lineNumber: number,
    trimmed: string,
    line: string
): boolean {
    if (!state.frontmatterClosed && state.inFrontmatter) {
        if (lineNumber > 0 && trimmed === "---") {
            state.inFrontmatter = false;
            state.frontmatterClosed = true;
        }
        return true;
    }

    if (state.inComment) {
        if (trimmed.includes("%%")) state.inComment = false;
        return true;
    }

    if (trimmed.startsWith("%%")) {
        if (!trimmed.slice(2).includes("%%")) state.inComment = true;
        return true;
    }

    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!state.inFence) {
            state.inFence = true;
            state.fenceMarker = marker;
        } else if (marker === state.fenceMarker) {
            state.inFence = false;
            state.fenceMarker = "";
        }
        return true;
    }

    return state.inFence;
}

function parseLine(
    line: string,
    lineNumber: number,
    offset: number,
    headingStack: ListHeadingItem[]
): ListHeadingItem | null {
    const markdownHeadingMatch = line.match(MARKDOWN_HEADING_RE);
    if (markdownHeadingMatch) {
        const marker = markdownHeadingMatch[1];
        const title = cleanupTitle(markdownHeadingMatch[2]);
        if (!title) return null;
        const col = line.indexOf(marker);
        return {
            kind: "markdown-heading",
            title,
            line: lineNumber,
            col,
            offset: offset + col,
            level: marker.length,
            source: line,
        };
    }

    const listHeadingMatch = line.match(LIST_HEADING_RE);
    if (listHeadingMatch) {
        const tabPrefix = listHeadingMatch[1];
        const listPrefix = listHeadingMatch[2];
        const marker = listHeadingMatch[3];
        const title = cleanupTitle(listHeadingMatch[4]);
        if (!title) return null;
        const col = tabPrefix.length + listPrefix.length;
        return {
            kind: "list-heading",
            title,
            line: lineNumber,
            col,
            offset: offset + col,
            level: marker.length,
            indentDepth: tabPrefix.length,
            parentHeadingKey: getParentHeadingKey(headingStack, marker.length),
            source: line,
        };
    }

    const listItemMatch = line.match(LIST_ITEM_RE);
    if (!listItemMatch) return null;

    const tabPrefix = listItemMatch[1];
    const listPrefix = listItemMatch[2];
    const checkboxMarker = listItemMatch[3];
    const title = cleanupTitle(listItemMatch[4]);
    if (!title) return null;

    const checkboxLength = checkboxMarker === undefined ? 0 : 4;
    const col = tabPrefix.length + listPrefix.length + checkboxLength;
    const parent = headingStack[headingStack.length - 1];
    return {
        kind: "indent-block",
        title,
        line: lineNumber,
        col,
        offset: offset + col,
        level: parent ? parent.level + 1 + tabPrefix.length : 1 + tabPrefix.length,
        indentDepth: tabPrefix.length,
        parentHeadingKey: parent ? buildHeadingKey(parent) : undefined,
        source: line,
    };
}

function cleanupTitle(title: string): string {
    return title
        .trim()
        .replace(/[ \t]+#+$/, "")
        .replace(/[ \t]+\^[A-Za-z0-9-]+$/, "")
        .trim();
}

function updateHeadingStack(stack: ListHeadingItem[], item: ListHeadingItem): void {
    while (stack.length && stack[stack.length - 1].level >= item.level) {
        stack.pop();
    }
    stack.push(item);
}

function getParentHeadingKey(
    stack: ListHeadingItem[],
    level: number
): string | undefined {
    for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].level < level) {
            return buildHeadingKey(stack[index]);
        }
    }
    return undefined;
}

function buildHeadingKey(item: ListHeadingItem): string {
    return `${item.line}:${item.col}:${item.title}`;
}

function getVisibleIndentDepths(
    items: ListHeadingItem[],
    mode: ListHeadingMode
): Set<number> {
    const depths = Array.from(
        new Set(
            items
                .filter(
                    (item) =>
                        item.kind === "indent-block" &&
                        typeof item.indentDepth === "number"
                )
                .map((item) => item.indentDepth as number)
        )
    ).sort((a, b) => a - b);

    if (mode === "top-indent") return new Set(depths.slice(0, 1));
    if (mode === "top-two-indent") return new Set(depths.slice(0, 2));
    return new Set();
}
