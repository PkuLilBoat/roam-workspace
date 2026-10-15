import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { OutlinerScope } from "../types/settings";

export const setStreamEditorContext = StateEffect.define<boolean>();

export const streamEditorContextField = StateField.define<boolean>({
    create: () => false,
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(setStreamEditorContext)) value = effect.value;
        }
        return value;
    },
});

export interface OutlinerRuntimeState {
    getScope(): OutlinerScope;
    hasExternalConflict(): boolean;
}

export function resolveOutlinerCapabilities(
    scope: OutlinerScope,
    isStream: boolean,
    hasExternalConflict: boolean
): { selection: boolean; commands: boolean; paste: boolean } {
    const enabled =
        scope === "vault-wide" || (scope === "stream-only" && isStream);
    return {
        selection: enabled,
        commands: enabled && !hasExternalConflict,
        paste: enabled,
    };
}

export function isStreamEditorDom(element: HTMLElement): boolean {
    return Boolean(
        element.closest(
            ".journal-v2, .roam-page-stream-view, .roam-page-card"
        )
    );
}

export function isOutlinerEnabled(
    state: EditorState,
    runtime: OutlinerRuntimeState
): boolean {
    const scope = runtime.getScope();
    return resolveOutlinerCapabilities(
        scope,
        state.field(streamEditorContextField, false) === true,
        runtime.hasExternalConflict()
    ).selection;
}

export function isOutlinerCommandsEnabled(
    state: EditorState,
    runtime: OutlinerRuntimeState
): boolean {
    return resolveOutlinerCapabilities(
        runtime.getScope(),
        state.field(streamEditorContextField, false) === true,
        runtime.hasExternalConflict()
    ).commands;
}

export function isOutlinerPasteEnabled(
    state: EditorState,
    runtime: OutlinerRuntimeState
): boolean {
    return resolveOutlinerCapabilities(
        runtime.getScope(),
        state.field(streamEditorContextField, false) === true,
        runtime.hasExternalConflict()
    ).paste;
}

export function createStreamContextExtension(runtime: OutlinerRuntimeState) {
    return ViewPlugin.fromClass(
        class {
            private destroyed = false;
            private microtaskPending = false;
            private frame: number | null = null;

            constructor(private view: EditorView) {
                this.scheduleRefresh();
            }

            update(update: ViewUpdate): void {
                if (
                    update.transactions.some((transaction) => transaction.reconfigured) ||
                    update.focusChanged
                ) {
                    this.scheduleRefresh();
                }
                this.updateClass();
            }

            destroy(): void {
                this.destroyed = true;
                if (this.frame !== null) {
                    window.cancelAnimationFrame(this.frame);
                    this.frame = null;
                }
                this.view.dom.classList.remove("roam-outliner-enabled");
            }

            private scheduleRefresh(): void {
                if (!this.microtaskPending) {
                    this.microtaskPending = true;
                    window.queueMicrotask(() => {
                        this.microtaskPending = false;
                        this.refreshContext();
                    });
                }
                if (this.frame === null) {
                    this.frame = window.requestAnimationFrame(() => {
                        this.frame = null;
                        this.refreshContext();
                    });
                }
            }

            private refreshContext(): void {
                if (this.destroyed) return;
                const stream =
                    this.view.state.field(streamEditorContextField, false) === true ||
                    isStreamEditorDom(this.view.dom);
                if (
                    this.view.state.field(streamEditorContextField, false) !==
                    stream
                ) {
                    this.view.dispatch({
                        effects: setStreamEditorContext.of(stream),
                    });
                }
                this.updateClass();
            }

            private updateClass(): void {
                this.view.dom.classList.toggle(
                    "roam-outliner-enabled",
                    isOutlinerEnabled(this.view.state, runtime)
                );
            }
        }
    );
}
