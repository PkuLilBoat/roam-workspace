import type { Component } from "obsidian";

type CollapseListener = (collapsed: boolean) => void;

export type NativeMetadataEditor = Component & {
    collapsed: boolean;
    containerEl: HTMLElement;
    setCollapse(collapsed: boolean, save?: boolean): void;
    synchronize(frontmatter: Record<string, unknown> | null): void;
};

export class StreamPropertiesState {
    private readonly collapsedByPath = new Map<string, boolean>();
    private readonly listenersByPath = new Map<string, Set<CollapseListener>>();

    isCollapsed(path: string): boolean {
        return this.collapsedByPath.get(path) ?? true;
    }

    setCollapsed(path: string, collapsed: boolean): void {
        if (this.isCollapsed(path) === collapsed && this.collapsedByPath.has(path)) {
            return;
        }
        this.collapsedByPath.set(path, collapsed);
        for (const listener of this.listenersByPath.get(path) ?? []) {
            listener(collapsed);
        }
    }

    subscribe(path: string, listener: CollapseListener): () => void {
        let listeners = this.listenersByPath.get(path);
        if (!listeners) {
            listeners = new Set();
            this.listenersByPath.set(path, listeners);
        }
        listeners.add(listener);
        listener(this.isCollapsed(path));
        return () => {
            listeners?.delete(listener);
            if (listeners?.size === 0) this.listenersByPath.delete(path);
        };
    }
}

export function bindStreamProperties(
    root: HTMLElement,
    path: string,
    state: StreamPropertiesState,
    getNativeEditor?: () => NativeMetadataEditor | null
): () => void {
    root.addClass("roam-stream-properties-root", "show-properties");

    const validContainers = () =>
        Array.from(
            root.querySelectorAll<HTMLElement>(
                ".metadata-container:not(.mod-error)"
            )
        );

    const applyCollapsedState = (collapsed: boolean) => {
        const nativeEditor = getNativeEditor?.();
        if (nativeEditor && nativeEditor.collapsed !== collapsed) {
            nativeEditor.setCollapse(collapsed, false);
        }
        if (!root.hasClass("show-properties")) root.addClass("show-properties");
        for (const view of Array.from(root.querySelectorAll<HTMLElement>(
            ".markdown-source-view, .markdown-preview-view"
        ))) {
            if (!view.hasClass("show-properties")) view.addClass("show-properties");
        }
        for (const container of validContainers()) {
            if (container.hasClass("is-collapsed") !== collapsed) {
                container.toggleClass("is-collapsed", collapsed);
            }
            const value = String(collapsed);
            if (container.getAttr("data-roam-properties-collapsed") !== value) {
                container.setAttr("data-roam-properties-collapsed", value);
            }
        }
    };

    const unsubscribe = state.subscribe(path, applyCollapsedState);
    const Observer = root.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(() => {
        applyCollapsedState(state.isCollapsed(path));
    }) : null;
    observer?.observe(root, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
        const target = event.target;
        const ElementConstructor = root.ownerDocument.defaultView?.Element;
        if (!ElementConstructor || !(target instanceof ElementConstructor)) return;
        const container = target.closest<HTMLElement>(
            ".metadata-container:not(.mod-error)"
        );
        if (!container || !root.contains(container)) return;
        window.setTimeout(() => {
            if (!container.isConnected) return;
            state.setCollapsed(path, container.hasClass("is-collapsed"));
        }, 0);
    };
    root.addEventListener("click", handleClick);

    applyCollapsedState(state.isCollapsed(path));
    return () => {
        observer?.disconnect();
        unsubscribe();
        root.removeEventListener("click", handleClick);
    };
}

export function isStreamPropertiesInteraction(target: EventTarget | null): boolean {
    return hasClosest(target) && target.closest(".metadata-container") !== null;
}

function hasClosest(
    target: EventTarget | null
): target is EventTarget & { closest(selector: string): Element | null } {
    return (
        target !== null &&
        typeof (target as { closest?: unknown }).closest === "function"
    );
}
