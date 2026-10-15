export const NAVIGATION_SECTION_IDS = [
    "bookmarks",
    "recentFiles",
    "recentTasks",
] as const;

export type NavigationSectionId = (typeof NAVIGATION_SECTION_IDS)[number];

export type NavigationSectionCollapsed = Record<NavigationSectionId, boolean>;

export const DEFAULT_NAVIGATION_SECTION_COLLAPSED: NavigationSectionCollapsed = {
    bookmarks: false,
    recentFiles: false,
    recentTasks: false,
};

export function restoreNavigationSectionCollapsed(
    value: unknown,
    fallback: NavigationSectionCollapsed = DEFAULT_NAVIGATION_SECTION_COLLAPSED
): NavigationSectionCollapsed {
    const record = isRecord(value) ? value : {};
    return {
        bookmarks: booleanOrFallback(record.bookmarks, fallback.bookmarks),
        recentFiles: booleanOrFallback(record.recentFiles, fallback.recentFiles),
        recentTasks: booleanOrFallback(record.recentTasks, fallback.recentTasks),
    };
}

export function setNavigationSectionCollapsed(
    current: NavigationSectionCollapsed,
    section: NavigationSectionId,
    collapsed: boolean
): NavigationSectionCollapsed {
    if (current[section] === collapsed) return current;
    return { ...current, [section]: collapsed };
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
