export type PasteNormalizeReason =
    | "empty"
    | "protected"
    | "single-line"
    | "list"
    | "paragraphs"
    | "unchanged";

export interface PasteNormalizeResult {
    text: string;
    changed: boolean;
    reason: PasteNormalizeReason;
}

export interface OutlinerPasteContext {
    lineText: string;
    cursorColumn: number;
}

const LIST_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/;

export function normalizeOutlinerPaste(text: string): PasteNormalizeResult {
    const normalizedNewlines = text.replace(/\r\n?/g, "\n");
    if (!normalizedNewlines.trim()) {
        return { text: normalizedNewlines, changed: false, reason: "empty" };
    }
    if (!normalizedNewlines.includes("\n")) {
        return { text: normalizedNewlines, changed: false, reason: "single-line" };
    }
    if (shouldProtectPaste(normalizedNewlines)) {
        return { text: normalizedNewlines, changed: false, reason: "protected" };
    }

    const lines = normalizedNewlines.split("\n");
    const trailingBlank = lines[lines.length - 1] === "";
    const contentLines = trailingBlank ? lines.slice(0, -1) : lines;
    const hasList = hasListLikeLine(contentLines);
    const normalizedLines = hasList
        ? normalizeListPaste(contentLines)
        : normalizeParagraphPaste(contentLines);

    if (!normalizedLines.length) {
        return { text: normalizedNewlines, changed: false, reason: "empty" };
    }

    const result = normalizedLines.join("\n") + (trailingBlank ? "\n" : "");
    if (result === normalizedNewlines) {
        return { text: normalizedNewlines, changed: false, reason: "unchanged" };
    }

    return {
        text: result,
        changed: true,
        reason: hasList ? "list" : "paragraphs",
    };
}

export function adaptOutlinerPasteToListContext(
    text: string,
    context: OutlinerPasteContext
): string {
    if (!text.includes("\n")) return text;

    const currentListPrefix = context.lineText.match(
        /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
    );
    if (!currentListPrefix || context.cursorColumn < currentListPrefix[0].length) {
        return text;
    }

    const lines = text.split("\n");
    const firstListItem = lines[0].match(
        /^\s*(?:[-*+]|\d+[.)])\s+((?:\[[ xX]\]\s+)?[^\n]*)$/
    );
    if (!firstListItem) return text;

    const baseIndent = currentListPrefix[1];
    const contentBeforeCursor = context.lineText.slice(
        currentListPrefix[0].length,
        context.cursorColumn
    );
    const firstLinePrefix = contentBeforeCursor && !/\s$/.test(contentBeforeCursor)
        ? " "
        : "";
    return [
        `${firstLinePrefix}${firstListItem[1]}`,
        ...lines.slice(1).map((line) => (line ? `${baseIndent}${line}` : line)),
    ].join("\n");
}

function normalizeListPaste(lines: string[]): string[] {
    const indentDepths = buildIndentDepthMap(lines);
    const result: string[] = [];
    let paragraphParts: string[] = [];
    let canContinuePrevious = false;

    const flushParagraph = () => {
        if (!paragraphParts.length) return;
        result.push(`- ${joinWrappedLines(paragraphParts)}`);
        paragraphParts = [];
    };

    for (const line of lines) {
        if (!line.trim()) {
            flushParagraph();
            canContinuePrevious = false;
            continue;
        }

        const listMatch = line.match(LIST_LINE_RE);
        if (listMatch) {
            flushParagraph();
            const indent = normalizeIndent(listMatch[1], indentDepths);
            const checkbox = listMatch[3];
            const content = listMatch[4].trim();
            if (!content) continue;
            result.push(
                `${indent}- ${checkbox ? `[${checkbox.toLowerCase()}] ` : ""}${content}`
            );
            canContinuePrevious = true;
            continue;
        }

        const continuation = line.trim();
        if (result.length > 0 && canContinuePrevious) {
            result[result.length - 1] = `${result[result.length - 1]} ${continuation}`;
        } else {
            paragraphParts.push(continuation);
            canContinuePrevious = false;
        }
    }

    flushParagraph();
    return result;
}

function normalizeParagraphPaste(lines: string[]): string[] {
    const groups: string[][] = [];
    let group: string[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (group.length) groups.push(group);
            group = [];
            continue;
        }
        group.push(trimmed);
    }
    if (group.length) groups.push(group);

    return groups.flatMap((parts) => {
        if (!looksSoftWrapped(parts)) return parts.map((part) => `- ${part}`);
        return [`- ${joinWrappedLines(parts)}`];
    });
}

function looksSoftWrapped(lines: string[]): boolean {
    if (lines.length < 2) return false;
    return lines.some((line) => line.length >= 32 || /[,，;；:]$/.test(line));
}

function joinWrappedLines(lines: string[]): string {
    return lines.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeIndent(
    rawIndent: string,
    indentDepths: Map<number, number>
): string {
    const columns = countIndentColumns(rawIndent);
    return "\t".repeat(indentDepths.get(columns) ?? 0);
}

function buildIndentDepthMap(lines: string[]): Map<number, number> {
    const columns = Array.from(
        new Set(
            lines
                .map((line) => line.match(LIST_LINE_RE)?.[1])
                .filter((indent): indent is string => indent !== undefined)
                .map(countIndentColumns)
        )
    ).sort((a, b) => a - b);
    const clusters: number[][] = [];
    for (const column of columns) {
        const cluster = clusters[clusters.length - 1];
        if (cluster && column - cluster[cluster.length - 1] <= 1) {
            cluster.push(column);
        } else {
            clusters.push([column]);
        }
    }

    return new Map(
        clusters.flatMap((cluster, depth) =>
            cluster.map((column) => [column, depth] as const)
        )
    );
}

function countIndentColumns(rawIndent: string): number {
    let columns = 0;
    for (const char of rawIndent) {
        columns += char === "\t" ? 4 : 1;
    }
    return columns;
}

function shouldProtectPaste(text: string): boolean {
    const lines = text.split("\n");
    if (lines.some((line) => /^\s*(`{3,}|~{3,})/.test(line))) return true;
    if (lines.some((line) => /^\s*> \[!/.test(line))) return true;
    const tableLikeLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
    return tableLikeLines.length >= 2;
}

function hasListLikeLine(lines: string[]): boolean {
    return lines.some((line) => LIST_LINE_RE.test(line));
}
