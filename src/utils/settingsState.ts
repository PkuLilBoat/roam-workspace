import { DailyNoteSettings, OutlinerScope } from "../types/settings";
import { TimeRange } from "../types/time";
import { DEFAULT_SETTINGS } from "./defaultSettings";
import { isTimeRange } from "./viewState";
import { NAVIGATION_VIEW_IDS, NavigationViewId } from "../roamTypes";
import { restoreNavigationSectionCollapsed } from "../navigation/sectionState";
import { normalizeRecentFileClassFilter } from "../navigation/recentFileClassFilter";
import { normalizeFilterValues, restorePropertyFilters } from "../navigation/recentMultiFilter";
import { restoreRecentTaskBlockRecords } from "../navigation/recentTaskBlocks";
import { restoreRecentPaths } from "./recentFiles";
import { restoreNavigationConfiguration, restoreBookmarkGroupCollapsed } from "../navigation/configuration";

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
    navigationConfiguration?: unknown;
    additionalJournalsCollapsed?: unknown;
    bookmarkGroupCollapsed?: unknown;
    navigationSectionCollapsed?: unknown;
    recentFileClassFilter?: unknown;
    recentFileTagsFilter?: unknown;
    recentFilePropertyFilters?: unknown;
    recentFiles?: unknown;
    showRecentTasks?: unknown;
    recentTaskBlocks?: unknown;
    recentTaskTagsFilter?: unknown;
    recentTaskPagesFilter?: unknown;
    outlinerScope?: unknown;
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
        navigationConfiguration: restoreNavigationConfiguration(raw.navigationConfiguration),
        additionalJournalsCollapsed: booleanOrDefault(raw.additionalJournalsCollapsed, defaults.additionalJournalsCollapsed),
        bookmarkGroupCollapsed: restoreBookmarkGroupCollapsed(raw.bookmarkGroupCollapsed),
        navigationSectionCollapsed: restoreNavigationSectionCollapsed(
            raw.navigationSectionCollapsed,
            defaults.navigationSectionCollapsed
        ),
        recentFileClassFilter: normalizeRecentFileClassFilter(
            raw.recentFileClassFilter
        ),
        recentFileTagsFilter: normalizeFilterValues(raw.recentFileTagsFilter),
        recentFilePropertyFilters: restorePropertyFilters(raw.recentFilePropertyFilters),
        recentFiles: restoreRecentPaths(raw.recentFiles),
        showRecentTasks: booleanOrDefault(
            raw.showRecentTasks,
            defaults.showRecentTasks
        ),
        recentTaskBlocks: restoreRecentTaskBlockRecords(raw.recentTaskBlocks),
        recentTaskTagsFilter: normalizeFilterValues(raw.recentTaskTagsFilter),
        recentTaskPagesFilter: normalizeFilterValues(raw.recentTaskPagesFilter),
        outlinerScope: isOutlinerScope(raw.outlinerScope)
            ? raw.outlinerScope
            : defaults.outlinerScope,
        preset: restorePresetList(raw.preset),
    };
}

function isOutlinerScope(value: unknown): value is OutlinerScope {
    return value === "off" || value === "stream-only" || value === "vault-wide";
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
