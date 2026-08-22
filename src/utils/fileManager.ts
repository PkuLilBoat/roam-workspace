import { TFile, TFolder, moment, App } from "obsidian";
import {
    getAllDailyNotes,
    getDailyNote,
    createDailyNote,
    getDateFromFile,
    getDailyNoteSettings,
    DEFAULT_DAILY_NOTE_FORMAT,
} from "obsidian-daily-notes-interface";
import { TimeRange, TimeField } from "../types/time";
import {
    filterJournalFilesByRange,
    parseTimeField,
    sortJournalFiles,
} from "./journalCore";
import {
    collectMarkdownFilesFromFolder,
    isMarkdownFile,
    removeFileByPath,
    upsertFileByPath,
} from "./fileList";
import { fileHasTag, isFileInFolder } from "./fileSource";
import { updateIncrementalFileSet } from "./incrementalFileSet";

export interface FileManagerOptions {
    mode: "daily" | "folder" | "tag";
    target?: string;
    timeRange?: TimeRange;
    customRange?: { start: Date; end: Date } | null;
    app?: App;
    timeField?: TimeField;
}

export class FileManager {
    private allFiles: TFile[] = [];
    private filteredFiles: TFile[] = [];
    private hasFetched: boolean = false;
    private hasCurrentDay: boolean = true;
    private cacheDailyNotes: Record<string, any> = {};

    // Make options public so it can be accessed from outside
    public options: FileManagerOptions;

    constructor(options: FileManagerOptions) {
        this.options = options;
        this.fetchFiles();
    }

    /**
     * Helper method to parse time field and check if it's reverse
     * @param timeField The time field to parse
     * @returns An object containing isReverse flag and baseTimeField
     */
    private parseTimeField(timeField: TimeField | undefined): {
        isReverse: boolean;
        baseTimeField: string;
    } {
        return parseTimeField(timeField);
    }

    /**
     * Helper method to sort files by time field
     * @param files The files to sort
     * @param timeField The time field to sort by
     * @returns Sorted files
     */
    private sortFilesByTimeField(
        files: TFile[],
        timeField?: TimeField
    ): TFile[] {
        return sortJournalFiles(files, timeField);
    }

    public fetchFiles(): void {
        if (this.hasFetched) return;

        switch (this.options.mode) {
            case "daily":
                this.fetchDailyNotes();
                break;
            case "folder":
                this.fetchFolderFiles();
                break;
            case "tag":
                this.fetchTaggedFiles();
                break;
        }

        this.hasFetched = true;
        this.checkDailyNote();
        this.filterFilesByRange();
    }

    private fetchDailyNotes(): void {
        this.cacheDailyNotes = getAllDailyNotes();

        // Convert the object to an array of files
        const notes = Object.values(this.cacheDailyNotes) as TFile[];

        // Sort based on the selected time field
        const { isReverse, baseTimeField } = this.parseTimeField(
            this.options.timeField
        );

        if (baseTimeField === "name") {
            // For name-based sorting, sort by filename
            this.allFiles = [...notes].sort((a, b) => {
                const result = a.name.localeCompare(b.name);
                return isReverse ? -result : result;
            });
        } else {
            // Default sorting (by date in the filename)
            // Build notes list by date in descending order
            for (const string of Object.keys(this.cacheDailyNotes)
                .sort()
                .reverse()) {
                this.allFiles.push(<TFile>this.cacheDailyNotes[string]);
            }

            // Apply additional time-based sorting if needed
            if (baseTimeField !== "ctime" && baseTimeField !== "mtime") {
                this.allFiles = this.sortFilesByTimeField(
                    this.allFiles,
                    this.options.timeField
                );
            }
        }
    }

