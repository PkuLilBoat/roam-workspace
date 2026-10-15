import { Editor } from "obsidian";
import { EditorView } from "@codemirror/view";
import { setStreamEditorContext } from "./scope";

/** Isolates Obsidian's undocumented Editor-to-CodeMirror bridge. */
export function getCodeMirrorView(editor: Editor): EditorView | null {
    const candidate = (editor as Editor & { cm?: unknown }).cm;
    return candidate instanceof EditorView ? candidate : null;
}

export function markEditorAsStream(editor: Editor): boolean {
    const view = getCodeMirrorView(editor);
    if (!view) return false;
    view.dispatch({ effects: setStreamEditorContext.of(true) });
    return true;
}
