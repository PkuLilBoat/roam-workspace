import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function run() {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "journal-card-list-"));

    try {
        const outfile = path.join(temporaryRoot, "journal-card-list.mjs");
        await build({
            entryPoints: ["src/journal-v2/card/JournalCardList.ts"],
            outfile,
            bundle: true,
            format: "esm",
            platform: "node",
            logLevel: "silent",
            plugins: [{
                name: "obsidian-boundary",
                setup(build) {
                    build.onResolve({ filter: /^obsidian$/ }, () => ({
                        path: "obsidian",
                        namespace: "test-obsidian",
                    }));
                    build.onLoad({ filter: /.*/, namespace: "test-obsidian" }, () => ({
                        contents: "export function setIcon() {}",
                        loader: "js",
                    }));
                },
            }],
        });

        const { JournalCardList } = await import(pathToFileURL(outfile).href);
        const container = new TestElement("div");
        const callbacks = {
            onActivateVirtual() {},
            onConflictAction() {},
            onFocusChange() {},
            onLocalEdit() {},
            onOpenSource() {},
            onToggleCollapsed() {},
        };
        const list = new JournalCardList(container, callbacks);
        const [a, b, c, x] = ["a", "b", "c", "x"].map(makeItem);

        let result = list.reconcile([a, b, c]);
        assert.deepEqual(result.cards.map((card) => card.getItem().key), ["a", "b", "c"]);
        assert.deepEqual(cardOrder(container), ["a", "b", "c"]);
        const roots = new Map(["a", "b", "c"].map((key) => [key, list.getCard(key).rootEl]));

        container.placements.length = 0;
        const beforeNoop = subtreeWrites(container);
        result = list.reconcile([a, b, c]);
        assert.deepEqual(result.removedKeys, []);
        assert.equal(container.placements.length, 0, "same projection must not move cards");
        assert.equal(subtreeWrites(container), beforeNoop, "same projection must not rewrite DOM");
        for (const [key, root] of roots) assert.equal(list.getCard(key).rootEl, root);

        const changedB = { ...b, dateLabel: "B updated", content: "changed" };
        const aWrites = subtreeWrites(roots.get("a"));
        const bWrites = subtreeWrites(roots.get("b"));
        const cWrites = subtreeWrites(roots.get("c"));
        container.placements.length = 0;
        result = list.reconcile([a, changedB, c]);
        assert.equal(container.placements.length, 0, "single-card update must not move cards");
        assert.equal(subtreeWrites(roots.get("a")), aWrites);
        assert.ok(subtreeWrites(roots.get("b")) > bWrites);
        assert.equal(subtreeWrites(roots.get("c")), cWrites);
        assert.equal(list.getCard("b").getItem(), changedB);
        assert.deepEqual(result.cards.map((card) => card.getItem().key), ["a", "b", "c"]);

        container.placements.length = 0;
        result = list.reconcile([x, a, changedB, c]);
        assert.deepEqual(cardOrder(container), ["x", "a", "b", "c"]);
        assert.deepEqual(result.cards.map((card) => card.getItem().key), ["x", "a", "b", "c"]);
        assert.equal(
            container.placements.filter(({ node }) => [...roots.values()].includes(node)).length,
            0,
            "inserting a front card must not move retained cards"
        );

        container.placements.length = 0;
        result = list.reconcile([c, x, a, changedB]);
        assert.deepEqual(cardOrder(container), ["c", "x", "a", "b"]);
        assert.deepEqual(result.cards.map((card) => card.getItem().key), ["c", "x", "a", "b"]);
        assert.deepEqual(
            container.placements.map(({ node }) => node.dataset.journalKey),
            ["c"],
            "reordering should move only the card whose position changed"
        );

        container.placements.length = 0;
        result = list.reconcile([c, x, changedB]);
        assert.deepEqual(result.removedKeys, ["a"]);
        assert.equal(roots.get("a").parentNode, null);
        assert.deepEqual(cardOrder(container), ["c", "x", "b"]);
        assert.equal(container.placements.length, 0, "removing a card must not move survivors");

        const bRoot = list.getCard("b").rootEl;
        assert.equal(list.renameKey("b", "beta"), true);
        const beta = { ...changedB, key: "beta", path: "beta", dateLabel: "Beta" };
        container.placements.length = 0;
        result = list.reconcile([c, x, beta]);
        assert.equal(list.getCard("b"), undefined);
        assert.equal(list.getCard("beta").rootEl, bRoot);
        assert.equal(bRoot.dataset.path, "beta");
        assert.deepEqual(result.cards.map((card) => card.getItem().key), ["c", "x", "beta"]);
        assert.deepEqual(cardOrder(container), ["c", "x", "beta"]);
        assert.equal(container.placements.length, 0, "path migration must retain card DOM");

        result = list.reconcile([]);
        assert.deepEqual(result.removedKeys, ["c", "x", "beta"]);
        assert.deepEqual(cardOrder(container), []);
        assert.equal(container.children.length, 1);
        assert.equal(container.children[0].hidden, false);

        console.log("Journal card list reconciliation passed");
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

function makeItem(key) {
    return {
        content: key,
        dateLabel: key.toUpperCase(),
        dateTime: 0,
        file: { path: key },
        isVirtualToday: false,
        key,
        path: key,
    };
}

function cardOrder(container) {
    return container.children
        .filter((child) => child.classes.has("journal-v2__card"))
        .map((child) => child.dataset.journalKey);
}

function subtreeWrites(element) {
    return element.writes + element.children.reduce(
        (total, child) => total + subtreeWrites(child),
        0
    );
}

class TestElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.parentNode = null;
        this.classes = new Set();
        this.dataset = {};
        this.hidden = false;
        this.placements = [];
        this.writes = 0;
    }

    get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.children;
        return siblings[siblings.indexOf(this) + 1] ?? null;
    }

    createEl(tagName, options = {}) {
        const element = new TestElement(tagName);
        if (options.cls) element.classes.add(options.cls);
        if (options.text) element.setText(options.text);
        for (const [name, value] of Object.entries(options.attr ?? {})) {
            element.setAttribute(name, value);
        }
        this.appendChild(element);
        return element;
    }

    createDiv(options) {
        return this.createEl("div", options);
    }

    createSpan(options) {
        return this.createEl("span", options);
    }

    appendChild(node) {
        return this.insertBefore(node, null);
    }

    insertBefore(node, reference) {
        if (reference !== null && reference.parentNode !== this) {
            throw new Error("Reference node does not belong to container");
        }
        if (node === reference) return node;
        node.remove();
        const index = reference === null ? this.children.length : this.children.indexOf(reference);
        this.children.splice(index, 0, node);
        node.parentNode = this;
        this.placements.push({ node, reference });
        return node;
    }

    remove() {
        if (!this.parentNode) return;
        const siblings = this.parentNode.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentNode = null;
    }

    setText(value) {
        this.text = String(value);
        this.writes += 1;
    }

    setAttribute() {
        this.writes += 1;
    }

    toggleClass(name, enabled) {
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        this.writes += 1;
    }

    addEventListener() {}
}

await run();
