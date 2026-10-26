import { AbstractInputSuggest, App, getIcon, getIconIds, Menu, Modal, Notice, Setting, setIcon } from "obsidian";
import type DailyNoteViewPlugin from "../dailyNoteViewIndex";
import { JournalV2View } from "../journal-v2/JournalV2View";
import { JOURNAL_VIEW_TYPE } from "../journal-v2/routing";
import { NAVIGATION_VIEW_IDS } from "../roamTypes";
import { openPluginSettings } from "../compat/PluginSettingsAccess";
import { editNavigation, moveNavigation, readNavigationDraft, removeNavigation, type NavigationDraft, type NavigationReference, type NavigationState } from "./management";

const pending = new WeakMap<DailyNoteViewPlugin, Promise<void>>();
const listeners = new WeakMap<DailyNoteViewPlugin, Set<() => void>>();

export function subscribeNavigationChanges(plugin: DailyNoteViewPlugin, callback: () => void): () => void {
    let callbacks = listeners.get(plugin);
    if (!callbacks) { callbacks = new Set(); listeners.set(plugin, callbacks); }
    callbacks.add(callback);
    const registered = callbacks;
    return () => { registered.delete(callback); };
}

export function navigationState(plugin: DailyNoteViewPlugin): NavigationState {
    return { configuration: plugin.settings.navigationConfiguration, views: plugin.settings.navigationViews };
}

/** Serialize both UI routes; each edit reads the latest state after the previous save. */
export function updateNavigation(plugin: DailyNoteViewPlugin, edit: (state: NavigationState) => NavigationState): Promise<void> {
    const operation = (pending.get(plugin) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const previous = navigationState(plugin);
        const next = edit(previous);
        plugin.settings.navigationConfiguration = next.configuration;
        plugin.settings.navigationViews = next.views;
        try { await plugin.saveSettings(); }
        catch (error) {
            plugin.settings.navigationConfiguration = previous.configuration;
            plugin.settings.navigationViews = previous.views;
            throw error;
        }
        plugin.notifySettingsChanged();
        for (const leaf of plugin.app.workspace.getLeavesOfType(JOURNAL_VIEW_TYPE)) {
            if (leaf.view instanceof JournalV2View) leaf.view.refreshDisplayName();
        }
        for (const callback of listeners.get(plugin) ?? []) callback();
    });
    pending.set(plugin, operation);
    return operation;
}

function report(error: unknown): void {
    new Notice(`Navigation not changed: ${error instanceof Error ? error.message : "Could not save"}`);
}

export function navigationIcon(icon: string | undefined, fallback: string): string {
    return icon && getIcon(icon) ? icon : fallback;
}

class IconNameSuggest extends AbstractInputSuggest<string> {
    private readonly icons = getIconIds();
    constructor(app: App, input: HTMLInputElement, private readonly selected: (icon: string) => void) { super(app, input); }
    getSuggestions(query: string): string[] { return this.icons.filter(icon => icon.includes(query.toLowerCase())).slice(0, 50); }
    renderSuggestion(icon: string, el: HTMLElement): void {
        el.addClass("roam-navigation-icon-suggestion");
        setIcon(el.createSpan(), icon);
        el.createSpan({ text: icon });
    }
    selectSuggestion(icon: string): void { this.setValue(icon); this.selected(icon); this.close(); }
}

