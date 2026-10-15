// Original code from https://github.com/nothingislost/obsidian-hover-editor/blob/9ec3449be9ab3433dc46c4c3acfde1da72ff0261/src/popover.ts
// You can use this file as a basic leaf view create method in anywhere
// Please rememeber if you want to use this file, you should patch the obsidian.d.ts file
// And also monkey around the Obsidian original method.
import {
    Component,
    EphemeralState,
    HoverPopover,
    OpenViewState,
    parseLinktext,
    PopoverState,
    requireApiVersion,
    resolveSubpath,
    TFile,
    View,
    Workspace,
    WorkspaceContainer,
    WorkspaceItem,
    WorkspaceLeaf,
    WorkspaceSplit,
    WorkspaceTabs,
} from "obsidian";

import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { genId } from "./utils/utils";


export interface DailyNoteEditorParent {
    hoverPopover?: DailyNoteEditor | null;
    DailyNoteEditor?: DailyNoteEditor | null;
    containerEl?: HTMLElement;
    view?: View;
    dom?: HTMLElement;
}

const popovers = new WeakMap<Element, DailyNoteEditor>();
type ConstructableWorkspaceSplit = new (ws: Workspace, dir: "horizontal" | "vertical") => WorkspaceSplit;

export function isDailyNoteLeaf(leaf: WorkspaceLeaf) {
    // Work around missing enhance.js API by checking match condition instead of looking up parent
    return leaf.containerEl.matches(".dn-editor.dn-leaf-view .workspace-leaf");
}

function readProperty(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
}

function readChildren(value: unknown): unknown[] {
    const children = readProperty(value, "children");
    return Array.isArray(children) ? (children as unknown[]) : [];
}

function floatingContainers(workspace: Workspace): WorkspaceContainer[] {
    const floatingRoot: unknown = workspace.floatingSplit;
    return readChildren(floatingRoot).filter(
        (child): child is WorkspaceContainer => child instanceof WorkspaceContainer
    );
}

function hasReinit(value: unknown): value is { reinit(): void } {
    return typeof readProperty(value, "reinit") === "function";
}

function nosuper(base: typeof HoverPopover): new () => HoverPopover {
    // Keep Component initialization without running HoverPopover's native UI constructor.
    class ComponentHost extends Component {}
    Object.setPrototypeOf(ComponentHost.prototype, base.prototype);
    return ComponentHost as new () => HoverPopover;
}

export const spawnLeafView = (plugin: DailyNoteViewPlugin, initiatingEl?: HTMLElement, leaf?: WorkspaceLeaf, onShowCallback?: () => unknown, options?: {independentFromParent?: boolean}): [WorkspaceLeaf, DailyNoteEditor] => {
    const parent: DailyNoteEditorParent = leaf ?? plugin.app.workspace.getLeaf(false);
    const targetEl = initiatingEl ?? parent.containerEl;
    if (!targetEl) throw new Error("Embedded editor target is unavailable");

    // A Page stream card must not replace another card's popover on the shared view leaf.
    const editorParent = options?.independentFromParent ? {containerEl: targetEl} : parent;
    const hoverPopover = new DailyNoteEditor(editorParent, targetEl, plugin, undefined, onShowCallback);
    return [hoverPopover.attachLeaf(), hoverPopover];

};

export class DailyNoteEditor extends nosuper(HoverPopover) {
    declare parent: DailyNoteEditorParent | null;
    onTarget: boolean;
    setActive: (event: MouseEvent) => void;

    lockedOut: boolean;
    abortController? = this.addChild(new Component());
    detaching = false;
    opening = false;

    rootSplit: WorkspaceSplit;
    isPinned = true;

    titleEl: HTMLElement;
    containerEl: HTMLElement;

    // It is currently not useful.
    // leafInHoverEl: WorkspaceLeaf;

    oldPopover: DailyNoteEditor | null | undefined;
    document: Document;

    id = genId(8);
    bounce?: number;
    boundOnZoomOut: () => void;

