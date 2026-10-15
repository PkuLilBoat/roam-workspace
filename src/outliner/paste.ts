import { getIndentColumns, parseListLine } from "./model";
import { shouldProtectPastedText } from "./protectedRegions";

export interface PasteResult {
    text: string;
    changed: boolean;
    reason:
        | "empty"
        | "single-line"
        | "protected"
        | "list"
        | "paragraphs"
        | "unchanged";
}

export interface ListPastePlan {
    fromColumn: number;
    toColumn: number;
    insert: string;
    placement: "replace-empty" | "insert-children";
}

export function normalizeOutlinerPaste(text: string): PasteResult {
    const normalized = text.replace(/\r\n?/g, "\n");
    if (!normalized.trim()) return result(normalized, normalized, "empty");
    if (shouldProtectPastedText(normalized)) {
        return result(normalized, normalized, "protected");
    }

    const lines = normalized.split("\n");
    const hasList = lines.some((line) => parseListLine(line) !== null);
    const output = hasList ? normalizeListLines(lines) : normalizeParagraphs(lines);
    const joined = output.join("\n");
    const reason = normalized.includes("\n")
        ? hasList
            ? "list"
            : "paragraphs"
        : "single-line";
    return result(normalized, joined, reason);
}

export function planListContextPaste(
    text: string,
    lineText: string,
    cursorColumn: number
): ListPastePlan | null {
    const current = parseListLine(lineText);
    if (
        !current ||
        cursorColumn < current.prefixLength ||
        shouldProtectPastedText(text)
    ) {
        return null;
    }

    const normalized = normalizeOutlinerPaste(text);
    if (!normalized.text.trim() || normalized.reason === "protected") return null;
    const sourceLines = normalized.text.split("\n");
    if (!sourceLines.every((line) => parseListLine(line) !== null)) return null;

    if (!current.content.trim()) {
        return {
            fromColumn: 0,
            toColumn: lineText.length,
            insert: rebaseListLines(sourceLines, current.indent, 0),
            placement: "replace-empty",
        };
    }

    return {
        fromColumn: lineText.length,
        toColumn: lineText.length,
        insert: `\n${rebaseListLines(sourceLines, current.indent, 1)}`,
        placement: "insert-children",
    };
}

export function adaptPasteToListContext(
    text: string,
    lineText: string,
    cursorColumn: number
): string {
    const plan = planListContextPaste(text, lineText, cursorColumn);
    return plan?.insert ?? text;
}

function normalizeListLines(lines: string[]): string[] {
    const depths = buildIndentDepthMap(lines);
    const output: string[] = [];
    let previousDepth = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        const item = parseListLine(line);
        if (!item) {
            if (output.length) {
                output[output.length - 1] += ` ${line.trim()}`;
            } else {
                output.push(`- ${line.trim()}`);
            }
            continue;
        }

        const rawDepth = depths.get(getIndentColumns(item.indent)) ?? 0;
        const depth = output.length ? Math.min(rawDepth, previousDepth + 1) : 0;
        output.push(
            `${"\t".repeat(depth)}- ${checkboxPrefix(item)}${item.content.trim()}`.trimEnd()
        );
        previousDepth = depth;
    }

    return output;
}

function normalizeParagraphs(lines: string[]): string[] {
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
        if (looksSoftWrapped(parts)) return [`- ${joinWrappedLines(parts)}`];
        return parts.map((part) => `- ${part}`);
    });
}

function buildIndentDepthMap(lines: string[]): Map<number, number> {
    const columns = Array.from(
        new Set(
            lines
                .map((line) => parseListLine(line)?.indent)
                .filter((indent): indent is string => indent !== undefined)
                .map(getIndentColumns)
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

function rebaseListLines(
    lines: string[],
    targetIndent: string,
    depthOffset: number
): string {
    const first = parseListLine(lines[0]);
    const rootColumns = first ? getIndentColumns(first.indent) : 0;
    let previousDepth = 0;

    return lines
        .map((line, index) => {
            const item = parseListLine(line);
            if (!item) return null;
            const rawDepth = Math.max(
                0,
                Math.round((getIndentColumns(item.indent) - rootColumns) / 4)
            );
            const depth = index === 0 ? 0 : Math.min(rawDepth, previousDepth + 1);
            previousDepth = depth;
            return `${targetIndent}${"\t".repeat(depthOffset + depth)}- ${checkboxPrefix(item)}${item.content}`.trimEnd();
        })
        .filter((line): line is string => line !== null)
        .join("\n");
}

function looksSoftWrapped(lines: string[]): boolean {
    if (lines.length < 2) return false;
    return lines.some((line) => line.length >= 32 || /[,，;；:]$/.test(line));
}

function joinWrappedLines(lines: string[]): string {
    return lines.join(" ").replace(/\s+/g, " ").trim();
}

function checkboxPrefix(item: ReturnType<typeof parseListLine>): string {
    if (!item || item.checkbox === null) return "";
    return `[${item.checkbox.toLowerCase()}] `;
}

function result(
    original: string,
    text: string,
    reason: PasteResult["reason"]
): PasteResult {
    return {
        text,
        changed: text !== original,
        reason:
            text === original &&
            reason !== "protected" &&
            reason !== "empty" &&
            reason !== "single-line"
                ? "unchanged"
                : reason,
    };
}
