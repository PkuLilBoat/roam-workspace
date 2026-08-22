export function restoreRecentPaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    const paths: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const path = typeof item === "string" ? item.trim() : "";
        if (!path || seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
    }
    return paths;
}

export function recordRecentPath(paths: string[], path: string): string[] {
    if (paths[0] === path) return paths;
    return [path, ...paths.filter((item) => item !== path)];
}

export function renameRecentPath(
    paths: string[],
    oldPath: string,
    newPath: string
): string[] {
    if (!paths.includes(oldPath)) return paths;

    const seen = new Set<string>();
    return paths.flatMap((path) => {
        const renamed = path === oldPath ? newPath : path;
        if (seen.has(renamed)) return [];
        seen.add(renamed);
        return [renamed];
    });
}

export function removeRecentPath(paths: string[], path: string): string[] {
    if (!paths.includes(path)) return paths;
    return paths.filter((item) => item !== path);
}