export class NavigationEntryModal extends Modal {
    private suggest: IconNameSuggest | null = null;
    constructor(private readonly plugin: DailyNoteViewPlugin, private readonly reference: NavigationReference | null = null, private readonly focusField: "name" | "icon" | "target" = "name") { super(plugin.app); }
    onOpen(): void {
        this.contentEl.addClass("roam-navigation-entry-editor");
        this.setTitle(this.reference ? "Edit navigation shortcut" : "Add navigation shortcut");
        let draft: NavigationDraft;
        try { draft = this.reference ? readNavigationDraft(navigationState(this.plugin), this.reference) : { type: "note", name: "", target: "", icon: "", visible: true }; }
        catch (error) { report(error); this.close(); return; }
        const original = this.reference ? JSON.stringify(draft) : null;
        if (!this.reference) new Setting(this.contentEl).setName("Type").addDropdown(dropdown => dropdown
            .addOption("note", "Note").addOption("journal", "Journal folder").addOption("web", "Website")
            .setValue(draft.type).onChange(value => { if (value === "note" || value === "journal" || value === "web") draft.type = value; }));
        new Setting(this.contentEl).setName("Display name").addText(text => {
            text.setValue(draft.name).onChange(value => { draft.name = value; });
            text.inputEl.setAttribute("aria-label", "Shortcut display name");
        });
        if (draft.type !== "builtin") new Setting(this.contentEl).setName("Target")
            .setDesc("Vault-relative folder or note link, or an HTTP(s) website. Editing this does not move files.")
            .addText(text => {
                text.setValue(draft.target).onChange(value => { draft.target = value; });
                text.inputEl.setAttribute("aria-label", "Shortcut target");
            });
        new Setting(this.contentEl).setName("Icon").setDesc("Search icon names. Leave empty to use the default.").addText(text => {
            text.setValue(draft.icon).onChange(value => { draft.icon = value; });
            text.inputEl.setAttribute("aria-label", "Shortcut icon");
            this.suggest = new IconNameSuggest(this.app, text.inputEl, icon => { draft.icon = icon; });
        });
        new Setting(this.contentEl).setName("Visible in navigation").addToggle(toggle => toggle.setValue(draft.visible).onChange(value => { draft.visible = value; }));
        const errorEl = this.contentEl.createDiv({ cls: "roam-navigation-validation", attr: { role: "alert" } });
        new Setting(this.contentEl).addButton(button => button.setButtonText("Cancel").onClick(() => this.close()))
            .addButton(button => button.setButtonText("Save shortcut").setCta().onClick(async () => {
                button.setDisabled(true);
                try {
                    draft.icon = draft.icon.trim();
                    if (draft.icon && !getIcon(draft.icon)) throw new Error("Choose a valid icon name or leave it empty.");
                    await updateNavigation(this.plugin, state => {
                        if (this.reference && JSON.stringify(readNavigationDraft(state, this.reference)) !== original) throw new Error("This shortcut changed while editing. Close and reopen the editor.");
                        return editNavigation(state, this.reference, draft, `shortcut-${crypto.randomUUID()}`);
                    });
                    this.close();
                } catch (error) { errorEl.setText(error instanceof Error ? error.message : "Could not save shortcut."); }
                finally { button.setDisabled(false); }
            }));
        const label = this.focusField === "name" ? "Shortcut display name" : this.focusField === "target" ? "Shortcut target" : "Shortcut icon";
        const input = this.contentEl.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
        if (input) {
            input.autofocus = true;
            queueMicrotask(() => { if (input.isConnected) input.focus(); });
        }
    }
    onClose(): void { this.suggest?.close(); this.suggest = null; this.contentEl.empty(); }
}

