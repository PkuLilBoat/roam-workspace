import { App, Notice } from "obsidian";

function isSettingsMethod(value: unknown): value is (...args: string[]) => unknown {
    return typeof value === "function";
}

/** No public API opens a particular settings tab. Keep this optional jump isolated. */
export async function openPluginSettings(app: App, pluginId: string): Promise<void> {
    if ("setting" in app && app.setting !== null && typeof app.setting === "object" &&
        "open" in app.setting && isSettingsMethod(app.setting.open) &&
        "openTabById" in app.setting && isSettingsMethod(app.setting.openTabById)) {
        try {
            await app.setting.open();
            await app.setting.openTabById(pluginId);
            return;
        } catch { /* The full editor remains available through the native settings UI. */ }
    }
    new Notice("Open settings → roam workspace → navigation views to manage shortcuts.");
}
