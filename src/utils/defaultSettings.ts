import { DailyNoteSettings } from "../types/settings";

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
    recentFiles: [],
    preset: [],
};
