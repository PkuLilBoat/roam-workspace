import { NAVIGATION_VIEW_IDS, type NavigationViewId } from "../roamTypes";
import { parseNavigationConfiguration, type NavigationConfiguration } from "./configuration";

export type NavigationReference = { kind: "builtin" | "journal" | "link"; id: string };
export type NavigationDraft = { type: "journal" | "note" | "web" | "builtin"; name: string; target: string; icon: string; visible: boolean };
export type NavigationState = { configuration: NavigationConfiguration; views: NavigationViewId[] };

export const BUILTIN_APPEARANCE: Record<NavigationViewId, { name: string; icon: string }> = {
    "journal-stream": { name: "Journal stream", icon: "calendar-range" },
    "page-stream": { name: "Page stream", icon: "panel-right-open" },
    "list-heading": { name: "List heading", icon: "list-tree" },
};

function viewId(id: string): NavigationViewId {
    const found = NAVIGATION_VIEW_IDS.find(value => value === id);
    if (!found) throw new Error("Unknown built-in view.");
    return found;
}

export function builtinAppearance(config: NavigationConfiguration, id: NavigationViewId): { name: string; icon: string } {
    if (id === "journal-stream") return { name: config.journalName, icon: config.journalIcon ?? "calendar-range" };
    return { ...BUILTIN_APPEARANCE[id], ...config.viewOverrides?.[id] };
}

export function readNavigationDraft(state: NavigationState, ref: NavigationReference): NavigationDraft {
    if (ref.kind === "builtin") {
        const id = viewId(ref.id);
        return { type: "builtin", ...builtinAppearance(state.configuration, id), target: "", visible: state.views.includes(id) };
    }
    const item = ref.kind === "journal" ? state.configuration.journals.find(item => item.id === ref.id) : state.configuration.links.find(item => item.id === ref.id);
    if (!item) throw new Error("This shortcut was removed. Open the editor again.");
    if ("folder" in item) return { type: "journal", name: item.name, target: item.folder, icon: item.icon ?? "calendar-range", visible: !item.hidden };
    return { type: item.type, name: item.name, target: item.target, icon: item.icon ?? (item.type === "web" ? "external-link" : "file-text"), visible: !item.hidden };
}

/** Work on a copy so validation failure never partially changes live settings. */
export function editNavigation(state: NavigationState, ref: NavigationReference | null, draft: NavigationDraft, newId: string): NavigationState {
    const next = { configuration: structuredClone(state.configuration), views: [...state.views] };
    if (ref?.kind === "builtin") {
        const id = viewId(ref.id);
        if (id === "journal-stream") {
            next.configuration.journalName = draft.name;
            if (draft.icon) next.configuration.journalIcon = draft.icon;
            else delete next.configuration.journalIcon;
        } else {
            next.configuration.viewOverrides ??= {};
            next.configuration.viewOverrides[id] = { name: draft.name, ...(draft.icon ? { icon: draft.icon } : {}) };
        }
        if (draft.visible && !next.views.includes(id)) next.views.push(id);
        if (!draft.visible) next.views = next.views.filter(value => value !== id);
    } else {
        if (ref) readNavigationDraft(state, ref);
        const id = ref?.id ?? newId;
        const appearance = { id, name: draft.name, ...(draft.icon ? { icon: draft.icon } : {}), hidden: !draft.visible };
        if (draft.type === "journal") {
            if (ref && ref.kind !== "journal") throw new Error("Shortcut type cannot change while editing.");
            const entry = { ...appearance, folder: draft.target };
            if (ref) next.configuration.journals = next.configuration.journals.map(item => item.id === id ? entry : item);
            else next.configuration.journals.push(entry);
        } else if (draft.type === "note" || draft.type === "web") {
            if (ref && ref.kind !== "link") throw new Error("Shortcut type cannot change while editing.");
            const entry = { ...appearance, type: draft.type, target: draft.target };
            if (ref) next.configuration.links = next.configuration.links.map(item => item.id === id ? entry : item);
            else next.configuration.links.push(entry);
        } else throw new Error("Choose a shortcut type.");
    }
    next.configuration = parseNavigationConfiguration(next.configuration);
    return next;
}

export function removeNavigation(state: NavigationState, ref: NavigationReference): NavigationState {
    const next = { configuration: structuredClone(state.configuration), views: [...state.views] };
    if (ref.kind === "builtin") next.views = next.views.filter(id => id !== viewId(ref.id));
    else if (ref.kind === "journal") next.configuration.journals = next.configuration.journals.filter(item => item.id !== ref.id);
    else next.configuration.links = next.configuration.links.filter(item => item.id !== ref.id);
    return next;
}

export function moveNavigation(state: NavigationState, ref: NavigationReference, direction: -1 | 1): NavigationState {
    const next = { configuration: structuredClone(state.configuration), views: [...state.views] };
    const move = <T>(items: T[], index: number) => {
        const destination = index + direction;
        if (index >= 0 && destination >= 0 && destination < items.length) [items[index], items[destination]] = [items[destination], items[index]];
    };
    if (ref.kind === "builtin") move(next.views, next.views.indexOf(viewId(ref.id)));
    else if (ref.kind === "journal") move(next.configuration.journals, next.configuration.journals.findIndex(item => item.id === ref.id));
    else move(next.configuration.links, next.configuration.links.findIndex(item => item.id === ref.id));
    return next;
}
