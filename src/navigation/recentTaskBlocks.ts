export const RECENT_TASK_BLOCK_LIMIT = 20;

export type ParsedRootTaskBlock = {
    rootLine: number;
    endLine: number;
    normalizedRootText: string;
    subtreeSignature: string;
};

export type RecentTaskBlockRecord = {
    path: string;
    lineHint: number;
    normalizedRootText: string;
    subtreeSignature: string;
    lastTouchedAt: number;
};

const ROOT_TASK_PATTERN = /^(?:[-+*])\s+\[ \]\s+(.+?)\s*$/;

export function parseIncompleteRootTaskBlocks(text: string): ParsedRootTaskBlock[] {
    const lines = text.split("\n");
    const blocks: ParsedRootTaskBlock[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (leadingIndentWidth(line) !== 0) continue;
        const match = line.match(ROOT_TASK_PATTERN);
        const normalizedRootText = normalizeTaskText(match?.[1] ?? "");
        if (!match || !normalizedRootText) continue;

        let endLine = lineIndex;
        for (let childIndex = lineIndex + 1; childIndex < lines.length; childIndex += 1) {
            const childLine = lines[childIndex];
            if (childLine.trim() && leadingIndentWidth(childLine) === 0) break;
            endLine = childIndex;
        }
        const subtree = lines
            .slice(lineIndex, endLine + 1)
            .map(normalizeSubtreeLine)
            .join("\n");
        blocks.push({
            rootLine: lineIndex,
            endLine,
            normalizedRootText,
            subtreeSignature: createTaskBlockSignature(subtree),
        });
        lineIndex = endLine;
    }

    return blocks;
}

export function findRootTaskBlockAtLine(
    blocks: readonly ParsedRootTaskBlock[],
    line: number
): ParsedRootTaskBlock | null {
    return blocks.find((block) => line >= block.rootLine && line <= block.endLine) ?? null;
}

export function resolveRecentTaskRecord(
    text: string,
    record: RecentTaskBlockRecord
): ParsedRootTaskBlock | null {
    const candidates = parseIncompleteRootTaskBlocks(text).filter(
        (block) => block.normalizedRootText === record.normalizedRootText
    );
    if (!candidates.length) return null;

    const signatureMatches = candidates.filter(
        (block) => block.subtreeSignature === record.subtreeSignature
    );
    if (signatureMatches.length) {
        return selectUniqueNearestBlock(signatureMatches, record.lineHint);
    }
    return candidates.length === 1 ? candidates[0] : null;
}

export function reconcileRecentTaskRecordsForPath(
    records: readonly RecentTaskBlockRecord[],
    path: string,
    text: string,
    touchedLine: number | null = null,
    touchedAt = Date.now(),
    limit = RECENT_TASK_BLOCK_LIMIT
): RecentTaskBlockRecord[] {
    const blocks = parseIncompleteRootTaskBlocks(text);
    const reconciled: RecentTaskBlockRecord[] = [];
    const occupiedLines = new Set<number>();

    for (const record of records) {
        if (record.path !== path) {
            reconciled.push(record);
            continue;
        }
        const resolved = resolveRecordFromBlocks(blocks, record);
        if (!resolved || occupiedLines.has(resolved.rootLine)) continue;
        occupiedLines.add(resolved.rootLine);
        reconciled.push(toRecord(path, resolved, record.lastTouchedAt));
    }

    const touchedBlock =
        touchedLine === null ? null : findRootTaskBlockAtLine(blocks, touchedLine);
    if (touchedBlock) {
        const existingIndex = findTouchedRecordIndex(
            reconciled,
            path,
            touchedBlock
        );
        if (existingIndex !== -1) reconciled.splice(existingIndex, 1);
        reconciled.unshift(toRecord(path, touchedBlock, touchedAt));
    }

    return reconciled.slice(0, Math.max(0, limit));
}

export function restoreRecentTaskBlockRecords(value: unknown): RecentTaskBlockRecord[] {
    if (!Array.isArray(value)) return [];
    const records: RecentTaskBlockRecord[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const path = normalizeStoredString(item.path);
        const normalizedRootText = normalizeTaskText(item.normalizedRootText);
        const subtreeSignature = normalizeStoredString(item.subtreeSignature);
        const lineHint = toNonNegativeInteger(item.lineHint);
        const lastTouchedAt = toNonNegativeNumber(item.lastTouchedAt);
        if (
            !path ||
            !normalizedRootText ||
            !subtreeSignature ||
            lineHint === null ||
            lastTouchedAt === null
        ) {
            continue;
        }
        records.push({
            path,
            lineHint,
            normalizedRootText,
            subtreeSignature,
            lastTouchedAt,
        });
    }
    return records
        .sort((left, right) => right.lastTouchedAt - left.lastTouchedAt)
        .slice(0, RECENT_TASK_BLOCK_LIMIT);
}

