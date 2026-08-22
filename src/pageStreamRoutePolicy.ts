import type { PaneType } from "obsidian";

export const PAGE_STREAM_NATIVE_ROUTE_TTL_MS = 650;

export type NativeRouteState = {
    triggeredAt: number;
    sourcePath: string;
    fallbackLinktext?: string;
};

export function shouldRouteSplitToPageStream(
    state: NativeRouteState | null,
    now: number,
    newLeaf: PaneType | boolean | undefined
): boolean {
    return (
        !!state &&
        newLeaf === "split" &&
        now - state.triggeredAt >= 0 &&
        now - state.triggeredAt <= PAGE_STREAM_NATIVE_ROUTE_TTL_MS
    );
}

