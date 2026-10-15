import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const OLD_ID = "journal-stream-dne-spike";
const NEW_ID = "roam-workspace";
const BUNDLE_FILES = ["main.js", "manifest.json", "styles.css"];

export async function migrateTestPluginId({ sourceRoot, vaultRoot, backupDir }) {
    const pluginsDir = path.join(vaultRoot, ".obsidian", "plugins");
    const oldDir = path.join(pluginsDir, OLD_ID);
    const newDir = path.join(pluginsDir, NEW_ID);
    const stagedDir = path.join(pluginsDir, `.${NEW_ID}.${process.pid}.installing`);
    const communityPath = path.join(vaultRoot, ".obsidian", "community-plugins.json");
    const hotkeysPath = path.join(vaultRoot, ".obsidian", "hotkeys.json");
    const buildInfo = JSON.parse(await readFile(path.join(sourceRoot, "artifacts", "current-build-info.json"), "utf8"));
    const sourceManifest = JSON.parse(await readFile(path.join(sourceRoot, "manifest.json"), "utf8"));
    const oldManifest = JSON.parse(await readFile(path.join(oldDir, "manifest.json"), "utf8"));
    if (sourceManifest.id !== NEW_ID || oldManifest.id !== OLD_ID || buildInfo.manifestId !== NEW_ID) {
        throw new Error("Plugin manifest identity mismatch");
    }
    if (buildInfo.manifestVersion !== sourceManifest.version) {
        throw new Error("Build and source manifest versions differ");
    }
    for (const filename of BUNDLE_FILES) {
        if (await sha256(path.join(sourceRoot, filename)) !== buildInfo.artifactHashes?.[filename]) {
            throw new Error(`Unverified source artifact: ${filename}`);
        }
    }
    if (await exists(newDir) || await exists(stagedDir) || await exists(backupDir)) {
        throw new Error("New plugin, staging, or backup directory already exists");
    }
    const community = JSON.parse(await readFile(communityPath, "utf8"));
    if (!Array.isArray(community) || !community.includes(OLD_ID) || community.includes(NEW_ID)) {
        throw new Error("Expected only the old plugin ID to be enabled");
    }
    if (community.includes("daily-notes-editor")) {
        throw new Error("Daily Notes Editor must be disabled in TEST");
    }
    const hotkeysExists = await exists(hotkeysPath);
    const hotkeys = hotkeysExists ? JSON.parse(await readFile(hotkeysPath, "utf8")) : {};
    const migratedHotkeys = { ...hotkeys };
    for (const [commandId, binding] of Object.entries(hotkeys)) {
        if (!commandId.startsWith(`${OLD_ID}:`)) continue;
        const replacement = `${NEW_ID}:${commandId.slice(OLD_ID.length + 1)}`;
        if (Object.hasOwn(migratedHotkeys, replacement)) {
            throw new Error(`Hotkey command conflict: ${replacement}`);
        }
        migratedHotkeys[replacement] = binding;
        delete migratedHotkeys[commandId];
    }
    const dataPath = path.join(oldDir, "data.json");
    if (await exists(dataPath)) JSON.parse(await readFile(dataPath, "utf8"));
    await mkdir(backupDir, { recursive: false });
    await cp(oldDir, path.join(backupDir, OLD_ID), { recursive: true });
    await copyFile(communityPath, path.join(backupDir, "community-plugins.json"));
    if (hotkeysExists) await copyFile(hotkeysPath, path.join(backupDir, "hotkeys.json"));

    let newInstalled = false;
    try {
        await mkdir(stagedDir);
        for (const filename of BUNDLE_FILES) {
            await copyFile(path.join(sourceRoot, filename), path.join(stagedDir, filename));
        }
        if (await exists(dataPath)) await copyFile(dataPath, path.join(stagedDir, "data.json"));
        await rename(stagedDir, newDir);
        newInstalled = true;
        if (hotkeysExists) await atomicJsonWrite(hotkeysPath, migratedHotkeys);
        await atomicJsonWrite(communityPath, community.map((id) => id === OLD_ID ? NEW_ID : id));
        for (const filename of BUNDLE_FILES) {
            if (await sha256(path.join(newDir, filename)) !== buildInfo.artifactHashes[filename]) {
                throw new Error(`Installed artifact mismatch: ${filename}`);
            }
        }
        if (await exists(dataPath) && await sha256(dataPath) !== await sha256(path.join(newDir, "data.json"))) {
            throw new Error("Migrated data.json hash mismatch");
        }
    } catch (error) {
        await copyFile(path.join(backupDir, "community-plugins.json"), communityPath);
        if (hotkeysExists) await copyFile(path.join(backupDir, "hotkeys.json"), hotkeysPath);
        if (newInstalled) await rm(newDir, { recursive: true, force: true });
        await rm(stagedDir, { recursive: true, force: true });
        throw error;
    }
    const record = {
        migratedAt: new Date().toISOString(),
        sourceRoot,
        vaultRoot,
        backupDir,
        oldId: OLD_ID,
        newId: NEW_ID,
        buildId: buildInfo.buildId,
        artifactHashes: buildInfo.artifactHashes,
        dataHash: await exists(dataPath) ? await sha256(dataPath) : null,
        oldPluginRetainedDisabled: true,
    };
    await writeFile(path.join(backupDir, "migration-record.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
}

async function atomicJsonWrite(filePath, value) {
    const stagedPath = `${filePath}.${process.pid}.installing`;
    await writeFile(stagedPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(stagedPath, filePath);
}

async function exists(filePath) {
    try { await stat(filePath); return true; } catch { return false; }
}

async function sha256(filePath) {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const option = process.argv.find((arg) => arg.startsWith("--backup-dir="));
    if (!option) throw new Error("Usage: node scripts/migrate-test-plugin-id.mjs --backup-dir=<new-directory>");
    const sourceRoot = process.cwd();
    const vaultRoot = resolveTestVaultRoot();
    const backupDir = path.resolve(option.slice("--backup-dir=".length));
    const testExecutable = "/Users/feng/Applications/Obsidian TEST Bundle.app/Contents/MacOS/Obsidian";
    const processes = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" });
    if (processes.split("\n").some((line) => line === testExecutable || line.startsWith(`${testExecutable} `))) {
        throw new Error("Quit the independent Obsidian TEST Bundle before migrating its plugin ID");
    }
    if (backupDir.startsWith(`${vaultRoot}${path.sep}`)) {
        throw new Error("Backup must be outside the TEST vault");
    }
    console.log(JSON.stringify(await migrateTestPluginId({ sourceRoot, vaultRoot, backupDir }), null, 2));
}
