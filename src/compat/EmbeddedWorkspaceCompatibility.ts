import {
    Constructor,
    MarkdownView,
    Plugin,
    View,
    Workspace,
    WorkspaceItem,
    WorkspaceLeaf,
} from "obsidian";
import { around } from "monkey-around";
import { isDailyNoteLeaf } from "../leafView";

type ActiveLeafOptions = { focus?: boolean } | boolean;

interface EmbeddedActiveLeaf {
    child: WorkspaceLeaf;
    parent: WorkspaceLeaf;
}

/** Owns the remaining global patches needed by synthetic embedded leaves. */
export function installEmbeddedWorkspaceCompatibility(plugin: Plugin): void {
    let activeEmbedded: EmbeddedActiveLeaf | null = null;
    const forgetEmbedded = () => {
        const embeddedView: unknown = activeEmbedded?.child.view;
        if (activeEmbedded && plugin.app.workspace.activeEditor === embeddedView) {
            plugin.app.workspace.activeEditor = null;
        }
        activeEmbedded = null;
    };
    plugin.register(forgetEmbedded);

    const workspaceUninstall = around(Workspace.prototype, {
        getActiveViewOfType(next: Workspace["getActiveViewOfType"]) {
            return function <T extends View>(
                this: Workspace,
                type: Constructor<T>
            ): T | null {
                const nativeView: unknown = next.call(this, type);
                if (nativeView instanceof type) return nativeView;

                const embedded = activeEmbedded;
                if (
                    !embedded ||
                    !embedded.child.containerEl.isConnected ||
                    next.call(this, View) !== embedded.parent.view
                ) {
                    return null;
                }
                const childView = embedded.child.view;
                return childView instanceof type ? childView : null;
            };
        },
        setActiveLeaf(next: Workspace["setActiveLeaf"]) {
            return function (
                this: Workspace,
                leaf: WorkspaceLeaf,
                options?: ActiveLeafOptions,
                focus?: boolean
            ): void {
                const parent = leaf.parentLeaf;
                if (parent instanceof WorkspaceLeaf && isDailyNoteLeaf(leaf)) {
                    if (typeof options === "boolean") {
                        next.call(this, parent, options, focus);
                    } else {
                        next.call(this, parent, options);
                    }
                    if (leaf.view instanceof MarkdownView) {
                        activeEmbedded = { child: leaf, parent };
                        this.activeEditor = leaf.view;
                    } else {
                        forgetEmbedded();
                    }
                    return;
                }

                forgetEmbedded();
                if (typeof options === "boolean") {
                    next.call(this, leaf, options, focus);
                } else {
                    next.call(this, leaf, options);
                }
            };
        },
    });
    plugin.register(workspaceUninstall);

    const leafUninstall = around(WorkspaceLeaf.prototype, {
        detach(next: WorkspaceLeaf["detach"]) {
            return function (this: WorkspaceLeaf): void {
                if (activeEmbedded?.child === this) forgetEmbedded();
                next.call(this);
            };
        },
        getRoot(next: WorkspaceLeaf["getRoot"]) {
            return function (this: WorkspaceLeaf): WorkspaceItem {
                const root: unknown = next.call(this);
                if (!(root instanceof WorkspaceItem)) return plugin.app.workspace.rootSplit;
                return root.getRoot === this.getRoot ? root : root.getRoot();
            };
        },
        setPinned(next: WorkspaceLeaf["setPinned"]) {
            return function (this: WorkspaceLeaf, pinned: boolean): void {
                next.call(this, pinned);
                if (isDailyNoteLeaf(this) && !pinned) this.setPinned(true);
            };
        },
    });
    plugin.register(leafUninstall);
}
