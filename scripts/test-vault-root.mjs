import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export const TEST_VAULT_ROOT = "/Users/feng/Documents/OBSIDIAN/TEST";

export function resolveTestVaultRoot(environment = process.env) {
    const configuredRoot =
        environment.JOURNAL_STREAM_VAULT_ROOT ?? TEST_VAULT_ROOT;

    if (typeof configuredRoot !== "string" || configuredRoot.trim() === "") {
        throw new Error("JOURNAL_STREAM_VAULT_ROOT must be a non-empty path");
    }

    if (!path.isAbsolute(configuredRoot)) {
        throw new Error(
            `JOURNAL_STREAM_VAULT_ROOT must be absolute: ${configuredRoot}`
        );
    }

    const resolvedRoot = path.resolve(configuredRoot);
    const expectedRoot = path.resolve(TEST_VAULT_ROOT);
    if (resolvedRoot !== expectedRoot) {
        throw new Error(
            `Refusing non-TEST vault root: ${resolvedRoot}; expected ${expectedRoot}`
        );
    }

    const rootStat = statSync(resolvedRoot);
    if (!rootStat.isDirectory()) {
        throw new Error(`TEST vault root is not a directory: ${resolvedRoot}`);
    }

    const canonicalRoot = realpathSync(resolvedRoot);
    if (canonicalRoot !== expectedRoot) {
        throw new Error(
            `TEST vault must not resolve through a symlink: ${canonicalRoot}; expected ${expectedRoot}`
        );
    }

    return expectedRoot;
}

export function resolveTestVaultPath(relativePath, environment = process.env) {
    if (typeof relativePath !== "string" || relativePath.trim() === "") {
        throw new Error("TEST vault relative path must be a non-empty string");
    }

    if (path.isAbsolute(relativePath)) {
        throw new Error(`TEST vault path must be relative: ${relativePath}`);
    }

    const root = resolveTestVaultRoot(environment);
    const target = path.resolve(root, relativePath);
    const relativeTarget = path.relative(root, target);
    if (
        relativeTarget === "" ||
        relativeTarget === ".." ||
        relativeTarget.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeTarget)
    ) {
        throw new Error(`Refusing path outside TEST vault: ${relativePath}`);
    }

    return target;
}

export function assertTestVaultPayloadRoot(
    payloadRoot,
    label = "Payload",
    environment = process.env
) {
    const expectedRoot = resolveTestVaultRoot(environment);
    if (payloadRoot !== expectedRoot) {
        throw new Error(
            `${label} vaultRoot must be ${expectedRoot}, got ${payloadRoot}`
        );
    }

    return expectedRoot;
}
