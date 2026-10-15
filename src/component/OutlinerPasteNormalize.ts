import { Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    adaptOutlinerPasteToListContext,
    normalizeOutlinerPaste,
} from "../utils/outlinerPaste";

export function createOutlinerPasteNormalizeExtension(): Extension {
    return Prec.high(
        EditorView.clipboardInputFilter.of((text, state) => {
            const normalized = normalizeOutlinerPaste(text);
            const pasteText = normalized.changed ? normalized.text : text;
            const selection = state.selection.main;
            const line = state.doc.lineAt(selection.head);
            if (state.doc.lineAt(selection.from).number !== state.doc.lineAt(selection.to).number) {
                return pasteText;
            }
            return adaptOutlinerPasteToListContext(pasteText, {
                lineText: line.text,
                cursorColumn: selection.from - line.from,
            });
        })
    );
}
