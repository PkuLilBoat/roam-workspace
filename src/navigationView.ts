import {
    ItemView,
    MarkdownView,
    normalizePath,
    Notice,
    parseLinktext,
    setIcon,
    TFile,
    TFolder,
    WorkspaceLeaf,
} from "obsidian";
import { MetadataMenuAdapter } from "./integrations/metadataMenuAdapter";
import { createContentSignature } from "./integrations/metadataMenuContracts";
import { SuperchargedLinksAdapter } from "./integrations/superchargedLinksAdapter";
import {
    setNavigationSectionCollapsed,
    type NavigationSectionId,
} from "./navigation/sectionState";
import {
    buildRecentFileClassOptions,
    canFilterRecentFileClasses,
    filterRecentFileClassAssignments,
    getRecentFileClassValue,
    toggleRecentFileClassFilter,
    type RecentFileClassAssignment,
    type RecentFileClassOption,
} from "./navigation/recentFileClassFilter";
import type { RecentTaskBlockRecord } from "./navigation/recentTaskBlocks";
import {
    buildOptions,
    buildPropertyOptions,
    matchesRecentFileMetadata,
    matchesRecentTaskMetadata,
    normalizeFileMetadata,
    parseRootTaskMetadata,
    propertyValueLabel,
    type FilterOption,
    type RecentTaskMetadata,
} from "./navigation/recentMultiFilter";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import { ROAM_NAVIGATION_VIEW_TYPE } from "./roamTypes";
import type { NavigationViewId } from "./roamTypes";
import { buildBookmarkTree, type BookmarkNode, type BookmarkTarget } from "./navigation/bookmarkTree";
import type { NavigationLink } from "./navigation/configuration";
import { builtinAppearance } from "./navigation/management";
import { bindNavigationMenu, navigationIcon } from "./navigation/managementUi";

const INITIAL_ENTRY_BATCH = 40;
const NEXT_ENTRY_BATCH = 80;
const BOOKMARK_POLL_INTERVAL_MS = 2_000;

type NavigationEntry = {
    label: string;
    description: string;
    icon: string;
    onClick: (event: MouseEvent) => void | Promise<void>;
};

type BookmarkSnapshot = {
    signature: string;
    nodes: BookmarkNode[];
};

type ScheduledFrame = {
    ownerWindow: Window;
    id: number;
};

type FileDecorationElements = {
    iconButton: HTMLButtonElement;
    iconContainer: HTMLSpanElement;
    label: HTMLSpanElement;
};

type CollapsibleSection = {
    actions: HTMLElement;
    body: HTMLElement;
};

