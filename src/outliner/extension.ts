import {
    EditorSelection,
    Extension,
    Prec,
    Range,
    StateEffect,
    StateField,
} from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    keymap,
    ViewPlugin,
    ViewUpdate,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";
import {
    buildNewSiblingPrefix,
    indentListSubtree,
    moveListSubtree,
    outdentListSubtree,
    parseListLine,
} from "./model";
import { planListContextPaste } from "./paste";
import { isProtectedLine } from "./protectedRegions";
import {
    adjustBlockSelection,
    BlockSelection,
    createBlockSelection,
    resolveBlockSelection,
    serializeBlockSelection,
} from "./selection";
import {
    createStreamContextExtension,
    isOutlinerCommandsEnabled,
    isOutlinerEnabled,
    isOutlinerPasteEnabled,
    OutlinerRuntimeState,
    setStreamEditorContext,
    streamEditorContextField,
} from "./scope";

export const setOutlinerBlockSelection =
    StateEffect.define<BlockSelection | null>();

export const outlinerBlockSelectionField = StateField.define<BlockSelection | null>({
    create: () => null,
    update: (value, transaction) => {
        let next = transaction.docChanged ? null : value;
        for (const effect of transaction.effects) {
            if (effect.is(setOutlinerBlockSelection)) next = effect.value;
        }
        return next;
    },
});

export function createOutlinerExtension(
    runtime: OutlinerRuntimeState
): Extension {
    return [
        streamEditorContextField,
        outlinerBlockSelectionField,
        createStreamContextExtension(runtime),
        createGuideExtension(runtime),
        createBlockPointerCaptureExtension(runtime),
        createBlockSelectionDecorationExtension(),
        createOutlinerTheme(),
        Prec.highest(
            keymap.of([
                { key: "Escape", run: clearBlockSelection },
                {
                    key: "Shift-ArrowUp",
                    run: (view) => adjustSelection(view, runtime, "up"),
                },
                {
                    key: "Shift-ArrowDown",
                    run: (view) => adjustSelection(view, runtime, "down"),
                },
                { key: "Enter", run: (view) => runEnter(view, runtime) },
                { key: "Tab", run: (view) => runIndent(view, runtime, false) },
                {
                    key: "Shift-Tab",
                    run: (view) => runIndent(view, runtime, true),
                },
                {
                    key: "Mod-Shift-ArrowUp",
                    run: (view) => runMove(view, runtime, "up"),
                },
                {
                    key: "Mod-Shift-ArrowDown",
                    run: (view) => runMove(view, runtime, "down"),
                },
                {
                    key: "Mod-ArrowUp",
                    run: (view) => runFold(view, runtime),
                },
                {
                    key: "Mod-ArrowDown",
                    run: (view) => runFold(view, runtime),
                },
            ])
        ),
        Prec.highest(
            EditorView.domEventHandlers({
                keydown(event, view) {
                    if (!getBlockSelection(view)) return false;
                    if (
                        event.key.length === 1 &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        !event.altKey
                    ) {
                        clearBlockSelection(view);
                    }
                    return false;
                },
                copy(event, view) {
                    return handleBlockClipboard(event, view, runtime, false);
                },
                cut(event, view) {
                    return handleBlockClipboard(event, view, runtime, true);
                },
                paste(event, view) {
                    if (!isOutlinerPasteEnabled(view.state, runtime)) return false;
                    if (view.state.selection.ranges.length !== 1) return false;
                    const selection = view.state.selection.main;
                    if (!selection.empty) return false;
                    const line = view.state.doc.lineAt(selection.head);
                    if (isProtectedLine(view.state, line.number)) return false;
                    const text = event.clipboardData?.getData("text/plain") ?? "";
                    const plan = planListContextPaste(
                        text,
                        line.text,
                        selection.head - line.from
                    );
                    if (!plan) return false;

                    const from = line.from + plan.fromColumn;
                    const to = line.from + plan.toColumn;
                    view.dispatch({
                        changes: { from, to, insert: plan.insert },
                        selection: EditorSelection.cursor(from + plan.insert.length),
                        scrollIntoView: true,
                        userEvent: "input.paste",
                    });
                    return true;
                },
            })
        ),
    ];
}

