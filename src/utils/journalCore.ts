import { TimeRange, TimeField } from "../types/time";
import { CustomRangeLike, normalizeCustomRange } from "./dateInput";

export type JournalDateSource =
    | "frontmatter-date"
    | "frontmatter-created"
    | "filename"
    | "unparsed";

export interface JournalDateInfo {
    time: number | null;
    source: JournalDateSource;
    label: string;
}

export interface JournalLikeFile {
    basename: string;
    name: string;
    stat: {
        ctime: number;
        mtime: number;
    };
    frontmatter?: {
        date?: unknown;
        created?: unknown;
    };
}

export function getJournalDateInfoFromParts(file: JournalLikeFile): JournalDateInfo {
    const frontmatterDate = parseFrontmatterDate(file.frontmatter?.date);
    if (frontmatterDate !== null) {
        return {
            time: frontmatterDate,
            source: "frontmatter-date",
            label: formatDate(frontmatterDate),
        };
    }

    const frontmatterCreated = parseFrontmatterDate(file.frontmatter?.created);
    if (frontmatterCreated !== null) {
        return {
            time: frontmatterCreated,
            source: "frontmatter-created",
            label: formatDate(frontmatterCreated),
        };
    }

    const filenameDate = parseJournalFilename(file.basename);
    if (filenameDate !== null) {
        return {
            time: filenameDate,
            source: "filename",
            label: formatDate(filenameDate),
        };
    }

    return {
        time: null,
        source: "unparsed",
        label: "date not parsed; sorted by modified time",
    };
}

export function parseTimeField(timeField: TimeField | undefined): {
    isReverse: boolean;
    baseTimeField: string;
} {
    const field = timeField || "mtime";
    const isReverse = field.endsWith("Reverse");
    const baseTimeField = isReverse ? field.replace("Reverse", "") : field;
    return { isReverse, baseTimeField };
}

export function sortJournalFiles<T extends JournalLikeFile>(
    files: T[],
    timeField?: TimeField
): T[] {
    const { isReverse, baseTimeField } = parseTimeField(timeField);

    if (baseTimeField === "journalDate") {
        return files
            .map((file) => ({
                file,
                sortTime: getJournalDateInfoFromParts(file).time ?? file.stat.mtime,
            }))
            .sort((a, b) =>
                isReverse ? a.sortTime - b.sortTime : b.sortTime - a.sortTime
            )
            .map(({ file }) => file);
    }

    return [...files].sort((a, b) => {
        if (baseTimeField === "name") {
            const result = a.name.localeCompare(b.name);
            return isReverse ? -result : result;
        }

        const statField = baseTimeField === "ctime" ? "ctime" : "mtime";
        return isReverse
            ? a.stat[statField] - b.stat[statField]
            : b.stat[statField] - a.stat[statField];
    });
}

export function filterJournalFilesByRange<T extends JournalLikeFile>(
    files: T[],
    timeField: TimeField | undefined,
    timeRange: TimeRange | undefined,
    now: number,
    customRange?: CustomRangeLike | null
): T[] {
    if (!timeRange || timeRange === "all") return [...files];

    const { baseTimeField } = parseTimeField(timeField);
    const filtered = files.filter((file) => {
        const fileTime =
            baseTimeField === "journalDate"
                ? getJournalDateInfoFromParts(file).time ?? file.stat.mtime
                : file.stat[baseTimeField === "ctime" ? "ctime" : "mtime"];

        return isTimeInRange(fileTime, now, timeRange, customRange);
    });

    return filtered;
}

export function isTimeInRange(
    fileTime: number,
    now: number,
    timeRange: TimeRange,
    customRange?: CustomRangeLike | null
): boolean {
    const fileDate = new Date(fileTime);
    const nowDate = new Date(now);

    switch (timeRange) {
        case "today":
            return isSameDay(fileDate, nowDate);
        case "recent-7": {
            const start = addDays(nowDate, -7);
            start.setHours(0, 0, 0, 0);
            return isBetweenInclusive(fileDate, start, nowDate);
        }
        case "recent-30": {
            const start = addDays(nowDate, -30);
            start.setHours(0, 0, 0, 0);
            return isBetweenInclusive(fileDate, start, nowDate);
        }
        case "week":
            return isSameWeek(fileDate, nowDate);
        case "month":
            return isSameMonth(fileDate, nowDate);
        case "year":
            return fileDate.getFullYear() === nowDate.getFullYear();
        case "last-week": {
            const [start, end] = weekBounds(addDays(nowDate, -7));
            return isBetweenInclusive(fileDate, start, end);
        }
        case "last-month": {
            const year = nowDate.getFullYear();
            const month = nowDate.getMonth() - 1;
            const start = new Date(year, month, 1);
            const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
            return isBetweenInclusive(fileDate, start, end);
        }
        case "last-year":
            return fileDate.getFullYear() === nowDate.getFullYear() - 1;
        case "quarter":
            return isSameQuarter(fileDate, nowDate);
        case "last-quarter": {
            const currentQuarterStartMonth =
                Math.floor(nowDate.getMonth() / 3) * 3;
            const start = new Date(nowDate.getFullYear(), currentQuarterStartMonth - 3, 1);
            const end = new Date(nowDate.getFullYear(), currentQuarterStartMonth, 0, 23, 59, 59, 999);
            return isBetweenInclusive(fileDate, start, end);
        }
        case "custom": {
            const normalizedRange = normalizeCustomRange(customRange);
            if (!normalizedRange) return false;
            return isBetweenInclusive(
                fileDate,
                normalizedRange.start,
                normalizedRange.end
            );
        }
        default:
            return true;
    }
}

function parseFrontmatterDate(value: unknown): number | null {
    if (!value) return null;

    const parsed = new Date(value as string | number | Date);
    const time = parsed.valueOf();
    return Number.isFinite(time) ? startOfDay(time) : null;
}

function parseJournalFilename(basename: string): number | null {
    if (/^\d{6}$/.test(basename)) {
        const year = Number(`20${basename.slice(0, 2)}`);
        const month = Number(basename.slice(2, 4));
        const day = Number(basename.slice(4, 6));
        return validLocalDate(year, month, day);
    }

    const match = basename.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return validLocalDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    return null;
}

function validLocalDate(year: number, month: number, day: number): number | null {
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    return date.valueOf();
}

function formatDate(time: number): string {
    const date = new Date(time);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function startOfDay(time: number): number {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
}

function isSameMonth(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function isSameDay(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function isSameQuarter(a: Date, b: Date): boolean {
    return (
        a.getFullYear() === b.getFullYear() &&
        Math.floor(a.getMonth() / 3) === Math.floor(b.getMonth() / 3)
    );
}

function isSameWeek(a: Date, b: Date): boolean {
    const [start, end] = weekBounds(b);
    return isBetweenInclusive(a, start, end);
}

function weekBounds(date: Date): [Date, Date] {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return [start, end];
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function isBetweenInclusive(date: Date, start: Date, end: Date): boolean {
    return date.valueOf() >= start.valueOf() && date.valueOf() <= end.valueOf();
}
