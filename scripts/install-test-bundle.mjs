import { createHash } from "node:crypto";
import {
    copyFile,
    mkdir,
    readFile,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

export const PLUGIN_ID = "roam-workspace";
export const BUNDLE_FILES = ["main.js", "manifest.json", "styles.css"];

export async function installBundle({ sourceRoot, installedPluginDir, backupDir }) {
    assertSeparateDirectories(sourceRoot, installedPluginDir, backupDir);
    const buildInfo = JSON.parse(
        await readFile(path.join(sourceRoot, "artifacts", "current-build-info.json"), "utf8")
    );
    const sourceManifest = JSON.parse(
        await readFile(path.join(sourceRoot, "manifest.json"), "utf8")
    );
    const installedManifest = JSON.parse(
        await readFile(path.join(installedPluginDir, "manifest.json"), "utf8")
    );
    assertManifestIdentity(sourceManifest, installedManifest, buildInfo);
    await assertSourceArtifacts(sourceRoot, buildInfo);

    await mkdir(backupDir, { recursive: true });
    const beforeHashes = {};
    const afterHashes = {};
    const stagedPaths = [];
    try {
        for (const filename of BUNDLE_FILES) {
            const installedPath = path.join(installedPluginDir, filename);
            const backupPath = path.join(backupDir, filename);
            await assertFile(installedPath);
            if (await exists(backupPath)) {
                throw new Error(`Backup target already exists: ${backupPath}`);
            }
            await copyFile(installedPath, backupPath);
            beforeHashes[filename] = await sha256(backupPath);

            const stagedPath = path.join(
                installedPluginDir,
                `.${filename}.${process.pid}.installing`
            );
            await copyFile(path.join(sourceRoot, filename), stagedPath);
            stagedPaths.push(stagedPath);
        }

        for (const filename of BUNDLE_FILES) {
            const stagedPath = path.join(
                installedPluginDir,
                `.${filename}.${process.pid}.installing`
            );
            await rename(stagedPath, path.join(installedPluginDir, filename));
        }

        for (const filename of BUNDLE_FILES) {
            const installedHash = await sha256(path.join(installedPluginDir, filename));
            const expectedHash = buildInfo.artifactHashes?.[filename];
            if (installedHash !== expectedHash) {
                throw new Error(
                    `Installed ${filename} hash mismatch: expected=${expectedHash} actual=${installedHash}`
                );
            }
            afterHashes[filename] = installedHash;
        }
    } catch (error) {
        await Promise.all(stagedPaths.map((stagedPath) => rm(stagedPath, { force: true })));
        await restoreAvailableBackups(backupDir, installedPluginDir);
        throw error;
    }

    const record = {
        installedAt: new Date().toISOString(),
        sourceRoot,
        installedPluginDir,
        buildFingerprint: pickFingerprint(buildInfo),
        beforeHashes,
        afterHashes,
    };
    await writeFile(
        path.join(backupDir, "install-record.json"),
        `${JSON.stringify(record, null, 2)}\n`
    );
    return record;
}

function assertManifestIdentity(sourceManifest, installedManifest, buildInfo) {
    for (const [label, manifest] of [
        ["source", sourceManifest],
        ["installed", installedManifest],
    ]) {
        if (manifest.id !== PLUGIN_ID) {
            throw new Error(`${label} manifest id must be ${PLUGIN_ID}, got ${manifest.id}`);
        }
    }
    if (
        buildInfo.manifestId !== sourceManifest.id ||
        buildInfo.manifestVersion !== sourceManifest.version
    ) {
        throw new Error("Build fingerprint manifest identity does not match source manifest");
    }
}

async function assertSourceArtifacts(sourceRoot, buildInfo) {
    for (const filename of BUNDLE_FILES) {
        const actualHash = await sha256(path.join(sourceRoot, filename));
        const expectedHash = buildInfo.artifactHashes?.[filename];
        if (!expectedHash || actualHash !== expectedHash) {
            throw new Error(
                `Source ${filename} does not match current build info: expected=${expectedHash} actual=${actualHash}`
            );
        }
    }
}

function assertSeparateDirectories(sourceRoot, installedPluginDir, backupDir) {
    const values = [sourceRoot, installedPluginDir, backupDir].map((value) =>
        path.resolve(value)
    );
    if (new Set(values).size !== values.length) {
        throw new Error("Source, installed plugin, and backup directories must be distinct");
    }
}

async function restoreAvailableBackups(backupDir, installedPluginDir) {
    for (const filename of BUNDLE_FILES) {
        const backupPath = path.join(backupDir, filename);
        if (await exists(backupPath)) {
            await copyFile(backupPath, path.join(installedPluginDir, filename));
        }
    }
}

async function assertFile(filePath) {
    if (!(await stat(filePath)).isFile()) {
        throw new Error(`Expected file: ${filePath}`);
    }
}

async function exists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function sha256(filePath) {
    return createHash("sha256")
        .update(await readFile(filePath))
        .digest("hex");
}

function pickFingerprint(buildInfo) {
    const {
        head,
        dirty,
        sourceStateHash,
        buildId,
        builtAt,
        manifestId,
        manifestVersion,
    } = buildInfo;
    return {
        head,
        dirty,
        sourceStateHash,
        buildId,
        builtAt,
        manifestId,
        manifestVersion,
    };
}

async function main() {
    const sourceRoot = process.cwd();
    const vaultRoot = resolveTestVaultRoot();
    const installedPluginDir = path.join(
        vaultRoot,
        ".obsidian",
        "plugins",
        PLUGIN_ID
    );
    const enabledPlugins = JSON.parse(
        await readFile(path.join(vaultRoot, ".obsidian", "community-plugins.json"), "utf8")
    );
    if (!enabledPlugins.includes(PLUGIN_ID)) {
        throw new Error(`${PLUGIN_ID} must be enabled before deployment`);
    }
    if (enabledPlugins.includes("daily-notes-editor")) {
        throw new Error("daily-notes-editor must be disabled for the BASE-02 baseline");
    }

    const backupOption = process.argv.find((argument) =>
        argument.startsWith("--backup-dir=")
    );
    if (!backupOption) {
        throw new Error("Usage: pnpm install:test -- --backup-dir=<empty-directory>");
    }
    const backupDir = path.resolve(backupOption.slice("--backup-dir=".length));
    const record = await installBundle({ sourceRoot, installedPluginDir, backupDir });
    console.log(`Installed Journal Stream build ${record.buildFingerprint.buildId}`);
    console.log(`Backup: ${backupDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    await main();
}