    originalPath: string; // these are kept to avoid adopting targets w/a different link
    originalLinkText: string;
    static activePopover?: DailyNoteEditor;

    static activeWindows(workspace: Workspace) {
        const mainWindow =
            workspace.containerEl.ownerDocument.defaultView ?? window;
        const windows: Window[] = [mainWindow];
        for (const container of floatingContainers(workspace)) {
            windows.push(container.win);
        }
        return windows;
    }

    static containerForDocument(plugin: DailyNoteViewPlugin, doc: Document) {
        const mainDocument = plugin.app.workspace.containerEl.ownerDocument;
        if (doc !== mainDocument)
            for (const container of floatingContainers(plugin.app.workspace)) {
                if (container.doc === doc) return container;
            }
        return plugin.app.workspace.rootSplit;
    }

    static activePopovers(workspace: Workspace) {
        return this.activeWindows(workspace).flatMap((activeWindow) =>
            this.popoversForWindow(activeWindow)
        );
    }

    static popoversForWindow(win?: Window) {
        return (Array.prototype.slice.call(win?.document?.body.querySelectorAll(".dn-leaf-view") ?? []) as HTMLElement[])
            .map(el => popovers.get(el)!)
            .filter(he => he);
    }

    static forLeaf(leaf: WorkspaceLeaf | undefined) {
        const el = leaf?.containerEl.closest(".dn-leaf-view");
        return el ? popovers.get(el) : undefined;
    }

    static iteratePopoverLeaves(ws: Workspace, cb: (leaf: WorkspaceLeaf) => boolean | void) {
        for (const popover of this.activePopovers(ws)) {
            if (popover.rootSplit && ws.iterateLeaves(cb, popover.rootSplit)) return true;
        }
        return false;
    }

    hoverEl: HTMLElement;

    constructor(
        parent: DailyNoteEditorParent,
        public targetEl: HTMLElement,
        public plugin: DailyNoteViewPlugin,
        waitTime?: number,
        public onShowCallback?: () => unknown,
    ) {
        //
        super();

        if (waitTime === undefined) {
            waitTime = 300;
        }
        this.onTarget = true;

        this.parent = parent;
        this.oldPopover = parent.DailyNoteEditor;
        this.waitTime = waitTime;
        this.state = PopoverState.Showing;

        this.document = this.targetEl?.ownerDocument ?? window.activeDocument ?? window.document;
        this.rootSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(
            plugin.app.workspace,
            "vertical"
        );
        this.hoverEl = this.document.defaultView!.createDiv({
            cls: "dn-editor dn-leaf-view",
            attr: {id: "dn-" + this.id},
        });
        const {hoverEl} = this;

        this.abortController!.load();
        const ownerWindow = this.document.defaultView ?? window;
        this.timer = ownerWindow.setTimeout(() => this.show(), waitTime);
        this.setActive = (event) => this._setActive(event);
        if (hoverEl) {
            hoverEl.addEventListener("mousedown", this.setActive);
        }
        // custom logic begin
        popovers.set(this.hoverEl, this);
        this.hoverEl.addClass("dn-editor");
        this.containerEl = this.hoverEl.createDiv("dn-content");
        this.buildWindowControls();
        this.setInitialDimensions();

    }

    _setActive(evt: MouseEvent) {
        this.plugin.app.workspace.setActiveLeaf(this.leaves()[0], {focus: true});
    }

    getDefaultMode() {
        // return this.parent?.view?.getMode ? this.parent.view.getMode() : "source";
        return "source";
    }

    updateLeaves() {
        if (this.onTarget && this.targetEl && !this.document.contains(this.targetEl)) {
            this.onTarget = false;
            this.transition();
        }
        let leafCount = 0;
        this.plugin.app.workspace.iterateLeaves(leaf => {
            leafCount++;
        }, this.rootSplit);

        if (leafCount === 0) {
            this.hide(); // close if we have no leaves
        }
        this.hoverEl.setAttribute("data-leaf-count", leafCount.toString());
    }