export function renderNavigationManager(container: HTMLElement, plugin: DailyNoteViewPlugin): void {
    const manager = container.createDiv({ cls: "roam-navigation-manager" });
    new Setting(manager).setName("Navigation shortcuts").setDesc("Edit names, icons, visibility, and order. Removing a shortcut never deletes its file or folder.")
        .addButton(button => button.setButtonText("Add shortcut").onClick(() => new NavigationEntryModal(plugin).open()));
    const state = navigationState(plugin);
    const refs: NavigationReference[] = [
        ...[...state.views, ...NAVIGATION_VIEW_IDS.filter(id => !state.views.includes(id))].map(id => ({ kind: "builtin" as const, id })),
        ...state.configuration.journals.map(item => ({ kind: "journal" as const, id: item.id })),
        ...state.configuration.links.map(item => ({ kind: "link" as const, id: item.id })),
    ];
    for (const ref of refs) {
        const draft = readNavigationDraft(state, ref);
        const group = ref.kind === "builtin" ? state.views : ref.kind === "journal" ? state.configuration.journals.map(item => item.id) : state.configuration.links.map(item => item.id);
        const index = group.findIndex(id => id === ref.id);
        const row = new Setting(manager).setName(draft.name).setDesc(ref.kind === "builtin" ? "Built-in view" : `${draft.type === "journal" ? "Journal" : draft.type === "web" ? "Website" : "Note"} · ${draft.target}`);
        row.settingEl.dataset.navigationItem = `${ref.kind}:${ref.id}`;
        const iconEl = row.nameEl.createSpan({ cls: "roam-navigation-manager-icon", attr: { "aria-hidden": "true" } });
        setIcon(iconEl, navigationIcon(draft.icon, "file-text"));
        row.nameEl.prepend(iconEl);
        row.addToggle(toggle => toggle.setValue(draft.visible).setTooltip("Show shortcut").onChange(async value => {
            try { await updateNavigation(plugin, current => editNavigation(current, ref, { ...readNavigationDraft(current, ref), visible: value }, "")); }
            catch (error) { toggle.setValue(!value); report(error); }
        }));
        row.addExtraButton(button => button.setIcon("pencil").setTooltip("Edit shortcut").onClick(() => new NavigationEntryModal(plugin, ref).open()));
        for (const direction of [-1, 1] as const) row.addExtraButton(button => button.setIcon(direction === -1 ? "arrow-up" : "arrow-down").setTooltip(direction === -1 ? "Move up" : "Move down")
            .setDisabled(index < 0 || index + direction < 0 || index + direction >= group.length)
            .onClick(async () => { try { await updateNavigation(plugin, current => moveNavigation(current, ref, direction)); } catch (error) { report(error); } }));
        if (ref.kind !== "builtin") row.addExtraButton(button => button.setIcon("trash-2").setTooltip("Remove shortcut").onClick(async () => {
            try { await updateNavigation(plugin, current => removeNavigation(current, ref)); } catch (error) { report(error); }
        }));
    }
}

export function showNavigationMenu(plugin: DailyNoteViewPlugin, event: MouseEvent | KeyboardEvent, ref?: NavigationReference): void {
    event.preventDefault();
    event.stopPropagation();
    // Obsidian's own menu preserves icons and keyboard behavior across desktop and mobile.
    const menu = new Menu().setUseNativeMenu(false);
    if (ref) {
        menu.addItem(item => item.setTitle("Rename shortcut").setIcon("pencil").onClick(() => new NavigationEntryModal(plugin, ref, "name").open()));
        menu.addItem(item => item.setTitle("Change icon").setIcon("image").onClick(() => new NavigationEntryModal(plugin, ref, "icon").open()));
        if (ref.kind !== "builtin") menu.addItem(item => item.setTitle("Edit target").setIcon("link").onClick(() => new NavigationEntryModal(plugin, ref, "target").open()));
        menu.addItem(item => item.setTitle(ref.kind === "builtin" ? "Hide shortcut" : "Remove shortcut").setIcon(ref.kind === "builtin" ? "eye-off" : "trash-2")
            .onClick(async () => { try { await updateNavigation(plugin, state => removeNavigation(state, ref)); } catch (error) { report(error); } }));
        menu.addSeparator();
    }
    menu.addItem(item => item.setTitle("Add shortcut").setIcon("plus").onClick(() => new NavigationEntryModal(plugin).open()));
    menu.addItem(item => item.setTitle("Manage navigation").setIcon("settings").onClick(() => openPluginSettings(plugin.app, plugin.manifest.id)));
    if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
    else if (event.currentTarget instanceof HTMLElement) {
        const rect = event.currentTarget.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
}

export function bindNavigationMenu(element: HTMLElement, plugin: DailyNoteViewPlugin, ref?: NavigationReference): void {
    element.addEventListener("contextmenu", event => showNavigationMenu(plugin, event, ref));
    element.addEventListener("keydown", event => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) showNavigationMenu(plugin, event, ref);
    });
}
