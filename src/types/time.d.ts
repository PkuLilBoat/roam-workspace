export type TimeRange =
    | "today"
    | "recent-7"
    | "recent-30"
    | "week"
    | "month"
    | "year"
    | "all"
    | "last-week"
    | "last-month"
    | "last-year"
    | "quarter"
    | "last-quarter"
    | "custom";

export type SelectionMode = "daily" | "folder" | "tag";

export type TimeField =
    | "ctime"
    | "mtime"
    | "journalDate"
    | "ctimeReverse"
    | "mtimeReverse"
    | "journalDateReverse"
    | "name"
    | "nameReverse";
