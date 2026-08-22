import { TimeField, TimeRange, SelectionMode } from "../types/time";
import { CustomRangeLike, normalizeCustomRange } from "./dateInput";

export interface JournalStreamViewState extends Record<string, unknown> {
    selectionMode: SelectionMode;
    target: string;
    timeField: TimeField;
    selectedRange: TimeRange;
    customRange: null;
}

export interface JournalStreamDefaults {
    defaultOpenMode: "journal-folder" | "daily";
    journalFolder: string;
    initialRange: TimeRange;
}

export interface RestoredJournalStreamState {
    selectionMode: SelectionMode;
    target: string;
    timeField: TimeField;
    selectedRange: TimeRange;
    customRange: { start: Date; end: Date } | null;
}

export interface JournalStreamRestoreDefaults {
    initialRange: TimeRange;
}

export interface JournalStreamStateLike {
    selectionMode?: unknown;
    target?: unknown;
    timeField?: unknown;
    selectedRange?: unknown;
    customRange?: CustomRangeLike | null;
}

export const TIME_RANGES: readonly TimeRange[] = [
    "today",
    "recent-7",
    "recent-30",
    "week",
    "month",
    "year",
    "all",
    "last-week",
    "last-month",
    "last-year",
    "quarter",
    "last-quarter",
    "custom",
];

export const SELECTION_MODES: readonly SelectionMode[] = [
    "daily",
    "folder",
    "tag",
];

export const TIME_FIELDS: readonly TimeField[] = [
    "ctime",
    "mtime",
    "journalDate",
    "ctimeReverse",
    "mtimeReverse",
    "journalDateReverse",
    "name",
    "nameReverse",
];

export interface TimeRangeOption {
    value: TimeRange;
    label: string;
}

export const TIME_RANGE_OPTIONS: readonly TimeRangeOption[] = [
    { value: "today", label: "Today" },
    { value: "recent-7", label: "Recent 7 Days" },
    { value: "recent-30", label: "Recent 30 Days" },
    { value: "week", label: "This Week" },
    { value: "month", label: "This Month" },
    { value: "year", label: "This Year" },
    { value: "all", label: "All Notes" },
    { value: "last-week", label: "Last Week" },
    { value: "last-month", label: "Last Month" },
    { value: "last-year", label: "Last Year" },
    { value: "quarter", label: "This Quarter" },
    { value: "last-quarter", label: "Last Quarter" },
    { value: "custom", label: "Custom Date Range" },
];

export const INITIAL_RANGE_OPTIONS: readonly TimeRangeOption[] =
    TIME_RANGE_OPTIONS.filter((option) => option.value !== "custom");

export function buildJournalFolderViewState(
    folderPath: string,
    timeField: TimeField,
    selectedRange: TimeRange
): JournalStreamViewState {
    return {
        selectionMode: "folder",
        target: folderPath,
        timeField,
        selectedRange,
        customRange: null,
    };
}

export function buildDailyViewState(
    selectedRange: TimeRange
): JournalStreamViewState {
    return {
        selectionMode: "daily",
        target: "",
        timeField: "journalDate",
        selectedRange,
        customRange: null,
    };
}

export function buildTagViewState(
    tagName: string,
    timeField: TimeField,
    selectedRange: TimeRange
): JournalStreamViewState {
    return {
        selectionMode: "tag",
        target: tagName,
        timeField,
        selectedRange,
        customRange: null,
    };
}

export function buildDefaultJournalStreamViewState(
    settings: JournalStreamDefaults
): JournalStreamViewState {
    return settings.defaultOpenMode === "daily"
        ? buildDailyViewState(settings.initialRange)
        : buildJournalFolderViewState(
              settings.journalFolder,
              "journalDate",
              settings.initialRange
          );
}

export function canCopyJournalStreamMarkdown(
    enableExportMarkdown: boolean,
    hasView: boolean
): boolean {
    return enableExportMarkdown && hasView;
}

export function restoreJournalStreamState(
    state: unknown,
    defaults: JournalStreamRestoreDefaults
): RestoredJournalStreamState {
    const stateLike = isObjectRecord(state)
        ? (state as JournalStreamStateLike)
        : {};
    const selectionMode = isSelectionMode(stateLike.selectionMode)
        ? stateLike.selectionMode
        : "daily";
    const timeField = isTimeField(stateLike.timeField)
        ? stateLike.timeField
        : "journalDate";
    const target =
        selectionMode === "daily"
            ? ""
            : typeof stateLike.target === "string"
                ? stateLike.target
                : "";
    const restoredCustomRange = normalizeCustomRange(stateLike.customRange);
    const selectedRange = isTimeRange(stateLike.selectedRange)
        ? stateLike.selectedRange === "custom" && !restoredCustomRange
            ? defaults.initialRange
            : stateLike.selectedRange
        : defaults.initialRange;

    return {
        selectionMode,
        target,
        timeField,
        selectedRange,
        customRange: selectedRange === "custom" ? restoredCustomRange : null,
    };
}

export function isTimeRange(value: unknown): value is TimeRange {
    return typeof value === "string" && TIME_RANGES.includes(value as TimeRange);
}

export function isSelectionMode(value: unknown): value is SelectionMode {
    return (
        typeof value === "string" &&
        SELECTION_MODES.includes(value as SelectionMode)
    );
}

export function isTimeField(value: unknown): value is TimeField {
    return typeof value === "string" && TIME_FIELDS.includes(value as TimeField);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
