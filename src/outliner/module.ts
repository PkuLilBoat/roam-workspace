import {
    Editor,
    MarkdownFileInfo,
    MarkdownView,
    Notice,
    Plugin,
} from "obsidian";
import type { OutlinerScope } from "../types/settings";
import { getCodeMirrorView } from "./codeMirrorAdapter";
import { isExternalOutlinerEnabled } from "./conflict";
import {
    createOutlinerExtension,
    selectOutlinerBlockAtCursor,
} from "./extension";
import {
    indentListSubtree,
    moveListSubtree,
    outdentListSubtree,
    parseListLine,
    toggleCheckboxLine,
} from "./model";
import { isStreamEditorDom, OutlinerRuntimeState } from "./scope";
import { isProtectedTextLine } from "./protectedRegions";

export interface OutlinerHost extends Plugin {
    settings: { outlinerScope: OutlinerScope };
}

export class OutlinerModule {
    private externalConflict = false;
    private conflictNoticeShown = false;
    private appliedScope: OutlinerScope;
    private readonly runtime: OutlinerRuntimeState = {
        getScope: () => this.host.settings.outlinerScope,
        hasExternalConflict: () => this.externalConflict,
    };

    constructor(private readonly host: OutlinerHost) {
        this.appliedScope = host.settings.outlinerScope;
    }

    load(): void {
        this.refreshConflict();
        this.host.registerEditorExtension(createOutlinerExtension(this.runtime));
        this.host.registerEvent(
            this.host.app.workspace.on("layout-change", () => {
                this.refreshConflict();
            })
        );
        this.registerCommands();
    }

    updateScope(): void {
        this.refreshConflict();
        if (this.appliedScope === this.host.settings.outlinerScope) return;
        this.appliedScope = this.host.settings.outlinerScope;
        this.host.app.workspace.updateOptions();
    }

    getAuditState(): Record<string, unknown> {
        return {
            scope: this.host.settings.outlinerScope,
            externalOutlinerEnabled: this.externalConflict,
            builtInBehaviorEnabled:
                this.host.settings.outlinerScope !== "off" &&
                !this.externalConflict,
            blockSelectionEnabled:
                this.host.settings.outlinerScope !== "off",
            listPasteNormalizationEnabled:
                this.host.settings.outlinerScope !== "off",
        };
    }

    private refreshConflict(): void {
        const next = isExternalOutlinerEnabled(this.host.app);
        if (next === this.externalConflict) return;
        this.externalConflict = next;
        if (next && !this.conflictNoticeShown) {
            this.conflictNoticeShown = true;
            new Notice(
                "External outliner is enabled. Overlapping list commands and guides are paused; Stream block selection and paste cleanup remain active."
            );
        } else if (!next) {
            this.conflictNoticeShown = false;
        }
        this.host.app.workspace.updateOptions();
    }

