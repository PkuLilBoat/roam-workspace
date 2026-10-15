import { MarkdownView, Notice, TFile } from "obsidian";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import {
    findInternalLinkElement,
    readLinktextFromElement,
    resolveInternalLinkTarget,
} from "./pageTargetResolver";

const FILE_ROW_SELECTOR =
    ".nav-file-title[data-path], .search-result-file-title[data-path], " +
    ".bookmark-item[data-path], .tree-item-self[data-path]";
const SOURCE_CARD_SELECTOR = ".roam-page-card[data-path], .journal-v2__card[data-path]";

export function isPlainShiftClick(event: MouseEvent): boolean {
    return (
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.button === 0
    );
}

export class PageStreamNativeRouter {
    private clickGeneration = 0;
    private disposed = false;

    constructor(private readonly plugin: DailyNoteViewPlugin) {}

    install(): void {
        this.plugin.registerDomEvent(
            window,
            "click",
            (event) => this.recordTrigger(event),
            { capture: true }
        );
        this.plugin.register(() => {
            this.disposed = true;
            this.clickGeneration++;
        });
    }

    private recordTrigger(event: MouseEvent): void {
        if (this.disposed) return;
        const generation = ++this.clickGeneration;
        if (event.defaultPrevented || !isPlainShiftClick(event)) return;

        const linkEl = findInternalLinkElement(event.target);
        if (linkEl) {
            let linktext: string | null;
            try {
                linktext = readLinktextFromElement(linkEl);
            } catch {
                return;
            }
            if (!linktext) return;

            const sourcePath = this.sourcePathForTarget(linkEl);
            if (!sourcePath) return;
            let target: ReturnType<typeof resolveInternalLinkTarget>;
            try {
                target = resolveInternalLinkTarget(this.plugin.app, linktext, sourcePath);
            } catch {
                return;
            }
            if (!(target?.file instanceof TFile) || target.file.extension !== "md") return;

            event.preventDefault();
            event.stopPropagation();
            void this.pushLinkWithNativeFallback(
                target.file, target, linktext, sourcePath, generation
            );
            return;
        }

        const clickedElement = event.target instanceof HTMLElement
            ? event.target : null;
        const fileRow = clickedElement
            ? clickedElement.closest<HTMLElement>(FILE_ROW_SELECTOR)
            : null;
        const control = clickedElement?.closest<HTMLElement>(
            "button, input, textarea, select, [role='button'], [contenteditable='true'], a[href]"
        );
        if (fileRow && control && control !== fileRow && fileRow.contains(control)) {
            return;
        }
        const rowSubpath = fileRow?.getAttribute("data-subpath") ??
            fileRow?.getAttribute("data-line");
        if (rowSubpath || fileRow?.getAttribute("data-href")?.includes("#")) return;
        const path = fileRow?.getAttribute("data-path");
        if (!path) return;
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== "md") return;

        event.preventDefault();
        event.stopPropagation();
        void this.pushFileRowWithNativeFallback(file, generation);
    }

    private sourcePathForTarget(target: HTMLElement): string | null {
        let sourcePath: string | null = null;
        this.plugin.app.workspace.iterateAllLeaves((leaf) => {
            if (sourcePath !== null || !(leaf.view instanceof MarkdownView)) return;
            if (leaf.view.file && leaf.view.containerEl.contains(target)) {
                sourcePath = leaf.view.file.path;
            }
        });
        if (sourcePath) return sourcePath;

        const cardPath = target.closest<HTMLElement>(SOURCE_CARD_SELECTOR)
            ?.getAttribute("data-path");
        if (!cardPath) return null;
        const cardFile = this.plugin.app.vault.getAbstractFileByPath(cardPath);
        return cardFile instanceof TFile && cardFile.extension === "md"
            ? cardFile.path
            : null;
    }

    private async pushLinkWithNativeFallback(
        file: TFile,
        target: NonNullable<ReturnType<typeof resolveInternalLinkTarget>>,
        linktext: string,
        sourcePath: string,
        generation: number
    ): Promise<void> {
        let pushed = false;
        try {
            pushed = await this.plugin.pushFileToPageStream(file, "link", target, {
                active: false,
                reveal: true,
            });
        } catch (error) {
            console.error("Could not route link to Page Stream:", error);
        }
        if (pushed || this.disposed) return;
        if (!this.isCurrent(generation)) {
            new Notice("Could not open the earlier linked note. Try again.");
            return;
        }

        try {
            await this.plugin.app.workspace.openLinkText(linktext, sourcePath, "split");
        } catch (error) {
            console.error("Could not open routed link natively:", error);
            new Notice("Could not open the linked note.");
        }
    }

    private async pushFileRowWithNativeFallback(
        file: TFile,
        generation: number
    ): Promise<void> {
        let pushed = false;
        try {
            pushed = await this.plugin.pushFileToPageStream(file, "navigation", undefined, {
                active: false,
                reveal: true,
            });
        } catch (error) {
            console.error("Could not route file to Page Stream:", error);
        }
        if (pushed || this.disposed) return;
        if (!this.isCurrent(generation)) {
            new Notice("Could not open the earlier file. Try again.");
            return;
        }

        try {
            await this.plugin.app.workspace.getLeaf("split").openFile(file);
        } catch (error) {
            console.error("Could not open routed file natively:", error);
            new Notice("Could not open the linked note.");
        }
    }

    private isCurrent(generation: number): boolean {
        return !this.disposed && generation === this.clickGeneration;
    }
}
