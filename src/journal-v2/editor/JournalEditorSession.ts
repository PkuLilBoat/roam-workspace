import type {
    EditorSelection,
    MarkdownView,
    WorkspaceLeaf,
} from "obsidian";
import type { DailyNoteEditor } from "../../leafView";

export interface JournalEditorState {
    propertiesCollapsed: boolean;
    scroll: { left: number; top: number };
    selections: EditorSelection[];
}

let nextSessionId = 0;

export class JournalEditorSession {
    readonly id = `journal-v2-editor-${++nextSessionId}`;
    private destroyed = false;
    private propertiesCleanup: (() => void) | null = null;

    constructor(
        private currentPath: string,
        readonly leaf: WorkspaceLeaf,
        private readonly editorHost: DailyNoteEditor,
        readonly slotEl: HTMLElement
    ) {
        this.slotEl.dataset.journalEditorSessionId = this.id;
    }

    get path(): string {
        return this.currentPath;
    }

    renamePath(path: string): void {
        this.currentPath = path;
    }

    markReady(): void {
        this.slotEl.dataset.editorStatus = "ready";
    }

    getMarkdownView(): MarkdownView | null {
        const view = this.leaf.view;
        return view.getViewType() === "markdown"
            ? (view as MarkdownView)
            : null;
    }

    getContent(): string | null {
        return this.getMarkdownView()?.getViewData() ?? null;
    }

    replaceContent(content: string): boolean {
        const view = this.getMarkdownView();
        if (!view) return false;
        view.editor.setValue(content);
        view.data = content;
        view.requestSave();
        return true;
    }

    focus(): boolean {
        const view = this.getMarkdownView();
        if (!view) return false;
        view.editor.focus();
        return true;
    }

    bindProperties(cleanup: () => void): void {
        this.propertiesCleanup?.();
        this.propertiesCleanup = cleanup;
    }

    captureState(propertiesCollapsed: boolean): JournalEditorState | null {
        const view = this.getMarkdownView();
        if (!view) return null;
        const scroll = view.editor.getScrollInfo();
        return {
            propertiesCollapsed,
            scroll: { left: scroll.left, top: scroll.top },
            selections: view.editor.listSelections().map((selection) => ({
                anchor: { ...selection.anchor },
                head: { ...selection.head },
            })),
        };
    }

    restoreState(state: JournalEditorState): void {
        const view = this.getMarkdownView();
        if (!view) return;
        if (state.selections.length > 0) {
            view.editor.setSelections(state.selections);
        }
        view.editor.scrollTo(state.scroll.left, state.scroll.top);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.propertiesCleanup?.();
        this.propertiesCleanup = null;
        try {
            this.editorHost.hide();
        } catch (error) {
            console.error("Failed to close Journal V2 editor host:", error);
            this.leaf.detach();
        }
        this.slotEl.removeAttribute("data-journal-editor-session-id");
        this.slotEl.removeAttribute("data-editor-status");
        this.slotEl.empty();
    }
}