function createBlockPointerCaptureExtension(
    runtime: OutlinerRuntimeState
): Extension {
    return ViewPlugin.fromClass(
        class {
            private readonly ownerWindow: Window;

            constructor(private readonly view: EditorView) {
                this.ownerWindow = view.dom.ownerDocument.defaultView ?? window;
                this.ownerWindow.addEventListener(
                    "mousedown",
                    this.handleMouseDown,
                    true
                );
                this.ownerWindow.addEventListener("click", this.handleClick, true);
            }

            destroy(): void {
                this.ownerWindow.removeEventListener(
                    "mousedown",
                    this.handleMouseDown,
                    true
                );
                this.ownerWindow.removeEventListener(
                    "click",
                    this.handleClick,
                    true
                );
            }

            private readonly handleMouseDown = (event: MouseEvent): void => {
                if (!handleBlockPointerDown(event, this.view, runtime)) return;
                event.stopImmediatePropagation();
            };

            private readonly handleClick = (event: MouseEvent): void => {
                if (
                    !isOutlinerEnabled(this.view.state, runtime) ||
                    !findListMarkerInView(event.target, this.view)
                ) {
                    return;
                }
                event.preventDefault();
                event.stopImmediatePropagation();
            };
        }
    );
}

export function selectOutlinerBlockAtCursor(
    view: EditorView,
    lineNumber?: number
): boolean {
    const line =
        lineNumber === undefined
            ? view.state.doc.lineAt(view.state.selection.main.head)
            : view.state.doc.line(lineNumber + 1);
    const item = parseListLine(line.text);
    if (!item || isProtectedLine(view.state, line.number)) return false;
    view.dispatch({
        selection: EditorSelection.cursor(line.from + item.prefixLength),
        effects: setOutlinerBlockSelection.of(
            createBlockSelection(line.number - 1)
        ),
        scrollIntoView: true,
    });
    view.focus();
    return true;
}

function handleBlockPointerDown(
    event: MouseEvent,
    view: EditorView,
    runtime: OutlinerRuntimeState
): boolean {
    const current = getBlockSelection(view);
    const bullet = findListMarkerInView(event.target, view);
    if (!bullet) {
        if (current) clearBlockSelection(view);
        return false;
    }
    if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !isOutlinerEnabled(view.state, runtime)
    ) {
        return false;
    }
    const lineElement = bullet.closest(".cm-line");
    if (!(lineElement instanceof HTMLElement)) return false;
    const line = view.state.doc.lineAt(view.posAtDOM(lineElement));
    if (!parseListLine(line.text) || isProtectedLine(view.state, line.number)) {
        return false;
    }

    event.preventDefault();
    return selectOutlinerBlockAtCursor(view, line.number - 1);
}

function findListMarker(target: EventTarget | null): Element | null {
    return target instanceof Element
        ? target.closest(".list-bullet, .cm-formatting-list")
        : null;
}

function findListMarkerInView(
    target: EventTarget | null,
    view: EditorView
): Element | null {
    const marker = findListMarker(target);
    return marker && view.dom.contains(marker) ? marker : null;
}

function adjustSelection(
    view: EditorView,
    runtime: OutlinerRuntimeState,
    direction: "up" | "down"
): boolean {
    if (!isOutlinerEnabled(view.state, runtime)) return false;
    const current = getBlockSelection(view);
    if (!current) return false;
    const lines = view.state.doc.toString().split("\n");
    const next = adjustBlockSelection(
        lines,
        current,
        direction,
        (lineNumber) =>
            parseListLine(lines[lineNumber] ?? "") !== null &&
            !isProtectedLine(view.state, lineNumber + 1)
    );
    if (!next) return false;
    view.dispatch({ effects: setOutlinerBlockSelection.of(next) });
    return true;
}

function clearBlockSelection(view: EditorView): boolean {
    if (!getBlockSelection(view)) return false;
    view.dispatch({ effects: setOutlinerBlockSelection.of(null) });
    return true;
}

