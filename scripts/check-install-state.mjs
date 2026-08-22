import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const pluginId = "roam-in-ob";
const vaultRoot = process.env.ROAM_IN_OB_VAULT_ROOT;
if (!vaultRoot) {
    throw new Error("Set ROAM_IN_OB_VAULT_ROOT to the test vault path.");
}
const installedPluginDir = path.join(vaultRoot, ".obsidian", "plugins", pluginId);
const sourceRoot = process.cwd();
const requiredFiles = ["manifest.json", "main.js", "styles.css"];
const failures = [];
const warnings = [];

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
    }
}

async function checkManifest() {
    const manifest = JSON.parse(
        await readFile(path.join(installedPluginDir, "manifest.json"), "utf8")
    );

    if (manifest.id !== pluginId) {
        failures.push(`Installed manifest id must be ${pluginId}, got ${manifest.id}`);
    }
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
            "workspace.json does not currently contain daily-note-editor-view; install state is OK but UI view is not open/restored"
        );
        return;
    }

    const workspace = JSON.parse(workspaceText);
    const matchingStates = [];
    collectDailyNoteEditorStates(workspace, matchingStates);

    if (matchingStates.length === 0) {
        warnings.push(
            "workspace.json contains daily-note-editor-view text but no parseable state object was found"
        );
        return;
    }

    console.log(
        `Workspace contains ${matchingStates.length} daily-note-editor-view state object(s)`
    );
}

function collectDailyNoteEditorStates(value, matches) {
    if (!value || typeof value !== "object") return;

    if (value.type === "daily-note-editor-view") {
        matches.push(value.state ?? {});
    }

    for (const child of Object.values(value)) {
        if (child && typeof child === "object") {
            collectDailyNoteEditorStates(child, matches);
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
