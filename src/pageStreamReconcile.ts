import type { PageTarget } from "./roamTypes";

export type PageStreamReconcileOperation =
    | { type: "insert"; index: number; target: PageTarget }
    | { type: "move"; index: number; path: string }
    | { type: "update"; index: number; target: PageTarget }
    | { type: "remove"; path: string };

export function planPageStreamReconcile(
    previousTargets: PageTarget[],
    nextTargets: PageTarget[]
): PageStreamReconcileOperation[] {
    const operations: PageStreamReconcileOperation[] = [];
    const desiredPaths = new Set(nextTargets.map((target) => target.path));
    const working = [...previousTargets];

    for (let index = working.length - 1; index >= 0; index -= 1) {
        const target = working[index];
        if (desiredPaths.has(target.path)) continue;
        operations.push({ type: "remove", path: target.path });
        working.splice(index, 1);
    }

    for (const [index, target] of nextTargets.entries()) {
        const currentIndex = working.findIndex(
            (candidate) => candidate.path === target.path
        );
        if (currentIndex === -1) {
            operations.push({ type: "insert", index, target });
            working.splice(index, 0, target);
            continue;
        }

        if (currentIndex !== index) {
            operations.push({ type: "move", index, path: target.path });
            const [moved] = working.splice(currentIndex, 1);
            working.splice(index, 0, moved);
        }
        if (!pageTargetsEqual(working[index], target)) {
            operations.push({ type: "update", index, target });
            working[index] = target;
        }
    }

    return operations;
}

export function pageTargetsEqual(left: PageTarget, right: PageTarget): boolean {
    return (
        left.path === right.path &&
        left.kind === right.kind &&
        left.source === right.source &&
        left.subpath === right.subpath &&
        left.line === right.line &&
        left.col === right.col &&
        left.label === right.label
    );
}
