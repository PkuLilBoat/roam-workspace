export interface CustomRangeLike {
    start: Date | string | number;
    end: Date | string | number;
}

export function parseDateInputStart(value: string): Date {
    const { year, month, day } = parseDateInput(value);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function tryParseDateInputStart(value: string): Date | null {
    try {
        return parseDateInputStart(value);
    } catch {
        return null;
    }
}

export function parseDateInputEnd(value: string): Date {
    const { year, month, day } = parseDateInput(value);
    return new Date(year, month - 1, day, 23, 59, 59, 999);
}

export function tryParseDateInputEnd(value: string): Date | null {
    try {
        return parseDateInputEnd(value);
    } catch {
        return null;
    }
}

export function startOfLocalDay(date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0,
        0
    );
}

export function endOfLocalDay(date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        23,
        59,
        59,
        999
    );
}

export function normalizeCustomRange(
    range: CustomRangeLike | null | undefined
): { start: Date; end: Date } | null {
    if (!range) return null;

    const start = normalizeDateLike(range.start);
    const end = normalizeDateLike(range.end);

    if (!start || !end) return null;

    return { start, end };
}

function normalizeDateLike(value: Date | string | number): Date | null {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.valueOf();
    return Number.isFinite(time) ? date : null;
}

function parseDateInput(value: string): {
    year: number;
    month: number;
    day: number;
} {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(`Invalid date input: ${value}`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);

    if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
    ) {
        throw new Error(`Invalid date input: ${value}`);
    }

    return { year, month, day };
}
