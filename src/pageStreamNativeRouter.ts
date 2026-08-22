import {
    Keymap,
    OpenViewState,
    PaneType,
    TFile,
    Workspace,
    WorkspaceLeaf,
} from "obsidian";
import { around } from "monkey-around";
import type DailyNoteViewPlugin from "./dailyNoteViewIndex";
import {
    findInternalLinkElement,
    readLinktextFromElement,
    resolveInternalLinkTarget,
} from "./pageTargetResolver";
import {
    NativeRouteState,
    PAGE_STREAM_NATIVE_ROUTE_TTL_MS,
    shouldRouteSplitToPageStream,
} from "./pageStreamRoutePolicy";

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
    private routeState: NativeRouteState | null = null;
    private fallbackTimer: number | null = null;

    constructor(private readonly plugin: DailyNoteViewPlugin) {}

    install(): void {
        this.plugin.registerDomEvent(
            document,
            "click",
            (event) => this.recordTrigger(event),
            { capture: true }
        );

        this.patchKeymap();
        this.patchOpenLinkText();
        this.patchOpenFile();
        this.plugin.register(() => this.clearFallbackTimer());
    }

    private recordTrigger(event: MouseEvent): void {
        if (event.defaultPrevented || !isPlainShiftClick(event)) return;
        const sourceFile = this.plugin.app.workspace.getActiveFile();
        const linkEl = findInternalLinkElement(event.target);
        const fallbackLinktext = linkEl
            ? readLinktextFromElement(linkEl) ?? undefined
            : undefined;
        if (fallbackLinktext) {
            const resolved = resolveInternalLinkTarget(
                this.plugin.app,
                fallbackLinktext,
                sourceFile?.path ?? ""
            );
            if (resolved?.file instanceof TFile) {
                event.preventDefault();
                event.stopPropagation();
                this.clearRoute();
                void this.plugin.pushFileToPageStream(resolved.file, "link", resolved, {
                    active: false,
                    reveal: true,
                });
                return;
            }
        }
        this.routeState = {
            triggeredAt: Date.now(),
            sourcePath: sourceFile?.path ?? "",
            fallbackLinktext,
        };
        this.scheduleDomFallback(this.routeState);
    }

    private patchKeymap(): void {
        const plugin = this.plugin;
        const isFreshRoute = () => this.isFreshRoute();
        const uninstaller = around(Keymap, {
            isModEvent(next) {
                return function (event?: unknown): PaneType | boolean {
                    if (
                        event instanceof MouseEvent &&
                        isPlainShiftClick(event) &&
                        isFreshRoute()
                    ) {
                        return "split";
                    }
                    return next.call(this, event);
                };
            },
            isModifier(next) {
                return function (event: unknown, modifier: unknown): boolean {
                    if (
                        modifier === "Mod" &&
                        event instanceof MouseEvent &&
                        isPlainShiftClick(event) &&
                        isFreshRoute()
                    ) {
                        return true;
                    }
                    return next.call(this, event, modifier);
                };
            },
        });
        plugin.register(uninstaller);
    }

    private patchOpenLinkText(): void {
        const plugin = this.plugin;
        const routeOpenLinkText = this.routeOpenLinkText.bind(this);
        const uninstaller = around(Workspace.prototype, {
            openLinkText(next) {
                return async function (
                    linktext: string,
                    sourcePath: string,
                    newLeaf?: PaneType | boolean,
                    openViewState?: OpenViewState
                ): Promise<void> {
                    const routed = await routeOpenLinkText(
                        linktext,
                        sourcePath,
                        newLeaf
                    );
                    if (routed) return;

                    return next.call(
                        this,
                        linktext,
                        sourcePath,
                        newLeaf,
                        openViewState
                    );
                };
            },
        });
        plugin.register(uninstaller);
    }

    private patchOpenFile(): void {
        const plugin = this.plugin;
        const routeOpenFile = this.routeOpenFile.bind(this);
        const uninstaller = around(WorkspaceLeaf.prototype, {
            openFile(next) {
                return async function (
                    file: TFile,
                    openState?: OpenViewState
                ): Promise<void> {
                    const routed = await routeOpenFile(file);
                    if (routed) return;

                    return next.call(this, file, openState);
                };
            },
        });
        plugin.register(uninstaller);
    }

    private async routeOpenLinkText(
        linktext: string,
        sourcePath: string,
        newLeaf?: PaneType | boolean
    ): Promise<boolean> {
        if (
            !shouldRouteSplitToPageStream(this.routeState, Date.now(), newLeaf)
        ) {
            return false;
        }

        const resolved = resolveInternalLinkTarget(
            this.plugin.app,
            linktext,
            sourcePath || this.routeState?.sourcePath || ""
        );
        this.clearRoute();
        if (resolved?.file instanceof TFile) {
            await this.plugin.pushFileToPageStream(resolved.file, "link", resolved, {
                active: false,
                reveal: true,
            });
            return true;
        }
        return false;
    }

    private async routeOpenFile(file: TFile): Promise<boolean> {
        if (!this.isFreshRoute() || !(file instanceof TFile) || file.extension !== "md") {
            return false;
        }

        this.clearRoute();
        await this.plugin.pushFileToPageStream(file, "navigation", undefined, {
            active: false,
            reveal: true,
        });
        return true;
    }

    private scheduleDomFallback(state: NativeRouteState): void {
        this.clearFallbackTimer();
        if (!state.fallbackLinktext) return;
        this.fallbackTimer = window.setTimeout(() => {
            this.fallbackTimer = null;
            if (this.routeState !== state || !this.isFreshRoute()) return;
            const resolved = resolveInternalLinkTarget(
                this.plugin.app,
                state.fallbackLinktext ?? "",
                state.sourcePath
            );
            this.clearRoute();
            if (resolved?.file instanceof TFile) {
                void this.plugin.pushFileToPageStream(resolved.file, "link", resolved, {
                    active: false,
                    reveal: true,
                });
            }
        }, 120);
    }

    private isFreshRoute(): boolean {
        return (
            !!this.routeState &&
            Date.now() - this.routeState.triggeredAt >= 0 &&
            Date.now() - this.routeState.triggeredAt <=
                PAGE_STREAM_NATIVE_ROUTE_TTL_MS
        );
    }

    private clearRoute(): void {
        this.routeState = null;
        this.clearFallbackTimer();
    }

    private clearFallbackTimer(): void {
        if (this.fallbackTimer !== null) {
            window.clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
        }
    }
}
