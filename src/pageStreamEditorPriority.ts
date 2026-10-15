export type PageStreamEditorPriority =
    | "editing"
    | "visible-expanded"
    | "near-viewport"
    | "collapsed-offscreen";

export type PageStreamEditorActivity = {
    collapsed: boolean;
    editing: boolean;
    nearViewport: boolean;
    visible: boolean;
};

const PRIORITY_RANK: Record<PageStreamEditorPriority, number> = {
    editing: 0,
    "visible-expanded": 1,
    "near-viewport": 2,
    "collapsed-offscreen": 3,
};

export function resolvePageStreamEditorPriority(
    activity: PageStreamEditorActivity
): PageStreamEditorPriority {
    if (activity.editing) return "editing";
    if (!activity.collapsed && activity.visible) return "visible-expanded";
    if (!activity.collapsed && activity.nearViewport) return "near-viewport";
    return "collapsed-offscreen";
}

export function shouldPinPageStreamEditor(
    priority: PageStreamEditorPriority
): boolean {
    return priority === "editing" || priority === "visible-expanded";
}

export function comparePageStreamEditorPriority(
    left: PageStreamEditorPriority,
    right: PageStreamEditorPriority
): number {
    return PRIORITY_RANK[left] - PRIORITY_RANK[right];
}
