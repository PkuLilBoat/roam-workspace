import { PathIdentifiedFile } from "./fileList";

export function enqueueModifiedFile<T extends PathIdentifiedFile>(
    pendingFiles: Map<string, T>,
    file: T
): Map<string, T> {
    const nextPendingFiles = new Map(pendingFiles);
    nextPendingFiles.set(file.path, file);
    return nextPendingFiles;
}

export function drainModifiedFiles<T extends PathIdentifiedFile>(
    pendingFiles: Map<string, T>
): {
    files: T[];
    pendingFiles: Map<string, T>;
} {
    return {
        files: Array.from(pendingFiles.values()),
        pendingFiles: new Map(),
    };
}
