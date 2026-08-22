import { TimeRange } from "./time";
import type { NavigationViewId } from "../roamTypes";

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
    recentFiles: string[];

    preset: {
        type: "folder" | "tag";
        target: string;
    }[];
}
