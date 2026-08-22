import { Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { normalizeOutlinerPaste } from "../utils/outlinerPaste";

export function createOutlinerPasteNormalizeExtension(): Extension {
    return Prec.high(
        EditorView.clipboardInputFilter.of((text) => {
            const normalized = normalizeOutlinerPaste(text);
            return normalized.changed ? normalized.text : text;
        })
    );
}