    private fetchFolderFiles(): void {
        if (!this.options.target || !this.options.app) return;

        const targetFolder =
            this.options.app.vault.getAbstractFileByPath(this.options.target);
        if (!(targetFolder instanceof TFolder)) return;

        this.allFiles = collectMarkdownFilesFromFolder(targetFolder) as TFile[];

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    private fetchTaggedFiles(): void {
        if (!this.options.target || !this.options.app) return;

        // Get all files with the specified tag
        const allFiles = this.options.app.vault.getMarkdownFiles();
        this.allFiles = allFiles.filter((file) => {
            // Check if the file has the target tag in its cache
            const fileCache =
                this.options.app?.metadataCache.getFileCache(file);
            return fileHasTag(fileCache, this.options.target);
        });

        // Sort files by the specified time field
        this.allFiles = this.sortFilesByTimeField(
            this.allFiles,
            this.options.timeField
        );
    }

    public filterFilesByRange(): TFile[] {
        // If no time range is specified, return all files
        if (!this.options.timeRange) {
            this.filteredFiles = [...this.allFiles];
            return this.filteredFiles;
        }

        // Reset the filtered files list
        this.filteredFiles = [];

        // If the time range is "all", return all files
        if (this.options.timeRange === "all") {
            this.filteredFiles = [...this.allFiles];
            return this.filteredFiles;
        }

        // Use different filtering methods based on different modes
        if (this.options.mode === "daily") {
            // Daily mode: filter daily notes by date
            this.filterDailyNotesByRange();
        } else {
            // Folder and tag modes: filter files by creation or modification time
            this.filterFilesByTimeRange();
        }

        return this.filteredFiles;
    }

    /**
     * Filter files by time range
     * Applicable to folder and tag modes
     */
    private filterFilesByTimeRange(): void {
        this.filteredFiles = filterJournalFilesByRange(
            this.allFiles,
            this.options.timeField,
            this.options.timeRange,
            Date.now(),
            this.options.customRange
        );
    }

    /**
     * Filter daily notes by date
     * Applicable to daily mode
     */
    private filterDailyNotesByRange(): void {
        const now = moment();
        const fileFormat =
            getDailyNoteSettings().format || DEFAULT_DAILY_NOTE_FORMAT;

        this.filteredFiles = this.allFiles.filter((file) => {
            const fileDate = moment(file.basename, fileFormat, true);
            if (!fileDate.isValid()) return false;

            return this.isDateInRange(fileDate, now);
        });
    }

    /**
     * Check if the file date is in the range
     * @param fileDate file date
     * @param now current date
     * @returns whether in the range
     */
    private isDateInRange(
        fileDate: moment.Moment,
        now: moment.Moment
    ): boolean {
        switch (this.options.timeRange) {
            case "today":
                return fileDate.isSame(now, "day");
            case "recent-7":
                return fileDate.isBetween(
                    now.clone().subtract(7, "days").startOf("day"),
                    now,
                    null,
                    "[]"
                );
            case "recent-30":
                return fileDate.isBetween(
                    now.clone().subtract(30, "days").startOf("day"),
                    now,
                    null,
                    "[]"
                );
            case "week":
                return fileDate.isSame(now, "week");
            case "month":
                return fileDate.isSame(now, "month");
            case "year":
                return fileDate.isSame(now, "year");
            case "last-week":
                return fileDate.isBetween(
                    now.clone().subtract(1, "week").startOf("week"),
                    now.clone().subtract(1, "week").endOf("week"),
                    null,
                    "[]"
                );
            case "last-month":
                return fileDate.isBetween(
                    now.clone().subtract(1, "month").startOf("month"),
                    now.clone().subtract(1, "month").endOf("month"),
                    null,
                    "[]"
                );
            case "last-year":
                return fileDate.isBetween(
                    now.clone().subtract(1, "year").startOf("year"),
                    now.clone().subtract(1, "year").endOf("year"),
                    null,
                    "[]"
                );
            case "quarter":
                return fileDate.isSame(now, "quarter");
            case "last-quarter":
                return fileDate.isBetween(
                    now.clone().subtract(1, "quarter").startOf("quarter"),
                    now.clone().subtract(1, "quarter").endOf("quarter"),
                    null,
                    "[]"
                );
            case "custom":
                if (this.options.customRange) {
                    const startDate = moment(this.options.customRange.start);
                    const endDate = moment(this.options.customRange.end);
                    return fileDate.isBetween(startDate, endDate, null, "[]");
                }
                return false;
            default:
                return true;
        }
    }

    public checkDailyNote(): boolean {
        if (this.options.mode !== "daily") {
            this.hasCurrentDay = true;
            return true;
        }

        // Refresh the daily notes cache to ensure we have the latest data
        this.cacheDailyNotes = getAllDailyNotes();

        // @ts-ignore
        const currentDate = moment();
        const currentDailyNote = getDailyNote(
            currentDate,
            this.cacheDailyNotes
        );

        if (!currentDailyNote) {
            this.hasCurrentDay = false;
            return false;
        }

        // Check if we need to update the allFiles and filteredFiles arrays
        if (this.hasCurrentDay === false) {
            // We didn't have the current day's note before, but now we do
            // So we need to update our file lists
            this.allFiles = [];
            this.fetchDailyNotes();
            this.filterFilesByRange();
        }

        this.hasCurrentDay = true;
        return true;
    }

    public async createNewDailyNote(): Promise<TFile | null> {
        if (this.options.mode !== "daily" || this.hasCurrentDay) {
            return null;
        }

        const currentDate = moment();
        const currentDailyNote: any = await createDailyNote(currentDate);

        if (currentDailyNote) {
            this.allFiles = this.sortDailyNotes(
                upsertFileByPath(this.allFiles, currentDailyNote)
            );
            this.hasCurrentDay = true;
            this.filterFilesByRange();
            return currentDailyNote;
        }

        return null;
    }

    public fileCreate(file: TFile): void {
        if (this.options.mode === "daily") {
            this.handleDailyNoteCreate(file);
        } else if (this.options.mode === "folder") {
            this.handleFolderFileCreate(file);
        } else if (this.options.mode === "tag") {
            this.handleTaggedFileCreate(file);
        }
    }

    private handleDailyNoteCreate(file: TFile): void {
        const fileDate = getDateFromFile(file as any, "day");
        if (!fileDate) return;

        this.allFiles = this.sortDailyNotes(
            upsertFileByPath(this.allFiles, file)
        );
        this.filterFilesByRange();

        if (fileDate.isSame(moment(), "day")) this.hasCurrentDay = true;
    }

    private handleFolderFileCreate(file: TFile): void {
        if (!this.options.target) return;

        // Check if the file belongs to the target folder
        if (isFileInFolder(file, this.options.target)) {
            this.upsertAndSortFile(file);
            this.filterFilesByRange();
        }
    }

    private handleTaggedFileCreate(file: TFile): void {
        if (!this.options.target || !this.options.app) return;

        // Check if the file has the target tag
        const fileCache = this.options.app.metadataCache.getFileCache(file);
        if (fileHasTag(fileCache, this.options.target)) {
            this.upsertAndSortFile(file);
            this.filterFilesByRange();
        }
    }

    public fileDelete(file: TFile): void {
        if (
            this.options.mode === "daily" &&
            getDateFromFile(file as any, "day")
        ) {
            this.filteredFiles = removeFileByPath(this.filteredFiles, file);
            this.allFiles = removeFileByPath(this.allFiles, file);
            this.filterFilesByRange();
            this.checkDailyNote();
        } else {
            // Handle deletion for folder and tag modes
            this.filteredFiles = removeFileByPath(this.filteredFiles, file);
            this.allFiles = removeFileByPath(this.allFiles, file);
        }
    }

    public fileModify(file: TFile): void {
        this.updateSingleFile(file);
    }

    public fileRename(file: TFile, oldPath: string): void {
        this.updateSingleFile(file, oldPath);
    }

    public refreshFiles(): void {
        this.allFiles = [];
        this.filteredFiles = [];
        this.hasFetched = false;
        this.fetchFiles();
    }

    private sortDailyNotes(notes: TFile[]): TFile[] {
        // Sort daily notes by date (newest first by default)
        // For this, we're using the file name which follows the daily note format
        const { isReverse, baseTimeField } = this.parseTimeField(
            this.options.timeField
        );

        // If sorting by name, use alphabetical sorting which will automatically
        // sort chronologically for date-formatted filenames
        if (baseTimeField === "name") {
            return [...notes].sort((a, b) => {
                if (isReverse) {
                    return b.name.localeCompare(a.name);
                }
                return a.name.localeCompare(b.name);
            });
        }

        // Otherwise use the normal time-based sorting
        return this.sortFilesByTimeField(notes, this.options.timeField);
    }

    private updateSingleFile(file: TFile, oldPath?: string): void {
        const nextFiles = updateIncrementalFileSet(
            this.allFiles,
            file,
            {
                belongsToSource: this.fileBelongsToCurrentSource(file),
                timeRange: this.options.timeRange,
                customRange: this.options.customRange,
                timeField: this.options.timeField,
                oldPath,
            }
        );

        this.allFiles = nextFiles.allFiles;
        this.filteredFiles = nextFiles.filteredFiles;

        if (this.options.mode === "daily") {
            this.cacheDailyNotes = getAllDailyNotes();
            this.updateCurrentDayStatus(file);
        }
    }

    private fileBelongsToCurrentSource(file: TFile): boolean {
        if (!isMarkdownFile(file)) return false;

        if (this.options.mode === "daily") {
            return Boolean(getDateFromFile(file as any, "day"));
        }

        if (!this.options.target) return false;

        if (this.options.mode === "folder") {
            return isFileInFolder(file, this.options.target);
        }

        if (this.options.mode === "tag") {
            if (!this.options.app) return false;
            const fileCache = this.options.app.metadataCache.getFileCache(file);
            return fileHasTag(fileCache, this.options.target);
        }

        return false;
    }

    private upsertAndSortFile(file: TFile): void {
        if (this.options.mode === "daily") {
            this.allFiles = this.sortDailyNotes(
                upsertFileByPath(this.allFiles, file)
            );
        } else {
            this.allFiles = this.sortFilesByTimeField(
                upsertFileByPath(this.allFiles, file),
                this.options.timeField
            );
        }
    }

    private updateCurrentDayStatus(file: TFile): void {
        const fileDate = getDateFromFile(file as any, "day");

        if (fileDate?.isSame(moment(), "day")) {
            this.hasCurrentDay = true;
            return;
        }

        this.hasCurrentDay = Boolean(
            getDailyNote(moment(), this.cacheDailyNotes)
        );
    }

    public getAllFiles(): TFile[] {
        return [...this.allFiles];
    }

    public getFilteredFiles(): TFile[] {
        return [...this.filteredFiles];
    }

    public hasCurrentDayNote(): boolean {
        return this.hasCurrentDay;
    }

    public updateOptions(options: Partial<FileManagerOptions>): void {
        this.options = { ...this.options, ...options };

        if (options.timeRange || options.customRange) {
            this.filterFilesByRange();
        }

        if (options.mode || options.target || options.timeField) {
            this.refreshFiles();
        }
    }
}
