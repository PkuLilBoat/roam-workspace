export type BookmarkTarget = { type: "file" | "folder"; path: string; label: string };
export type BookmarkNode = BookmarkTarget | {
    type: "group";
    key: string;
    label: string;
    children: BookmarkNode[];
};

type ResolveBookmark = (path: string, type: "file" | "folder") => string | null;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Preserve the core bookmark hierarchy without mutating its configuration. */
export function buildBookmarkTree(items: unknown[], resolve: ResolveBookmark, parent = "root"): BookmarkNode[] {
    const nodes: BookmarkNode[] = [];
    const occurrences = new Map<string, number>();
    for (const item of items) {
        if (!record(item)) continue;
        const title = typeof item.title === "string" ? item.title.trim() : "";
        if (item.type === "group" && Array.isArray(item.items)) {
            const label = title || "Untitled group";
            const identity = typeof item.ctime === "number" && Number.isFinite(item.ctime)
                ? `ctime:${item.ctime}` : `title:${encodeURIComponent(label)}`;
            const occurrence = occurrences.get(identity) ?? 0;
            occurrences.set(identity, occurrence + 1);
            const key = `${parent}/${identity}:${occurrence}`;
            nodes.push({ type: "group", key, label, children: buildBookmarkTree(item.items, resolve, key) });
        } else if ((item.type === "file" || item.type === "folder") && typeof item.path === "string") {
            const path = resolve(item.path, item.type);
            if (path !== null) nodes.push({ type: item.type, path, label: title || path.split("/").pop() || path });
        }
    }
    return nodes;
}
