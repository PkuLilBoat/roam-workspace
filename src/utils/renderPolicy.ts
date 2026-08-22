export function shouldMountMarkdownEditor(
    isEditing: boolean,
    rendered: boolean
): boolean {
    return isEditing && !rendered;
}

export function shouldUnloadMarkdownEditor(
    isEditing: boolean,
    rendered: boolean
): boolean {
    return !isEditing && rendered;
}

export function shouldRenderMarkdownPreview(
    shouldRender: boolean,
    isEditing: boolean,
    previewRendered: boolean
): boolean {
    return shouldRender && !isEditing && !previewRendered;
}

export function shouldUnloadMarkdownPreview(
    shouldRender: boolean,
    previewRendered: boolean
): boolean {
    return !shouldRender && previewRendered;
}

export function shouldRefreshPreviewAfterExternalChange(
    shouldRender: boolean,
    isEditing: boolean
): boolean {
    return shouldRender && !isEditing;
}
