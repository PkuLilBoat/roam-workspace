import { App, TFile, moment } from "obsidian";
import {
    getJournalDateInfoFromParts,
    JournalDateSource,
} from "./journalCore";

export interface JournalDateInfo {
    date: moment.Moment | null;
    source: JournalDateSource;
    label: string;
}

export function getJournalDateInfo(app: App | undefined, file: TFile): JournalDateInfo {
    const frontmatter = app?.metadataCache.getFileCache(file)?.frontmatter;
    const info = getJournalDateInfoFromParts({
        basename: file.basename,
        name: file.name,
        stat: file.stat,
        frontmatter,
    });

    return {
        date: info.time === null ? null : moment(info.time),
        source: info.source,
        label: info.label,
    };
}
