export const UNCLASSIFIED_FILTER_VALUE = "__unclassified__";

export type RecentFileClassAssignment = {
    path: string;
    fileClassName: string | null;
};

export type RecentFileClassOption = {
    value: string;
    label: string;
    count: number;
};

export function normalizeRecentFileClassFilter(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}

export function getRecentFileClassValue(fileClassName: string | null): string {
    const trimmed = fileClassName?.trim();
    return trimmed || UNCLASSIFIED_FILTER_VALUE;
}

export function buildRecentFileClassOptions(
    assignments: readonly RecentFileClassAssignment[]
): RecentFileClassOption[] {
    const counts = new Map<string, number>();
    for (const assignment of assignments) {
        const value = getRecentFileClassValue(assignment.fileClassName);
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({
        value,
        label: value === UNCLASSIFIED_FILTER_VALUE ? "Unclassified" : value,
        count,
    }));
}

export function canFilterRecentFileClasses(
    options: readonly RecentFileClassOption[]
): boolean {
    return options.length >= 2;
}

export function filterRecentFileClassAssignments(
    assignments: readonly RecentFileClassAssignment[],
    selected: readonly string[],
    capabilityReady: boolean
): RecentFileClassAssignment[] {
    const options = buildRecentFileClassOptions(assignments);
    if (!capabilityReady || !canFilterRecentFileClasses(options) || !selected.length) {
        return [...assignments];
    }
    const selectedValues = new Set(selected);
    return assignments.filter((assignment) =>
        selectedValues.has(getRecentFileClassValue(assignment.fileClassName))
    );
}

export function toggleRecentFileClassFilter(
    selected: readonly string[],
    value: string
): string[] {
    return selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value];
}
