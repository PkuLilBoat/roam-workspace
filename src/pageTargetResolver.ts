import {
    App,
    CachedMetadata,
    HeadingSubpathResult,
    parseLinktext,
    resolveSubpath,
    TFile,
} from "obsidian";
import type { PageTarget, ResolvedPageTarget } from "./roamTypes";

const INTERNAL_LINK_SELECTOR = "a.internal-link, span.cm-hmd-internal-link, .internal-link";

export function buildFileTarget(file: TFile, source: PageTarget["source"]): PageTarget {
    return {
        path: file.path,
        kind: "file",
        source,
        label: file.basename,
    };
}

export function resolveLineTarget(
    file: TFile,
    line: number,
    col = 0,
    source: PageTarget["source"] = "navigation",
    label?: string
): PageTarget {
    return {
        path: file.path,
        kind: "line",
        line: Math.max(0, line),
        col: Math.max(0, col),
        source,
        label,
    };
}

export function resolveTargetLineFromCache(
    cache: CachedMetadata | null,
    target: PageTarget
): { line?: number; col?: number; missing: boolean } {
    if (!cache) {
        return {
            line: target.line,
            col: target.col,
            missing: target.kind !== "file" && target.line === undefined,
        };
    }

    if (typeof target.line === "number") {
        return { line: target.line, col: target.col ?? 0, missing: false };
    }

    if (!target.subpath) {
        return { missing: false };
    }

    const result = resolveSubpath(cache, target.subpath);
    if (!result) {
        return { missing: true };
    }

    if (result.type === "heading") {
        const headingResult = result as HeadingSubpathResult;
        return {
            line: headingResult.current.position.start.line,
            col: headingResult.current.position.start.col,
            missing: false,
        };
    }

    if (result.type === "block") {
        return {
            line: result.block.position.start.line,
            col: result.block.position.start.col,
            missing: false,
        };
    }

    return { missing: true };
}

export function resolveInternalLinkTarget(
    app: App,
    linktext: string,
    sourcePath: string
): ResolvedPageTarget | null {
    const parsed = parseLinktext(linktext);
    const file = app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath);
    if (!(file instanceof TFile)) return null;

    const subpath = parsed.subpath || undefined;
    const kind = subpath?.startsWith("#^")
        ? "block"
        : subpath?.startsWith("#")
            ? "heading"
            : "file";

    return {
        file,
        path: file.path,
        subpath,
        kind,
        source: "link",
        label: subpath ? `${file.basename}${subpath}` : file.basename,
    };
}

export function findInternalLinkElement(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest(INTERNAL_LINK_SELECTOR);
}

export function readLinktextFromElement(el: HTMLElement): string | null {
    const href = el.getAttribute("href");
    if (href?.trim()) return decodeURIComponent(href.trim());

    const dataHref = el.getAttribute("data-href");
    if (dataHref?.trim()) return dataHref.trim();

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const text = el.textContent?.trim();
    return text || null;
}
