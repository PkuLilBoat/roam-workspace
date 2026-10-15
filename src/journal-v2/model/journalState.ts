import type {
    JournalProjectionItem,
    JournalQuery,
    JournalSourceRecord,
} from "../contracts";
import { parseTimeField } from "../../utils/journalCore";

export interface VirtualTodayProjection {
    dateLabel: string;
    dateTime: number;
    path: string;
    position: "first" | "last";
}

export interface JournalState {
    items: JournalProjectionItem[];
    query: JournalQuery;
    records: JournalSourceRecord[];
}

export type JournalAction =
    | {
          type: "replace-source";
          records: JournalSourceRecord[];
          virtualToday: VirtualTodayProjection | null;
      }
    | {
          type: "remove-source";
          path: string;
          virtualToday: VirtualTodayProjection | null;
      }
    | {
          type: "rename-source";
          oldPath: string;
          record: JournalSourceRecord | null;
          virtualToday: VirtualTodayProjection | null;
      }
    | {
          type: "upsert-source";
          record: JournalSourceRecord;
          virtualToday: VirtualTodayProjection | null;
      }
    | { type: "set-query"; query: JournalQuery };

export function createJournalState(query: JournalQuery): JournalState {
    return { items: [], query, records: [] };
}

export function reduceJournalState(
    state: JournalState,
    action: JournalAction
): JournalState {
    if (action.type === "set-query") {
        return { ...state, query: action.query };
    }

    let nextRecords: JournalSourceRecord[];
    if (action.type === "replace-source") {
        nextRecords = action.records;
    } else if (action.type === "remove-source") {
        nextRecords = state.records.filter((record) => record.path !== action.path);
    } else if (action.type === "rename-source") {
        nextRecords = state.records.filter((record) =>
            record.path !== action.oldPath && record.path !== action.record?.path
        );
        if (action.record) nextRecords.push(action.record);
    } else {
        nextRecords = state.records.filter(
            (record) => record.path !== action.record.path
        );
        nextRecords.push(action.record);
    }
    nextRecords = sortJournalRecords(nextRecords, state.query);
    const nextItems = projectJournalItems(nextRecords, action.virtualToday);
    const previousByKey = new Map(state.items.map((item) => [item.key, item]));

    return {
        ...state,
        items: nextItems.map((item) => {
            const previous = previousByKey.get(item.key);
            return previous && journalItemsEqual(previous, item)
                ? previous
                : item;
        }),
        records: nextRecords,
    };
}

export function projectJournalItems(
    records: JournalSourceRecord[],
    virtualToday: VirtualTodayProjection | null
): JournalProjectionItem[] {
    const items = records
        .filter((record) => !record.isStrictlyEmpty)
        .map(toProjectionItem);

    if (
        !virtualToday ||
        items.some((item) => item.path === virtualToday.path)
    ) {
        return items;
    }

    const virtualItem: JournalProjectionItem = {
        content: "",
        dateLabel: virtualToday.dateLabel,
        dateTime: virtualToday.dateTime,
        file: null,
        isVirtualToday: true,
        key: virtualToday.path,
        path: virtualToday.path,
    };
    return virtualToday.position === "last"
        ? [...items, virtualItem]
        : [virtualItem, ...items];
}

function toProjectionItem(record: JournalSourceRecord): JournalProjectionItem {
    return {
        content: record.content,
        dateLabel: record.dateLabel,
        dateTime: record.dateTime,
        file: record.file,
        isVirtualToday: false,
        key: record.path,
        path: record.path,
    };
}

function journalItemsEqual(
    left: JournalProjectionItem,
    right: JournalProjectionItem
): boolean {
    return (
        left.content === right.content &&
        left.dateLabel === right.dateLabel &&
        left.dateTime === right.dateTime &&
        left.file === right.file &&
        left.isVirtualToday === right.isVirtualToday &&
        left.path === right.path
    );
}

function sortJournalRecords(
    records: JournalSourceRecord[],
    query: JournalQuery
): JournalSourceRecord[] {
    const { baseTimeField, isReverse } = parseTimeField(query.timeField);
    return [...records].sort((left, right) => {
        if (baseTimeField === "name") {
            const compared = left.file.name.localeCompare(right.file.name);
            return isReverse ? -compared : compared;
        }

        const leftTime = getRecordTime(left, baseTimeField);
        const rightTime = getRecordTime(right, baseTimeField);
        return isReverse ? leftTime - rightTime : rightTime - leftTime;
    });
}

function getRecordTime(record: JournalSourceRecord, field: string): number {
    if (field === "journalDate") {
        return record.dateTime ?? record.file.stat.mtime;
    }
    return field === "ctime" ? record.file.stat.ctime : record.file.stat.mtime;
}
