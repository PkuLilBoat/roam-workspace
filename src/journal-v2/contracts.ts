import type { TFile } from "obsidian";
import type { SelectionMode, TimeField, TimeRange } from "../types/time";

export interface JournalQuery {
    selectionMode: SelectionMode;
    target: string;
    timeField: TimeField;
    selectedRange: TimeRange;
    customRange: { start: Date; end: Date } | null;
}

export interface JournalSourceRecord {
    content: string;
    dateLabel: string;
    dateTime: number | null;
    file: TFile;
    isStrictlyEmpty: boolean;
    path: string;
}

export interface JournalProjectionItem {
    content: string;
    dateLabel: string;
    dateTime: number | null;
    file: TFile | null;
    isVirtualToday: boolean;
    key: string;
    path: string;
}
