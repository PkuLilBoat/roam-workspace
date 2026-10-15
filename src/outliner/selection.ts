import { findSubtreeEnd, getIndentColumns, parseListLine } from "./model";

export interface BlockSelection {
    anchorLine: number;
    roots: number[];
}

export interface ResolvedBlockSelection {
    fromLine: number;
    toLine: number;
}

export type BlockSelectionDirection = "up" | "down";

export function createBlockSelection(lineNumber: number): BlockSelection {
    return { anchorLine: lineNumber, roots: [lineNumber] };
}

export function resolveBlockSelection(
    lines: string[],
    selection: BlockSelection
): ResolvedBlockSelection | null {
    const roots = selection.roots.filter((line) => parseListLine(lines[line] ?? ""));
    if (!roots.length) return null;
    return {
        fromLine: Math.min(...roots),
        toLine: Math.max(...roots.map((line) => findSubtreeEnd(lines, line))),
    };
}

export function adjustBlockSelection(
    lines: string[],
    selection: BlockSelection,
    direction: BlockSelectionDirection,
    isSelectable: (lineNumber: number) => boolean = (lineNumber) =>
        parseListLine(lines[lineNumber] ?? "") !== null
): BlockSelection | null {
    const resolved = resolveBlockSelection(lines, selection);
    if (!resolved) return null;
    const roots = [...selection.roots].sort((left, right) => left - right);
    const extendsAbove = roots[0] < selection.anchorLine;
    const extendsBelow = roots[roots.length - 1] > selection.anchorLine;

    if (direction === "down" && extendsAbove) {
        roots.shift();
        return { ...selection, roots };
    }
    if (direction === "up" && extendsBelow) {
        roots.pop();
        return { ...selection, roots };
    }

    const candidate = findSelectableLine(
        lines,
        direction === "up" ? resolved.fromLine - 1 : resolved.toLine + 1,
        direction,
        isSelectable
    );
    if (candidate === null) return selection;
    if (direction === "up") roots.unshift(candidate);
    else roots.push(candidate);
    return { ...selection, roots };
}

export function serializeBlockSelection(
    lines: string[],
    selection: BlockSelection
): string | null {
    const resolved = resolveBlockSelection(lines, selection);
    if (!resolved) return null;
    const selected = lines.slice(resolved.fromLine, resolved.toLine + 1);
    const baseIndent = selected.reduce((minimum, line) => {
        const item = parseListLine(line);
        if (!item) return minimum;
        return Math.min(minimum, getIndentColumns(item.indent));
    }, Number.POSITIVE_INFINITY);
    const removeColumns = Number.isFinite(baseIndent) ? baseIndent : 0;
    return selected
        .map((line) => removeLeadingColumns(line, removeColumns))
        .join("\n");
}

function findSelectableLine(
    lines: string[],
    start: number,
    direction: BlockSelectionDirection,
    isSelectable: (lineNumber: number) => boolean
): number | null {
    const step = direction === "up" ? -1 : 1;
    for (let line = start; line >= 0 && line < lines.length; line += step) {
        if (isSelectable(line)) return line;
        if (lines[line].trim()) return null;
    }
    return null;
}

function removeLeadingColumns(line: string, columns: number): string {
    if (columns <= 0) return line;
    let consumed = 0;
    let index = 0;
    while (index < line.length && consumed < columns) {
        const character = line[index];
        if (character === "\t") consumed += 4;
        else if (character === " ") consumed += 1;
        else break;
        index += 1;
    }
    return line.slice(index);
}