    private registerCommands(): void {
        this.host.addCommand({
            id: "select-list-item-and-children",
            name: "Select list item and children",
            editorCheckCallback: (checking, editor, view) => {
                if (!this.canRun(editor, view)) return false;
                const codeMirror = getCodeMirrorView(editor);
                if (!codeMirror) return false;
                const line = codeMirror.state.doc.lineAt(
                    codeMirror.state.selection.main.head
                );
                if (
                    !parseListLine(line.text) ||
                    isProtectedTextLine(editor.getValue(), line.number - 1)
                ) {
                    return false;
                }
                return checking || selectOutlinerBlockAtCursor(codeMirror);
            },
        });
        this.host.addCommand({
            id: "move-list-item-up",
            name: "Move list item and children up",
            editorCheckCallback: (checking, editor, view) =>
                this.runMove(checking, editor, view, "up"),
        });
        this.host.addCommand({
            id: "move-list-item-down",
            name: "Move list item and children down",
            editorCheckCallback: (checking, editor, view) =>
                this.runMove(checking, editor, view, "down"),
        });
        this.host.addCommand({
            id: "indent-list-item",
            name: "Indent list item and children",
            editorCheckCallback: (checking, editor, view) =>
                this.runIndent(checking, editor, view, false),
        });
        this.host.addCommand({
            id: "outdent-list-item",
            name: "Outdent list item and children",
            editorCheckCallback: (checking, editor, view) =>
                this.runIndent(checking, editor, view, true),
        });
        this.host.addCommand({
            id: "toggle-list-checkbox",
            name: "Toggle list checkbox",
            editorCheckCallback: (checking, editor, view) =>
                this.runToggleCheckbox(checking, editor, view),
        });
        this.host.addCommand({
            id: "toggle-list-fold",
            name: "Toggle list fold",
            editorCheckCallback: (checking, editor, view) => {
                if (!this.canRun(editor, view)) return false;
                const cursor = editor.getCursor();
                if (isProtectedTextLine(editor.getValue(), cursor.line)) {
                    return false;
                }
                const item = parseListLine(editor.getLine(cursor.line));
                if (!item) return false;
                if (!checking) editor.exec("toggleFold");
                return true;
            },
        });
    }

    private runMove(
        checking: boolean,
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo,
        direction: "up" | "down"
    ): boolean {
        if (!this.canRun(editor, view)) return false;
        const cursor = editor.getCursor();
        if (isProtectedTextLine(editor.getValue(), cursor.line)) return false;
        const result = moveListSubtree(editor.getValue(), cursor.line, direction);
        if (!result) return false;
        if (!checking) {
            this.replaceDocument(editor, result.text, {
                line: result.cursorLine,
                ch: cursor.ch,
            });
        }
        return true;
    }

    private runIndent(
        checking: boolean,
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo,
        outdent: boolean
    ): boolean {
        if (!this.canRun(editor, view)) return false;
        const cursor = editor.getCursor();
        const source = editor.getValue();
        if (isProtectedTextLine(source, cursor.line)) return false;
        const transform = outdent
            ? outdentListSubtree(source, cursor.line)
            : indentListSubtree(source, cursor.line);
        if (!transform) return false;
        if (!checking) {
            editor.transaction({
                changes: [
                    {
                        from: { line: transform.fromLine, ch: 0 },
                        to: {
                            line: transform.toLine,
                            ch: editor.getLine(transform.toLine).length,
                        },
                        text: transform.replacement,
                    },
                ],
            });
        }
        return true;
    }

    private runToggleCheckbox(
        checking: boolean,
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo
    ): boolean {
        if (!this.canRun(editor, view)) return false;
        const cursor = editor.getCursor();
        if (isProtectedTextLine(editor.getValue(), cursor.line)) return false;
        const replacement = toggleCheckboxLine(editor.getLine(cursor.line));
        if (!replacement) return false;
        if (!checking) editor.setLine(cursor.line, replacement);
        return true;
    }

    private canRun(
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo
    ): boolean {
        if (this.externalConflict || this.host.settings.outlinerScope === "off") {
            return false;
        }
        if (!("containerEl" in view)) return false;
        const containerEl = view.containerEl;
        if (!containerEl?.instanceOf(HTMLElement)) return false;
        if (
            this.host.settings.outlinerScope === "stream-only" &&
            !isStreamEditorDom(containerEl)
        ) {
            return false;
        }
        const selections = editor.listSelections();
        return (
            selections.length === 1 &&
            selections[0].anchor.line === selections[0].head.line &&
            selections[0].anchor.ch === selections[0].head.ch
        );
    }

    private replaceDocument(
        editor: Editor,
        text: string,
        cursor: { line: number; ch: number }
    ): void {
        editor.transaction({
            changes: [
                {
                    from: { line: 0, ch: 0 },
                    to: {
                        line: editor.lastLine(),
                        ch: editor.getLine(editor.lastLine()).length,
                    },
                    text,
                },
            ],
            selection: { from: cursor, to: cursor },
        });
    }
}
