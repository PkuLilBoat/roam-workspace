import { TimeField, TimeRange } from "../types/time";
import {
    filterJournalFilesByRange,
    JournalLikeFile,
    sortJournalFiles,
} from "./journalCore";

export interface FolderLikeFile {
    parent?: {
        path?: string;
    } | null;
}

export interface TagLikeCache {
    tags?: {
        tag: string;
    }[];
}

export function isFileInFolder(
    file: FolderLikeFile,
    folderPath: string | undefined
): boolean {
    if (!folderPath) return false;

    const parentPath = file.parent?.path || "";
    return parentPath === folderPath || parentPath.startsWith(`${folderPath}/`);
}

export function normalizeTag(tagName: string | undefined): string | null {
    const trimmedTag = tagName?.trim();
    if (!trimmedTag) return null;

    return trimmedTag.startsWith("#") ? trimmedTag : `#${trimmedTag}`;
}

export function fileHasTag(
    fileCache: TagLikeCache | null | undefined,
    tagName: string | undefined
): boolean {
    const targetTag = normalizeTag(tagName);
    if (!targetTag || !fileCache?.tags) return false;

    return fileCache.tags.some((tag) => tag.tag === targetTag);
}

export function sortAndFilterJournalFiles<T extends JournalLikeFile>(
    files: T[],
    timeField: TimeField | undefined,
    timeRange: TimeRange | undefined,
    now: number,
    customRange?: { start: Date; end: Date } | null
): T[] {
    const sortedFiles = sortJournalFiles(files, timeField);
    return filterJournalFilesByRange(
        sortedFiles,
        timeField,
        timeRange,
        now,
        customRange
    );
}
