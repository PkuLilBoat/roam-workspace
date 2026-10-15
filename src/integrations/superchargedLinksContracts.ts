export type SuperchargedLinksSettings = {
    targetAttributes: readonly string[];
    targetTags: boolean;
};

export function createSuperchargedLinksStateSignature(
    enabled: boolean,
    settings: SuperchargedLinksSettings
): string {
    return JSON.stringify([
        enabled,
        [...settings.targetAttributes].sort(),
        settings.targetTags,
    ]);
}

export function isLatestAsyncGeneration(
    completedGeneration: number,
    latestGeneration: number
): boolean {
    return completedGeneration === latestGeneration;
}

export function parseSuperchargedLinksSettings(
    value: unknown
): SuperchargedLinksSettings {
    if (!isRecord(value)) return { targetAttributes: [], targetTags: false };

    const rawAttributes = Array.isArray(value.targetAttributes)
        ? value.targetAttributes
        : [];
    const targetAttributes = Array.from(
        new Set(
            rawAttributes
                .filter((attribute): attribute is string => typeof attribute === "string")
                .map((attribute) => attribute.trim())
                .filter(Boolean)
        )
    );
    return { targetAttributes, targetTags: value.targetTags === true };
}

export function buildSuperchargedLinkAttributes(
    frontmatter: Record<string, unknown> | null,
    tags: readonly string[],
    path: string,
    settings: SuperchargedLinksSettings
): Record<string, string> {
    const attributes: Record<string, string> = {};
    let mergedTags = "";

    if (frontmatter) {
        for (const attribute of settings.targetAttributes) {
            if (!Object.prototype.hasOwnProperty.call(frontmatter, attribute)) continue;
            const serialized = serializeAttributeValue(frontmatter[attribute]);
            if (serialized === null) continue;
            if (attribute === "tag" || attribute === "tags") {
                mergedTags += serialized;
            } else {
                attributes[toContractKey(attribute)] = serialized;
            }
        }
    }

    if (settings.targetTags && tags.length) mergedTags += tags.join(" ");
    if (mergedTags) attributes.tags = mergedTags;
    attributes.path = path;
    return attributes;
}

export function toContractKey(key: string): string {
    return key.replace(/ /g, "-");
}

export function toContractCssValue(value: string): string {
    return value.startsWith("http") || value.startsWith("data:")
        ? `url(${value})`
        : value;
}

function serializeAttributeValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        return value
            .map(serializeAttributeValue)
            .filter((item): item is string => item !== null)
            .join(",");
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
