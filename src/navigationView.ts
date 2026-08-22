import { ItemView, setIcon, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { ROAM_NAVIGATION_VIEW_TYPE } from "./roamTypes";
import type { NavigationViewId } from "./roamTypes";

type NavigationEntry = {
    label: string;
    description: string;
    icon: string;
    onClick: (event: MouseEvent) => void | Promise<void>;
};

type BookmarkTarget = {
    type: "file" | "folder";
    path: string;
    label: string;
};

export class RoamNavigationView extends ItemView {
    private recentSectionEl: HTMLElement | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: DailyNoteViewPlugin
    ) {
        super(leaf);
    }

    getViewType(): string {
        return ROAM_NAVIGATION_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Roam navigation";
    }

    getIcon(): string {
        return "layout-dashboard";
    }

    async onOpen(): Promise<void> {
        this.render();
    }

    refreshRecentFiles(): void {
        this.renderRecentFiles(this.contentEl);
    }

    render(): void {
        const container = this.contentEl;
        container.empty();
        container.addClass("roam-nav-view");

        const header = container.createDiv({ cls: "roam-nav-header" });
        header.createDiv({ cls: "roam-nav-title", text: "Roam workspace" });

        const entries: Record<NavigationViewId, NavigationEntry> = {
            "journal-stream": {
                label: "Journal stream",
                description: "Open the Journal stream in the main area",
                icon: "calendar-range",
                onClick: () => this.plugin.openDefaultJournalView(),
            },
            "page-stream": {
                label: "Page stream",
                description: "Open the right sidebar page stream",
                icon: "panel-right-open",
                onClick: async () => {
                    await this.plugin.openPageStreamView();
                },
            },
            "list-heading": {
                label: "List heading",
                description: "Open the current page structure sidebar",
                icon: "list-tree",
                onClick: () => this.plugin.openListHeadingView(),
            },
        };

        const section = container.createDiv({ cls: "roam-nav-section" });
        section.createDiv({ cls: "roam-nav-section-title", text: "Views" });
        for (const id of this.plugin.settings.navigationViews) {
            this.renderEntry(section, entries[id]);
        }
        if (!this.plugin.settings.navigationViews.length) {
            section.createDiv({
                cls: "roam-nav-empty",
                text: "Choose shortcuts in plugin settings.",
            });
        }

        this.renderBookmarks(container);
        this.renderRecentFiles(container);
    }

    private renderEntry(parent: HTMLElement, entry: NavigationEntry): void {
        const button = parent.createEl("button", {
            cls: "roam-nav-entry",
            attr: {
                type: "button",
                "aria-label": entry.label,
            },
        });
        const icon = button.createSpan({ cls: "roam-nav-entry-icon" });
        setIcon(icon, entry.icon);
        button.createSpan({ cls: "roam-nav-entry-label", text: entry.label });
        button.addEventListener("click", (event) => {
            void entry.onClick(event);
        });
    }

    private renderRecentFiles(container: HTMLElement): void {
        const section = this.recentSectionEl?.isConnected
            ? this.recentSectionEl
            : container.createDiv({ cls: "roam-nav-section roam-nav-recent-section" });
        section.empty();
        this.recentSectionEl = section;
        section.createDiv({ cls: "roam-nav-section-title", text: "Recent files" });

        const files = this.getRecentMarkdownFiles();
        if (!files.length) {
            section.createDiv({
                cls: "roam-nav-empty",
                text: "Open a Markdown file to build recent files.",
            });
            return;
        }

        for (const file of files) {
            const button = section.createEl("button", {
                cls: "roam-nav-file roam-nav-recent-file",
                attr: {
                    type: "button",
                    "aria-label": `Open ${file.basename}`,
                },
            });
            button.setAttr("title", file.path);
            button.createSpan({ cls: "roam-nav-file-name", text: file.basename });
            button.addEventListener("click", (event) => {
                if (event.shiftKey) {
                    event.preventDefault();
                    void this.plugin.pushFileToPageStream(file, "navigation", undefined, {
                        active: false,
                        reveal: true,
                    });
                    return;
                }
                void this.app.workspace.getLeaf(false).openFile(file);
            });
        }
    }

    private getRecentMarkdownFiles(): TFile[] {
        const files: TFile[] = [];
        const seen = new Set<string>();

        const activeFile = this.app.workspace.getActiveFile();
        if (
            activeFile instanceof TFile &&
            activeFile.extension === "md" &&
            !seen.has(activeFile.path)
        ) {
            files.unshift(activeFile);
            seen.add(activeFile.path);
        }

        for (const path of this.plugin.settings.recentFiles) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile && file.extension === "md" && !seen.has(file.path)) {
                seen.add(file.path);
                files.push(file);
            }
        }

        return files;
    }

    private renderBookmarks(container: HTMLElement): void {
        const section = container.createDiv({ cls: "roam-nav-section" });
        section.createDiv({ cls: "roam-nav-section-title", text: "Bookmarks" });
        section.createDiv({
            cls: "roam-nav-empty roam-nav-bookmarks-loading",
            text: "Loading bookmarks...",
        });
        void this.renderBookmarksAsync(section);
    }

    private async renderBookmarksAsync(section: HTMLElement): Promise<void> {
        const loadingEl = section.querySelector(".roam-nav-bookmarks-loading");
        const targets = await this.getBookmarkTargets();
        if (!section.isConnected) return;
        loadingEl?.remove();

        if (!targets.length) {
            section.createDiv({
                cls: "roam-nav-empty",
                text: "No Markdown bookmarks found.",
            });
            return;
        }

        for (const target of targets) {
            const button = section.createEl("button", {
                cls: "roam-nav-file roam-nav-bookmark",
                attr: {
                    type: "button",
                    "aria-label": `Open bookmark ${target.label}`,
                },
            });
            button.setAttr("title", target.path);
            button.createSpan({ cls: "roam-nav-file-name", text: target.label });
            button.addEventListener("click", (event) => {
                void this.openBookmarkTarget(target, event);
            });
        }
    }

    private async getBookmarkTargets(): Promise<BookmarkTarget[]> {
        try {
            const text = await this.app.vault.adapter.read(
                `${this.app.vault.configDir}/bookmarks.json`
            );
            const parsed: unknown = JSON.parse(text);
            const items = isRecord(parsed) && Array.isArray(parsed.items)
                ? parsed.items
                : [];
            const targets = this.flattenBookmarkTargets(items);
            return targets;
        } catch {
            return [];
        }
    }

    private flattenBookmarkTargets(items: unknown[]): BookmarkTarget[] {
        const targets: BookmarkTarget[] = [];
        for (const item of items) {
            if (!isRecord(item)) continue;
            if (item.type === "group" && Array.isArray(item.items)) {
                targets.push(...this.flattenBookmarkTargets(item.items));
                continue;
            }

            if (typeof item.path !== "string") continue;
            const abstractFile = this.app.vault.getAbstractFileByPath(item.path);
            const label =
                typeof item.title === "string" && item.title.trim()
                    ? item.title.trim()
                    : item.path.split("/").pop() ?? item.path;
            if (item.type === "file" && abstractFile instanceof TFile) {
                if (abstractFile.extension !== "md") continue;
                targets.push({ type: "file", path: abstractFile.path, label });
            } else if (item.type === "folder" && abstractFile instanceof TFolder) {
                targets.push({ type: "folder", path: abstractFile.path, label });
            }
        }
        return targets;
    }

    private async openBookmarkTarget(
        target: BookmarkTarget,
        event: MouseEvent
    ): Promise<void> {
        const abstractFile = this.app.vault.getAbstractFileByPath(target.path);
        if (target.type === "file" && abstractFile instanceof TFile) {
            if (event.shiftKey) {
                event.preventDefault();
                await this.plugin.pushFileToPageStream(
                    abstractFile,
                    "navigation",
                    undefined,
                    { active: false, reveal: true }
                );
                return;
            }
            await this.app.workspace.getLeaf(false).openFile(abstractFile);
            return;
        }

        if (target.type === "folder" && abstractFile instanceof TFolder) {
            await this.plugin.openFolderView(abstractFile.path, "journalDate");
        }
    }

}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
