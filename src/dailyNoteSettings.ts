import DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { App, debounce, PluginSettingTab, Setting, Modal } from "obsidian";
import { DailyNoteSettings } from "./types/settings";
import { TimeRange } from "./types/time";
import { DEFAULT_SETTINGS } from "./utils/defaultSettings";
import { INITIAL_RANGE_OPTIONS } from "./utils/viewState";
import { NAVIGATION_VIEW_IDS, NavigationViewId } from "./roamTypes";

export type { DailyNoteSettings };
export { DEFAULT_SETTINGS };

export class DailyNoteSettingTab extends PluginSettingTab {
    plugin: DailyNoteViewPlugin;

    constructor(app: App, plugin: DailyNoteViewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    debounceApplySettingsUpdate = debounce(
        async () => {
            await this.plugin.saveSettings();
        },
        200,
        true
    );

    debounceDisplay = debounce(
        async () => {
            await this.display();
        },
        400,
        true
    );

    applySettingsUpdate() {
        this.plugin.notifySettingsChanged();
        this.debounceApplySettingsUpdate();
    }

    async display() {
        await this.plugin.loadSettings();

        const { containerEl } = this;
        const settings = this.plugin.settings;

        containerEl.toggleClass("daily-note-settings-container", true);

        containerEl.empty();

        new Setting(containerEl)
            .setName("Hide frontmatter")
            .setDesc("Hide frontmatter in daily notes")
            .addToggle((toggle) =>
                toggle
                    .setValue(settings.hideFrontmatter)
                    .onChange(async (value) => {
                        this.plugin.settings.hideFrontmatter = value;

                        document.body.classList.toggle(
                            "daily-notes-hide-frontmatter",
                            value
                        );
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Hide backlinks")
            .setDesc("Hide backlinks in daily notes")
            .addToggle((toggle) =>
                toggle
                    .setValue(settings.hideBacklinks)
                    .onChange(async (value) => {
                        this.plugin.settings.hideBacklinks = value;

                        document.body.classList.toggle(
                            "daily-notes-hide-backlinks",
                            value
                        );
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Create and open Journal Stream on startup")
            .setDesc(
                "Automatically open the Journal Stream when Obsidian starts"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(settings.createAndOpenOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.createAndOpenOnStartup = value;
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Journal folder")
            .setDesc("Folder used by the Journal Stream view")
            .addText((text) =>
                text
                    .setPlaceholder("Journal")
                    .setValue(settings.journalFolder)
                    .onChange((value) => {
                        this.plugin.settings.journalFolder =
                            value.trim() || "Journal";
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Default open mode")
            .setDesc("Open the configured Journal folder or the Daily Notes list")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("journal-folder", "Journal folder")
                    .addOption("daily", "Daily Notes")
                    .setValue(settings.defaultOpenMode)
                    .onChange((value: "journal-folder" | "daily") => {
                        this.plugin.settings.defaultOpenMode = value;
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Initial range")
            .setDesc("Default date range used when opening the Journal Stream")
            .addDropdown((dropdown) =>
                INITIAL_RANGE_OPTIONS.reduce(
                    (currentDropdown, option) =>
                        currentDropdown.addOption(option.value, option.label),
                    dropdown
                )
                    .setValue(settings.initialRange)
                    .onChange((value: TimeRange) => {
                        this.plugin.settings.initialRange = value;
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Enable Markdown export")
            .setDesc("Show the copy button for exporting the current Journal window")
            .addToggle((toggle) =>
                toggle
                    .setValue(settings.enableExportMarkdown)
                    .onChange(async (value) => {
                        this.plugin.settings.enableExportMarkdown = value;
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl)
            .setName("Use arrow up/down key to navigate between notes")
            .addToggle((toggle) =>
                toggle
                    .setValue(settings.useArrowUpOrDownToNavigate)
                    .onChange(async (value) => {
                        this.plugin.settings.useArrowUpOrDownToNavigate = value;
                        this.applySettingsUpdate();
                    })
            );

        new Setting(containerEl).setName("Navigation views").setHeading();

        const navigationViewLabels: Record<NavigationViewId, [string, string]> = {
            "journal-stream": [
                "Journal stream",
                "Show the Journal stream shortcut in Roam navigation.",
            ],
            "page-stream": [
                "Page stream",
                "Show the right sidebar Page stream shortcut.",
            ],
            "list-heading": [
                "List heading",
                "Show the current page structure shortcut.",
            ],
        };

        for (const id of NAVIGATION_VIEW_IDS) {
            const [name, description] = navigationViewLabels[id];
            new Setting(containerEl)
                .setName(name)
                .setDesc(description)
                .addToggle((toggle) =>
                    toggle
                        .setValue(settings.navigationViews.includes(id))
                        .onChange((value) => {
                            const selected = new Set(settings.navigationViews);
                            if (value) selected.add(id);
                            else selected.delete(id);
                            settings.navigationViews = NAVIGATION_VIEW_IDS.filter(
                                (viewId) => selected.has(viewId)
                            );
                            this.applySettingsUpdate();
                        })
                );
        }

        new Setting(containerEl).setName("Saved presets").setHeading();

        const presetContainer = containerEl.createDiv("preset-container");

        // Display existing presets
        if (settings.preset.length === 0) {
            presetContainer.createEl("p", {
                text: "No presets saved yet. Select a folder or tag in Roam In Ob to create a preset.",
                cls: "no-presets-message",
            });
        } else {
            settings.preset.forEach((preset, index) => {
                new Setting(containerEl)
                    .setName(
                        preset.type === "folder"
                            ? "Focus on Folder: "
                            : "Focus on Tag: "
                    )
                    .setDesc(preset.target)
                    .addButton((button) => {
                        button.setIcon("trash");
                        button.onClick(() => {
                            settings.preset.splice(index, 1);
                            this.applySettingsUpdate();
                            this.debounceDisplay();
                        });
                    });
            });
        }

        // Add button to add a new preset
        new Setting(containerEl)
            .setName("Add new preset")
            .setDesc("Add a new folder or tag preset")
            .addButton((button) => {
                button
                    .setButtonText("Add Preset")
                    .setCta()
                    .onClick(() => {
                        const modal = new AddPresetModal(
                            this.app,
                            (type, target) => {
                                // Check if this preset already exists
                                const existingPresetIndex =
                                    settings.preset.findIndex(
                                        (p) =>
                                            p.type === type &&
                                            p.target === target
                                    );

                                // If it doesn't exist, add it
                                if (existingPresetIndex === -1) {
                                    settings.preset.push({
                                        type,
                                        target,
                                    });
                                    this.applySettingsUpdate();
                                    this.debounceDisplay();
                                }
                            }
                        );
                        modal.open();
                    });
            });
    }
}

// Add a new modal for adding presets
class AddPresetModal extends Modal {
    saveCallback: (type: "folder" | "tag", target: string) => void;
    type: "folder" | "tag" = "folder";
    targetInput: HTMLInputElement;

    constructor(
        app: App,
        saveCallback: (type: "folder" | "tag", target: string) => void
    ) {
        super(app);
        this.saveCallback = saveCallback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Add New Preset" });

        const form = contentEl.createEl("form");
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            this.save();
        });

        // Type selection
        const typeSetting = form.createDiv();
        typeSetting.addClass("setting-item");

        const typeSettingInfo = typeSetting.createDiv();
        typeSettingInfo.addClass("setting-item-info");
        typeSettingInfo.createEl("div", {
            text: "Preset Type",
            cls: "setting-item-name",
        });

        const typeSettingControl = typeSetting.createDiv();
        typeSettingControl.addClass("setting-item-control");

        // Radio buttons for type selection
        const folderRadio = typeSettingControl.createEl("input", {
            type: "radio",
            attr: {
                name: "preset-type",
                id: "preset-type-folder",
                value: "folder",
                checked: true,
            },
        });
        typeSettingControl.createEl("label", {
            text: "Folder",
            attr: {
                for: "preset-type-folder",
            },
        });

        const tagRadio = typeSettingControl.createEl("input", {
            type: "radio",
            attr: {
                name: "preset-type",
                id: "preset-type-tag",
                value: "tag",
            },
        });
        typeSettingControl.createEl("label", {
            text: "Tag",
            attr: {
                for: "preset-type-tag",
            },
        });

        folderRadio.addEventListener("change", () => {
            if (folderRadio.checked) {
                this.type = "folder";
            }
        });

        tagRadio.addEventListener("change", () => {
            if (tagRadio.checked) {
                this.type = "tag";
            }
        });

        // Target input
        const targetSetting = form.createDiv();
        targetSetting.addClass("setting-item");

        const targetSettingInfo = targetSetting.createDiv();
        targetSettingInfo.addClass("setting-item-info");

        targetSettingInfo.createEl("div", {
            text: "Target",
            cls: "setting-item-name",
        });

        targetSettingInfo.createEl("div", {
            text: "Enter the folder path or tag name",
            cls: "setting-item-description",
        });

        const targetSettingControl = targetSetting.createDiv();
        targetSettingControl.addClass("setting-item-control");

        this.targetInput = targetSettingControl.createEl("input", {
            type: "text",
            value: "",
            placeholder: "Enter folder path or tag name",
        });
        this.targetInput.addClass("target-input");

        const footerEl = contentEl.createDiv();
        footerEl.addClass("modal-button-container");

        footerEl
            .createEl("button", {
                text: "Cancel",
                cls: "mod-warning",
                attr: {
                    type: "button",
                },
            })
            .addEventListener("click", () => {
                this.close();
            });

        footerEl
            .createEl("button", {
                text: "Save",
                cls: "mod-cta",
                attr: {
                    type: "submit",
                },
            })
            .addEventListener("click", (e) => {
                e.preventDefault();
                this.save();
            });
    }

    save() {
        const target = this.targetInput.value.trim();
        if (target) {
            this.saveCallback(this.type, target);
            this.close();
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