function handleBlockClipboard(
    event: ClipboardEvent,
    view: EditorView,
    runtime: OutlinerRuntimeState,
    cut: boolean
): boolean {
    if (!isOutlinerEnabled(view.state, runtime)) return false;
    const selection = getBlockSelection(view);
    if (!selection || !event.clipboardData) return false;
    const lines = view.state.doc.toString().split("\n");
    const text = serializeBlockSelection(lines, selection);
    const resolved = resolveBlockSelection(lines, selection);
    if (text === null || !resolved) return false;

    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    if (!cut) {
        clearBlockSelection(view);
        return true;
    }

    const first = view.state.doc.line(resolved.fromLine + 1);
    const last = view.state.doc.line(resolved.toLine + 1);
    let from = first.from;
    let to = last.to;
    if (last.number < view.state.doc.lines) to += 1;
    else if (first.number > 1) from -= 1;
    view.dispatch({
        changes: { from, to, insert: "" },
        selection: EditorSelection.cursor(from),
        effects: setOutlinerBlockSelection.of(null),
        scrollIntoView: true,
        userEvent: "delete.cut",
    });
    return true;
}

function getBlockSelection(view: EditorView): BlockSelection | null {
    return view.state.field(outlinerBlockSelectionField, false) ?? null;
}

function createBlockSelectionDecorationExtension(): Extension {
    return EditorView.decorations.compute(
        [outlinerBlockSelectionField],
        (state) => {
            const selection = state.field(outlinerBlockSelectionField, false);
            if (!selection) return Decoration.none;
            const lines = state.doc.toString().split("\n");
            const resolved = resolveBlockSelection(lines, selection);
            if (!resolved) return Decoration.none;
            const ranges: Range<Decoration>[] = [];
            for (let index = resolved.fromLine; index <= resolved.toLine; index += 1) {
                const line = state.doc.line(index + 1);
                const classes = ["roam-outliner-block-selected"];
                if (index === resolved.fromLine) classes.push("is-selection-start");
                if (index === resolved.toLine) classes.push("is-selection-end");
                ranges.push(
                    Decoration.line({
                        attributes: {
                            class: classes.join(" "),
                            "aria-selected": "true",
                        },
                    }).range(line.from)
                );
            }
            return Decoration.set(ranges, true);
        }
    );
}

function runEnter(view: EditorView, runtime: OutlinerRuntimeState): boolean {
    if (!canRunSingleCursor(view, runtime)) return false;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    if (isProtectedLine(view.state, line.number)) return false;
    const item = parseListLine(line.text);
    const column = selection.head - line.from;
    if (!item || column < item.prefixLength || !item.content.trim()) return false;

    view.dispatch({
        changes: {
            from: selection.head,
            insert: `\n${buildNewSiblingPrefix(item)}`,
        },
        selection: EditorSelection.cursor(
            selection.head + buildNewSiblingPrefix(item).length + 1
        ),
        scrollIntoView: true,
        userEvent: "input",
    });
    return true;
}

function runIndent(
    view: EditorView,
    runtime: OutlinerRuntimeState,
    outdent: boolean
): boolean {
    if (!canRunSingleCursor(view, runtime)) return false;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    if (isProtectedLine(view.state, line.number)) return false;
    const source = view.state.doc.toString();
    const transform = outdent
        ? outdentListSubtree(source, line.number - 1)
        : indentListSubtree(source, line.number - 1);
    if (!transform) return false;
    applyLineTransform(view, transform);
    return true;
}

function runMove(
    view: EditorView,
    runtime: OutlinerRuntimeState,
    direction: "up" | "down"
): boolean {
    if (!canRunSingleCursor(view, runtime)) return false;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    if (isProtectedLine(view.state, line.number)) return false;
    const column = selection.head - line.from;
    const result = moveListSubtree(
        view.state.doc.toString(),
        line.number - 1,
        direction
    );
    if (!result) return false;
    const targetLine = Math.min(result.cursorLine + 1, result.text.split("\n").length);
    const targetOffset = offsetForLine(result.text, targetLine) + column;
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: result.text },
        selection: EditorSelection.cursor(Math.min(targetOffset, result.text.length)),
        scrollIntoView: true,
        userEvent: "move",
    });
    return true;
}

