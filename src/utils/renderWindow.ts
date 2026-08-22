export interface RenderWindowState<T> {
    renderedFiles: T[];
    pendingFiles: T[];
    hasMore: boolean;
}

export function appendRenderBatch<T>(
    renderedFiles: T[],
    pendingFiles: T[],
    batchSize: number
): RenderWindowState<T> {
    const safeBatchSize = Math.max(0, Math.floor(batchSize));
    const nextBatch = pendingFiles.slice(0, safeBatchSize);
    const nextPending = pendingFiles.slice(safeBatchSize);

    return {
        renderedFiles: [...renderedFiles, ...nextBatch],
        pendingFiles: nextPending,
        hasMore: nextPending.length > 0,
    };
}

export function rebuildRenderWindow<T>(
    filteredFiles: T[],
    renderedFiles: T[],
    batchSize: number
): RenderWindowState<T> {
    const nextRenderedCount = Math.max(
        renderedFiles.length,
        Math.max(0, Math.floor(batchSize))
    );

    return {
        renderedFiles: filteredFiles.slice(0, nextRenderedCount),
        pendingFiles: filteredFiles.slice(nextRenderedCount),
        hasMore: filteredFiles.length > nextRenderedCount,
    };
}
