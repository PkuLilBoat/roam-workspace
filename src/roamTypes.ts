import type { TFile } from "obsidian";

export const ROAM_NAVIGATION_VIEW_TYPE = "roam-navigation-view";
export const ROAM_PAGE_STREAM_VIEW_TYPE = "roam-page-stream-view";
export const ROAM_LIST_HEADING_VIEW_TYPE = "roam-list-heading-view";

export const NAVIGATION_VIEW_IDS = [
    "journal-stream",
    "page-stream",
    "list-heading",
] as const;

export type NavigationViewId = (typeof NAVIGATION_VIEW_IDS)[number];

export type PageTargetKind = "file" | "heading" | "block" | "line";
export type PageTargetSource = "link" | "navigation" | "list-heading" | "command";

export interface PageTarget {
    path: string;
    subpath?: string;
    kind: PageTargetKind;
    line?: number;
    col?: number;
    source: PageTargetSource;
    label?: string;
}

export interface ResolvedPageTarget extends PageTarget {
    file: TFile;
}

export interface PageStreamState {
    targets: PageTarget[];
    activePath: string | null;
    editingPath: string | null;
    collapsedPaths: string[];
    scrollTop: number;
    maxCards: number;
}

export interface PageStreamStackResult {
    targets: PageTarget[];
    activePath: string | null;
}
