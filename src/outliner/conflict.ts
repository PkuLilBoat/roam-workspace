import type { App } from "obsidian";

const EXTERNAL_OUTLINER_ID = "obsidian-outliner";

interface CommunityPluginRegistry {
    plugins?: Record<string, unknown>;
    enabledPlugins?: Set<string>;
}

export function isExternalOutlinerEnabled(app: App): boolean {
    const registry = (app as unknown as { plugins?: CommunityPluginRegistry })
        .plugins;
    if (!registry) return false;
    if (registry.enabledPlugins instanceof Set) {
        return registry.enabledPlugins.has(EXTERNAL_OUTLINER_ID);
    }
    return Boolean(registry.plugins?.[EXTERNAL_OUTLINER_ID]);
}