export function renameRecentTaskPath(
    records: readonly RecentTaskBlockRecord[],
    oldPath: string,
    newPath: string
): RecentTaskBlockRecord[] {
    if (!records.some((record) => record.path === oldPath)) return records.slice();
    return records.map((record) =>
        record.path === oldPath ? { ...record, path: newPath } : record
    );
}

export function removeRecentTaskPath(
    records: readonly RecentTaskBlockRecord[],
    path: string
): RecentTaskBlockRecord[] {
    return records.filter((record) => record.path !== path);
}

function resolveRecordFromBlocks(
    blocks: readonly ParsedRootTaskBlock[],
    record: RecentTaskBlockRecord
): ParsedRootTaskBlock | null {
    const candidates = blocks.filter(
        (block) => block.normalizedRootText === record.normalizedRootText
    );
    if (!candidates.length) return null;
    const signatureMatches = candidates.filter(
        (block) => block.subtreeSignature === record.subtreeSignature
    );
    if (signatureMatches.length) {
        return selectUniqueNearestBlock(signatureMatches, record.lineHint);
    }
    return candidates.length === 1 ? candidates[0] : null;
}

function selectUniqueNearestBlock(
    blocks: readonly ParsedRootTaskBlock[],
    lineHint: number
): ParsedRootTaskBlock | null {
    const sorted = [...blocks].sort(
        (left, right) =>
            Math.abs(left.rootLine - lineHint) - Math.abs(right.rootLine - lineHint)
    );
    if (sorted.length < 2) return sorted[0] ?? null;
    const firstDistance = Math.abs(sorted[0].rootLine - lineHint);
    const secondDistance = Math.abs(sorted[1].rootLine - lineHint);
    return firstDistance === secondDistance ? null : sorted[0];
}

function findTouchedRecordIndex(
    records: readonly RecentTaskBlockRecord[],
    path: string,
    block: ParsedRootTaskBlock
): number {
    const samePath = records
        .map((record, index) => ({ record, index }))
        .filter(({ record }) => record.path === path);
    const exactLine = samePath.find(
        ({ record }) => record.lineHint === block.rootLine
    );
    if (exactLine) return exactLine.index;
    const exactSignature = samePath.filter(
        ({ record }) => record.subtreeSignature === block.subtreeSignature
    );
    return selectUniqueNearestRecordIndex(exactSignature, block.rootLine);
}

function selectUniqueNearestRecordIndex(
    records: readonly { record: RecentTaskBlockRecord; index: number }[],
    line: number
): number {
    const sorted = [...records].sort(
        (left, right) =>
            Math.abs(left.record.lineHint - line) -
            Math.abs(right.record.lineHint - line)
    );
    if (!sorted.length) return -1;
    if (sorted.length === 1) return sorted[0].index;
    const firstDistance = Math.abs(sorted[0].record.lineHint - line);
    const secondDistance = Math.abs(sorted[1].record.lineHint - line);
    return firstDistance === secondDistance ? -1 : sorted[0].index;
}

function toRecord(
    path: string,
    block: ParsedRootTaskBlock,
    lastTouchedAt: number
): RecentTaskBlockRecord {
    return {
        path,
        lineHint: block.rootLine,
        normalizedRootText: block.normalizedRootText,
        subtreeSignature: block.subtreeSignature,
        lastTouchedAt,
    };
}

function normalizeTaskText(value: unknown): string {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeStoredString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeSubtreeLine(line: string): string {
    return line.replace(/\t/g, "    ").trimEnd();
}

function leadingIndentWidth(line: string): number {
    const indent = line.match(/^[\t ]*/)?.[0] ?? "";
    return Array.from(indent).reduce(
        (width, character) => width + (character === "\t" ? 4 : 1),
        0
    );
}

function createTaskBlockSignature(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function toNonNegativeInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? value
        : null;
}

function toNonNegativeNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
