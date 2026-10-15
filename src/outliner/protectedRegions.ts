import { EditorState } from "@codemirror/state";

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HTML_BLOCK_START_RE = /^\s*<(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|script|section|style|table|ul)(?:\s|>|\/)/i;
const HTML_BLOCK_END_RE = /<\/(?:address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|main|nav|ol|p|pre|script|section|style|table|ul)>\s*$/i;

export function isProtectedLine(state: EditorState, lineNumber: number): boolean {
    return isProtectedTextLine(state.doc.toString(), lineNumber - 1);
}

export function isProtectedTextLine(text: string, lineNumber: number): boolean {
    const lines = text.split("\n");
    let fence: string | null = null;
    let inMathBlock = false;
    let inHtmlBlock = false;
    let inFrontmatter = false;

    for (let index = 0; index <= lineNumber && index < lines.length; index += 1) {
        const line = lines[index];
        if (index === 0 && line.trim() === "---") {
            inFrontmatter = true;
            if (index === lineNumber) return true;
            continue;
        }
        if (inFrontmatter) {
            if (line.trim() === "---" || line.trim() === "...") {
                if (index === lineNumber) return true;
                inFrontmatter = false;
            }
            if (index === lineNumber) return true;
            continue;
        }

        const fenceMatch = FENCE_RE.exec(line);
        if (fenceMatch) {
            const marker = fenceMatch[1][0];
            fence = fence === marker ? null : fence ?? marker;
            if (index === lineNumber) return true;
            continue;
        }
        if (fence) {
            if (index === lineNumber) return true;
            continue;
        }

        if (line.trim() === "$$") {
            inMathBlock = !inMathBlock;
            if (index === lineNumber) return true;
            continue;
        }
        if (inMathBlock) {
            if (index === lineNumber) return true;
            continue;
        }

        if (!inHtmlBlock && HTML_BLOCK_START_RE.test(line)) inHtmlBlock = true;
        if (inHtmlBlock) {
            if (index === lineNumber) return true;
            if (HTML_BLOCK_END_RE.test(line)) inHtmlBlock = false;
        }
    }

    return false;
}

export function shouldProtectPastedText(text: string): boolean {
    const normalized = text.replace(/\r\n?/g, "\n");
    const lines = normalized.split("\n");
    if (lines.some((line) => FENCE_RE.test(line))) return true;
    if (lines.some((line) => line.trim() === "$$")) return true;
    if (lines.some((line) => /^\s*>\s*\[!/.test(line))) return true;
    if (lines.some((line) => HTML_BLOCK_START_RE.test(line))) return true;
    if (lines[0]?.trim() === "---") return true;
    return lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length >= 2;
}