function runFold(view: EditorView, runtime: OutlinerRuntimeState): boolean {
    if (!canRunSingleCursor(view, runtime)) return false;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    if (!parseListLine(line.text) || isProtectedLine(view.state, line.number)) {
        return false;
    }
    const info = view.state.field(editorInfoField, false);
    if (!info?.editor) return false;
    info.editor.exec("toggleFold");
    return true;
}

function canRunSingleCursor(
    view: EditorView,
    runtime: OutlinerRuntimeState
): boolean {
    const selection = view.state.selection;
    return (
        isOutlinerCommandsEnabled(view.state, runtime) &&
        !view.composing &&
        selection.ranges.length === 1 &&
        selection.main.empty
    );
}

function applyLineTransform(
    view: EditorView,
    transform: { fromLine: number; toLine: number; replacement: string }
): void {
    const from = view.state.doc.line(transform.fromLine + 1).from;
    const to = view.state.doc.line(transform.toLine + 1).to;
    view.dispatch({
        changes: { from, to, insert: transform.replacement },
        scrollIntoView: true,
        userEvent: "input",
    });
}

function offsetForLine(text: string, lineNumber: number): number {
    let offset = 0;
    for (let current = 1; current < lineNumber; current += 1) {
        const next = text.indexOf("\n", offset);
        if (next < 0) return text.length;
        offset = next + 1;
    }
    return offset;
}

function createGuideExtension(runtime: OutlinerRuntimeState): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildGuideDecorations(view, runtime);
            }

            update(update: ViewUpdate): void {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.transactions.some((transaction) =>
                        transaction.effects.some((effect) =>
                            effect.is(setStreamEditorContext)
                        )
                    ) ||
                    update.transactions.some((transaction) => transaction.reconfigured)
                ) {
                    this.decorations = buildGuideDecorations(update.view, runtime);
                }
            }
        },
        { decorations: (value) => value.decorations }
    );
}

function buildGuideDecorations(
    view: EditorView,
    runtime: OutlinerRuntimeState
): DecorationSet {
    if (!isOutlinerCommandsEnabled(view.state, runtime)) return Decoration.none;
    const ranges: Range<Decoration>[] = [];
    for (const visible of view.visibleRanges) {
        let position = visible.from;
        while (position <= visible.to) {
            const line = view.state.doc.lineAt(position);
            const item = parseListLine(line.text);
            if (
                item &&
                item.indent.length > 0 &&
                !isProtectedLine(view.state, line.number)
            ) {
                ranges.push(
                    Decoration.mark({ class: "roam-outliner-indent-guide" }).range(
                        line.from,
                        line.from + item.indent.length
                    )
                );
            }
            if (line.to >= visible.to || line.to === view.state.doc.length) break;
            position = line.to + 1;
        }
    }
    return Decoration.set(ranges, true);
}

function createOutlinerTheme(): Extension {
    return EditorView.baseTheme({
        ".roam-outliner-enabled .roam-outliner-indent-guide": {
            backgroundImage:
                "repeating-linear-gradient(to right, transparent 0, transparent calc(var(--indent-size, 2em) - 1px), var(--indentation-guide-color, var(--background-modifier-border)) calc(var(--indent-size, 2em) - 1px), var(--indentation-guide-color, var(--background-modifier-border)) var(--indent-size, 2em))",
        },
        ".mod-rtl .roam-outliner-enabled .roam-outliner-indent-guide": {
            backgroundImage:
                "repeating-linear-gradient(to left, transparent 0, transparent calc(var(--indent-size, 2em) - 1px), var(--indentation-guide-color, var(--background-modifier-border)) calc(var(--indent-size, 2em) - 1px), var(--indentation-guide-color, var(--background-modifier-border)) var(--indent-size, 2em))",
        },
    });
}
