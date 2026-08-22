import { TimeRange, TimeField } from "../types/time";
import { filterJournalFilesByRange, JournalLikeFile, sortJournalFiles } from "./journalCore";
import {
    PathIdentifiedFile,
    removeFileByPath,
    upsertFileByPath,
} from "./fileList";

export interface IncrementalJournalFile
    extends JournalLikeFile,
        PathIdentifiedFile {}

export interface IncrementalFileSetOptions {
    belongsToSource: boolean;
    timeRange?: TimeRange;
    customRange?: { start: Date; end: Date } | null;
    timeField?: TimeField;
    now?: number;
    oldPath?: string;
}

export interface IncrementalFileSetResult<T extends IncrementalJournalFile> {
    allFiles: T[];
    filteredFiles: T[];
}

export function updateIncrementalFileSet<T extends IncrementalJournalFile>(
    allFiles: T[],
    file: T,
    options: IncrementalFileSetOptions
): IncrementalFileSetResult<T> {
    let nextAllFiles = options.oldPath
        ? removeFileByPath(allFiles, { path: options.oldPath })
        : allFiles;

    if (options.belongsToSource) {
        nextAllFiles = sortJournalFiles(
            upsertFileByPath(nextAllFiles, file),
            options.timeField
        );
    } else {
        nextAllFiles = removeFileByPath(nextAllFiles, file);
    }

    return {
        allFiles: nextAllFiles,
        filteredFiles: filterIncrementalFilesByRange(nextAllFiles, options),
    };
}

function filterIncrementalFilesByRange<T extends IncrementalJournalFile>(
    files: T[],
    options: IncrementalFileSetOptions
): T[] {
    if (!options.timeRange || options.timeRange === "all") {
        return [...files];
    }

    return filterJournalFilesByRange(
        files,
        options.timeField,
        options.timeRange,
        options.now ?? Date.now(),
        options.customRange
    );
}