    leaves() {
        const leaves: WorkspaceLeaf[] = [];
        this.plugin.app.workspace.iterateLeaves(leaf => {
            leaves.push(leaf);
        }, this.rootSplit);
        return leaves;
    }

    setInitialDimensions() {
        this.hoverEl.setCssProps({
            height: "auto",
            width: "100%",
        });
    }

    transition() {
        if (this.shouldShow()) {
            if (this.state === PopoverState.Hiding) {
                this.state = PopoverState.Shown;
                (this.document.defaultView ?? window).clearTimeout(this.timer);
            }
        } else {
            if (this.state === PopoverState.Showing) {
                this.hide();
            } else {
                if (this.state === PopoverState.Shown) {
                    this.state = PopoverState.Hiding;
                    this.timer = (this.document.defaultView ?? window).setTimeout(() => {
                        if (this.shouldShow()) {
                            this.transition();
                        } else {
                            this.hide();
                        }
                    }, this.waitTime);
                }
            }
        }
    }


    buildWindowControls() {
        this.titleEl = this.document.defaultView!.createDiv("popover-titlebar");
        this.titleEl.createDiv("popover-title");

        this.containerEl.prepend(this.titleEl);

    }

    attachLeaf(): WorkspaceLeaf {
        const mainDocument = this.plugin.app.workspace.containerEl.ownerDocument;
        this.rootSplit.getRoot = (): WorkspaceItem => {
            const workspace = this.plugin.app.workspace;
            if (this.document === mainDocument) return workspace.rootSplit;
            const floatingRoot: unknown = workspace.floatingSplit;
            return floatingRoot instanceof WorkspaceItem
                ? floatingRoot
                : workspace.rootSplit;
        };
        this.rootSplit.getContainer = () => DailyNoteEditor.containerForDocument(this.plugin, this.document);

        this.titleEl.insertAdjacentElement("afterend", this.rootSplit.containerEl);
        const leaf = this.plugin.app.workspace.createLeafInParent(this.rootSplit, 0);

        this.updateLeaves();
        return leaf;
    }

