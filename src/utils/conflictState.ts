export interface ExternalChangeState {
    isEditing: boolean;
    rendered: boolean;
    shouldRender: boolean;
    isLocalSave: boolean;
}

export interface ExternalChangeResult {
    isEditing: boolean;
    showExternalChangeNotice: boolean;
    restoreEditAfterReload: boolean;
    shouldUnloadEditor: boolean;
    shouldRefreshPreview: boolean;
    shouldReloadEditor: boolean;
    isSavedConfirmation: boolean;
}

export interface ReloadConflictState {
    restoreEditAfterReload: boolean;
    rendered: boolean;
}

export interface ReloadConflictResult {
    isEditing: boolean;
    showExternalChangeNotice: boolean;
    restoreEditAfterReload: boolean;
    shouldUnloadEditor: boolean;
    shouldRenderPreview: boolean;
    shouldShowEditor: boolean;
}

export function applyExternalChangeState(
    state: ExternalChangeState
): ExternalChangeResult {
    if (state.isLocalSave) {
        return {
            isEditing: state.isEditing,
            showExternalChangeNotice: false,
            restoreEditAfterReload: false,
            shouldUnloadEditor: false,
            shouldRefreshPreview: false,
            shouldReloadEditor: false,
            isSavedConfirmation: true,
        };
    }

    return {
        isEditing: state.isEditing,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: state.isEditing && state.rendered,
        shouldRefreshPreview: state.shouldRender && !state.isEditing,
        shouldReloadEditor: state.isEditing,
        isSavedConfirmation: false,
    };
}

export function applyReloadConflictState(
    state: ReloadConflictState
): ReloadConflictResult {
    return {
        isEditing: state.restoreEditAfterReload,
        showExternalChangeNotice: false,
        restoreEditAfterReload: false,
        shouldUnloadEditor: state.rendered,
        shouldRenderPreview: !state.restoreEditAfterReload,
        shouldShowEditor: state.restoreEditAfterReload,
    };
}
