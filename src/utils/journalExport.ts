import { TimeRange, TimeField } from "../types/time";
import { CustomRangeLike, normalizeCustomRange } from "./dateInput";
import { getJournalDateInfoFromParts, JournalLikeFile } from "./journalCore";

export interface JournalExportFile extends JournalLikeFile {
    path: string;
}

export interface JournalExportEntry<T extends JournalExportFile = JournalExportFile> {
    file: T;
    content: string;
}

export interface JournalExportContext {
    selectionMode: string;
    target: string;
    selectedRange: TimeRange;
    timeField: TimeField;
    customRange?: CustomRangeLike | null;
    exportedAt?: Date;
}

export interface ClipboardWriter {
    writeText(text: string): Promise<void>;
}

export type JournalContentReader<T extends JournalExportFile = JournalExportFile> = (
    file: T
) => Promise<string>;

export function selectVisibleExportFiles<T extends JournalExportFile>(
    renderedFiles: T[],
    visiblePaths: Set<string>
): T[] {
    const visibleFiles = renderedFiles.filter((file) =>
        visiblePaths.has(file.path)
    );

    return visibleFiles.length > 0 ? visibleFiles : renderedFiles;
}

export async function readJournalExportEntries<T extends JournalExportFile>(
    files: T[],
    readContent: JournalContentReader<T>
): Promise<JournalExportEntry<T>[]> {
    return Promise.all(
        files.map(async (file) => ({
            file,
            content: await readContent(file),
        }))
    );
}

export function buildJournalExportMarkdown(
    entries: JournalExportEntry[],
    context: JournalExportContext
): string {
    const exportedAt = context.exportedAt ?? new Date();
    const lines: string[] = [
        "# Journal Stream Export",
        "",
        "## Filter",
        `- selectionMode: ${context.selectionMode}`,
        `- target: ${context.target || "(none)"}`,
        `- selectedRange: ${context.selectedRange}`,
        `- timeField: ${context.timeField}`,
    ];

    if (context.selectedRange === "custom" && context.customRange) {
        const customRange = normalizeCustomRange(context.customRange);
        lines.push(
            customRange
                ? `- customRange: ${formatDate(customRange.start)} to ${formatDate(customRange.end)}`
                : "- customRange: invalid"
        );
    }

    lines.push(`- exportedAt: ${exportedAt.toISOString()}`);
    lines.push("", "## Source Files");

    if (entries.length === 0) {
        lines.push("- (none)");
    } else {
        for (const entry of entries) {
            const dateInfo = getJournalDateInfoFromParts(entry.file);
            lines.push(`- [[${entry.file.path}]] | ${dateInfo.label}`);
        }
    }

    lines.push("", "## Entries");

    for (const entry of entries) {
        const dateInfo = getJournalDateInfoFromParts(entry.file);
        const fence = markdownFenceFor(entry.content);
        lines.push(
            "",
            `### ${dateInfo.label} | ${entry.file.name}`,
            `- source_path: ${entry.file.path}`,
            `- date_source: ${dateInfo.source}`,
            "",
            `${fence}markdown`,
            entry.content.trimEnd(),
            fence
        );
    }

    return `${lines.join("\n")}\n`;
}

export async function copyMarkdownToClipboard(
    writer: ClipboardWriter | undefined,
    markdown: string
): Promise<void> {
    if (!writer?.writeText) {
        throw new Error("Clipboard API is not available");
    }

    await writer.writeText(markdown);
}

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function markdownFenceFor(content: string): string {
    const matches: RegExpMatchArray | [] = content.match(/`+/g) ?? [];
    let longest = 0;

    for (const match of matches) {
        longest = Math.max(longest, match.length);
    }

    return "`".repeat(Math.max(3, longest + 1));
}
