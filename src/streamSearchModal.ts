import { App, Modal, SearchComponent } from "obsidian";

export type StreamSearchDocument = {
    path: string;
    title: string;
    read: () => Promise<string>;
    activate: () => void | Promise<void>;
};

type SearchResult = {
    document: StreamSearchDocument;
    snippet: string;
};

const MAX_RESULTS = 50;
const SEARCH_CONCURRENCY = 12;

export class StreamSearchModal extends Modal {
    private queryRevision = 0;
    private selectedIndex = 0;
    private results: SearchResult[] = [];
    private resultsEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private searchTimer: number | null = null;
    private readonly contentCache = new Map<string, Promise<string>>();

    constructor(
        app: App,
        private readonly documents: StreamSearchDocument[],
        private readonly label: string
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("roam-stream-search-modal");
        this.titleEl.setText(this.label);

        const search = new SearchComponent(this.contentEl);
        search.setPlaceholder("Search pages");
        search.inputEl.setAttr("aria-label", "Search pages");
        search.onChange((query) => this.scheduleSearch(query));
        search.inputEl.addEventListener("keydown", (event) => this.handleKeydown(event));

        this.statusEl = this.contentEl.createDiv({
            cls: "roam-stream-search-status",
            attr: { role: "status", "aria-live": "polite" },
        });
        this.resultsEl = this.contentEl.createDiv({
            cls: "roam-stream-search-results",
            attr: { role: "listbox", "aria-label": "Search results" },
        });

        search.inputEl.focus();
        void this.runSearch("");
    }

    onClose(): void {
        this.queryRevision += 1;
        if (this.searchTimer !== null) {
            window.clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
        this.contentEl.empty();
    }

    private scheduleSearch(query: string): void {
        if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
        this.searchTimer = window.setTimeout(() => {
            this.searchTimer = null;
            void this.runSearch(query);
        }, 120);
    }

    private async runSearch(rawQuery: string): Promise<void> {
        const revision = ++this.queryRevision;
        const terms = normalizeTerms(rawQuery);
        this.statusEl?.setText(terms.length ? "Searching..." : `${this.documents.length} pages`);

        let results: SearchResult[];
        if (!terms.length) {
            results = this.documents.slice(0, MAX_RESULTS).map((document) => ({
                document,
                snippet: document.path,
            }));
        } else {
            const matches = await mapWithConcurrency(
                this.documents,
                SEARCH_CONCURRENCY,
                async (document) => this.matchDocument(document, terms, revision)
            );
            results = matches.filter((result): result is SearchResult => result !== null).slice(0, MAX_RESULTS);
        }

        if (revision !== this.queryRevision) return;
        this.results = results;
        this.selectedIndex = 0;
        this.renderResults();
        this.statusEl?.setText(
            `${results.length}${results.length === MAX_RESULTS ? "+" : ""} result${results.length === 1 ? "" : "s"}`
        );
    }

    private async matchDocument(
        document: StreamSearchDocument,
        terms: string[],
        revision: number
    ): Promise<SearchResult | null> {
        const identity = `${document.title}\n${document.path}`.toLocaleLowerCase();
        if (terms.every((term) => identity.includes(term))) {
            return { document, snippet: document.path };
        }

        const content = await this.readDocument(document);
        if (revision !== this.queryRevision) return null;
        const normalizedContent = content.toLocaleLowerCase();
        if (!terms.every((term) => normalizedContent.includes(term))) return null;
        return {
            document,
            snippet: buildSnippet(content, terms[0]),
        };
    }

    private readDocument(document: StreamSearchDocument): Promise<string> {
        const cached = this.contentCache.get(document.path);
        if (cached) return cached;
        const pending = document.read().catch(() => "");
        this.contentCache.set(document.path, pending);
        return pending;
    }

    private renderResults(): void {
        if (!this.resultsEl) return;
        this.resultsEl.empty();
        for (const [index, result] of this.results.entries()) {
            const button = this.resultsEl.createEl("button", {
                cls: "roam-stream-search-result",
                attr: {
                    type: "button",
                    role: "option",
                    "aria-selected": String(index === this.selectedIndex),
                },
            });
            button.createDiv({ cls: "roam-stream-search-result-title", text: result.document.title });
            button.createDiv({ cls: "roam-stream-search-result-snippet", text: result.snippet });
            button.addEventListener("mouseenter", () => this.selectIndex(index));
            button.addEventListener("click", () => void this.activate(index));
        }
    }

    private handleKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.selectIndex(Math.min(this.results.length - 1, this.selectedIndex + 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.selectIndex(Math.max(0, this.selectedIndex - 1));
        } else if (event.key === "Enter") {
            event.preventDefault();
            void this.activate(this.selectedIndex);
        }
    }

    private selectIndex(index: number): void {
        if (index < 0 || index >= this.results.length) return;
        this.selectedIndex = index;
        const options = Array.from(
            this.resultsEl?.querySelectorAll<HTMLElement>(".roam-stream-search-result") ?? []
        );
        options.forEach((option, optionIndex) => {
            option.setAttr("aria-selected", String(optionIndex === index));
        });
        options[index]?.scrollIntoView({ block: "nearest" });
    }

    private async activate(index: number): Promise<void> {
        const result = this.results[index];
        if (!result) return;
        this.close();
        await result.document.activate();
    }
}

function normalizeTerms(query: string): string[] {
    return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function buildSnippet(content: string, term: string): string {
    const compact = content.replace(/\s+/g, " ").trim();
    const index = compact.toLocaleLowerCase().indexOf(term);
    if (index < 0) return compact.slice(0, 140);
    const start = Math.max(0, index - 48);
    const end = Math.min(compact.length, index + term.length + 88);
    return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await mapper(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
