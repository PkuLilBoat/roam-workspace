import { Component, setIcon } from "obsidian";

let nextListId = 0;

export function enhancePreviewOutliner(
    root: HTMLElement,
    owner: Component,
    collapsedKeys: Set<string> = new Set()
): void {
    root.addClass("roam-outline-preview");

    for (const item of Array.from(root.querySelectorAll<HTMLElement>("li"))) {
        if (item.closest(".markdown-embed")) continue;
        if (Array.from(item.children).some((child) => child.hasClass("roam-outline-toggle"))) {
            continue;
        }
        const childList = Array.from(item.children).find(
            (child): child is HTMLElement =>
                child.instanceOf(HTMLElement) &&
                child.tagName === "UL"
        );
        if (!childList) continue;

        const listKey = getListKey(item, root);
        const collapsed = collapsedKeys.has(listKey);
        const childListId = `roam-outline-children-${++nextListId}`;
        item.addClass("roam-outline-branch");
        item.toggleClass("is-roam-outline-collapsed", collapsed);
        childList.addClass("roam-outline-children");
        childList.id = childListId;
        childList.hidden = collapsed;
        const toggle = item.createEl("button", {
            cls: "roam-outline-toggle",
            attr: {
                type: "button",
                "aria-controls": childListId,
                "aria-label": collapsed ? "Expand nested list" : "Collapse nested list",
                "aria-expanded": String(!collapsed),
                "data-tooltip-position": "left",
            },
        });
        setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
        item.prepend(toggle);

        owner.registerDomEvent(toggle, "click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextCollapsed = !item.hasClass("is-roam-outline-collapsed");
            item.toggleClass("is-roam-outline-collapsed", nextCollapsed);
            childList.hidden = nextCollapsed;
            if (nextCollapsed) collapsedKeys.add(listKey);
            else collapsedKeys.delete(listKey);
            toggle.setAttr("aria-expanded", String(!nextCollapsed));
            toggle.setAttr(
                "aria-label",
                nextCollapsed ? "Expand nested list" : "Collapse nested list"
            );
            toggle.empty();
            setIcon(toggle, nextCollapsed ? "chevron-right" : "chevron-down");
        });
        owner.registerDomEvent(toggle, "dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    }
}

function getListKey(item: HTMLElement, root: HTMLElement): string {
    const line = item.getAttr("data-line");
    if (line) return `line:${line}`;

    const parts: number[] = [];
    let current: HTMLElement | null = item;
    while (current && current !== root) {
        const parent: HTMLElement | null = current.parentElement;
        if (!parent) break;
        parts.push(Array.from(parent.children).indexOf(current));
        current = parent.closest<HTMLElement>("li");
    }
    return `tree:${parts.reverse().join(".")}`;
}
