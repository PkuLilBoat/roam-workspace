import { getIcon, Menu, type App, type MenuItem, type TFile } from "obsidian";
import {
    selectHighestPriorityFileClass,
    selectMetadataMenuTargetAction,
    supportsMetadataMenuTargetedActions,
    type MetadataMenuActionDescriptor,
    type MetadataMenuTarget,
} from "./metadataMenuContracts";

const METADATA_MENU_PLUGIN_ID = "metadata-menu";
const METADATA_MENU_INDEXED_EVENT = "metadata-menu:indexed";
const FALLBACK_FILE_ICON = "file-text";

export type FileClassIconResolution = {
    fileClassName: string | null;
    icon: string;
    source: "file-class" | "fallback";
};

export class MetadataMenuAdapter {
    constructor(private readonly app: App) {}

    subscribeToFileClassIndex(callback: () => void): (() => void) | null {
        const metadataCache = this.app.metadataCache;
        const on = readProperty(metadataCache, "on");
        const offref = readProperty(metadataCache, "offref");
        if (!isUnknownFunction(on) || !isUnknownFunction(offref)) return null;

        const eventRef = on.call(
            metadataCache,
            METADATA_MENU_INDEXED_EVENT,
            callback
        ) as unknown;
        return () => {
            offref.call(metadataCache, eventRef);
        };
    }

    isFileClassCapabilityReady(): boolean {
        return this.getCompatibleReadyPlugin() !== null;
    }

    getCapabilitySignature(): string {
        const plugin = this.getPlugin();
        if (!plugin) return "disabled";
        const version = readString(readProperty(plugin, "manifest"), "version") ?? "unknown";
        const launched = readProperty(plugin, "launched") === true;
        return `${version}:${launched ? "ready" : "indexing"}`;
    }

    resolveFileClassIcon(file: TFile): FileClassIconResolution {
        const plugin = this.getCompatibleReadyPlugin();
        if (!plugin) return fallbackResolution();
        const fileClass = this.getHighestPriorityFileClass(plugin, file);
        if (!fileClass) return fallbackResolution();

        const name = readString(fileClass, "name");
        const icon = callStringMethod(fileClass, "getIcon");
        if (!name || !icon || getIcon(icon) === null) {
            return { fileClassName: name, icon: FALLBACK_FILE_ICON, source: "fallback" };
        }
        return { fileClassName: name, icon, source: "file-class" };
    }

    openTargetedActions(file: TFile, event: MouseEvent): boolean {
        const plugin = this.getCompatibleReadyPlugin();
        if (!plugin) return false;

        const contextMenu = readProperty(plugin, "contextMenu");
        if (!isObject(contextMenu)) return false;
        const buildOptions = readProperty(contextMenu, "buildOptions");
        if (!isUnknownFunction(buildOptions)) return false;

        const menu = new Menu();
        const captured: MetadataMenuActionDescriptor<TargetedAction>[] = [];
        const interceptedMenu = createInterceptingMenu(menu, captured);
        try {
            this.buildExpandedOptions(plugin, contextMenu, buildOptions, file, interceptedMenu);
            const target: MetadataMenuTarget = this.getHighestPriorityFileClass(
                plugin,
                file
            )
                ? "open-fields"
                : "add-file-class";
            const action = selectMetadataMenuTargetAction(
                captured,
                target,
                file.basename
            );
            if (!action) {
                menu.close();
                return this.showNativeMenu(contextMenu, buildOptions, file, event);
            }

            menu.close();
            const result = action(event);
            if (isPromiseLike(result)) {
                void Promise.resolve(result).catch(() => {
                    this.showNativeMenu(contextMenu, buildOptions, file, event);
                });
            }
            return true;
        } catch {
            menu.close();
            return this.showNativeMenu(contextMenu, buildOptions, file, event);
        }
    }

    private buildExpandedOptions(
        plugin: object,
        contextMenu: object,
        buildOptions: (this: unknown, ...args: unknown[]) => unknown,
        file: TFile,
        menu: Menu
    ): void {
        const settings = readProperty(plugin, "settings");
        if (!isObject(settings)) {
            buildOptions.call(contextMenu, file, menu);
            return;
        }

        const original = readProperty(settings, "displayFieldsInContextMenu");
        if (typeof original !== "boolean" || original) {
            buildOptions.call(contextMenu, file, menu);
            return;
        }

        try {
            Reflect.set(settings, "displayFieldsInContextMenu", true);
            buildOptions.call(contextMenu, file, menu);
        } finally {
            Reflect.set(settings, "displayFieldsInContextMenu", original);
        }
    }

    private showNativeMenu(
        contextMenu: object,
        buildOptions: (this: unknown, ...args: unknown[]) => unknown,
        file: TFile,
        event: MouseEvent
    ): boolean {
        const fallbackMenu = new Menu();
        try {
            buildOptions.call(contextMenu, file, fallbackMenu);
            fallbackMenu.showAtMouseEvent(event);
            return true;
        } catch {
            fallbackMenu.close();
            return false;
        }
    }

