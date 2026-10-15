import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const pluginId = "roam-workspace";
const vaultRoot = resolveTestVaultRoot();
const installedPluginDir = path.join(vaultRoot, ".obsidian", "plugins", pluginId);
const sourceRoot = process.cwd();
const requiredFiles = ["manifest.json", "main.js", "styles.css"];
const failures = [];
const warnings = [];
const buildInfo = await readBuildInfo();

await checkCommunityPluginEnabled();
await checkInstalledFiles();
await checkManifest();
await checkWorkspaceState();

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(`Journal Stream install state OK: ${installedPluginDir}`);
if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) {
        console.log(`- ${warning}`);
    }
}

async function checkCommunityPluginEnabled() {
    const enabledPluginsPath = path.join(
        vaultRoot,
        ".obsidian",
        "community-plugins.json"
    );
    const enabledPlugins = JSON.parse(await readFile(enabledPluginsPath, "utf8"));

    if (!enabledPlugins.includes(pluginId)) {
        failures.push(`${pluginId} is not enabled in community-plugins.json`);
    }
}

async function checkInstalledFiles() {
    for (const filename of requiredFiles) {
        const sourcePath = path.join(sourceRoot, filename);
        const installedPath = path.join(installedPluginDir, filename);

        if (!(await isFile(installedPath))) {
            failures.push(`Installed plugin file missing: ${installedPath}`);
            continue;
        }

        const [sourceHash, installedHash] = await Promise.all([
            sha256(sourcePath),
            sha256(installedPath),
        ]);

        if (sourceHash !== installedHash) {
            failures.push(
                `Installed ${filename} hash mismatch: source=${sourceHash} installed=${installedHash}`
            );
        }
        const expectedHash = buildInfo.artifactHashes?.[filename];
        if (!expectedHash || sourceHash !== expectedHash) {
            failures.push(
                `Current build info ${filename} hash mismatch: expected=${expectedHash} source=${sourceHash}`
            );
        }
    }
}

async function checkManifest() {
    const manifest = JSON.parse(
        await readFile(path.join(installedPluginDir, "manifest.json"), "utf8")
    );

    if (manifest.id !== pluginId) {
        failures.push(`Installed manifest id must be ${pluginId}, got ${manifest.id}`);
    }
    if (
        buildInfo.manifestId !== manifest.id ||
        buildInfo.manifestVersion !== manifest.version
    ) {
        failures.push(
            `Build manifest identity mismatch: build=${buildInfo.manifestId}@${buildInfo.manifestVersion} installed=${manifest.id}@${manifest.version}`
        );
    }
}

async function readBuildInfo() {
    const buildInfoPath = path.join(
        sourceRoot,
        "artifacts",
        "current-build-info.json"
    );
    const value = JSON.parse(await readFile(buildInfoPath, "utf8"));
    for (const field of [
        "head",
        "sourceStateHash",
        "buildId",
        "builtAt",
        "manifestId",
        "manifestVersion",
        "artifactHashes",
    ]) {
        if (!value[field]) failures.push(`Current build info missing ${field}`);
    }
    if (typeof value.dirty !== "boolean") {
        failures.push("Current build info dirty must be boolean");
    }
    return value;
}

async function checkWorkspaceState() {
    const workspacePath = path.join(vaultRoot, ".obsidian", "workspace.json");
    if (!(await isFile(workspacePath))) {
        warnings.push("workspace.json is missing; cannot inspect restored view state");
        return;
    }

    const workspaceText = await readFile(workspacePath, "utf8");
    if (!workspaceText.includes("daily-note-editor-view")) {
        warnings.push(
            "workspace.json does not currently contain a Journal view; install state is OK but UI view is not open/restored"
        );
        return;
    }

    const workspace = JSON.parse(workspaceText);
    const journalStates = [];
    collectJournalStates(workspace, journalStates);

    if (journalStates.length === 0) {
        warnings.push(
            "workspace.json contains Journal view text but no parseable state object was found"
        );
        return;
    }

    console.log(
        `Workspace contains ${journalStates.length} canonical Journal view state object(s)`
    );
}

function collectJournalStates(value, matches) {
    if (!value || typeof value !== "object") return;

    if (value.type === "daily-note-editor-view") {
        matches.push(value.state ?? {});
    }

    for (const child of Object.values(value)) {
        if (child && typeof child === "object") {
            collectJournalStates(child, matches);
        }
    }
}

async function isFile(filePath) {
    try {
        return (await stat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function sha256(filePath) {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
}
