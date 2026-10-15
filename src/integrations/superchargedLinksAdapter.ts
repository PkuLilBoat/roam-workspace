import {
    getAllTags,
    normalizePath,
    type App,
    type TFile,
} from "obsidian";
import {
    buildSuperchargedLinkAttributes,
    createSuperchargedLinksStateSignature,
    isLatestAsyncGeneration,
    parseSuperchargedLinksSettings,
    toContractCssValue,
    type SuperchargedLinksSettings,
} from "./superchargedLinksContracts";

const SUPERCHARGED_LINKS_PLUGIN_ID = "supercharged-links-obsidian";
const CONTRACT_CLASSES = ["data-link-text", "data-link-icon", "data-link-icon-after"];

export class SuperchargedLinksAdapter {
    private enabled = false;
    private loadGeneration = 0;
    private settings: SuperchargedLinksSettings = {
        targetAttributes: [],
        targetTags: false,
    };

    constructor(private readonly app: App) {}

    async initialize(): Promise<boolean> {
        const generation = ++this.loadGeneration;
        const configDir = this.app.vault.configDir;
        const enabledPlugins = await this.readJson(
            normalizePath(`${configDir}/community-plugins.json`)
        );
        const enabled =
            Array.isArray(enabledPlugins) &&
            enabledPlugins.includes(SUPERCHARGED_LINKS_PLUGIN_ID);
        const settings = enabled
            ? parseSuperchargedLinksSettings(
                  await this.readJson(
                      normalizePath(
                          `${configDir}/plugins/${SUPERCHARGED_LINKS_PLUGIN_ID}/data.json`
                      )
                  )
              )
            : { targetAttributes: [], targetTags: false };
        if (!isLatestAsyncGeneration(generation, this.loadGeneration)) return false;

        const previousSignature = createSuperchargedLinksStateSignature(
            this.enabled,
            this.settings
        );
        const nextSignature = createSuperchargedLinksStateSignature(enabled, settings);
        this.enabled = enabled;
        this.settings = settings;
        return previousSignature !== nextSignature;
    }

    apply(element: HTMLElement, file: TFile): void {
        this.clear(element);
        if (!this.enabled) return;
        if (!this.settings.targetAttributes.length && !this.settings.targetTags) return;

        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return;
        const frontmatter = isRecord(cache.frontmatter) ? cache.frontmatter : null;
        const tags = getAllTags(cache) ?? [];
        const attributes = buildSuperchargedLinkAttributes(
            frontmatter,
            tags,
            file.path,
            this.settings
        );

        for (const [key, value] of Object.entries(attributes)) {
            element.setAttr(`data-link-${key}`, value);
            element.style.setProperty(`--data-link-${key}`, toContractCssValue(value));
        }
        element.addClass(...CONTRACT_CLASSES);
    }

    clear(element: HTMLElement): void {
        for (const attribute of Array.from(element.attributes)) {
            if (!attribute.name.startsWith("data-link-")) continue;
            element.removeAttribute(attribute.name);
            element.style.removeProperty(`--${attribute.name}`);
        }
        element.removeClass(...CONTRACT_CLASSES);
    }

    private async readJson(path: string): Promise<unknown> {
        try {
            const text = await this.app.vault.adapter.read(path);
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
