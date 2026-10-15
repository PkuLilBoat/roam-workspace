import { App, ButtonComponent, Menu, Modal } from "obsidian";
import type { SelectionMode, TimeField, TimeRange } from "../../types/time";
import {
    endOfLocalDay,
    startOfLocalDay,
    tryParseDateInputEnd,
    tryParseDateInputStart,
} from "../../utils/dateInput";
import { TIME_RANGE_OPTIONS } from "../../utils/viewState";

export interface JournalSourceChoice {
    mode: SelectionMode;
    target: string;
}

export function showJournalTimeFieldMenu(
    event: MouseEvent,
    current: TimeField,
    select: (field: TimeField) => void
): void {
    const menu = new Menu();
    for (const [label, field] of [
        ["Journal date", "journalDate"],
        ["Journal date (reverse)", "journalDateReverse"],
        ["Creation time", "ctime"],
        ["Modification time", "mtime"],
        ["Creation time (reverse)", "ctimeReverse"],
        ["Modification time (reverse)", "mtimeReverse"],
        ["Name (A–Z)", "name"],
        ["Name (Z–A)", "nameReverse"],
    ] as const) {
        menu.addItem((item) => {
            item.setTitle(label);
            item.setChecked(current === field);
            item.onClick(() => select(field));
        });
    }
    menu.showAtMouseEvent(event);
}

export function showJournalRangeMenu(
    app: App,
    event: MouseEvent,
    current: TimeRange,
    select: (range: TimeRange, customRange?: { start: Date; end: Date }) => void
): void {
    const menu = new Menu();
    for (const option of TIME_RANGE_OPTIONS) {
        if (option.value === "custom") {
            menu.addSeparator();
            menu.addItem((item) => {
                item.setTitle(option.label);
                item.setChecked(current === "custom");
                item.onClick(() => {
                    new JournalCustomRangeModal(app, (range) => {
                        select("custom", range);
                    }).open();
                });
            });
            continue;
        }
        menu.addItem((item) => {
            item.setTitle(option.label);
            item.setChecked(current === option.value);
            item.onClick(() => select(option.value));
        });
    }
    menu.showAtMouseEvent(event);
}

export function showJournalSourceMenu(
    app: App,
    event: MouseEvent,
    current: JournalSourceChoice,
    presets: JournalSourceChoice[],
    select: (choice: JournalSourceChoice) => void
): void {
    const menu = new Menu();
    menu.addItem((item) => {
        item.setTitle("Daily notes");
        item.setChecked(current.mode === "daily");
        item.onClick(() => select({ mode: "daily", target: "" }));
    });
    for (const mode of ["folder", "tag"] as const) {
        menu.addItem((item) => {
            item.setTitle(mode === "folder" ? "Folder…" : "Tag…");
            item.setChecked(current.mode === mode);
            item.onClick(() => {
                new JournalTargetModal(app, mode, (target) => {
                    select({ mode, target });
                }).open();
            });
        });
    }
    if (presets.length > 0) {
        menu.addSeparator();
        for (const preset of presets) {
            menu.addItem((item) => {
                item.setTitle(
                    `${preset.mode === "folder" ? "Folder" : "Tag"}: ${preset.target}`
                );
                item.setChecked(
                    current.mode === preset.mode && current.target === preset.target
                );
                item.onClick(() => select(preset));
            });
        }
    }
    menu.showAtMouseEvent(event);
}

class JournalCustomRangeModal extends Modal {
    private confirmButton?: ButtonComponent;
    private endDate = endOfLocalDay(new Date());
    private errorEl?: HTMLElement;
    private startDate = startOfLocalDay(new Date());

    constructor(
        app: App,
        private readonly save: (range: { start: Date; end: Date }) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText("Select custom date range");
        this.errorEl = this.contentEl.createDiv({ cls: "custom-range-error" });
        const startInput = this.createDateInput("Start date", this.startDate);
        const endInput = this.createDateInput("End date", this.endDate);
        const footerEl = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footerEl).setButtonText("Cancel").onClick(() => this.close());
        this.confirmButton = new ButtonComponent(footerEl)
            .setButtonText("Confirm")
            .setCta()
            .onClick(() => {
                if (!this.validate(startInput, endInput)) return;
                this.save({ start: this.startDate, end: this.endDate });
                this.close();
            });
        const validate = () => this.validate(startInput, endInput);
        startInput.addEventListener("change", validate);
        endInput.addEventListener("change", validate);
        this.validate(startInput, endInput);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private createDateInput(label: string, value: Date): HTMLInputElement {
        const rowEl = this.contentEl.createDiv({ cls: "custom-range-date-container" });
        rowEl.createEl("label", { text: label });
        return rowEl.createEl("input", {
            attr: { "aria-label": label },
            type: "date",
            value: formatDate(value),
        });
    }

    private validate(startInput: HTMLInputElement, endInput: HTMLInputElement): boolean {
        const start = tryParseDateInputStart(startInput.value);
        const end = tryParseDateInputEnd(endInput.value);
        const message = !start || !end
            ? "Choose a valid start and end date."
            : start.valueOf() > end.valueOf()
                ? "Start date must be on or before end date."
                : "";
        if (start && end && !message) {
            this.startDate = start;
            this.endDate = end;
        }
        this.errorEl?.setText(message);
        this.confirmButton?.setDisabled(Boolean(message));
        return !message;
    }
}

class JournalTargetModal extends Modal {
    constructor(
        app: App,
        private readonly mode: "folder" | "tag",
        private readonly save: (target: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(this.mode === "folder" ? "Select folder" : "Select tag");
        const formEl = this.contentEl.createEl("form");
        const inputEl = formEl.createEl("input", {
            attr: {
                "aria-label": this.mode === "folder" ? "Folder path" : "Tag name",
                placeholder: this.mode === "folder" ? "Folder/subfolder" : "tag",
                type: "text",
            },
        });
        const footerEl = formEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footerEl).setButtonText("Cancel").onClick(() => this.close());
        new ButtonComponent(footerEl).setButtonText("Apply").setCta().onClick(() => {
            this.submit(inputEl);
        });
        formEl.addEventListener("submit", (event) => {
            event.preventDefault();
            this.submit(inputEl);
        });
        inputEl.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private submit(inputEl: HTMLInputElement): void {
        const target = inputEl.value.trim();
        if (!target) return;
        this.save(target);
        this.close();
    }
}

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
