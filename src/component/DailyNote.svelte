<script lang="ts">
    import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
    import {
        Component,
        MarkdownRenderer,
        MarkdownView,
        TAbstractFile,
        TFile,
        WorkspaceLeaf,
    } from "obsidian";
    import { spawnLeafView } from "../leafView";
    import { onDestroy, onMount, tick as svelteTick } from "svelte";
    import { getJournalDateInfo } from "../utils/journalDate";
    import {
        isLocalSaveConfirmation,
        isTextChangingKey,
        SAVE_NOT_CONFIRMED_MS,
        shouldShowSaveNotConfirmed,
    } from "../utils/saveStatus";
    import {
        shouldMountMarkdownEditor,
        shouldRenderMarkdownPreview,
        shouldUnloadMarkdownEditor,
        shouldUnloadMarkdownPreview,
    } from "../utils/renderPolicy";
    import { applyExternalChangeState } from "../utils/conflictState";

    export let file: TAbstractFile;
    export let plugin: DailyNoteViewPlugin;
    export let leaf: WorkspaceLeaf;
    export let shouldRender: boolean = true;
    export let fileChange: { token: number; mtime: number } | undefined;

    let editorEl: HTMLElement;
    let previewEl: HTMLElement;
    let containerEl: HTMLElement;
    let title: string;
    let journalDateTitle = "";

    let rendered: boolean = false;
    let previewRendered: boolean = false;
    let isEditing: boolean = false;
    let markdownRenderComponent: Component | null = null;
    let previewRenderToken = 0;

    let createdLeaf: WorkspaceLeaf;
    let unloadTimeout: number | null = null;
    let editorMountTimeout: number | null = null;
    let modeSwitchTimeout: number | null = null;
    let editorHeight: number = 100; // Default minimum height
    let lastExternalChangeToken: number = 0;
    let showExternalChangeNotice: boolean = false;
    let saveStatus = "Loaded";
    let saveConfirmTimeout: number | null = null;
    let lastLocalEditAt = 0;
    let saveStatusDom: HTMLElement | null = null;
    
    // Track if this component is being destroyed
    let isDestroying = false;
    
    // Track if the note is collapsed
    let isCollapsed: boolean = false;

    onMount(() => {
        if (file instanceof TFile) {
            title = file.basename;
            const journalDateInfo = getJournalDateInfo(plugin.app, file);
            journalDateTitle =
                journalDateInfo.source === "unparsed"
                    ? file.basename
                    : journalDateInfo.label;
            saveStatus = `Loaded ${formatTime(file.stat.mtime)}`;
        }
    });

    $: if (previewEl && shouldRenderMarkdownPreview(shouldRender, isEditing, previewRendered)) {
        renderPreview();
    } else if (previewEl && shouldUnloadMarkdownPreview(shouldRender, previewRendered)) {
        unloadPreview();
    }

    $: if (editorEl && shouldMountMarkdownEditor(isEditing, rendered)) {
        showEditor();
    } else if (editorEl && shouldUnloadMarkdownEditor(isEditing, rendered)) {
        scheduleUnload();
    }

    $: if (fileChange?.token && fileChange.token !== lastExternalChangeToken) {
        lastExternalChangeToken = fileChange.token;
        if (isLocalSaveConfirmation(Date.now(), lastLocalEditAt)) {
            saveStatus = `Saved ${formatTime(fileChange.mtime)}`;
            showExternalChangeNotice = false;
            clearSaveConfirmTimeout();
        } else {
            const syncState = applyExternalChangeState({
                isEditing,
                rendered,
                shouldRender,
                isLocalSave: false,
            });
            saveStatus = `Synced ${formatTime(fileChange.mtime)}`;
            showExternalChangeNotice = syncState.showExternalChangeNotice;
            clearSaveConfirmTimeout();

            if (syncState.shouldUnloadEditor) {
                unloadEditor();
            }
            isEditing = syncState.isEditing;
            if (syncState.shouldReloadEditor) {
                scheduleModeSwitch(showEditor);
            } else if (syncState.shouldRefreshPreview) {
                renderPreview();
            }
        }
    }

    onDestroy(() => {
        isDestroying = true;
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }
        clearEditorMountTimeout();
        clearModeSwitchTimeout();
        if (rendered && createdLeaf) {
            unloadEditor();
        }
        unloadPreview();
        clearSaveConfirmTimeout();
    });

    async function renderPreview() {
        if (!(file instanceof TFile)) return;
        if (!previewEl || isDestroying) return;

        unloadPreview();
        previewEl.empty();
        const renderToken = ++previewRenderToken;

        try {
            const content = await plugin.app.vault.cachedRead(file);
            if (renderToken !== previewRenderToken || isDestroying || isEditing) {
                return;
            }

            markdownRenderComponent = new Component();
            markdownRenderComponent.load();
            await MarkdownRenderer.render(
                plugin.app,
                content,
                previewEl,
                file.path,
                markdownRenderComponent
            );
            if (renderToken !== previewRenderToken || isDestroying || isEditing) {
                unloadPreview();
                return;
            }

            previewRendered = true;
            const height = previewEl.getBoundingClientRect().height;
            if (height > 0) {
                editorHeight = Math.max(100, height);
                containerEl.style.minHeight = `${editorHeight}px`;
            }
        } catch (error) {
            console.error("Error rendering Journal preview:", error);
            previewEl.setText("Preview failed to render.");
            previewRendered = true;
        }
    }

    function unloadPreview() {
        previewRenderToken++;
        if (markdownRenderComponent) {
            markdownRenderComponent.unload();
            markdownRenderComponent = null;
        }
        if (previewEl) {
            previewEl.empty();
        }
        previewRendered = false;
    }

    function showEditor() {
        if (!(file instanceof TFile)) return;
        if (rendered) return;
        if (isDestroying) return;
        
        // Clear any pending unload
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }

        try {
            [createdLeaf] = spawnLeafView(plugin, editorEl, leaf);
            createdLeaf.setPinned(true);

            createdLeaf.setViewState({
                type: "markdown",
                state: {
                    file: file.path,
                    mode: "source",
                    source: false,
                    backlinks: !plugin.settings.hideBacklinks,
                    backlinkOpts: {
                        collapseAll: false,
                        extraContext: false,
                        sortOrder: "alphabetical",
                        showSearch: false,
                        searchQuery: "",
                        backlinkCollapsed: false,
                        unlinkedCollapsed: true
                    }
                }
            });
            createdLeaf.parentLeaf = leaf;

            rendered = true;
            
            // Set a small timeout to allow the editor to render completely
            const mountedLeaf = createdLeaf;
            clearEditorMountTimeout();
            editorMountTimeout = window.setTimeout(() => {
                editorMountTimeout = null;
                if (isDestroying || !rendered) return;
                if (createdLeaf !== mountedLeaf) return;
                if (createdLeaf && containerEl) {
                    // Get the actual height of the editor content
                    if(!(createdLeaf.view instanceof MarkdownView)) return; 
                    // @ts-ignore
                    const editor = createdLeaf.view.editMode?.editor;
                    // @ts-ignore
                    const actualHeight = editor?.cm?.dom.innerHeight;
                    if (actualHeight > 0) {
                        editorHeight = actualHeight;
                        // Apply the height to the container
                        containerEl.style.minHeight = `${editorHeight}px`;
                    }
                    registerLocalChangeHandler(editor);
                }
            }, 400);
        } catch (error) {
            console.error("Error creating leaf view:", error);
        }
    }

    function enterEditMode() {
        if (isEditing) return;
        if (file instanceof TFile) plugin.setOutlineSourcePath(file.path);
        isEditing = true;
        unloadPreview();
        scheduleModeSwitch(showEditor);
    }

    function enterPreviewMode() {
        if (!isEditing) return;
        isEditing = false;
        if (rendered) {
            unloadEditor();
        }
        scheduleModeSwitch(renderPreview);
    }

    function handlePreviewKeydown(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        enterEditMode();
    }
    
    // Schedule unloading the editor with a delay to prevent flickering
    function scheduleUnload() {
        if (unloadTimeout) {
            window.clearTimeout(unloadTimeout);
            unloadTimeout = null;
        }
        
        // Use a longer timeout to prevent frequent load/unload cycles
        unloadTimeout = window.setTimeout(() => {
            if (shouldUnloadMarkdownEditor(isEditing, rendered)) {
                unloadEditor();
            }
        }, 1000);
    }
    
    // Unload the editor to free up resources
    function unloadEditor() {
        if (!rendered || !createdLeaf) return;
        
        try {
            clearEditorMountTimeout();
            unregisterLocalChangeHandler();
            // Detach the leaf
            if (createdLeaf.detach) {
                createdLeaf.detach();
            }
            
            // Clear the editor element
            if (editorEl) {
                editorEl.empty();
            }
            
            rendered = false;
            
            // Keep the container height to prevent scroll jumps
            // The height will be maintained by the min-height we set earlier
        } catch (error) {
            console.error("Error unloading editor:", error);
        }
    }

    function handleFileIconClick() {
        if (!(file instanceof TFile)) return;
        if (leaf && !(leaf as any)?.pinned) {
            leaf.openFile(file);
        } else plugin.app.workspace.getLeaf(false).openFile(file);
    }

    function handleEditorClick() {
        if (file instanceof TFile) plugin.setOutlineSourcePath(file.path);
        // @ts-ignore
        const editor = createdLeaf?.view?.editMode?.editor;
        if (createdLeaf) {
            plugin.app.workspace.setActiveLeaf(createdLeaf, { focus: true });
        }
        if (editor && !editor.hasFocus()) {
            editor.focus();
        }
    }

    function selectForOutline() {
        if (file instanceof TFile) plugin.setOutlineSourcePath(file.path);
    }
    
    // Toggle collapse/expand state
    function toggleCollapse() {
        isCollapsed = !isCollapsed;
    }

    function reloadEditor() {
        if (file instanceof TFile) {
            saveStatus = `Reloaded ${formatTime(file.stat.mtime)}`;
        }
        showExternalChangeNotice = false;

        if (rendered) {
            unloadEditor();
        }
        if (isEditing) {
            scheduleModeSwitch(showEditor);
        } else {
            unloadPreview();
            scheduleModeSwitch(renderPreview);
        }
    }

    export async function enterEditModeForAudit() {
        enterEditMode();
        await waitForAudit(750);
        await svelteTick();
        return getAuditState();
    }

    export async function appendMarkerForAudit(marker: string) {
        if (!(file instanceof TFile)) {
            return {
                ...getAuditState(),
                status: "failed",
                reason: "file-is-not-tfile",
            };
        }

        enterEditMode();
        await waitForAudit(750);
        const content = await plugin.app.vault.cachedRead(file);
        const nextContent = `${content.trimEnd()}\n${marker}\n`;
        markSaving();

        const editor = (createdLeaf?.view as any)?.editMode?.editor;
        if (editor?.setValue) {
            editor.setValue(nextContent);
        }
        await plugin.app.vault.modify(file, nextContent);
        await waitForAudit(800);

        const savedContent = await plugin.app.vault.cachedRead(file);
        return {
            ...getAuditState(),
            status: savedContent.includes(marker) ? "passed" : "failed",
            reason: savedContent.includes(marker)
                ? undefined
                : "source-file-missing-marker",
            marker,
            sourceContainsMarker: savedContent.includes(marker),
        };
    }

    export async function enterPreviewModeForAudit() {
        enterPreviewMode();
        await waitForAudit(800);
        return getAuditState();
    }

    export async function createExternalChangeForAudit(marker: string) {
        if (!(file instanceof TFile)) {
            return {
                ...getAuditState(),
                status: "failed",
                reason: "file-is-not-tfile",
            };
        }

        if (showExternalChangeNotice) {
            await reloadForAudit();
        }
        enterEditMode();
        await waitForAudit(750);
        const content = await plugin.app.vault.cachedRead(file);
        await plugin.app.vault.modify(file, `${content.trimEnd()}\n${marker}\n`);
        const deadline = Date.now() + 3000;
        let state = getAuditState();
        while (
            !state.saveStatus.startsWith("Synced") &&
            Date.now() < deadline
        ) {
            await waitForAudit(100);
            await svelteTick();
            state = getAuditState();
        }
        return {
            ...state,
            status:
                state.saveStatus.startsWith("Synced") &&
                !state.showExternalChangeNotice &&
                !state.conflictVisible
                    ? "passed"
                    : "failed",
            reason:
                state.saveStatus.startsWith("Synced") &&
                !state.showExternalChangeNotice &&
                !state.conflictVisible
                    ? undefined
                    : "external-change-autosync-not-observed",
            marker,
        };
    }

    export async function reloadAfterExternalChangeForAudit(marker: string) {
        if (!(file instanceof TFile)) {
            return {
                ...getAuditState(),
                status: "failed",
                reason: "file-is-not-tfile",
            };
        }

        reloadEditor();
        const deadline = Date.now() + 3000;
        let state = getAuditState();
        while (
            !state.previewRendered &&
            Date.now() < deadline
        ) {
            await waitForAudit(100);
            await svelteTick();
            state = getAuditState();
        }
        const content = await plugin.app.vault.cachedRead(file);
        return {
            ...state,
            status:
                !state.showExternalChangeNotice &&
                !state.conflictVisible &&
                content.includes(marker)
                ? "passed"
                : "failed",
            reason:
                !state.showExternalChangeNotice &&
                !state.conflictVisible &&
                content.includes(marker)
                    ? undefined
                    : "reload-did-not-clear-conflict-or-content-missing",
            marker,
            sourceContainsMarker: content.includes(marker),
        };
    }

    export async function reloadForAudit() {
        reloadEditor();
        await waitForAudit(800);
        return getAuditState();
    }

    export function getAuditState() {
        return {
            path: file instanceof TFile ? file.path : "",
            title,
            isEditing,
            editorMounted: rendered,
            previewRendered,
            showExternalChangeNotice,
            saveStatus,
            editButtonDisabled:
                containerEl?.querySelector<HTMLButtonElement>(
                    '.daily-note-mode-button[aria-label="Edit"]'
                )?.disabled ?? false,
            conflictVisible:
                containerEl?.querySelector(".daily-note-conflict") !== null,
        };
    }

    function waitForAudit(ms: number) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function registerLocalChangeHandler(editor: any) {
        const dom = editor?.cm?.dom as HTMLElement | undefined;
        if (!dom || (dom as any)._journalStreamSaveStatusRegistered) return;

        (dom as any)._journalStreamSaveStatusRegistered = true;
        dom.addEventListener("input", markSaving);
        dom.addEventListener("keydown", handleSavingKeydown);
        saveStatusDom = dom;
    }

    function unregisterLocalChangeHandler() {
        if (!saveStatusDom) return;

        saveStatusDom.removeEventListener("input", markSaving);
        saveStatusDom.removeEventListener("keydown", handleSavingKeydown);
        delete (saveStatusDom as any)._journalStreamSaveStatusRegistered;
        saveStatusDom = null;
    }

    function markSaving() {
        lastLocalEditAt = Date.now();
        saveStatus = "Saving...";
        clearSaveConfirmTimeout();
        saveConfirmTimeout = window.setTimeout(() => {
            if (shouldShowSaveNotConfirmed(Date.now(), lastLocalEditAt)) {
                saveStatus = "Save not confirmed";
            }
        }, SAVE_NOT_CONFIRMED_MS);
    }

    function handleSavingKeydown(event: KeyboardEvent) {
        if (!isTextChangingKey(event)) return;
        markSaving();
    }

    function clearSaveConfirmTimeout() {
        if (saveConfirmTimeout) {
            window.clearTimeout(saveConfirmTimeout);
            saveConfirmTimeout = null;
        }
    }

    function clearEditorMountTimeout() {
        if (editorMountTimeout) {
            window.clearTimeout(editorMountTimeout);
            editorMountTimeout = null;
        }
    }

    function scheduleModeSwitch(callback: () => void) {
        clearModeSwitchTimeout();
        modeSwitchTimeout = window.setTimeout(() => {
            modeSwitchTimeout = null;
            if (isDestroying) return;
            callback();
        }, 0);
    }

    function clearModeSwitchTimeout() {
        if (modeSwitchTimeout) {
            window.clearTimeout(modeSwitchTimeout);
            modeSwitchTimeout = null;
        }
    }

    function formatTime(time: number): string {
        return new Date(time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }
</script>

<div class="daily-note-container" data-id='dn-editor-{file.path}' data-editing={isEditing} data-collapsed={isCollapsed} bind:this={containerEl} style="min-height: {isCollapsed ? 'auto' : editorHeight + 'px'};">
    <div class="daily-note">
        {#if title}
            <div class="daily-note-title">
                <button type="button" data-collapsed={isCollapsed} class="collapse-button" on:click={toggleCollapse} title={isCollapsed ? "Expand" : "Collapse"} aria-label={isCollapsed ? "Expand" : "Collapse"} aria-expanded={!isCollapsed}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <button type="button" class="clickable-link daily-note-title-link" on:click={handleFileIconClick} data-title={title}>
                    <svg class="daily-note-journal-icon" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4 19.5V5.8A2.8 2.8 0 0 1 6.8 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5Z"/>
                        <path d="M8 7h7"/>
                        <path d="M8 11h5"/>
                        <path d="M6.5 21A2.5 2.5 0 0 1 4 18.5"/>
                    </svg>
                    <span>{journalDateTitle}</span>
                </button>
            </div>
        {/if}
        <div
            class="daily-note-preview markdown-preview-view"
            data-collapsed={isCollapsed}
            data-editing={isEditing}
            bind:this={previewEl}
            data-title={title}
            role="button"
            tabindex="0"
            title="Double-click to edit"
            on:click={selectForOutline}
            on:dblclick={enterEditMode}
            on:keydown={handlePreviewKeydown}
        >
            {#if !previewRendered && shouldRender && !isEditing}
                <div class="editor-placeholder">Loading...</div>
            {/if}
            {#if !shouldRender && !previewRendered && !isEditing}
                <div class="editor-placeholder">Scroll to view content</div>
            {/if}
        </div>
        <div class="daily-note-editor" data-collapsed={isCollapsed} data-editing={isEditing} aria-hidden={!isEditing} bind:this={editorEl} data-title={title} on:click={handleEditorClick}>
            {#if isEditing && !rendered && shouldRender}
                <div class="editor-placeholder">Loading editor...</div>
            {/if}
        </div>
    </div>
</div>

<style>
    .daily-note {
        background: transparent;
        border: 0;
        border-radius: 0;
        margin: 0 auto;
        max-width: var(--file-line-width);
        padding: 0;
        position: relative;
        width: calc(100% - var(--size-4-8));
    }

    .daily-note-editor,
    .daily-note-preview {
        min-height: 100px;
    }

    .daily-note-editor[data-collapsed="true"],
    .daily-note-preview[data-collapsed="true"],
    .daily-note-editor[data-editing="false"],
    .daily-note-preview[data-editing="true"] {
        display: none;
    }

    .daily-note .collapse-button {
        opacity: 0;
        pointer-events: none;
    }

    .daily-note:hover .collapse-button,
    .daily-note:focus-within .collapse-button {
        opacity: 1;
        pointer-events: auto;
    }

    .daily-note .collapse-button {
        align-items: center;
        display: inline-flex;
        justify-content: center;
        position: absolute;
        right: 0;
        top: 0;
        color: var(--text-muted);
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        cursor: pointer;
        flex: 0 0 44px;
        margin: 0;
    }

    .daily-note .collapse-button:hover  {
        color: var(--text-normal);
        background: transparent;
    }

    .daily-note-title {
        display: flex;
        align-items: center;
        margin-bottom: var(--size-4-3);
        gap: var(--size-4-2);
        width: 100%;
    }

    .daily-note-title-link {
        border: 0;
        background: transparent;
        box-shadow: none;
        color: var(--text-normal);
        cursor: pointer;
        font-family: var(--font-text-theme);
        font-size: var(--h1-size);
        font-weight: 700;
        line-height: 1.25;
        padding: 0;
        text-align: left;
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: var(--size-4-2);
        max-width: calc(100% - 44px);
        min-width: 0;
    }

    .daily-note-title-link:hover {
        background: transparent;
        color: var(--text-accent);
    }

    .daily-note-journal-icon {
        color: var(--text-faint);
        flex: 0 0 auto;
    }

    .collapse-button[data-collapsed="true"] {
        transform: rotate(-90deg);

        transition: transform 0.2s ease;
    }

    .daily-note-preview,
    .daily-note-editor {
        margin-left: 0;
        width: 100%;
    }

    .clickable-link {
        cursor: pointer;
        text-decoration: none;
    }

    .clickable-link:hover {
        color: var(--color-accent);
        text-decoration: underline;
    }
    
    .editor-placeholder {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100px;
        color: var(--text-muted);
        font-style: italic;
    }
    
    @media (prefers-reduced-motion: reduce) {
        .collapse-button {
            transition: none;
        }
    }
</style>
