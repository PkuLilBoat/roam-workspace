import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OLD_ID = "journal-stream-dne-spike";
const NEW_ID = "roam-workspace";
const FILES = ["main.js", "manifest.json", "styles.css"];
const targets = JSON.parse(await readFile(new URL("./roam-workspace-release-targets.json", import.meta.url), "utf8"));
const mode = process.argv[2];
const backupOption = process.argv.find((arg) => arg.startsWith("--backup-root="));
if (!["plan", "apply", "verify"].includes(mode)) {
    throw new Error("Usage: node scripts/release-roam-workspace.mjs plan|apply|verify [--backup-root=<new-directory>]");
}

const source = await inspectSource();
const states = [];
for (const target of targets) states.push(await inspectTarget(target, source));
if (mode === "plan") {
    console.log(JSON.stringify({ source, targets: states }, null, 2));
} else if (mode === "verify") {
    const failures = states.filter((item) => item.status !== "installed");
    console.log(JSON.stringify({ source, targets: states }, null, 2));
    if (failures.length) process.exitCode = 1;
} else {
    if (!backupOption) throw new Error("--backup-root=<new-directory> is required for apply");
    if (states.some((item) => item.status !== "install" && item.status !== "migrate")) {
        throw new Error("Preflight found a conflict or previously installed target; no vaults changed");
    }
    const backupRoot = path.resolve(backupOption.slice("--backup-root=".length));
    if (await exists(backupRoot) || targets.some((target) => backupRoot === target.vault || backupRoot.startsWith(`${target.vault}${path.sep}`))) {
        throw new Error("Backup root must be new and outside every target vault");
    }
    await mkdir(backupRoot, { recursive: false });
    const ledger = { source, startedAt: new Date().toISOString(), targets: [] };
    for (const [index, target] of targets.entries()) {
        try {
            ledger.targets.push(await applyTarget(target, states[index], source, backupRoot, index));
            await writeFile(path.join(backupRoot, "release-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
        } catch (error) {
            ledger.failedTarget = target.vault;
            ledger.error = String(error);
            await writeFile(path.join(backupRoot, "release-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
            throw error;
        }
    }
    ledger.completedAt = new Date().toISOString();
    await writeFile(path.join(backupRoot, "release-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(JSON.stringify({ backupRoot, installed: ledger.targets.length, source }, null, 2));
}

async function inspectSource() {
    const branch = git(["branch", "--show-current"]);
    const head = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (branch !== "codex/journal-ui-cleanup" || dirty) {
        throw new Error(`Release source must be clean codex/journal-ui-cleanup; got ${branch}, dirty=${Boolean(dirty)}`);
    }
    const manifest = JSON.parse(await readFile(path.join(sourceRoot, "manifest.json"), "utf8"));
    const build = JSON.parse(await readFile(path.join(sourceRoot, "artifacts", "current-build-info.json"), "utf8"));
    if (manifest.id !== NEW_ID || build.head !== head || build.dirty || build.manifestId !== NEW_ID || build.manifestVersion !== manifest.version) {
        throw new Error("Source manifest or build fingerprint does not match clean merged HEAD");
    }
    for (const filename of FILES) {
        if (await sha256(path.join(sourceRoot, filename)) !== build.artifactHashes?.[filename]) {
            throw new Error(`Source artifact mismatch: ${filename}`);
        }
    }
    return { branch, head, buildId: build.buildId, id: manifest.id, version: manifest.version, hashes: build.artifactHashes };
}

async function inspectTarget(target, source) {
    const vault = target.vault;
    if (!path.isAbsolute(vault) || await realpath(vault) !== vault) throw new Error(`Invalid vault path: ${vault}`);
    const config = path.join(vault, ".obsidian");
    if (!(await stat(config)).isDirectory()) throw new Error(`Missing .obsidian: ${vault}`);
    const plugins = path.join(config, "plugins");
    const oldDir = path.join(plugins, OLD_ID);
    const newDir = path.join(plugins, NEW_ID);
    const enabledPath = path.join(config, "community-plugins.json");
    const enabled = await exists(enabledPath) ? JSON.parse(await readFile(enabledPath, "utf8")) : [];
    if (!Array.isArray(enabled)) throw new Error(`Invalid enabled plugin list: ${vault}`);
    if (enabled.includes(OLD_ID) && enabled.includes(NEW_ID)) throw new Error(`Both IDs enabled: ${vault}`);
    const oldExists = await exists(oldDir);
    const newExists = await exists(newDir);
    if (oldExists && JSON.parse(await readFile(path.join(oldDir, "manifest.json"), "utf8")).id !== OLD_ID) {
        throw new Error(`Old plugin directory has different manifest ID: ${vault}`);
    }
    let status = oldExists ? "migrate" : "install";
    if (newExists) {
        const manifest = JSON.parse(await readFile(path.join(newDir, "manifest.json"), "utf8"));
        status = manifest.id === NEW_ID && enabled.includes(NEW_ID) && !enabled.includes(OLD_ID) &&
            (await Promise.all(FILES.map(async (name) => await sha256(path.join(newDir, name)) === source.hashes[name]))).every(Boolean)
            ? "installed" : "conflict";
    }
    const hotkeysPath = path.join(config, "hotkeys.json");
    const hotkeys = await exists(hotkeysPath) ? JSON.parse(await readFile(hotkeysPath, "utf8")) : {};
    for (const key of Object.keys(hotkeys)) {
        if (!key.startsWith(`${OLD_ID}:`)) continue;
        const replacement = migratedCommandId(key);
        if (Object.hasOwn(hotkeys, replacement)) status = "conflict";
    }
    const journalPath = path.join(vault, target.journalFolder);
    if (target.journalFolder.includes("..") || path.isAbsolute(target.journalFolder)) throw new Error(`Invalid Journal folder: ${vault}`);
    if (await exists(journalPath) && !(await stat(journalPath)).isDirectory()) status = "conflict";
    return { vault, journalFolder: target.journalFolder, status, oldExists, newExists, oldEnabled: enabled.includes(OLD_ID), newEnabled: enabled.includes(NEW_ID), journalExists: await exists(journalPath), hotkeysToMigrate: Object.keys(hotkeys).filter((key) => key.startsWith(`${OLD_ID}:`)) };
}

async function applyTarget(target, state, source, backupRoot, index) {
    const vault = target.vault;
    const config = path.join(vault, ".obsidian");
    const plugins = path.join(config, "plugins");
    const oldDir = path.join(plugins, OLD_ID);
    const newDir = path.join(plugins, NEW_ID);
    const stagedDir = path.join(plugins, `.${NEW_ID}.${process.pid}.installing`);
    const backupDir = path.join(backupRoot, String(index + 1).padStart(2, "0"));
    const enabledPath = path.join(config, "community-plugins.json");
    const hotkeysPath = path.join(config, "hotkeys.json");
    const hadEnabled = await exists(enabledPath);
    const hadHotkeys = await exists(hotkeysPath);
    const enabled = hadEnabled ? JSON.parse(await readFile(enabledPath, "utf8")) : [];
    const hotkeys = hadHotkeys ? JSON.parse(await readFile(hotkeysPath, "utf8")) : {};
    const journalPath = path.join(vault, target.journalFolder);
    await mkdir(backupDir);
    if (hadEnabled) await copyFile(enabledPath, path.join(backupDir, "community-plugins.json"));
    if (hadHotkeys) await copyFile(hotkeysPath, path.join(backupDir, "hotkeys.json"));
    if (state.oldExists) await cp(oldDir, path.join(backupDir, OLD_ID), { recursive: true });
    let installed = false;
    let journalCreated = false;
    try {
        await mkdir(plugins, { recursive: true });
        await mkdir(stagedDir);
        for (const filename of FILES) await copyFile(path.join(sourceRoot, filename), path.join(stagedDir, filename));
        const oldData = path.join(oldDir, "data.json");
        if (state.oldExists && await exists(oldData)) {
            JSON.parse(await readFile(oldData, "utf8"));
            await copyFile(oldData, path.join(stagedDir, "data.json"));
        } else if (target.journalFolder !== "Journal") {
            await writeFile(path.join(stagedDir, "data.json"), `${JSON.stringify({ journalFolder: target.journalFolder }, null, 2)}\n`);
        }
        await rename(stagedDir, newDir);
        installed = true;
        if (!state.journalExists) {
            await mkdir(journalPath);
            journalCreated = true;
        }
        const migratedHotkeys = { ...hotkeys };
        for (const [key, value] of Object.entries(hotkeys)) {
            if (!key.startsWith(`${OLD_ID}:`)) continue;
            migratedHotkeys[migratedCommandId(key)] = value;
            delete migratedHotkeys[key];
        }
        if (hadHotkeys && state.hotkeysToMigrate.length) await atomicJsonWrite(hotkeysPath, migratedHotkeys);
        const migratedEnabled = enabled.filter((id) => id !== OLD_ID && id !== NEW_ID);
        migratedEnabled.push(NEW_ID);
        await atomicJsonWrite(enabledPath, migratedEnabled);
        for (const filename of FILES) {
            if (await sha256(path.join(newDir, filename)) !== source.hashes[filename]) throw new Error(`Installed hash mismatch: ${vault}/${filename}`);
        }
        if (state.oldExists && await exists(oldData) && await sha256(oldData) !== await sha256(path.join(newDir, "data.json"))) {
            throw new Error(`Settings hash mismatch: ${vault}`);
        }
    } catch (error) {
        if (hadEnabled) await copyFile(path.join(backupDir, "community-plugins.json"), enabledPath);
        else await rm(enabledPath, { force: true });
        if (hadHotkeys) await copyFile(path.join(backupDir, "hotkeys.json"), hotkeysPath);
        if (installed) await rm(newDir, { recursive: true, force: true });
        await rm(stagedDir, { recursive: true, force: true });
        if (journalCreated) await rm(journalPath, { recursive: false });
        throw error;
    }
    return { vault, status: "installed", installedAt: new Date().toISOString(), sourceCommit: source.head, pluginId: NEW_ID, version: source.version, hashes: source.hashes, enabled: true, journalFolder: target.journalFolder, journalCreated, backupDir, oldPluginRetainedDisabled: state.oldExists, runtimeVerified: false };
}

function migratedCommandId(key) {
    const suffix = key.slice(OLD_ID.length + 1);
    return `${NEW_ID}:${suffix === "write-roam-workspace-ui-audit" ? "write-ui-audit" : suffix}`;
}

function git(args) {
    return execFileSync("git", args, { cwd: sourceRoot, encoding: "utf8" }).trim();
}

async function atomicJsonWrite(filePath, value) {
    const staging = `${filePath}.${process.pid}.installing`;
    await writeFile(staging, `${JSON.stringify(value, null, 2)}\n`);
    await rename(staging, filePath);
}

async function exists(filePath) {
    try { await stat(filePath); return true; } catch { return false; }
}

async function sha256(filePath) {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
