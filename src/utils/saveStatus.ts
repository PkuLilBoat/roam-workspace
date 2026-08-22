export const LOCAL_SAVE_CONFIRM_WINDOW_MS = 5000;
export const SAVE_NOT_CONFIRMED_MS = 5000;

export function isLocalSaveConfirmation(
    now: number,
    lastLocalEditAt: number,
    windowMs: number = LOCAL_SAVE_CONFIRM_WINDOW_MS
): boolean {
    if (lastLocalEditAt <= 0) return false;
    return now - lastLocalEditAt <= windowMs;
}

export function shouldShowSaveNotConfirmed(
    now: number,
    lastLocalEditAt: number,
    timeoutMs: number = SAVE_NOT_CONFIRMED_MS
): boolean {
    if (lastLocalEditAt <= 0) return false;
    return now - lastLocalEditAt >= timeoutMs - 500;
}

export interface SaveStatusKeyEventLike {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
}

export function isTextChangingKey(event: SaveStatusKeyEventLike): boolean {
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key.length === 1) {
        return !event.altKey;
    }

    return [
        "Backspace",
        "Delete",
        "Enter",
        "Tab",
    ].includes(event.key);
}
