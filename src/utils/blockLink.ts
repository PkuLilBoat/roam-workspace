export interface EnsureBlockLinkResult {
    line: string;
    blockId: string;
    changed: boolean;
    reason: "existing" | "inserted" | "unsupported";
}

const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const BLOCK_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function findBlockId(line: string): string | null {
    return line.match(BLOCK_ID_RE)?.[1] ?? null;
}

export function canInsertBlockId(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\|.*\|\s*$/.test(trimmed)) return false;
    if (/^(`{3,}|~{3,})/.test(trimmed)) return false;
    if (/^---\s*$/.test(trimmed)) return false;
    return true;
}

export function appendBlockIdToLine(
    line: string,
    blockId: string
): EnsureBlockLinkResult {
    const existing = findBlockId(line);
    if (existing) {
        return {
            line,
            blockId: existing,
            changed: false,
            reason: "existing",
        };
    }

    if (!canInsertBlockId(line)) {
        return {
            line,
            blockId,
            changed: false,
            reason: "unsupported",
        };
    }

    return {
        line: `${line.trimEnd()} ^${blockId}`,
        blockId,
        changed: true,
        reason: "inserted",
    };
}

export function buildBlockLink(path: string, blockId: string, embed = false): string {
    return `${embed ? "!" : ""}[[${path}#^${blockId}]]`;
}

export function createBlockId(now = Date.now(), random = Math.random()): string {
    const timePart = Math.max(0, Math.floor(now)).toString(36).slice(-6);
    let randomPart = "";
    let value = Math.max(0, Math.min(0.999999, random));
    for (let index = 0; index < 3; index++) {
        value *= BLOCK_ID_CHARS.length;
        const charIndex = Math.floor(value) % BLOCK_ID_CHARS.length;
        randomPart += BLOCK_ID_CHARS[charIndex];
        value -= Math.floor(value);
    }
    return `b${timePart}${randomPart}`;
}