export class RoamNavigationView extends ItemView {
    private readonly fileDecorations = new Map<string, Set<FileDecorationElements>>();
    private readonly metadataMenu: MetadataMenuAdapter;
    private readonly scheduledFrames = new Set<number>();
    private readonly superchargedLinks: SuperchargedLinksAdapter;
    private readonly propertyFrames = new Set<ScheduledFrame>();
    private bookmarkPollInFlight = false;
    private bookmarkRenderGeneration = 0;
    private bookmarkSectionEl: HTMLElement | null = null;
    private bookmarkSignature: string | null = null;
    private eventsRegistered = false;
    private metadataCapabilitySignature = "";
    private readonly recentFileClassByPath = new Map<string, string | null>();
    private recentFileClassOptions: RecentFileClassOption[] = [];
    private recentFilterBadgeEl: HTMLElement | null = null;
    private recentFilterButtonEl: HTMLButtonElement | null = null;
    private recentFilterPopoverEl: HTMLElement | null = null;
    private recentRenderGeneration = 0;
    private recentSectionEl: HTMLElement | null = null;
    private recentTaskSectionEl: HTMLElement | null = null;
    private recentTaskFilterButtonEl: HTMLButtonElement | null = null;
    private recentTaskFilterBadgeEl: HTMLElement | null = null;
    private recentTaskFilterPopoverEl: HTMLElement | null = null;
    private propertiesOpenGeneration = 0;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: DailyNoteViewPlugin
    ) {
        super(leaf);
        this.metadataMenu = new MetadataMenuAdapter(this.app);
        this.superchargedLinks = new SuperchargedLinksAdapter(this.app);
    }

    getViewType(): string {
        return ROAM_NAVIGATION_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Roam workspace";
    }

    getIcon(): string {
        return "layout-dashboard";
    }

    async onOpen(): Promise<void> {
        await this.superchargedLinks.initialize();
        this.registerNavigationEvents();
        const ownerWindow = this.contentEl.ownerDocument.defaultView;
        if (ownerWindow) {
            this.registerInterval(
                ownerWindow.setInterval(() => {
                    this.refreshMetadataCapabilityIfChanged();
                    void this.pollBookmarks();
                }, BOOKMARK_POLL_INTERVAL_MS)
            );
        }
        this.metadataCapabilitySignature = this.metadataMenu.getCapabilitySignature();
        this.render();
    }

    async onClose(): Promise<void> {
        this.propertiesOpenGeneration += 1;
        this.cancelPropertyFrames();
        this.cancelScheduledFrames();
        this.fileDecorations.clear();
        this.bookmarkSectionEl = null;
        this.closeRecentFilesTransientUi();
        this.closeRecentTasksTransientUi();
        this.recentFilterBadgeEl = null;
        this.recentFilterButtonEl = null;
        this.recentSectionEl = null;
        this.recentTaskSectionEl = null;
        this.recentTaskFilterButtonEl = null;
        this.recentTaskFilterBadgeEl = null;
    }

    refreshRecentFiles(): void {
        this.renderRecentFiles(this.contentEl);
    }

    refreshRecentTasks(): void {
        if (!this.plugin.settings.showRecentTasks) return;
        if (!this.recentTaskSectionEl?.isConnected) {
            this.render();
            return;
        }
        this.populateRecentTasks(this.recentTaskSectionEl);
    }

    promoteRecentFile(file: TFile): void {
        const body = this.recentSectionEl;
        if (!body?.isConnected || file.extension !== "md") return;

        const rows = Array.from(
            body.querySelectorAll<HTMLElement>(".roam-nav-recent-file")
        );
        const existing = rows.find((row) => row.dataset.path === file.path);
        if (existing !== rows[0]) {
            const anchor = rows[0] ?? body.querySelector<HTMLElement>(".roam-nav-empty");
            if (existing) {
                body.insertBefore(existing, anchor);
            } else {
                body.querySelector(".roam-nav-empty")?.remove();
                const row = this.renderFileRow(
                    body,
                    file.basename,
                    file.path,
                    file,
                    false
                );
                if (anchor?.isConnected) body.insertBefore(row, anchor);
            }
        }
        this.refreshRecentFileClass(file);
    }

    render(): void {
        this.bookmarkRenderGeneration += 1;
        this.recentRenderGeneration += 1;
        this.cancelScheduledFrames();
        this.fileDecorations.clear();
        this.bookmarkSectionEl = null;
        this.closeRecentFilesTransientUi();
        this.closeRecentTasksTransientUi();
        this.recentFilterBadgeEl = null;
        this.recentFilterButtonEl = null;
        this.recentSectionEl = null;
        this.recentTaskSectionEl = null;
        this.recentTaskFilterButtonEl = null;
        this.recentTaskFilterBadgeEl = null;

        const container = this.contentEl;
        container.empty();
        container.addClass("roam-nav-view");

        const header = container.createDiv({ cls: "roam-nav-header" });
        const titleIcon = header.createSpan({
            cls: "roam-nav-title-icon",
            attr: { "aria-hidden": "true" },
        });
        setIcon(titleIcon, "layout-dashboard");
        header.createDiv({ cls: "roam-nav-title", text: "Roam workspace" });

        const entries: Record<NavigationViewId, NavigationEntry> = {
            "journal-stream": {
                label: this.plugin.settings.navigationConfiguration.journalName,
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
        section.createDiv({ cls: "roam-nav-section-title", text: "Navigation" });
        bindNavigationMenu(section, this.plugin);
        bindNavigationMenu(header, this.plugin);
        for (const id of this.plugin.settings.navigationViews) {
            const appearance = builtinAppearance(this.plugin.settings.navigationConfiguration, id);
            const entry = { ...entries[id], label: appearance.name, icon: navigationIcon(appearance.icon, entries[id].icon) };
            if (id === "journal-stream") this.renderJournalShortcuts(section, entry);
            else bindNavigationMenu(this.renderEntry(section, entry), this.plugin, { kind: "builtin", id });
        }
        for (const link of this.plugin.settings.navigationConfiguration.links.filter(link => !link.hidden)) {
            const button = this.renderEntry(section, {
                label: link.name,
                description: link.target,
                icon: navigationIcon(link.icon, link.type === "web" ? "external-link" : "file-text"),
                onClick: () => this.openConfiguredLink(link),
            });
            bindNavigationMenu(button, this.plugin, { kind: "link", id: link.id });
            button.dataset.shortcutId = link.id;
            button.dataset.shortcutType = link.type;
        }
        if (!this.plugin.settings.navigationViews.length && !this.plugin.settings.navigationConfiguration.links.some(link => !link.hidden)) {
            section.createDiv({
                cls: "roam-nav-empty",
                text: "Choose shortcuts in plugin settings.",
            });
        }

        this.renderBookmarks(container);
        this.renderRecentFiles(container);
        this.renderRecentTasks(container);
    }

    private registerNavigationEvents(): void {
        if (this.eventsRegistered) return;
        this.eventsRegistered = true;

        const unsubscribeFromFileClassIndex =
            this.metadataMenu.subscribeToFileClassIndex(() => {
                this.refreshAllFileDecorations();
                this.refreshRecentFileClassCapability();
            });
        if (unsubscribeFromFileClassIndex) {
            this.register(unsubscribeFromFileClassIndex);
        }

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                this.refreshFileDecorations(file.path);
                this.refreshRecentFileClass(file);
                if (this.plugin.settings.recentTaskBlocks.some((record) => record.path === file.path)) {
                    this.refreshRecentTasks();
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                this.refreshMetadataCapabilityIfChanged();
                void this.reloadSuperchargedLinks();
            })
        );
        this.registerDomEvent(
            this.contentEl.ownerDocument,
            "pointerdown",
            (event) => {
                const path = event.composedPath();
                if (
                    this.recentFilterPopoverEl &&
                    !path.includes(this.recentFilterPopoverEl) &&
                    !(
                        this.recentFilterButtonEl &&
                        path.includes(this.recentFilterButtonEl)
                    )
                ) {
                    this.closeRecentFilesTransientUi();
                }
                if (
                    this.recentTaskFilterPopoverEl &&
                    !path.includes(this.recentTaskFilterPopoverEl) &&
                    !(this.recentTaskFilterButtonEl && path.includes(this.recentTaskFilterButtonEl))
                ) {
                    this.closeRecentTasksTransientUi();
                }
            }
        );
        this.registerDomEvent(this.contentEl.ownerDocument, "keydown", (event) => {
            if (event.key !== "Escape") return;
            if (!this.recentFilterPopoverEl && !this.recentTaskFilterPopoverEl) return;
            event.preventDefault();
            if (this.recentFilterPopoverEl) {
                this.closeRecentFilesTransientUi();
                this.recentFilterButtonEl?.focus();
            } else {
                this.closeRecentTasksTransientUi();
                this.recentTaskFilterButtonEl?.focus();
            }
        });
        this.registerEvent(this.app.vault.on("rename", () => this.render()));
        this.registerEvent(this.app.vault.on("delete", () => this.render()));
    }

    private renderEntry(parent: HTMLElement, entry: NavigationEntry): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "roam-nav-entry",
            attr: {
                type: "button",
                "aria-label": entry.label,
                title: entry.description,
            },
        });
        const icon = button.createSpan({ cls: "roam-nav-entry-icon" });
        setIcon(icon, entry.icon);
        button.createSpan({ cls: "roam-nav-entry-label", text: entry.label });
        button.addEventListener("click", (event) => {
            void Promise.resolve().then(() => entry.onClick(event)).catch((error: unknown) => {
                new Notice(`Could not open ${entry.label}: ${error instanceof Error ? error.message : "Unknown error"}`);
            });
        });
        return button;
    }

    private renderJournalShortcuts(parent: HTMLElement, entry: NavigationEntry): void {
        const journals = this.plugin.settings.navigationConfiguration.journals.filter(journal => !journal.hidden);
        const row = parent.createDiv({ cls: "roam-nav-journal-row" });
        const primary = this.renderEntry(row, entry);
        primary.dataset.journalDefault = "true";
        bindNavigationMenu(primary, this.plugin, { kind: "builtin", id: "journal-stream" });
        if (!journals.length) return;
        const toggle = row.createEl("button", {
            cls: "roam-nav-section-toggle roam-nav-journal-toggle",
            attr: { type: "button" },
        });
        const children = parent.createDiv({ cls: "roam-nav-journal-children" });
        for (const journal of journals) {
            const button = this.renderEntry(children, {
                label: journal.name,
                description: journal.folder,
                icon: navigationIcon(journal.icon, "calendar-range"),
                onClick: async () => {
                    const folder = this.app.vault.getAbstractFileByPath(journal.folder);
                    if (!(folder instanceof TFolder)) {
                        new Notice(`Journal folder not found: ${journal.folder}`);
                        return;
                    }
                    await this.plugin.openFolderView(folder.path, "journalDate");
                },
            });
            bindNavigationMenu(button, this.plugin, { kind: "journal", id: journal.id });
            button.dataset.journalId = journal.id;
        }
        const updateState = () => {
            const collapsed = this.plugin.settings.additionalJournalsCollapsed;
            children.hidden = collapsed;
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} additional journals`);
            toggle.setAttribute("title", `${collapsed ? "Expand" : "Collapse"} additional journals`);
            toggle.empty();
            setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
        };
        toggle.addEventListener("click", () => {
            this.plugin.settings.additionalJournalsCollapsed = !this.plugin.settings.additionalJournalsCollapsed;
            updateState();
            void this.plugin.saveSettings();
        });
        updateState();
    }

    private async openConfiguredLink(link: NavigationLink): Promise<void> {
        if (link.type === "web") {
            window.open(link.target, "_blank", "noopener,noreferrer");
            return;
        }
        const target = link.target.replace(/^\[\[|\]\]$/g, "").split("|")[0];
        const { path } = parseLinktext(target);
        const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
        if (!(file instanceof TFile) || file.extension !== "md") {
            new Notice(`Note not found: ${link.target}`);
            return;
        }
        await this.app.workspace.openLinkText(target, "", false);
    }

    private renderRecentFiles(container: HTMLElement): void {
        this.recentRenderGeneration += 1;
        const generation = this.recentRenderGeneration;
        let body = this.recentSectionEl?.isConnected
            ? this.recentSectionEl
            : null;
        if (!body) {
            const section = this.createCollapsibleSection(
                container,
                "recentFiles",
                "Recent files",
                "roam-nav-recent-section"
            );
            body = section.body;
            this.createRecentFileClassFilterButton(section.actions);
        }
        const currentBody = body;
        this.unregisterFileDecorationsWithin(currentBody);
        currentBody.empty();
        this.recentSectionEl = currentBody;

        const files = this.getRecentMarkdownFiles();
        this.refreshRecentFileClassAssignments(files);
        if (!files.length) {
            if (this.recentFileFilterCount() === 0) {
                currentBody.createDiv({
                    cls: "roam-nav-empty",
                    text: "Edit a Markdown file to build recent files.",
                });
            }
            this.applyRecentFileClassFilter();
            return;
        }

        this.renderInBatches(
            currentBody,
            files,
            () =>
                generation === this.recentRenderGeneration &&
                currentBody.isConnected,
            (file) => {
                const row = this.renderFileRow(
                    currentBody,
                    file.basename,
                    file.path,
                    file,
                    false
                );
                this.decorateRecentFileClassRow(row, file.path);
            }
        );
        this.applyRecentFileClassFilter();
    }

    private getRecentMarkdownFiles(): TFile[] {
        const files: TFile[] = [];
        const seen = new Set<string>();
        for (const path of this.plugin.settings.recentFiles) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile && file.extension === "md" && !seen.has(file.path)) {
                seen.add(file.path);
                files.push(file);
            }
        }
        return files;
    }

    private renderRecentTasks(container: HTMLElement): void {
        if (!this.plugin.settings.showRecentTasks) return;
        const { actions, body } = this.createCollapsibleSection(
            container,
            "recentTasks",
            "Recent tasks",
            "roam-nav-recent-tasks-section"
        );
        this.recentTaskSectionEl = body;
        this.createRecentTaskFilterButton(actions);
        this.populateRecentTasks(body);
    }

    private populateRecentTasks(body: HTMLElement): void {
        body.empty();
        const records = this.plugin.getRecentTaskBlocks();
        if (!records.length) {
            const empty = body.createDiv({ cls: "roam-nav-empty" });
            empty.createDiv({ text: this.recentTaskFilterCount() > 0
                ? "No recent tasks match this filter."
                : "Edit an unfinished top-level task to build recent tasks." });
            if (this.recentTaskFilterCount() > 0) {
                const clear = empty.createEl("button", { text: "Clear filters", attr: { type: "button" } });
                clear.addEventListener("click", () => this.clearRecentTaskFilters());
            }
            this.updateRecentTaskFilterControl();
            if (this.recentTaskFilterPopoverEl) this.renderRecentTaskFilterPopover();
            return;
        }
        const metadata = records.map((record) => this.getRecentTaskMetadata(record));
        let visibleCount = 0;
        for (const [index, record] of records.entries()) {
            const row = this.renderRecentTaskRow(body, record);
            row.hidden = !matchesRecentTaskMetadata(
                metadata[index],
                this.plugin.settings.recentTaskTagsFilter,
                this.plugin.settings.recentTaskPagesFilter
            );
            if (!row.hidden) visibleCount += 1;
        }
        if (visibleCount === 0 && this.recentTaskFilterCount() > 0) {
            const empty = body.createDiv({ cls: "roam-nav-empty roam-nav-filter-empty" });
            empty.createDiv({ text: "No recent tasks match this filter." });
            const clear = empty.createEl("button", { text: "Clear filters", attr: { type: "button" } });
            clear.addEventListener("click", () => this.clearRecentTaskFilters());
        }
        this.updateRecentTaskFilterControl();
        if (this.recentTaskFilterPopoverEl) this.renderRecentTaskFilterPopover();
    }

    private renderRecentTaskRow(
        body: HTMLElement,
        record: RecentTaskBlockRecord
    ): HTMLElement {
        const row = body.createDiv({
            cls: "roam-nav-task",
            attr: {
                "data-path": record.path,
                "data-line": String(record.lineHint),
            },
        });
        const button = row.createEl("button", {
            cls: "roam-nav-task-main",
            attr: {
                type: "button",
                "aria-label": `Open task ${record.normalizedRootText}`,
                title: `${record.path}:${record.lineHint + 1}`,
            },
        });
        const icon = button.createSpan({
            cls: "roam-nav-task-icon",
            attr: { "aria-hidden": "true" },
        });
        setIcon(icon, "square");
        const copy = button.createSpan({ cls: "roam-nav-task-copy" });
        copy.createSpan({
            cls: "roam-nav-task-summary",
            text: record.normalizedRootText,
        });
        copy.createSpan({
            cls: "roam-nav-task-source",
            text: `${record.path}:${record.lineHint + 1}`,
        });
        button.addEventListener("click", () => {
            void this.plugin.openRecentTask(record);
        });
        return row;
    }

    private renderBookmarks(container: HTMLElement): void {
        this.bookmarkRenderGeneration += 1;
        const generation = this.bookmarkRenderGeneration;
        const { body } = this.createCollapsibleSection(
            container,
            "bookmarks",
            "Bookmarks",
            "roam-nav-bookmarks-section"
        );
        this.bookmarkSectionEl = body;
        this.prepareBookmarkSection(body);
        void this.renderBookmarksAsync(body, generation);
    }

    private prepareBookmarkSection(body: HTMLElement): void {
        this.unregisterFileDecorationsWithin(body);
        body.empty();
        body.createDiv({
            cls: "roam-nav-empty roam-nav-bookmarks-loading",
            text: "Loading bookmarks...",
        });
    }

    private async renderBookmarksAsync(
        body: HTMLElement,
        generation: number,
        suppliedSnapshot?: BookmarkSnapshot
    ): Promise<void> {
        const snapshot = suppliedSnapshot ?? (await this.getBookmarkSnapshot());
        if (!body.isConnected || generation !== this.bookmarkRenderGeneration) return;
        this.bookmarkSignature = snapshot.signature;
        body.querySelector(".roam-nav-bookmarks-loading")?.remove();

        if (!snapshot.nodes.length) {
            body.createDiv({ cls: "roam-nav-empty", text: "No Markdown bookmarks found." });
            return;
        }

        this.renderBookmarkNodes(body, snapshot.nodes, generation);
    }

    private renderBookmarkNodes(body: HTMLElement, nodes: BookmarkNode[], generation: number): void {
        this.renderInBatches(
            body,
            nodes,
            () => generation === this.bookmarkRenderGeneration && body.isConnected,
            (target) => {
                if (target.type === "group") {
                    this.renderBookmarkGroup(body, target, generation);
                    return;
                }
                const abstractFile = this.app.vault.getAbstractFileByPath(target.path);
                const file = abstractFile instanceof TFile ? abstractFile : null;
                this.renderFileRow(body, target.label, target.path, file, true, target);
            }
        );
    }

    private renderBookmarkGroup(parent: HTMLElement, group: Extract<BookmarkNode, { type: "group" }>, generation: number): void {
        const container = parent.createDiv({ cls: "roam-nav-bookmark-group", attr: { "data-bookmark-group": group.key } });
        const toggle = container.createEl("button", { cls: "roam-nav-bookmark-group-toggle", attr: { type: "button" } });
        const icon = toggle.createSpan({ attr: { "aria-hidden": "true" } });
        toggle.createSpan({ cls: "roam-nav-entry-label", text: group.label });
        const children = container.createDiv({ cls: "roam-nav-bookmark-children" });
        let rendered = false;
        const updateState = () => {
            const collapsed = this.plugin.settings.bookmarkGroupCollapsed[group.key] === true;
            children.hidden = collapsed;
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.label} bookmark group`);
            icon.empty();
            setIcon(icon, collapsed ? "chevron-right" : "chevron-down");
            if (!collapsed && !rendered) {
                rendered = true;
                if (group.children.length) this.renderBookmarkNodes(children, group.children, generation);
                else children.createDiv({ cls: "roam-nav-empty", text: "No Markdown bookmarks in this group." });
            }
        };
        toggle.addEventListener("click", () => {
            this.plugin.settings.bookmarkGroupCollapsed[group.key] = !(this.plugin.settings.bookmarkGroupCollapsed[group.key] === true);
            updateState();
            void this.plugin.saveSettings();
        });
        updateState();
    }

    private createCollapsibleSection(
        container: HTMLElement,
        id: NavigationSectionId,
        label: string,
        sectionClass: string
    ): CollapsibleSection {
        const section = container.createDiv({
            cls: `roam-nav-section roam-nav-collapsible-section ${sectionClass}`,
            attr: { "data-section-id": id },
        });
        const header = section.createDiv({ cls: "roam-nav-section-header" });
        header.createDiv({ cls: "roam-nav-section-title", text: label });
        const actions = header.createDiv({ cls: "roam-nav-section-actions" });
        const toggle = header.createEl("button", {
            cls: "roam-nav-section-toggle",
            attr: { type: "button" },
        });
        const toggleIcon = toggle.createSpan({ attr: { "aria-hidden": "true" } });
        const body = section.createDiv({
            cls: "roam-nav-section-body",
            attr: { "data-section-body": id },
        });

        const updateState = () => {
            const collapsed = this.plugin.settings.navigationSectionCollapsed[id];
            body.hidden = collapsed;
            toggle.setAttribute("aria-expanded", String(!collapsed));
            toggle.setAttribute(
                "aria-label",
                `${collapsed ? "Expand" : "Collapse"} ${label} section`
            );
            toggle.setAttribute(
                "title",
                `${collapsed ? "Expand" : "Collapse"} ${label}`
            );
            toggleIcon.empty();
            setIcon(toggleIcon, collapsed ? "chevron-right" : "chevron-down");
        };

        toggle.addEventListener("click", () => {
            const collapsed = !this.plugin.settings.navigationSectionCollapsed[id];
            this.plugin.settings.navigationSectionCollapsed =
                setNavigationSectionCollapsed(
                    this.plugin.settings.navigationSectionCollapsed,
                    id,
                    collapsed
                );
            if (collapsed && id === "recentFiles") {
                this.closeRecentFilesTransientUi();
            }
            if (collapsed && id === "recentTasks") this.closeRecentTasksTransientUi();
            updateState();
            void this.plugin.saveSettings();
        });
        updateState();
        return { actions, body };
    }

    private closeRecentFilesTransientUi(): void {
        this.recentFilterPopoverEl?.remove();
        this.recentFilterPopoverEl = null;
        this.recentFilterButtonEl?.setAttribute("aria-expanded", "false");
    }

    private createRecentFileClassFilterButton(actions: HTMLElement): void {
        const button = actions.createEl("button", {
            cls: "roam-nav-fileclass-filter",
            attr: {
                type: "button",
                "aria-label": "Filter recent files",
                "aria-expanded": "false",
                title: "Filter recent files",
            },
        });
        const icon = button.createSpan({
            cls: "roam-nav-fileclass-filter-icon",
            attr: { "aria-hidden": "true" },
        });
        setIcon(icon, "list-filter");
        this.recentFilterBadgeEl = button.createSpan({
            cls: "roam-nav-fileclass-filter-badge",
            attr: { "aria-hidden": "true" },
        });
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (this.recentFilterPopoverEl) {
                this.closeRecentFilesTransientUi();
            } else {
                this.renderRecentFileClassPopover();
            }
        });
        this.recentFilterButtonEl = button;
        this.updateRecentFileClassFilterControl();
    }

    private refreshRecentFileClassAssignments(files: readonly TFile[]): void {
        const paths = new Set(files.map((file) => file.path));
        for (const path of this.recentFileClassByPath.keys()) {
            if (!paths.has(path)) this.recentFileClassByPath.delete(path);
        }

        if (!this.metadataMenu.isFileClassCapabilityReady()) {
            this.recentFileClassByPath.clear();
            this.recentFileClassOptions = [];
            return;
        }

        for (const file of files) {
            const resolution = this.metadataMenu.resolveFileClassIcon(file);
            this.recentFileClassByPath.set(file.path, resolution.fileClassName);
        }
        this.recentFileClassOptions = buildRecentFileClassOptions(
            this.getRecentFileClassAssignments(files)
        );
    }

    private refreshRecentFileClass(file: TFile): void {
        if (
            file.extension !== "md" ||
            !this.plugin.settings.recentFiles.includes(file.path) ||
            !this.recentSectionEl?.isConnected
        ) {
            return;
        }

        if (this.metadataMenu.isFileClassCapabilityReady()) {
            const resolution = this.metadataMenu.resolveFileClassIcon(file);
            this.recentFileClassByPath.set(file.path, resolution.fileClassName);
        } else {
            this.recentFileClassByPath.delete(file.path);
        }
        const row = Array.from(
            this.recentSectionEl.querySelectorAll<HTMLElement>(
                ".roam-nav-recent-file"
            )
        ).find((candidate) => candidate.dataset.path === file.path);
        if (row) this.decorateRecentFileClassRow(row, file.path);
        this.applyRecentFileClassFilter();
    }

    private refreshRecentFileClassCapability(): void {
        if (!this.recentSectionEl?.isConnected) return;
        const files = this.getRecentMarkdownFiles();
        this.refreshRecentFileClassAssignments(files);
        for (const row of Array.from(
            this.recentSectionEl.querySelectorAll<HTMLElement>(
                ".roam-nav-recent-file"
            )
        )) {
            const path = row.dataset.path;
            if (path) this.decorateRecentFileClassRow(row, path);
        }
        this.applyRecentFileClassFilter();
    }

    private refreshMetadataCapabilityIfChanged(): void {
        const signature = this.metadataMenu.getCapabilitySignature();
        if (signature === this.metadataCapabilitySignature) return;
        this.metadataCapabilitySignature = signature;
        this.refreshAllFileDecorations();
        this.refreshRecentFileClassCapability();
    }

    private getRecentFileClassAssignments(
        files: readonly TFile[] = this.getRecentMarkdownFiles()
    ): RecentFileClassAssignment[] {
        return files.map((file) => ({
            path: file.path,
            fileClassName: this.recentFileClassByPath.get(file.path) ?? null,
        }));
    }

    private decorateRecentFileClassRow(row: HTMLElement, path: string): void {
        row.dataset.fileClassFilter = getRecentFileClassValue(
            this.recentFileClassByPath.get(path) ?? null
        );
        row.hidden = !this.isRecentFileClassPathVisible(path);
        if (!row.hidden) {
            this.recentSectionEl
                ?.querySelector(".roam-nav-filter-empty")
                ?.remove();
        }
    }

    private isRecentFileClassPathVisible(path: string): boolean {
        if (
            !this.metadataMenu.isFileClassCapabilityReady() ||
            !canFilterRecentFileClasses(this.recentFileClassOptions) ||
            this.plugin.settings.recentFileClassFilter.length === 0
        ) {
            return true;
        }
        return this.plugin.settings.recentFileClassFilter.includes(
            getRecentFileClassValue(this.recentFileClassByPath.get(path) ?? null)
        );
    }

    private applyRecentFileClassFilter(focusValue?: string): void {
        const body = this.recentSectionEl;
        if (!body?.isConnected) return;
        const assignments = this.getRecentFileClassAssignments();
        const capabilityReady = this.metadataMenu.isFileClassCapabilityReady();
        this.recentFileClassOptions = capabilityReady
            ? buildRecentFileClassOptions(assignments)
            : [];
        const filterAvailable =
            capabilityReady &&
            canFilterRecentFileClasses(this.recentFileClassOptions);
        const visiblePaths = new Set(
            filterRecentFileClassAssignments(
                assignments,
                this.plugin.settings.recentFileClassFilter,
                capabilityReady
            ).map((assignment) => assignment.path)
        );
        const files = this.getRecentMarkdownFiles();
        const fileMetadata = new Map(files.map((file) => [
            file.path,
            normalizeFileMetadata(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter),
        ]));
        let visibleCount = 0;
        for (const row of Array.from(
            body.querySelectorAll<HTMLElement>(".roam-nav-recent-file")
        )) {
            const path = row.dataset.path;
            const metadata = path ? fileMetadata.get(path) : null;
            const visible = Boolean(path && visiblePaths.has(path) && metadata &&
                matchesRecentFileMetadata(
                    metadata,
                    this.plugin.settings.recentFileTagsFilter,
                    this.plugin.settings.recentFilePropertyFilters
                ));
            row.hidden = !visible;
            if (visible) visibleCount += 1;
        }

        body.querySelector(".roam-nav-filter-empty")?.remove();
        if (
            this.recentFileFilterCount() > 0 &&
            visibleCount === 0
        ) {
            const empty = body.createDiv({ cls: "roam-nav-empty roam-nav-filter-empty" });
            empty.createDiv({ text: "No recent files match this filter." });
            const clear = empty.createEl("button", {
                text: "Clear filters",
                attr: { type: "button" },
            });
            clear.addEventListener("click", () => {
                this.clearRecentFileFilters();
                this.recentFilterButtonEl?.focus();
            });
        }

        this.updateRecentFileClassFilterControl(filterAvailable || files.length > 0 || this.recentFileFilterCount() > 0);
        if (this.recentFilterPopoverEl) {
            this.renderRecentFileClassPopover(focusValue);
        }
    }

    private updateRecentFileClassFilterControl(
        filterAvailable =
            this.getRecentMarkdownFiles().length > 0
    ): void {
        const button = this.recentFilterButtonEl;
        const badge = this.recentFilterBadgeEl;
        if (!button || !badge) return;
        button.hidden = !filterAvailable;
        if (!filterAvailable) this.closeRecentFilesTransientUi();

        const count = this.recentFileFilterCount();
        badge.hidden = count === 0;
        badge.setText(String(count));
        const label = count
            ? `Filter recent files, ${count} selected`
            : "Filter recent files";
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        button.toggleClass("is-active", count > 0 && filterAvailable);
    }

    private renderRecentFileClassPopover(focusValue?: string): void {
        const button = this.recentFilterButtonEl;
        const header = button?.closest<HTMLElement>(".roam-nav-section-header");
        if (!button || !header || button.hidden) return;
        this.closeRecentFilesTransientUi();

        const popover = header.createDiv({
            cls: "roam-nav-fileclass-popover",
            attr: { role: "dialog", "aria-label": "Filter recent files" },
        });
        this.recentFilterPopoverEl = popover;
        button.setAttribute("aria-expanded", "true");

        const popoverHeader = popover.createDiv({
            cls: "roam-nav-fileclass-popover-header",
        });
        popoverHeader.createSpan({ text: "Filter recent files" });
        const close = popoverHeader.createEl("button", {
            cls: "roam-nav-fileclass-popover-close",
            attr: { type: "button", "aria-label": "Close filter" },
        });
        const closeIcon = close.createSpan({ attr: { "aria-hidden": "true" } });
        setIcon(closeIcon, "x");
        close.addEventListener("click", () => {
            this.closeRecentFilesTransientUi();
            button.focus();
        });

        const fileClassGroup = popover.createDiv({ cls: "roam-nav-filter-group" });
        fileClassGroup.createDiv({ cls: "roam-nav-filter-group-title", text: "FileClass" });
        if (this.metadataMenu.isFileClassCapabilityReady() &&
            canFilterRecentFileClasses(this.recentFileClassOptions)) {
            this.createRecentFileClassChoice(
                fileClassGroup, "class:__all__", "All", this.getRecentFileClassAssignments().length,
                this.plugin.settings.recentFileClassFilter.length === 0,
                () => this.setRecentFileClassFilter([], "class:__all__")
            );
            for (const option of this.recentFileClassOptions) {
                this.createRecentFileClassChoice(
                    fileClassGroup, `class:${option.value}`, option.label, option.count,
                    this.plugin.settings.recentFileClassFilter.includes(option.value),
                    () => this.setRecentFileClassFilter(
                        toggleRecentFileClassFilter(this.plugin.settings.recentFileClassFilter, option.value),
                        `class:${option.value}`
                    )
                );
            }
        } else {
            fileClassGroup.createDiv({ cls: "roam-nav-filter-hint", text: "FileClass is unavailable." });
        }

        const metadata = this.getRecentMarkdownFiles().map((file) =>
            normalizeFileMetadata(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter)
        );
        const tagOptions = buildOptions(metadata.map((item) => item.tags));
        this.createRecentFilterGroup(popover, "Properties · tags", tagOptions,
            this.plugin.settings.recentFileTagsFilter, "tag", (value) => {
                this.plugin.settings.recentFileTagsFilter = toggleRecentFileClassFilter(
                    this.plugin.settings.recentFileTagsFilter, value
                );
                this.saveAndApplyRecentFileFilters(`tag:${value}`);
            });
        const propertyOptions = buildPropertyOptions(metadata);
        const propertyKeys = new Set([
            ...Object.keys(propertyOptions),
            ...Object.keys(this.plugin.settings.recentFilePropertyFilters),
        ]);
        for (const key of [...propertyKeys].sort()) {
            this.createRecentFilterGroup(
                popover, `Property · ${key}`, propertyOptions[key] ?? [],
                this.plugin.settings.recentFilePropertyFilters[key] ?? [], `property:${key}`,
                (value) => {
                    const selected = toggleRecentFileClassFilter(
                        this.plugin.settings.recentFilePropertyFilters[key] ?? [], value
                    );
                    if (selected.length) this.plugin.settings.recentFilePropertyFilters[key] = selected;
                    else delete this.plugin.settings.recentFilePropertyFilters[key];
                    this.saveAndApplyRecentFileFilters(`property:${key}:${value}`);
                }
            );
        }
        this.createClearFilterButton(popover, () => this.clearRecentFileFilters());

        const choices = Array.from(
            popover.querySelectorAll<HTMLButtonElement>(
                ".roam-nav-fileclass-filter-choice"
            )
        );
        const target = choices.find(
            (choice) => choice.dataset.filterValue === focusValue
        );
        (target ?? choices[0])?.focus();
    }

    private createRecentFileClassChoice(
        parent: HTMLElement,
        value: string,
        label: string,
        count: number,
        selected: boolean,
        onClick: () => void
    ): void {
        const button = parent.createEl("button", {
            cls: "roam-nav-fileclass-filter-choice",
            attr: {
                type: "button",
                "aria-pressed": String(selected),
                "data-filter-value": value,
            },
        });
        const check = button.createSpan({
            cls: "roam-nav-fileclass-filter-check",
            attr: { "aria-hidden": "true" },
        });
        if (selected) setIcon(check, "check");
        button.createSpan({
            cls: "roam-nav-fileclass-filter-label",
            text: label,
        });
        button.createSpan({
            cls: "roam-nav-fileclass-filter-count",
            text: String(count),
            attr: { "aria-hidden": "true" },
        });
        button.addEventListener("click", onClick);
    }

    private setRecentFileClassFilter(
        values: string[],
        focusValue?: string
    ): void {
        this.plugin.settings.recentFileClassFilter = values;
        void this.plugin.saveSettings();
        this.applyRecentFileClassFilter(focusValue);
    }

    private recentFileFilterCount(): number {
        return this.plugin.settings.recentFileClassFilter.length +
            this.plugin.settings.recentFileTagsFilter.length +
            Object.values(this.plugin.settings.recentFilePropertyFilters)
                .reduce((total, values) => total + values.length, 0);
    }

    private clearRecentFileFilters(): void {
        this.plugin.settings.recentFileClassFilter = [];
        this.plugin.settings.recentFileTagsFilter = [];
        this.plugin.settings.recentFilePropertyFilters = {};
        this.saveAndApplyRecentFileFilters();
    }

    private saveAndApplyRecentFileFilters(focusValue?: string): void {
        void this.plugin.saveSettings();
        this.applyRecentFileClassFilter(focusValue);
    }

    private createRecentFilterGroup(
        parent: HTMLElement,
        label: string,
        options: readonly FilterOption[],
        selected: readonly string[],
        key: string,
        toggle: (value: string) => void
    ): void {
        if (!options.length && !selected.length) return;
        const group = parent.createDiv({ cls: "roam-nav-filter-group" });
        group.createDiv({ cls: "roam-nav-filter-group-title", text: label });
        const known = new Set(options.map((option) => option.value));
        for (const option of options) {
            this.createRecentFileClassChoice(
                group, `${key}:${option.value}`, option.label, option.count,
                selected.includes(option.value), () => toggle(option.value)
            );
        }
        for (const value of selected) {
            if (known.has(value)) continue;
            this.createRecentFileClassChoice(
                group, `${key}:${value}`, `${propertyValueLabel(value)} (not in recent list)`, 0,
                true, () => toggle(value)
            );
        }
    }

    private createClearFilterButton(parent: HTMLElement, clear: () => void): void {
        const button = parent.createEl("button", {
            cls: "roam-nav-filter-clear",
            text: "Clear filters",
            attr: { type: "button" },
        });
        button.addEventListener("click", clear);
    }

    private closeRecentTasksTransientUi(): void {
        this.recentTaskFilterPopoverEl?.remove();
        this.recentTaskFilterPopoverEl = null;
        this.recentTaskFilterButtonEl?.setAttribute("aria-expanded", "false");
    }

    private createRecentTaskFilterButton(actions: HTMLElement): void {
        const button = actions.createEl("button", {
            cls: "roam-nav-fileclass-filter",
            attr: {
                type: "button",
                "aria-label": "Filter recent tasks",
                "aria-expanded": "false",
                title: "Filter recent tasks",
            },
        });
        const icon = button.createSpan({ cls: "roam-nav-fileclass-filter-icon", attr: { "aria-hidden": "true" } });
        setIcon(icon, "list-filter");
        this.recentTaskFilterBadgeEl = button.createSpan({
            cls: "roam-nav-fileclass-filter-badge",
            attr: { "aria-hidden": "true" },
        });
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (this.recentTaskFilterPopoverEl) this.closeRecentTasksTransientUi();
            else this.renderRecentTaskFilterPopover();
        });
        this.recentTaskFilterButtonEl = button;
        this.updateRecentTaskFilterControl();
    }

    private recentTaskFilterCount(): number {
        return this.plugin.settings.recentTaskTagsFilter.length +
            this.plugin.settings.recentTaskPagesFilter.length;
    }

    private updateRecentTaskFilterControl(): void {
        const button = this.recentTaskFilterButtonEl;
        const badge = this.recentTaskFilterBadgeEl;
        if (!button || !badge) return;
        const count = this.recentTaskFilterCount();
        button.hidden = this.plugin.getRecentTaskBlocks().length === 0 && count === 0;
        badge.hidden = count === 0;
        badge.setText(String(count));
        button.toggleClass("is-active", count > 0);
        button.setAttribute("aria-label", count
            ? `Filter recent tasks, ${count} selected`
            : "Filter recent tasks");
    }

    private getRecentTaskMetadata(record: RecentTaskBlockRecord): RecentTaskMetadata {
        return parseRootTaskMetadata(record.normalizedRootText, (target) => {
            const resolved = this.app.metadataCache.getFirstLinkpathDest(target, record.path);
            return resolved?.path ?? target.toLowerCase();
        });
    }

    private clearRecentTaskFilters(): void {
        this.plugin.settings.recentTaskTagsFilter = [];
        this.plugin.settings.recentTaskPagesFilter = [];
        this.saveAndApplyRecentTaskFilters();
    }

    private saveAndApplyRecentTaskFilters(focusValue?: string): void {
        void this.plugin.saveSettings();
        if (this.recentTaskSectionEl?.isConnected) this.populateRecentTasks(this.recentTaskSectionEl);
        if (focusValue && this.recentTaskFilterPopoverEl) {
            const choices = Array.from(this.recentTaskFilterPopoverEl.querySelectorAll<HTMLButtonElement>(
                ".roam-nav-fileclass-filter-choice"
            ));
            choices.find((choice) => choice.dataset.filterValue === focusValue)?.focus();
        }
    }

    private renderRecentTaskFilterPopover(): void {
        const button = this.recentTaskFilterButtonEl;
        const header = button?.closest<HTMLElement>(".roam-nav-section-header");
        if (!button || !header || button.hidden) return;
        this.closeRecentTasksTransientUi();
        const popover = header.createDiv({
            cls: "roam-nav-fileclass-popover",
            attr: { role: "dialog", "aria-label": "Filter recent tasks" },
        });
        this.recentTaskFilterPopoverEl = popover;
        button.setAttribute("aria-expanded", "true");
        const popoverHeader = popover.createDiv({ cls: "roam-nav-fileclass-popover-header" });
        popoverHeader.createSpan({ text: "Filter recent tasks" });
        const close = popoverHeader.createEl("button", {
            cls: "roam-nav-fileclass-popover-close",
            attr: { type: "button", "aria-label": "Close filter" },
        });
        const closeIcon = close.createSpan({ attr: { "aria-hidden": "true" } });
        setIcon(closeIcon, "x");
        close.addEventListener("click", () => {
            this.closeRecentTasksTransientUi();
            button.focus();
        });
        const metadata = this.plugin.getRecentTaskBlocks().map((record) => this.getRecentTaskMetadata(record));
        this.createRecentFilterGroup(
            popover, "Root task tags", buildOptions(metadata.map((task) => task.tags)),
            this.plugin.settings.recentTaskTagsFilter, "task-tag", (value) => {
                this.plugin.settings.recentTaskTagsFilter = toggleRecentFileClassFilter(
                    this.plugin.settings.recentTaskTagsFilter, value
                );
                this.saveAndApplyRecentTaskFilters(`task-tag:${value}`);
            }
        );
        this.createRecentFilterGroup(
            popover, "Root task pages", buildOptions(metadata.map((task) => task.pages)),
            this.plugin.settings.recentTaskPagesFilter, "task-page", (value) => {
                this.plugin.settings.recentTaskPagesFilter = toggleRecentFileClassFilter(
                    this.plugin.settings.recentTaskPagesFilter, value
                );
                this.saveAndApplyRecentTaskFilters(`task-page:${value}`);
            }
        );
        this.createClearFilterButton(popover, () => this.clearRecentTaskFilters());
        popover.querySelector<HTMLButtonElement>(".roam-nav-fileclass-filter-choice")?.focus();
    }

    private async getBookmarkSnapshot(): Promise<BookmarkSnapshot> {
        try {
            const text = await this.app.vault.adapter.read(
                normalizePath(`${this.app.vault.configDir}/bookmarks.json`)
            );
            const parsed: unknown = JSON.parse(text);
            const items = isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [];
            return {
                signature: createContentSignature(text),
                nodes: buildBookmarkTree(items, (path, type) => {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (type === "file" && file instanceof TFile && file.extension === "md") return file.path;
                    if (type === "folder" && file instanceof TFolder) return file.path;
                    return null;
                }),
            };
        } catch {
            return { signature: "missing", nodes: [] };
        }
    }

    private async pollBookmarks(): Promise<void> {
        if (this.bookmarkPollInFlight || !this.bookmarkSectionEl?.isConnected) return;
        this.bookmarkPollInFlight = true;
        try {
            const snapshot = await this.getBookmarkSnapshot();
            if (snapshot.signature === this.bookmarkSignature) return;
            this.bookmarkSignature = snapshot.signature;
            this.bookmarkRenderGeneration += 1;
            const generation = this.bookmarkRenderGeneration;
            const body = this.bookmarkSectionEl;
            if (!body?.isConnected) return;
            this.prepareBookmarkSection(body);
            await this.renderBookmarksAsync(body, generation, snapshot);
        } finally {
            this.bookmarkPollInFlight = false;
        }
    }

    private renderFileRow(
        parent: HTMLElement,
        label: string,
        path: string,
        file: TFile | null,
        isBookmark: boolean,
        bookmarkTarget?: BookmarkTarget
    ): HTMLElement {
        const row = parent.createDiv({
            cls: `roam-nav-file ${isBookmark ? "roam-nav-bookmark" : "roam-nav-recent-file"}`,
            attr: { title: path, "data-path": path },
        });

        if (file) {
            const resolution = this.metadataMenu.resolveFileClassIcon(file);
            const iconButton = row.createEl("button", {
                cls: "roam-nav-file-icon",
                attr: {
                    type: "button",
                    "aria-label": this.getFileIconAriaLabel(file, resolution.fileClassName),
                    title: this.getFileIconTooltip(resolution.fileClassName),
                },
            });
            const iconContainer = iconButton.createSpan({
                cls:
                    resolution.source === "file-class"
                        ? "roam-nav-fileclass-icon"
                        : undefined,
            });
            setIcon(iconContainer, resolution.icon);
            iconButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                void this.openFileProperties(file, event);
            });

            const mainButton = this.createFileMainButton(row, label, file.basename);
            const labelEl = mainButton.createSpan({ cls: "roam-nav-file-name", text: label });
            this.superchargedLinks.apply(labelEl, file);
            mainButton.addEventListener("click", (event) => {
                if (bookmarkTarget) void this.openBookmarkTarget(bookmarkTarget, event);
                else void this.openFile(file, event);
            });
            this.registerFileDecoration(file.path, {
                iconButton,
                iconContainer,
                label: labelEl,
            });
            return row;
        }

        const icon = row.createSpan({
            cls: "roam-nav-file-icon roam-nav-file-icon-static",
            attr: { "aria-hidden": "true" },
        });
        setIcon(icon, "folder");
        const mainButton = this.createFileMainButton(row, label, label);
        mainButton.createSpan({ cls: "roam-nav-file-name", text: label });
        if (bookmarkTarget) {
            mainButton.addEventListener("click", (event) => {
                void this.openBookmarkTarget(bookmarkTarget, event);
            });
        }
        return row;
    }

    private createFileMainButton(
        row: HTMLElement,
        label: string,
        basename: string
    ): HTMLButtonElement {
        return row.createEl("button", {
            cls: "roam-nav-file-main",
            attr: { type: "button", "aria-label": `Open ${basename}`, title: label },
        });
    }

    private async openFile(file: TFile, event: MouseEvent): Promise<void> {
        if (event.shiftKey) {
            event.preventDefault();
            await this.plugin.pushFileToPageStream(file, "navigation", undefined, {
                active: false,
                reveal: true,
            });
            return;
        }
        await this.app.workspace.getLeaf(false).openFile(file);
    }

    private async openBookmarkTarget(
        target: BookmarkTarget,
        event: MouseEvent
    ): Promise<void> {
        const abstractFile = this.app.vault.getAbstractFileByPath(target.path);
        if (target.type === "file" && abstractFile instanceof TFile) {
            await this.openFile(abstractFile, event);
            return;
        }
        if (target.type === "folder" && abstractFile instanceof TFolder) {
            await this.plugin.openFolderView(abstractFile.path, "journalDate");
        }
    }

    private async openFileProperties(file: TFile, event: MouseEvent): Promise<void> {
        this.propertiesOpenGeneration += 1;
        const generation = this.propertiesOpenGeneration;
        this.cancelPropertyFrames();
        if (this.metadataMenu.openTargetedActions(file, event)) return;

        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file, { active: true });
        if (generation !== this.propertiesOpenGeneration) return;
        if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== file.path) return;
        const ownerWindow = leaf.view.containerEl.ownerDocument.defaultView;
        if (!ownerWindow) return;
        this.schedulePropertyFrame(ownerWindow, () => {
            this.schedulePropertyFrame(ownerWindow, () => {
                if (generation !== this.propertiesOpenGeneration) return;
                if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== file.path) {
                    return;
                }
                const properties = leaf.view.containerEl.querySelector<HTMLElement>(
                    ".metadata-container, .metadata-properties"
                );
                if (!properties) return;
                properties.scrollIntoView({ block: "nearest" });
                properties
                    .querySelector<HTMLElement>(
                        "button, input, [contenteditable='true'], [tabindex]"
                    )
                    ?.focus({ preventScroll: true });
            });
        });
    }

    private schedulePropertyFrame(ownerWindow: Window, callback: () => void): void {
        const scheduled: ScheduledFrame = { ownerWindow, id: 0 };
        scheduled.id = ownerWindow.requestAnimationFrame(() => {
            this.propertyFrames.delete(scheduled);
            callback();
        });
        this.propertyFrames.add(scheduled);
    }

    private cancelPropertyFrames(): void {
        for (const frame of this.propertyFrames) {
            frame.ownerWindow.cancelAnimationFrame(frame.id);
        }
        this.propertyFrames.clear();
    }

    private async reloadSuperchargedLinks(): Promise<void> {
        if (!(await this.superchargedLinks.initialize())) return;
        this.refreshAllFileDecorations();
    }

    private getFileIconAriaLabel(file: TFile, fileClassName: string | null): string {
        return fileClassName
            ? `Manage ${fileClassName} fields for ${file.basename}`
            : `Choose FileClass or open properties for ${file.basename}`;
    }

    private getFileIconTooltip(fileClassName: string | null): string {
        return fileClassName
            ? `Manage ${fileClassName} fields`
            : "Choose FileClass or open properties";
    }

    private registerFileDecoration(
        path: string,
        elements: FileDecorationElements
    ): void {
        const entries = this.fileDecorations.get(path) ?? new Set();
        entries.add(elements);
        this.fileDecorations.set(path, entries);
    }

    private refreshFileDecorations(path: string): void {
        const entries = this.fileDecorations.get(path);
        if (!entries) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            this.fileDecorations.delete(path);
            return;
        }

        const resolution = this.metadataMenu.resolveFileClassIcon(file);
        for (const elements of entries) {
            if (!elements.label.isConnected) {
                entries.delete(elements);
                continue;
            }
            elements.iconContainer.empty();
            elements.iconContainer.toggleClass(
                "roam-nav-fileclass-icon",
                resolution.source === "file-class"
            );
            setIcon(elements.iconContainer, resolution.icon);
            elements.iconButton.setAttr(
                "aria-label",
                this.getFileIconAriaLabel(file, resolution.fileClassName)
            );
            elements.iconButton.setAttr(
                "title",
                this.getFileIconTooltip(resolution.fileClassName)
            );
            this.superchargedLinks.apply(elements.label, file);
        }
        if (!entries.size) this.fileDecorations.delete(path);
    }

    private refreshAllFileDecorations(): void {
        for (const path of Array.from(this.fileDecorations.keys())) {
            this.refreshFileDecorations(path);
        }
    }

    private unregisterFileDecorationsWithin(container: HTMLElement): void {
        for (const [path, entries] of this.fileDecorations) {
            for (const elements of entries) {
                if (container.contains(elements.label)) entries.delete(elements);
            }
            if (!entries.size) this.fileDecorations.delete(path);
        }
    }

    private renderInBatches<T>(
        parent: HTMLElement,
        items: readonly T[],
        isCurrent: () => boolean,
        renderItem: (item: T) => void
    ): void {
        let index = 0;
        const renderBatch = (size: number) => {
            if (!isCurrent()) return;
            const end = Math.min(index + size, items.length);
            while (index < end) {
                renderItem(items[index]);
                index += 1;
            }
            if (index < items.length) {
                this.scheduleFrame(parent, () => renderBatch(NEXT_ENTRY_BATCH));
            }
        };
        renderBatch(INITIAL_ENTRY_BATCH);
    }

    private scheduleFrame(parent: HTMLElement, callback: () => void): void {
        const ownerWindow = parent.ownerDocument.defaultView;
        if (!ownerWindow) return;
        const frame = ownerWindow.requestAnimationFrame(() => {
            this.scheduledFrames.delete(frame);
            callback();
        });
        this.scheduledFrames.add(frame);
    }

    private cancelScheduledFrames(): void {
        const ownerWindow = this.contentEl.ownerDocument.defaultView;
        if (ownerWindow) {
            for (const frame of this.scheduledFrames) ownerWindow.cancelAnimationFrame(frame);
        }
        this.scheduledFrames.clear();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
