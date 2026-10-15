export type SemanticVersion = {
    major: number;
    minor: number;
    patch: number;
};

export type MetadataMenuActionDescriptor<T> = {
    title: string | null;
    icon: string | null;
    section: string | null;
    action: T | null;
};

export type MetadataMenuTarget = "open-fields" | "add-file-class";

export function parseSemanticVersion(version: string): SemanticVersion | null {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
    if (!match) return null;

    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (![major, minor, patch].every(Number.isSafeInteger)) return null;
    return { major, minor, patch };
}

export function supportsMetadataMenuTargetedActions(version: string): boolean {
    const parsed = parseSemanticVersion(version);
    return parsed?.major === 0 && parsed.minor === 8 && parsed.patch === 12;
}

export function selectMetadataMenuTargetAction<T>(
    items: readonly MetadataMenuActionDescriptor<T>[],
    target: MetadataMenuTarget,
    basename: string
): T | null {
    for (const item of items) {
        if (!item.action) continue;
        if (target === "open-fields" && item.title === "Open fields modal") {
            return item.action;
        }
        if (
            target === "add-file-class" &&
            item.section === "metadata-menu-fileclass" &&
            item.icon === "plus-square" &&
            item.title?.startsWith("Add ") === true &&
            item.title.endsWith(` to ${basename}`)
        ) {
            return item.action;
        }
    }
    return null;
}

export function createContentSignature(content: string): string {
    let hash = 2166136261;
    for (let index = 0; index < content.length; index += 1) {
        hash ^= content.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${content.length}:${hash >>> 0}`;
}

export function selectHighestPriorityFileClass<T>(
    values: readonly T[] | null | undefined,
    isUsable: (value: T) => boolean
): T | null {
    if (!values) return null;
    for (let index = values.length - 1; index >= 0; index -= 1) {
        const value = values[index];
        if (isUsable(value)) return value;
    }
    return null;
}
