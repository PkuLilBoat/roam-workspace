import type { JournalProjectionItem } from "../contracts";
import { JournalCard, type JournalCardCallbacks } from "./JournalCard";

export interface JournalCardReconcileResult {
    cards: JournalCard[];
    removedKeys: string[];
}

export class JournalCardList {
    private readonly cards = new Map<string, JournalCard>();
    private readonly emptyEl: HTMLElement;

    constructor(
        private readonly containerEl: HTMLElement,
        private readonly callbacks: JournalCardCallbacks
    ) {
        this.emptyEl = containerEl.createEl("p", {
            cls: "journal-v2__empty",
            text: "No journal entries match this view.",
        });
    }

    reconcile(items: JournalProjectionItem[]): JournalCardReconcileResult {
        const hasItems = items.length > 0;
        if (this.emptyEl.hidden !== hasItems) this.emptyEl.hidden = hasItems;
        const nextKeys = new Set(items.map((item) => item.key));
        const removedKeys: string[] = [];
        for (const [key, card] of this.cards) {
            if (nextKeys.has(key)) continue;
            card.destroy();
            this.cards.delete(key);
            removedKeys.push(key);
        }

        const orderedCards: JournalCard[] = [];
        let previousEl: Node = this.emptyEl;
        for (const item of items) {
            let card = this.cards.get(item.key);
            if (card) {
                if (card.getItem() !== item) card.update(item);
            } else {
                card = new JournalCard(this.containerEl, item, this.callbacks);
                this.cards.set(item.key, card);
            }
            if (previousEl.nextSibling !== card.rootEl) {
                this.containerEl.insertBefore(card.rootEl, previousEl.nextSibling);
            }
            previousEl = card.rootEl;
            orderedCards.push(card);
        }

        return { cards: orderedCards, removedKeys };
    }

    getCard(key: string): JournalCard | undefined {
        return this.cards.get(key);
    }

    renameKey(oldKey: string, newKey: string): boolean {
        if (oldKey === newKey) return this.cards.has(oldKey);
        const card = this.cards.get(oldKey);
        if (!card || this.cards.has(newKey)) return false;
        this.cards.delete(oldKey);
        this.cards.set(newKey, card);
        return true;
    }

    getCards(): JournalCard[] {
        return [...this.cards.values()];
    }

    destroy(): void {
        for (const card of this.cards.values()) card.destroy();
        this.cards.clear();
        this.emptyEl.remove();
    }
}
