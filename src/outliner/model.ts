export interface ListLine {
    indent: string;
    marker: string;
    checkbox: string | null;
    content: string;
    prefixLength: number;
}

export interface LineRangeTransform {
    fromLine: number;
    toLine: number;
    replacement: string;
}

export interface MoveResult {
    text: string;
    cursorLine: number;
}

const LIST_LINE_RE = /^(\s*)([-+*]|\d+[.)])([ \t]+)(?:\[([ xX])\]([ \t]+))?(.*)$/;

export function parseListLine(text: string): ListLine | null {
    const match = LIST_LINE_RE.exec(text);
    if (!match) return null;

    return {
        indent: match[1],
        marker: match[2],
        checkbox: match[4] ?? null,
        content: match[6],
        prefixLength:
            match[1].length +
            match[2].length +
            match[3].length +
            (match[4] === undefined ? 0 : 3 + match[5].length),
    };
}

export function getIndentColumns(indent: string): number {
    let columns = 0;
    for (const character of indent) {
        columns += character === "\t" ? 4 : 1;
    }
    return columns;
}

export function nextListMarker(marker: string): string {
    const ordered = /^(\d+)([.)])$/.exec(marker);
    if (!ordered) return marker;
    return `${Number(ordered[1]) + 1}${ordered[2]}`;
}

export function buildNewSiblingPrefix(item: ListLine): string {
    const checkbox = item.checkbox === null ? "" : "[ ] ";
    return `${item.indent}${nextListMarker(item.marker)} ${checkbox}`;
}

export function findSubtreeEnd(lines: string[], lineNumber: number): number {
    const item = parseListLine(lines[lineNumber] ?? "");
    if (!item) return lineNumber;

    const baseColumns = getIndentColumns(item.indent);
    let end = lineNumber;
    for (let index = lineNumber + 1; index < lines.length; index += 1) {
        const line = lines[index];
        const child = parseListLine(line);
        if (child && getIndentColumns(child.indent) <= baseColumns) break;
        if (!child && line.trim() && getIndentColumns(line.match(/^\s*/)?.[0] ?? "") <= baseColumns) {
            break;
        }
        end = index;
    }
    return end;
}

export function indentListSubtree(
    text: string,
    lineNumber: number,
    indentUnit = "\t"
): LineRangeTransform | null {
    const lines = text.split("\n");
    const item = parseListLine(lines[lineNumber] ?? "");
    if (!item || lineNumber === 0) return null;

    let previousSibling = -1;
    for (let index = lineNumber - 1; index >= 0; index -= 1) {
        const candidate = parseListLine(lines[index]);
        if (!candidate) {
            if (lines[index].trim()) break;
            continue;
        }
        const candidateColumns = getIndentColumns(candidate.indent);
        const currentColumns = getIndentColumns(item.indent);
        if (candidateColumns < currentColumns) break;
        if (candidateColumns === currentColumns) {
            previousSibling = index;
            break;
        }
    }
    if (previousSibling < 0) return null;

    const toLine = findSubtreeEnd(lines, lineNumber);
    return {
        fromLine: lineNumber,
        toLine,
        replacement: lines
            .slice(lineNumber, toLine + 1)
            .map((line) => (line.length > 0 ? `${indentUnit}${line}` : line))
            .join("\n"),
    };
}

export function outdentListSubtree(
    text: string,
    lineNumber: number
): LineRangeTransform | null {
    const lines = text.split("\n");
    const item = parseListLine(lines[lineNumber] ?? "");
    if (!item || item.indent.length === 0) return null;

    const toLine = findSubtreeEnd(lines, lineNumber);
    return {
        fromLine: lineNumber,
        toLine,
        replacement: lines
            .slice(lineNumber, toLine + 1)
            .map(removeOneIndent)
            .join("\n"),
    };
}

export function moveListSubtree(
    text: string,
    lineNumber: number,
    direction: "up" | "down"
): MoveResult | null {
    const lines = text.split("\n");
    const item = parseListLine(lines[lineNumber] ?? "");
    if (!item) return null;

    const currentEnd = findSubtreeEnd(lines, lineNumber);
    const targetStart = findSibling(lines, lineNumber, item.indent, direction);
    if (targetStart < 0) return null;
    const targetEnd = findSubtreeEnd(lines, targetStart);

    if (direction === "up") {
        const target = lines.slice(targetStart, targetEnd + 1);
        const between = lines.slice(targetEnd + 1, lineNumber);
        const current = lines.slice(lineNumber, currentEnd + 1);
        lines.splice(
            targetStart,
            currentEnd - targetStart + 1,
            ...current,
            ...between,
            ...target
        );
        return {
            text: lines.join("\n"),
            cursorLine: targetStart,
        };
    }

    const current = lines.slice(lineNumber, currentEnd + 1);
    const between = lines.slice(currentEnd + 1, targetStart);
    const target = lines.slice(targetStart, targetEnd + 1);
    lines.splice(
        lineNumber,
        targetEnd - lineNumber + 1,
        ...target,
        ...between,
        ...current
    );
    return {
        text: lines.join("\n"),
        cursorLine: lineNumber + target.length + between.length,
    };
}

export function toggleCheckboxLine(line: string): string | null {
    const match = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\](\s+.*)$/.exec(line);
    if (!match) return null;
    const checked = match[2].toLowerCase() === "x";
    return `${match[1]}[${checked ? " " : "x"}]${match[3]}`;
}

function removeOneIndent(line: string): string {
    if (line.startsWith("\t")) return line.slice(1);
    const spaces = /^( {1,4})/.exec(line)?.[1].length ?? 0;
    return line.slice(spaces);
}

function findSibling(
    lines: string[],
    lineNumber: number,
    indent: string,
    direction: "up" | "down"
): number {
    const baseColumns = getIndentColumns(indent);
    if (direction === "up") {
        for (let index = lineNumber - 1; index >= 0; index -= 1) {
            const candidate = parseListLine(lines[index]);
            if (!candidate) continue;
            const columns = getIndentColumns(candidate.indent);
            if (columns < baseColumns) return -1;
            if (columns === baseColumns) return index;
        }
        return -1;
    }

    const currentEnd = findSubtreeEnd(lines, lineNumber);
    for (let index = currentEnd + 1; index < lines.length; index += 1) {
        const candidate = parseListLine(lines[index]);
        if (!candidate) {
            if (lines[index].trim()) return -1;
            continue;
        }
        const columns = getIndentColumns(candidate.indent);
        if (columns < baseColumns) return -1;
        if (columns === baseColumns) return index;
    }
    return -1;
}
