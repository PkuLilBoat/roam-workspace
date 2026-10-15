export const MISSING_PROPERTY_VALUE = "__missing__";

export type RecentFileMetadata = {
    path: string;
    tags: string[];
    properties: Record<string, string[]>;
};

export type RecentFilePropertyFilters = Record<string, string[]>;

export type RecentTaskMetadata = {
    tags: string[];
    pages: string[];
};

export type FilterOption = { value: string; label: string; count: number };

export function normalizeFilterValues(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const entry of value) {
        if (typeof entry !== "string") continue;
        const normalized = entry.trim();
        if (normalized) seen.add(normalized);
    }
    return [...seen];
}

export function restorePropertyFilters(value: unknown): RecentFilePropertyFilters {
    if (!isRecord(value)) return {};
    const restored: RecentFilePropertyFilters = {};
    for (const [key, selected] of Object.entries(value)) {
        if (!key.trim() || key === "tags" || key === "position") continue;
        const values = normalizeFilterValues(selected);
        if (values.length) restored[key] = values;
    }
    return restored;
}

export function normalizeFileMetadata(
    path: string,
    frontmatter: Record<string, unknown> | null | undefined
): RecentFileMetadata {
    const source = frontmatter ?? {};
    const rawTags = Array.isArray(source.tags) ? source.tags : [source.tags];
    const tags = [...new Set(rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean))];
    const properties: Record<string, string[]> = {};
    for (const [key, raw] of Object.entries(source)) {
        if (key === "tags" || key === "position") continue;
        const items = Array.isArray(raw) ? raw : [raw];
        properties[key] = [...new Set(items.map(encodePropertyValue).filter(isString))];
    }
    return { path, tags, properties };
}

export function encodePropertyValue(value: unknown): string | null {
    if (typeof value === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `date:${value}`;
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
            return `datetime:${value}`;
        }
        return `text:${value}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) return `number:${value}`;
    if (typeof value === "boolean") return `checkbox:${value}`;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return `datetime:${value.toISOString()}`;
    }
    return null;
}

export function propertyValueLabel(value: string): string {
    if (value === MISSING_PROPERTY_VALUE) return "Missing field";
    const colon = value.indexOf(":");
    if (colon < 0) return value;
    const kind = value.slice(0, colon);
    const content = value.slice(colon + 1);
    return kind === "text" ? content : `${content} · ${kind}`;
}

export function buildOptions(values: readonly (readonly string[])[]): FilterOption[] {
    const counts = new Map<string, number>();
    for (const row of values) {
        for (const value of new Set(row)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({
        value,
        label: propertyValueLabel(value),
        count,
    }));
}

export function buildPropertyOptions(
    files: readonly RecentFileMetadata[]
): Record<string, FilterOption[]> {
    const keys = new Set(files.flatMap((file) => Object.keys(file.properties)));
    const result: Record<string, FilterOption[]> = {};
    for (const key of keys) {
        const values = files.map((file) => file.properties[key] ?? []);
        result[key] = buildOptions(values);
        const missing = files.filter((file) => !(key in file.properties)).length;
        if (missing) {
            result[key].push({ value: MISSING_PROPERTY_VALUE, label: "Missing field", count: missing });
        }
    }
    return result;
}

export function matchesSelected(
    selected: readonly string[],
    values: readonly string[],
    missing = false
): boolean {
    return selected.length === 0 || selected.some((value) =>
        value === MISSING_PROPERTY_VALUE ? missing : values.includes(value)
    );
}

export function matchesRecentFileMetadata(
    file: RecentFileMetadata,
    tags: readonly string[],
    properties: RecentFilePropertyFilters
): boolean {
    if (!matchesSelected(tags, file.tags)) return false;
    return Object.entries(properties).every(([key, selected]) =>
        matchesSelected(selected, file.properties[key] ?? [], !(key in file.properties))
    );
}

export function parseRootTaskMetadata(
    rootText: string,
    resolvePage: (target: string) => string
): RecentTaskMetadata {
    const pages: string[] = [];
    const withoutLinks = rootText.replace(/\[\[([^\]]+)\]\]/g, (_match, content: string) => {
        const target = content.split("|")[0].split("#")[0].trim();
        if (target) pages.push(resolvePage(target));
        return " ";
    });
    const tags: string[] = [];
    const pattern = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
    for (const match of withoutLinks.matchAll(pattern)) {
        if (/[^0-9]/u.test(match[2])) tags.push(match[2].toLowerCase());
    }
    return { tags: [...new Set(tags)], pages: [...new Set(pages)] };
}

export function matchesRecentTaskMetadata(
    task: RecentTaskMetadata,
    tags: readonly string[],
    pages: readonly string[]
): boolean {
    return matchesSelected(tags, task.tags) && matchesSelected(pages, task.pages);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
    return value !== null;
}
