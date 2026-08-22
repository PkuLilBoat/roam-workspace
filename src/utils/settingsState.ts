import { DailyNoteSettings } from "../types/settings";
import { TimeRange } from "../types/time";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import { isTimeRange } from "./viewState";
import { NAVIGATION_VIEW_IDS, NavigationViewId } from "../roamTypes";
import { restoreRecentPaths } from "./recentFiles";

interface DailyNoteSettingsLike {
    hideFrontmatter?: unknown;
    hideBacklinks?: unknown;
    createAndOpenOnStartup?: unknown;
    useArrowUpOrDownToNavigate?: unknown;
    journalFolder?: unknown;
    defaultOpenMode?: unknown;
    initialRange?: unknown;
    showSourcePath?: unknown;
    enableExportMarkdown?: unknown;
    navigationViews?: unknown;
    recentFiles?: unknown;
    preset?: unknown;
}

export function restoreDailyNoteSettings(
    data: unknown,
    defaults: DailyNoteSettings = DEFAULT_SETTINGS
): DailyNoteSettings {
    const raw = isObjectRecord(data) ? (data as DailyNoteSettingsLike) : {};

    return {
        ...defaults,
        hideFrontmatter: booleanOrDefault(
            raw.hideFrontmatter,
            defaults.hideFrontmatter
        ),
        hideBacklinks: booleanOrDefault(
            raw.hideBacklinks,
            defaults.hideBacklinks
        ),
        createAndOpenOnStartup: booleanOrDefault(
            raw.createAndOpenOnStartup,
            defaults.createAndOpenOnStartup
        ),
        useArrowUpOrDownToNavigate: booleanOrDefault(
            raw.useArrowUpOrDownToNavigate,
            defaults.useArrowUpOrDownToNavigate
        ),
        journalFolder: folderOrDefault(raw.journalFolder, defaults.journalFolder),
        defaultOpenMode: isDefaultOpenMode(raw.defaultOpenMode)
            ? raw.defaultOpenMode
            : defaults.defaultOpenMode,
        initialRange: initialRangeOrDefault(
            raw.initialRange,
            defaults.initialRange
        ),
        showSourcePath: booleanOrDefault(
            raw.showSourcePath,
            defaults.showSourcePath
        ),
        enableExportMarkdown: booleanOrDefault(
            raw.enableExportMarkdown,
            defaults.enableExportMarkdown
        ),
        navigationViews: restoreNavigationViews(
            raw.navigationViews,
            defaults.navigationViews
        ),
        recentFiles: restoreRecentPaths(raw.recentFiles),
        preset: restorePresetList(raw.preset),
    };
}

function restoreNavigationViews(
    value: unknown,
    fallback: NavigationViewId[]
): NavigationViewId[] {
    if (!Array.isArray(value)) return [...fallback];

    const selected = new Set(
        value.filter((item): item is NavigationViewId =>
            NAVIGATION_VIEW_IDS.includes(item as NavigationViewId)
        )
    );
    return NAVIGATION_VIEW_IDS.filter((id) => selected.has(id));
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function folderOrDefault(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function initialRangeOrDefault(value: unknown, fallback: TimeRange): TimeRange {
    return isTimeRange(value) && value !== "custom" ? value : fallback;
}

function restorePresetList(
    value: unknown
): DailyNoteSettings["preset"] {
    if (!Array.isArray(value)) return [];

    const presets: DailyNoteSettings["preset"] = [];
    const seen = new Set<string>();

    for (const item of value) {
        if (!isObjectRecord(item)) continue;
        const type = item.type;
        const target =
            typeof item.target === "string" ? item.target.trim() : "";

        if ((type !== "folder" && type !== "tag") || !target) continue;

        const key = `${type}:${target}`;
        if (seen.has(key)) continue;

        seen.add(key);
        presets.push({ type, target });
    }

    return presets;
}

function isDefaultOpenMode(
    value: unknown
): value is DailyNoteSettings["defaultOpenMode"] {
    return value === "journal-folder" || value === "daily";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