    private getHighestPriorityFileClass(plugin: object, file: TFile): object | null {
        const fieldIndex = readProperty(plugin, "fieldIndex");
        const filesFileClasses = readProperty(fieldIndex, "filesFileClasses");
        const mapped = callMapGet(filesFileClasses, file.path)?.filter(isFileClassLike);
        return selectHighestPriorityFileClass(mapped, () => true);
    }

    private getCompatibleReadyPlugin(): object | null {
        const plugin = this.getPlugin();
        if (!plugin) return null;

        const manifest = readProperty(plugin, "manifest");
        const version = readString(manifest, "version");
        if (!version || !supportsMetadataMenuTargetedActions(version)) return null;
        if (readProperty(plugin, "launched") !== true) return null;
        return plugin;
    }

    private getPlugin(): object | null {
        const plugins = readProperty(this.app, "plugins");
        if (!isObject(plugins) || !isPluginEnabled(plugins, METADATA_MENU_PLUGIN_ID)) {
            return null;
        }

        const getPlugin = readProperty(plugins, "getPlugin");
        if (isUnknownFunction(getPlugin)) {
            const plugin = getPlugin.call(plugins, METADATA_MENU_PLUGIN_ID) as unknown;
            if (isObject(plugin)) return plugin;
        }

        const installed = readProperty(plugins, "plugins");
        const plugin = readProperty(installed, METADATA_MENU_PLUGIN_ID);
        return isObject(plugin) ? plugin : null;
    }
}

type TargetedAction = (event: MouseEvent | KeyboardEvent) => unknown;

function createInterceptingMenu(
    menu: Menu,
    captured: MetadataMenuActionDescriptor<TargetedAction>[]
): Menu {
    return new Proxy(menu, {
        get(target, property) {
            if (property === "addItem") {
                return (callback: (item: MenuItem) => unknown): Menu => {
                    target.addItem((item) => {
                        const descriptor: MetadataMenuActionDescriptor<TargetedAction> = {
                            title: null,
                            icon: null,
                            section: null,
                            action: null,
                        };
                        captured.push(descriptor);
                        callback(createInterceptingMenuItem(item, descriptor));
                    });
                    return menu;
                };
            }
            const value: unknown = Reflect.get(target, property);
            return isUnknownFunction(value) ? bindUnknownMethod(value, target) : value;
        },
    });
}

function createInterceptingMenuItem(
    item: MenuItem,
    descriptor: MetadataMenuActionDescriptor<TargetedAction>
): MenuItem {
    const proxy = new Proxy(item, {
        get(target, property) {
            if (property === "setTitle") {
                return (title: string | DocumentFragment): MenuItem => {
                    descriptor.title = typeof title === "string" ? title : null;
                    target.setTitle(title);
                    return proxy;
                };
            }
            if (property === "setIcon") {
                return (icon: string | null): MenuItem => {
                    descriptor.icon = icon;
                    target.setIcon(icon);
                    return proxy;
                };
            }
            if (property === "setSection") {
                return (section: string): MenuItem => {
                    descriptor.section = section;
                    target.setSection(section);
                    return proxy;
                };
            }
            if (property === "onClick") {
                return (action: TargetedAction): MenuItem => {
                    descriptor.action = action;
                    target.onClick(action);
                    return proxy;
                };
            }
            const value: unknown = Reflect.get(target, property);
            return isUnknownFunction(value) ? bindUnknownMethod(value, target) : value;
        },
    });
    return proxy;
}

function fallbackResolution(): FileClassIconResolution {
    return { fileClassName: null, icon: FALLBACK_FILE_ICON, source: "fallback" };
}

function isFileClassLike(value: unknown): value is object {
    return isObject(value) && typeof readString(value, "name") === "string";
}

function isPluginEnabled(plugins: object, id: string): boolean {
    const enabledPlugins = readProperty(plugins, "enabledPlugins");
    const has = readProperty(enabledPlugins, "has");
    if (!isUnknownFunction(has)) return false;
    return has.call(enabledPlugins, id) === true;
}

function callMapGet(value: unknown, key: string): unknown[] | null {
    const get = readProperty(value, "get");
    if (!isUnknownFunction(get)) return null;
    const result = get.call(value, key) as unknown;
    return Array.isArray(result) ? result : null;
}

function callStringMethod(value: unknown, key: string): string | null {
    const method = readProperty(value, key);
    if (!isUnknownFunction(method)) return null;
    try {
        const result = method.call(value) as unknown;
        return typeof result === "string" && result.trim() ? result.trim() : null;
    } catch {
        return null;
    }
}

function readString(value: unknown, key: string): string | null {
    const result = readProperty(value, key);
    return typeof result === "string" && result.trim() ? result.trim() : null;
}

function readProperty(value: unknown, key: string): unknown {
    if (!isObject(value)) return undefined;
    return Reflect.get(value, key);
}

function isObject(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isUnknownFunction(
    value: unknown
): value is (this: unknown, ...args: unknown[]) => unknown {
    return typeof value === "function";
}

function bindUnknownMethod(
    method: (this: unknown, ...args: unknown[]) => unknown,
    target: object
): (...args: unknown[]) => unknown {
    return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(method, target, args);
        return result;
    };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return isObject(value) && typeof readProperty(value, "then") === "function";
}
