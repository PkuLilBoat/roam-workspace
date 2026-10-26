import { DailyNoteSettings } from "../types/settings";
import { DEFAULT_NAVIGATION_SECTION_COLLAPSED } from "../navigation/sectionState";
import { defaultNavigationConfiguration } from "../navigation/configuration";

export const DEFAULT_SETTINGS: DailyNoteSettings = {
    hideFrontmatter: false,
    hideBacklinks: false,
    createAndOpenOnStartup: false,
    useArrowUpOrDownToNavigate: false,
    journalFolder: "Journal",
    defaultOpenMode: "journal-folder",
    initialRange: "recent-30",
    showSourcePath: true,
    enableExportMarkdown: true,
    navigationViews: ["journal-stream"],
    navigationConfiguration: defaultNavigationConfiguration(),
    additionalJournalsCollapsed: true,
    bookmarkGroupCollapsed: {},
    navigationSectionCollapsed: { ...DEFAULT_NAVIGATION_SECTION_COLLAPSED },
    recentFileClassFilter: [],
    recentFileTagsFilter: [],
    recentFilePropertyFilters: {},
    recentFiles: [],
    showRecentTasks: false,
    recentTaskBlocks: [],
    recentTaskTagsFilter: [],
    recentTaskPagesFilter: [],
    outlinerScope: "stream-only",
    preset: [],
};
