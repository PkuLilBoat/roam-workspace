import { MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type DailyNoteViewPlugin from "../../dailyNoteViewIndex";
import {
    DailyNoteEditor,
    type DailyNoteEditorParent,
} from "../../leafView";
import { markEditorAsStream } from "../../outliner/codeMirrorAdapter";
import {
    bindStreamProperties,
    type NativeMetadataEditor,
} from "../../utils/streamProperties";
import { JournalEditorSession } from "./JournalEditorSession";
import {
    resolveJournalEditorReadiness,
    type JournalEditorReadiness,
} from "./editorReadiness";

const EDITOR_READY_TIMEOUT_MS = 3000;
const EDITOR_READY_POLL_MS = 16;

export class ObsidianEmbeddedEditorAdapter {
    constructor(private readonly plugin: DailyNoteViewPlugin) {}

    async mount(
        slotEl: HTMLElement,
        file: TFile,
        parentLeaf: WorkspaceLeaf,
        signal?: AbortSignal
    ): Promise<JournalEditorSession> {
        this.assertCapabilities(slotEl);
        slotEl.dataset.editorStatus = "loading";

        let hostShown = false;
        const editorParent: DailyNoteEditorParent = {
            containerEl: parentLeaf.containerEl,
            hoverPopover: null,
            view: parentLeaf.view,
        };
        const editorHost = new DailyNoteEditor(
            editorParent,
            slotEl,
            this.plugin,
            undefined,
            () => {
                hostShown = true;
            }
        );
        const leaf = editorHost.attachLeaf();
        const session = new JournalEditorSession(
            file.path,
            leaf,
            editorHost,
            slotEl
        );

        try {
            leaf.parentLeaf = parentLeaf;
            leaf.setPinned(true);
            await this.openView(leaf, file);
            await this.waitUntilReady(session, () => hostShown, signal);
            const view = session.getMarkdownView();
            if (!(view instanceof MarkdownView)) {
                throw new Error("Journal V2 editor view did not become MarkdownView");
            }
            markEditorAsStream(view.editor);
            const viewWithMetadata = view as MarkdownView & {
                metadataEditor?: NativeMetadataEditor;
            };
            session.bindProperties(bindStreamProperties(
                slotEl,
                file.path,
                this.plugin.streamProperties,
                () => viewWithMetadata.metadataEditor ?? null
            ));
            session.markReady();
            return session;
        } catch (error) {
            session.destroy();
            throw error;
        }
    }

    private async openView(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
        try {
            await leaf.setViewState({
                type: "markdown",
                state: {
                    file: file.path,
                    mode: "source",
                    source: false,
                    backlinks: !this.plugin.settings.hideBacklinks,
                },
            });
        } catch (error) {
            const view = leaf.view;
            if (!(error instanceof RangeError) ||
                error.message !== "Selection points outside of document" ||
                !(view instanceof MarkdownView) || view.file !== file) {
                throw error;
            }
            // A cursor-persistence plugin can reject after opening the file
            // successfully. Optional stale cursor state must not kill editing.
            view.editor.setCursor({ line: 0, ch: 0 });
            console.warn("Discarded an out-of-range cursor while opening a Journal editor.");
        }
    }

    private assertCapabilities(slotEl: HTMLElement): void {
        if (!slotEl.isConnected) {
            throw new Error("Journal V2 editor slot is not connected");
        }
        if (typeof this.plugin.app.workspace.createLeafInParent !== "function") {
            throw new Error("Embedded editor leaf API is unavailable");
        }
        if (!slotEl.ownerDocument.defaultView) {
            throw new Error("Journal V2 editor window is unavailable");
        }
    }

    private async waitUntilReady(
        session: JournalEditorSession,
        isHostShown: () => boolean,
        signal?: AbortSignal
    ): Promise<void> {
        const deadline = Date.now() + EDITOR_READY_TIMEOUT_MS;
        let readiness: JournalEditorReadiness = {
            status: "waiting",
            reason: "host-not-shown",
        };

        while (Date.now() < deadline) {
            if (signal?.aborted) {
                throw new Error("Journal V2 editor mount was cancelled");
            }
            const view = session.leaf.view;
            const editorEl = session.slotEl.querySelector<HTMLElement>(".cm-editor");
            readiness = resolveJournalEditorReadiness({
                actualPath:
                    view instanceof MarkdownView && view.file instanceof TFile
                        ? view.file.path
                        : null,
                editorConnected:
                    !!editorEl?.isConnected && session.slotEl.contains(editorEl),
                expectedPath: session.path,
                hostShown: isHostShown(),
                leafConnected: session.leaf.containerEl.isConnected,
                sessionId: session.id,
                slotConnected: session.slotEl.isConnected,
            });
            if (readiness.status === "ready") return;
            await this.waitForNextPoll(session.slotEl);
        }

        throw new Error(
            `Journal V2 editor readiness timed out: ${readiness.status === "waiting" ? readiness.reason : "unknown"}`
        );
    }

    private async waitForNextPoll(slotEl: HTMLElement): Promise<void> {
        const ownerWindow = slotEl.ownerDocument.defaultView;
        if (!ownerWindow) return;
        await new Promise<void>((resolve) => {
            ownerWindow.setTimeout(resolve, EDITOR_READY_POLL_MS);
        });
    }
}
