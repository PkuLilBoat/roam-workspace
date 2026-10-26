import {
    Constructor,
    FileView,
    MarkdownView,
    Plugin,
    View,
    Workspace,
    WorkspaceItem,
    WorkspaceLeaf,
    WorkspaceParent,
} from "obsidian";
import { around } from "monkey-around";
import { isDailyNoteLeaf } from "../leafView";

type ActiveLeafOptions = { focus?: boolean } | boolean;

// The host status bar uses this private lookup rather than getActiveViewOfType.
// Probe it locally; unsupported hosts keep their native lookup unchanged.
interface FileViewWorkspace extends Workspace {
    getActiveFileView?: () => FileView | null;
}

interface EmbeddedActiveLeaf {
    child: WorkspaceLeaf;
    parent: WorkspaceLeaf;
}

/** Owns the remaining global patches needed by synthetic embedded leaves. */
export function installEmbeddedWorkspaceCompatibility(plugin: Plugin): void {
    let activeEmbedded: EmbeddedActiveLeaf | null = null;
    const mountingParents = new Set<WorkspaceParent>();
    const forgetEmbedded = () => {
        const embeddedView: unknown = activeEmbedded?.child.view;
        if (activeEmbedded && plugin.app.workspace.activeEditor === embeddedView) {
            plugin.app.workspace.activeEditor = null;
        }
        activeEmbedded = null;
    };
    plugin.register(forgetEmbedded);

    const workspaceUninstall = around(Workspace.prototype, {
        createLeafInParent(next: Workspace["createLeafInParent"]) {
            return function (this: Workspace, parent: WorkspaceParent, index: number): WorkspaceLeaf {
                const createLeaf = (): WorkspaceLeaf => {
                    const leaf: unknown = next.call(this, parent, index);
                    if (!(leaf instanceof WorkspaceLeaf)) throw new Error("Native leaf creation failed");
                    return leaf;
                };
                if (!parent.containerEl.closest(".dn-editor.dn-leaf-view")) {
                    return createLeaf();
                }
                // Native creation activates an empty leaf before its embedded
                // owner is assigned. Background mounts must stay passive.
                mountingParents.add(parent);
                try {
                    return createLeaf();
                } finally {
                    mountingParents.delete(parent);
                }
            };
        },
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
                const mountingParent: unknown = leaf.parent;
                if (Array.from(mountingParents).some(parent => parent === mountingParent)) return;
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

                // Native focus bubbles from the synthetic leaf to its parent.
                // That second activation still belongs to the same editor.
                const embedded = activeEmbedded;
                const keepEmbedded = embedded?.parent === leaf &&
                    embedded.child.containerEl.isConnected &&
                    embedded.child.containerEl.contains(
                        embedded.child.containerEl.ownerDocument.activeElement
                    );
                if (!keepEmbedded) forgetEmbedded();
                if (typeof options === "boolean") {
                    next.call(this, leaf, options, focus);
                } else {
                    next.call(this, leaf, options);
                }
                if (keepEmbedded && embedded.child.view instanceof MarkdownView) {
                    this.activeEditor = embedded.child.view;
                }
            };
        },
    });
    plugin.register(workspaceUninstall);

    const workspace: FileViewWorkspace = plugin.app.workspace;
    if (typeof workspace.getActiveFileView === "function") {
        plugin.register(around(workspace, {
            getActiveFileView(next: () => FileView | null) {
                return function (this: Workspace): FileView | null {
                    const embedded = activeEmbedded;
                    if (
                        embedded?.child.containerEl.isConnected &&
                        this.getActiveViewOfType(View) === embedded.parent.view &&
                        embedded.child.view instanceof MarkdownView
                    ) {
                        return embedded.child.view;
                    }
                    const nativeView: unknown = next.call(this);
                    return nativeView instanceof FileView ? nativeView : null;
                };
            },
        }));
    }

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
