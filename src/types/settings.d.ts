import { TimeRange } from "./time";
import type { NavigationViewId } from "../roamTypes";
import type { NavigationSectionCollapsed } from "../navigation/sectionState";
import type { RecentTaskBlockRecord } from "../navigation/recentTaskBlocks";
import type { RecentFilePropertyFilters } from "../navigation/recentMultiFilter";
import type { NavigationConfiguration } from "../navigation/configuration";

export type OutlinerScope = "off" | "stream-only" | "vault-wide";

export interface DailyNoteSettings {
    hideFrontmatter: boolean;
    hideBacklinks: boolean;
    createAndOpenOnStartup: boolean;
    useArrowUpOrDownToNavigate: boolean;
    journalFolder: string;
    defaultOpenMode: "journal-folder" | "daily";
    initialRange: TimeRange;
    showSourcePath: boolean;
    enableExportMarkdown: boolean;
    navigationViews: NavigationViewId[];
    navigationConfiguration: NavigationConfiguration;
    additionalJournalsCollapsed: boolean;
    bookmarkGroupCollapsed: Record<string, boolean>;
    navigationSectionCollapsed: NavigationSectionCollapsed;
    recentFileClassFilter: string[];
    recentFileTagsFilter: string[];
    recentFilePropertyFilters: RecentFilePropertyFilters;
    recentFiles: string[];
    showRecentTasks: boolean;
    recentTaskBlocks: RecentTaskBlockRecord[];
    recentTaskTagsFilter: string[];
    recentTaskPagesFilter: string[];
    outlinerScope: OutlinerScope;

    preset: {
        type: "folder" | "tag";
        target: string;
    }[];
}
