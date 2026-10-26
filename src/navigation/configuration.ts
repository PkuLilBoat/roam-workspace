/** Navigation data lives in the plugin's existing data.json; labels never rename files. */
export interface JournalShortcut {
    id: string;
    name: string;
    folder: string;
    icon?: string;
    hidden?: boolean;
}

export interface NavigationLink {
    id: string;
    name: string;
    type: "note" | "web";
    target: string;
    icon?: string;
    hidden?: boolean;
}

export interface NavigationConfiguration {
    journalName: string;
    journals: JournalShortcut[];
    links: NavigationLink[];
    journalIcon?: string;
    viewOverrides?: Partial<Record<"page-stream" | "list-heading", { name: string; icon?: string }>>;
}

export function defaultNavigationConfiguration(): NavigationConfiguration {
    return { journalName: "Journal stream", journals: [], links: [] };
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${field} must be a non-empty string.`);
    }
    return value.trim();
}

function icon(value: unknown, field: string): string | undefined {
    if (value === undefined || value === "") return undefined;
    const name = text(value, field);
    if (!/^[a-z\d-]+$/i.test(name)) throw new Error(`${field} must be an icon name.`);
    return name;
}

function appearance(item: Record<string, unknown>, field: string): { icon?: string; hidden?: boolean } {
    const result: { icon?: string; hidden?: boolean } = {};
    const value = icon(item.icon, `${field}.icon`);
    if (value) result.icon = value;
    if (item.hidden !== undefined) {
        if (typeof item.hidden !== "boolean") throw new Error(`${field}.hidden must be boolean.`);
        result.hidden = item.hidden;
    }
    return result;
}

/** Reject traversal and absolute paths before handing a vault-relative path to Obsidian. */
export function journalShortcutFolder(value: unknown, field = "folder"): string {
    const folder = text(value, field).replace(/\\/g, "/");
    if (folder.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(folder) ||
        folder.split("/").some((part) => part === "..")) {
        throw new Error(`${field} must be a vault-relative folder.`);
    }
    const normalized = folder.split("/").filter((part) => part && part !== ".").join("/");
    if (!normalized) throw new Error(`${field} must identify a folder.`);
    return normalized;
}

/** Strict, all-or-nothing validation for an explicit settings apply. */
export function parseNavigationConfiguration(value: unknown): NavigationConfiguration {
    if (!record(value)) throw new Error("Navigation configuration must be an object.");
    const defaults = defaultNavigationConfiguration();
    const journalName = value.journalName === undefined ? defaults.journalName :
        text(value.journalName, "journalName");
    const readList = (field: "journals" | "links"): unknown[] => {
        const list = value[field];
        if (list === undefined) return [];
        if (!Array.isArray(list)) throw new Error(`${field} must be an array.`);
        return list;
    };
    const ids = new Set<string>();
    const readItem = (item: unknown, field: string) => {
        if (!record(item)) throw new Error(`${field} must be an object.`);
        const id = text(item.id, `${field}.id`);
        if (ids.has(id)) throw new Error(`Duplicate shortcut id: ${id}.`);
        ids.add(id);
        return { item, id, name: text(item.name, `${field}.name`) };
    };
    const folders = new Set<string>();
    const journals = readList("journals").map((entry, index) => {
        const field = `journals[${index}]`;
        const { item, id, name } = readItem(entry, field);
        const folder = journalShortcutFolder(item.folder, `${field}.folder`);
        if (folders.has(folder)) throw new Error(`Duplicate Journal folder: ${folder}.`);
        folders.add(folder);
        return { id, name, folder, ...appearance(item, field) };
    });
    const links = readList("links").map((entry, index): NavigationLink => {
        const field = `links[${index}]`;
        const { item, id, name } = readItem(entry, field);
        if (item.type !== "note" && item.type !== "web") {
            throw new Error(`${field}.type must be note or web.`);
        }
        const target = text(item.target, `${field}.target`);
        if (item.type === "web") {
            let url: URL;
            try { url = new URL(target); } catch { throw new Error(`${field}.target must be an HTTP(S) URL.`); }
            if (url.protocol !== "https:" && url.protocol !== "http:") {
                throw new Error(`${field}.target must be an HTTP(S) URL.`);
            }
        } else if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.replace(/\\/g, "/").startsWith("/") ||
            target.replace(/\\/g, "/").split("/").includes("..")) {
            throw new Error(`${field}.target must be an internal note link.`);
        }
        return { id, name, type: item.type, target, ...appearance(item, field) };
    });
    const result: NavigationConfiguration = { journalName, journals, links };
    const journalIcon = icon(value.journalIcon, "journalIcon");
    if (journalIcon) result.journalIcon = journalIcon;
    if (value.viewOverrides !== undefined) {
        if (!record(value.viewOverrides)) throw new Error("viewOverrides must be an object.");
        result.viewOverrides = {};
        for (const [id, entry] of Object.entries(value.viewOverrides)) {
            if ((id !== "page-stream" && id !== "list-heading") || !record(entry)) throw new Error("Invalid built-in view override.");
            const override: { name: string; icon?: string } = { name: text(entry.name, `viewOverrides.${id}.name`) };
            const name = icon(entry.icon, `viewOverrides.${id}.icon`);
            if (name) override.icon = name;
            result.viewOverrides[id] = override;
        }
    }
    return result;
}

export function restoreNavigationConfiguration(value: unknown): NavigationConfiguration {
    try { return parseNavigationConfiguration(value); }
    catch { return defaultNavigationConfiguration(); }
}

export function restoreBookmarkGroupCollapsed(value: unknown): Record<string, boolean> {
    if (!record(value)) return {};
    const states: Record<string, boolean> = {};
    for (const [key, collapsed] of Object.entries(value)) {
        if (typeof collapsed === "boolean") {
            Object.defineProperty(states, key, { value: collapsed, enumerable: true, writable: true, configurable: true });
        }
    }
    return states;
}