    onload(): void {
        super.onload();
        this.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.updateLeaves()));
        this.registerEvent(this.plugin.app.workspace.on("layout-change", () => {
            // Ensure that top-level items in a popover are not tabbed
            readChildren(this.rootSplit).forEach((item, index) => {
                if (item instanceof WorkspaceTabs) {
                    const firstChild = readChildren(item)[0];
                    if (firstChild instanceof WorkspaceItem) {
                        this.rootSplit.replaceChild(index, firstChild);
                    }
                }
            });
        }));
    }

    onShow() {
        // Once we've been open for closeDelay, use the closeDelay as a hiding timeout
        const closeDelay = 600;
        this.document.defaultView?.setTimeout(
            () => (this.waitTime = closeDelay),
            closeDelay
        );

        this.oldPopover?.hide();
        this.oldPopover = null;

        this.hoverEl.toggleClass("is-new", true);

        this.document.body.addEventListener(
            "click",
            () => {
                this.hoverEl.toggleClass("is-new", false);
            },
            {once: true, capture: true},
        );

        if (this.parent) {
            this.parent.DailyNoteEditor = this;
        }

        // Remove original view header;
        const viewHeaderEl = this.hoverEl.querySelector(".view-header");
        viewHeaderEl?.remove();

        const sizer = this.hoverEl.querySelector(".workspace-leaf");
        if (sizer) this.hoverEl.appendChild(sizer);

        // Remove original inline tilte;
        const inlineTitle = this.hoverEl.querySelector(".inline-title");
        if (inlineTitle) inlineTitle.remove();

        this.onShowCallback?.();
        this.onShowCallback = undefined; // only call it once
    }

    detect(el: HTMLElement) {
        // TODO: may not be needed? the mouseover/out handers handle most detection use cases
        const {targetEl} = this;

        if (targetEl) {
            this.onTarget = el === targetEl || targetEl.contains(el);
        }
    }

    shouldShow() {
        return this.shouldShowSelf() || this.shouldShowChild();
    }

    shouldShowChild(): boolean {
        return DailyNoteEditor.activePopovers(this.plugin.app.workspace).some(popover => {
            if (popover !== this && popover.targetEl && this.hoverEl.contains(popover.targetEl)) {
                return popover.shouldShow();
            }
            return false;
        });
    }

    shouldShowSelf() {
        // Don't let obsidian show() us if we've already started closing
        // return !this.detaching && (this.onTarget || this.onHover);
        return (
            !this.detaching &&
            !!(
                this.onTarget ||
                (this.state == PopoverState.Shown) ||
                this.document.querySelector(`body>.modal-container, body > #he${this.id} ~ .menu, body > #he${this.id} ~ .suggestion-container`)
            )
        );
    }

    show() {
        // native obsidian logic start
        if (!this.targetEl || this.document.body.contains(this.targetEl)) {
            this.state = PopoverState.Shown;
            this.timer = 0;
            this.targetEl.appendChild(this.hoverEl);
            this.onShow();
            this.plugin.app.workspace.onLayoutChange();
            // initializingHoverPopovers.remove(this);
            // activeHoverPopovers.push(this);
            // initializePopoverChecker();
            this.load();
        } else {
            this.hide();
        }
        // native obsidian logic end

        // if this is an image view, set the dimensions to the natural dimensions of the image
        // an interactjs reflow will be triggered to constrain the image to the viewport if it's
        // too large
        if (this.hoverEl.dataset.imgHeight && this.hoverEl.dataset.imgWidth) {
            this.hoverEl.setCssProps({
                height:
                    parseFloat(this.hoverEl.dataset.imgHeight) +
                    this.titleEl.offsetHeight +
                    "px",
                width: parseFloat(this.hoverEl.dataset.imgWidth) + "px",
            });
        }
    }

    onHide() {
        this.oldPopover = null;
        if (this.parent?.DailyNoteEditor === this) {
            this.parent.DailyNoteEditor = null;
        }
    }

    hide() {
        this.onTarget = false;
        this.detaching = true;
        // Once we reach this point, we're committed to closing

        // in case we didn't ever call show()


        // A timer might be pending to call show() for the first time, make sure
        // it doesn't bring us back up after we close
        if (this.timer) {
            (this.document.defaultView ?? window).clearTimeout(this.timer);
            this.timer = 0;
        }

        // Hide our HTML element immediately, even if our leaves might not be
        // detachable yet.  This makes things more responsive and improves the
        // odds of not showing an empty popup that's just going to disappear
        // momentarily.
        this.hoverEl.hide();

        // If a file load is in progress, we need to wait until it's finished before
        // detaching leaves.  Because we set .detaching, The in-progress openFile()
        // will call us again when it finishes.
        if (this.opening) return;

        // Leave this code here to observe the state of the leaves
        const leaves = this.leaves();
        if (leaves.length) {
            // Detach all leaves before we unload the popover and remove it from the DOM.
            // Each leaf.detach() will trigger layout-changed and the updateLeaves()
            // method will then call hide() again when the last one is gone.
            // leaves[0].detach();
            leaves[0].detach();
            // this.targetEl.empty();
        } else {
            this.parent = null;
            this.abortController?.unload();
            this.abortController = undefined;
            return this.nativeHide();
        }
    }

    nativeHide() {
        const {hoverEl, targetEl} = this;
        this.state = PopoverState.Hidden;
        hoverEl.detach();

        if (targetEl) {
            const parent = targetEl.matchParent(".dn-leaf-view");
            if (parent) popovers.get(parent)?.transition();
        }

        this.onHide();
        this.unload();
    }

    resolveLink(linkText: string, sourcePath: string): TFile | null {
        const link = parseLinktext(linkText);
        const tFile = link ? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath) : null;
        return tFile;
    }

    async openLink(linkText: string, sourcePath: string, eState?: EphemeralState, createInLeaf?: WorkspaceLeaf) {
        let file = this.resolveLink(linkText, sourcePath);
        const link = parseLinktext(linkText);
        if (!file && createInLeaf) {
            const folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
            file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
        }

        if (!file) {
            // this.displayCreateFileAction(linkText, sourcePath, eState);
            return;
        }
        const {viewRegistry} = this.plugin.app;
        const viewType = viewRegistry.typeByExtension[file.extension];
        if (!viewType || !viewRegistry.viewByType[viewType]) {
            // this.displayOpenFileAction(file);
            return;
        }

        eState = Object.assign(this.buildEphemeralState(file, link), eState);
        const parentMode = this.getDefaultMode();
        const state = this.buildState(parentMode, eState);
        const leaf = await this.openFile(file, state as OpenViewState, createInLeaf);
        const leafViewType = leaf?.view?.getViewType();
        // console.log(leaf);
        if (leafViewType === "image") {
            // TODO: temporary workaround to prevent image popover from disappearing immediately when using live preview
            const editorEl = readProperty(this.parent, "editorEl");
            const HTMLElementCtor = this.document.defaultView?.HTMLElement ?? HTMLElement;
            if (editorEl instanceof HTMLElementCtor && editorEl.hasClass("is-live-preview")) {
                this.waitTime = 3000;
            }
            const img = leaf!.view.contentEl.querySelector("img")!;
            this.hoverEl.dataset.imgHeight = String(img.naturalHeight);
            this.hoverEl.dataset.imgWidth = String(img.naturalWidth);
            this.hoverEl.dataset.imgRatio = String(img.naturalWidth / img.naturalHeight);
        } else if (leafViewType === "pdf") {
            this.hoverEl.setCssProps({
                height: "800px",
                width: "600px",
            });
        }
        if (state.state?.mode === "source") {
            this.whenShown(() => {
                // Not sure why this is needed, but without it we get issue #186
                const editMode = readProperty(leaf?.view, "editMode");
                if (requireApiVersion("1.0") && hasReinit(editMode)) editMode.reinit();
                leaf?.view?.setEphemeralState(state.eState);
            });
        }
    }

    whenShown(callback: () => any) {
        // invoke callback once the popover is visible
        if (this.detaching) return;
        const existingCallback = this.onShowCallback;
        this.onShowCallback = () => {
            if (this.detaching) return;
            callback();
            if (typeof existingCallback === "function") existingCallback();
        };
        if (this.state === PopoverState.Shown) {
            this.onShowCallback();
            this.onShowCallback = undefined;
        }
    }

    async openFile(file: TFile, openState?: OpenViewState, useLeaf?: WorkspaceLeaf) {
        if (this.detaching) return;
        const leaf = useLeaf ?? this.attachLeaf();
        this.opening = true;

        try {
            await leaf.openFile(file, openState);
        } catch (e) {
            console.error(e);
        } finally {
            this.opening = false;
            if (this.detaching) this.hide();
        }
        this.plugin.app.workspace.setActiveLeaf(leaf);

        return leaf;
    }

    buildState(parentMode: string, eState?: EphemeralState) {
        return {
            active: false, // Don't let Obsidian force focus if we have autofocus off
            state: {mode: "source"}, // Don't set any state for the view, because this leaf is stayed on another view.
            eState: eState,
        };
    }

    buildEphemeralState(
        file: TFile,
        link?: {
            path: string;
            subpath: string;
        },
    ) {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const subpath = cache ? resolveSubpath(cache, link?.subpath || "") : undefined;
        const eState: EphemeralState = {subpath: link?.subpath};
        if (subpath) {
            eState.line = subpath.start.line;
            eState.startLoc = subpath.start;
            eState.endLoc = subpath.end || undefined;
        }
        return eState;
    }
}
