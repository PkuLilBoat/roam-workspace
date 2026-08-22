import type { PageStreamStackResult, PageTarget } from "./roamTypes";

export const DEFAULT_PAGE_STREAM_MAX_CARDS = 20;

export function pageTargetKey(target: Pick<PageTarget, "path">): string {
    return target.path;
}

export function pushPageStreamTarget(
    currentTargets: PageTarget[],
    nextTarget: PageTarget,
    maxCards = DEFAULT_PAGE_STREAM_MAX_CARDS
): PageStreamStackResult {
    const nextKey = pageTargetKey(nextTarget);
    const withoutDuplicate = currentTargets.filter(
        (target) => pageTargetKey(target) !== nextKey
    );
    const targets = [nextTarget, ...withoutDuplicate].slice(
        0,
        Math.max(1, maxCards)
    );

    return {
        targets,
        activePath: nextTarget.path,
    };
}

export function restorePageStreamTargets(
    targets: PageTarget[],
    existingPaths: Set<string>,
    maxCards = DEFAULT_PAGE_STREAM_MAX_CARDS
): PageTarget[] {
    const seen = new Set<string>();
    const restored: PageTarget[] = [];

    for (const target of targets) {
        if (!existingPaths.has(target.path)) continue;
        if (seen.has(target.path)) continue;
        seen.add(target.path);
        restored.push(target);
        if (restored.length >= Math.max(1, maxCards)) break;
    }

    return restored;
}
