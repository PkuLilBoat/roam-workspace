import type { ListHeadingDepth, ListHeadingItem } from "./listHeadingTypes";

export type ListHeadingDepthSummary = {
    availableDepth: ListHeadingDepth;
    cumulativeBlockCounts: [number, number, number, number, number, number];
};

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
    depth: ListHeadingDepth = 0
): ListHeadingItem[] {
    const rawItems = parseListHeadingItems(text);
    if (depth === 0) {
        return rawItems.filter((item) => item.kind !== "indent-block");
    }

    const visibleDepths = getVisibleIndentDepths(rawItems, depth);
    return rawItems.filter(
        (item) =>
            item.kind !== "indent-block" ||
            visibleDepths.has(item.indentDepth ?? Number.POSITIVE_INFINITY)
    );
}

export function summarizeListHeadingDepths(text: string): ListHeadingDepthSummary {
    const items = parseListHeadingItems(text);
    const indentBlocks = items.filter(
        (item) =>
            item.kind === "indent-block" &&
            typeof item.indentDepth === "number"
    );
    const depths = getSortedIndentDepths(indentBlocks);
    const availableDepth = Math.min(depths.length, 5) as ListHeadingDepth;
    const counts = [0, 0, 0, 0, 0, 0] as ListHeadingDepthSummary["cumulativeBlockCounts"];
    for (let depth = 1; depth <= 5; depth++) {
        const visibleDepths = new Set(depths.slice(0, depth));
        counts[depth] = indentBlocks.filter((item) =>
            visibleDepths.has(item.indentDepth as number)
        ).length;
    }
    return { availableDepth, cumulativeBlockCounts: counts };
}

export function getListHeadingDescendantEnds(items: ListHeadingItem[]): number[] {
    // A new heading ends list ancestry even when its heading level is deeper.
    const ends = items.map(() => items.length);
    const ancestors: number[] = [];
    for (let index = 0; index < items.length; index++) {
        while (
            ancestors.length &&
            (items[ancestors[ancestors.length - 1]].level >= items[index].level ||
                (items[index].kind !== "indent-block" &&
                    items[ancestors[ancestors.length - 1]].kind === "indent-block"))
        ) {
            ends[ancestors.pop() as number] = index;
        }
        ancestors.push(index);
    }
    return ends;
}

export function getListHeadingItemKeys(items: ListHeadingItem[]): string[] {
    const ends = getListHeadingDescendantEnds(items);
    const keys: string[] = [];
    const paths: string[][] = [];
    const ancestors: number[] = [];
    const occurrences = new Map<string, number>();
    items.forEach((item, index) => {
        while (ancestors.length && ends[ancestors[ancestors.length - 1]] <= index) {
            ancestors.pop();
        }
        const parent = ancestors.length ? paths[ancestors[ancestors.length - 1]] : [];
        const identity = JSON.stringify([parent, item.kind, item.level, item.indentDepth, item.title]);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        const path = [...parent, JSON.stringify([item.kind, item.level, item.indentDepth, item.title, occurrence])];
        paths.push(path);
        keys.push(JSON.stringify(path));
        ancestors.push(index);
    });
    return keys;
}

export function reconcileListHeadingCollapsedKeys(
    previousKeys: string[],
    currentKeys: string[],
    collapsed: ReadonlySet<string>
): Set<string> {
    const paths = (keys: string[]) => keys.map((key) => JSON.parse(key) as string[]);
    const group = (path: string[]) => JSON.stringify([
        ...path.slice(0, -1),
        (JSON.parse(path[path.length - 1]) as unknown[]).slice(0, -1),
    ]);
    const counts = (keys: string[]) => {
        const result = new Map<string, number>();
        paths(keys).forEach((path) => {
            const identity = group(path);
            result.set(identity, (result.get(identity) ?? 0) + 1);
        });
        return result;
    };
    const previousCounts = counts(previousKeys);
    const currentCounts = counts(currentKeys);
    return new Set(currentKeys.filter((key) => {
        if (!collapsed.has(key)) return false;
        const path = JSON.parse(key) as string[];
        return path.every((_, index) => {
            const identity = group(path.slice(0, index + 1));
            const before = previousCounts.get(identity) ?? 0;
            const after = currentCounts.get(identity) ?? 0;
            // A changed duplicate group cannot safely identify the surviving sibling.
            return Math.max(before, after) <= 1 || before === after;
        });
    }));
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
    depth: ListHeadingDepth
): Set<number> {
    return new Set(getSortedIndentDepths(items).slice(0, depth));
}

export function getListHeadingFoldTargets(
    items: ListHeadingItem[],
    depth: ListHeadingDepth
): number[] {
    const indentDepth = depth === 0 ? undefined : getSortedIndentDepths(items)[depth - 1];
    const ends = getListHeadingDescendantEnds(items);
    return items.flatMap((item, index) => {
        const matches = depth === 0
            ? item.kind !== "indent-block"
            : indentDepth !== undefined && item.kind === "indent-block" && item.indentDepth === indentDepth;
        return matches && ends[index] > index + 1 ? [index] : [];
    });
}

export function applyListHeadingDepthFold(
    items: ListHeadingItem[],
    keys: string[],
    collapsed: ReadonlySet<string>,
    depth: ListHeadingDepth,
    collapse: boolean
): Set<string> {
    const next = new Set(collapsed);
    const targets = new Set(getListHeadingFoldTargets(items, depth));
    const ends = getListHeadingDescendantEnds(items);
    const ancestors: number[] = [];
    items.forEach((_, index) => {
        while (ancestors.length && ends[ancestors[ancestors.length - 1]] <= index) ancestors.pop();
        if (targets.has(index)) {
            if (collapse) {
                next.add(keys[index]);
            } else {
                next.delete(keys[index]);
                for (const ancestor of ancestors) next.delete(keys[ancestor]);
            }
        }
        if (ends[index] > index + 1) ancestors.push(index);
    });
    return next;
}

function getSortedIndentDepths(items: ListHeadingItem[]): number[] {
    return Array.from(
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
}
