export function renameVisiblePath(
    visiblePaths: Set<string>,
    oldPath: string,
    newPath: string,
    renderedPaths: Set<string>
): Set<string> {
    const nextVisiblePaths = new Set(visiblePaths);
    const wasVisible = nextVisiblePaths.delete(oldPath);

    if (wasVisible && renderedPaths.has(newPath)) {
        nextVisiblePaths.add(newPath);
    }

    return nextVisiblePaths;
}
