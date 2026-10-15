import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateTestPluginId } from "./migrate-test-plugin-id.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "roam-workspace-id-migration-"));
try {
    const sourceRoot = path.join(root, "source");
    const vaultRoot = path.join(root, "vault");
    const pluginRoot = path.join(vaultRoot, ".obsidian", "plugins");
    const oldDir = path.join(pluginRoot, "journal-stream-dne-spike");
    const newDir = path.join(pluginRoot, "roam-workspace");
    const backupDir = path.join(root, "backup");
    await mkdir(path.join(sourceRoot, "artifacts"), { recursive: true });
    await mkdir(oldDir, { recursive: true });
    const artifacts = {
        "main.js": "new bundle",
        "manifest.json": JSON.stringify({ id: "roam-workspace", version: "0.1.0" }),
        "styles.css": "new styles",
    };
    const hashes = {};
    for (const [name, contents] of Object.entries(artifacts)) {
        await writeFile(path.join(sourceRoot, name), contents);
        hashes[name] = createHash("sha256").update(contents).digest("hex");
    }
    await writeFile(path.join(sourceRoot, "artifacts", "current-build-info.json"), JSON.stringify({
        manifestId: "roam-workspace", manifestVersion: "0.1.0", buildId: "test-build", artifactHashes: hashes,
    }));
    await writeFile(path.join(oldDir, "manifest.json"), JSON.stringify({ id: "journal-stream-dne-spike" }));
    await writeFile(path.join(oldDir, "data.json"), JSON.stringify({ journalFolder: "Journal", recentFiles: ["note.md"] }));
    await writeFile(path.join(vaultRoot, ".obsidian", "community-plugins.json"), JSON.stringify([
        "journal-stream-dne-spike", "metadata-menu",
    ]));
    await writeFile(path.join(vaultRoot, ".obsidian", "hotkeys.json"), JSON.stringify({
        "journal-stream-dne-spike:open-journal-stream": [{ modifiers: ["Mod"], key: "J" }],
        "other-plugin:command": [{ modifiers: ["Mod"], key: "K" }],
    }));
    const record = await migrateTestPluginId({ sourceRoot, vaultRoot, backupDir });
    assert.equal(record.newId, "roam-workspace");
    assert.deepEqual(JSON.parse(await readFile(path.join(vaultRoot, ".obsidian", "community-plugins.json"), "utf8")), [
        "roam-workspace", "metadata-menu",
    ]);
    const hotkeys = JSON.parse(await readFile(path.join(vaultRoot, ".obsidian", "hotkeys.json"), "utf8"));
    assert.ok(hotkeys["roam-workspace:open-journal-stream"]);
    assert.ok(hotkeys["other-plugin:command"]);
    assert.equal(await readFile(path.join(newDir, "data.json"), "utf8"), await readFile(path.join(oldDir, "data.json"), "utf8"));
    assert.equal(await readFile(path.join(backupDir, "journal-stream-dne-spike", "data.json"), "utf8"), await readFile(path.join(oldDir, "data.json"), "utf8"));
    await assert.rejects(migrateTestPluginId({ sourceRoot, vaultRoot, backupDir }), /already exists/);
    console.log("TEST plugin ID migration contract passed");
} finally {
    await rm(root, { recursive: true, force: true });
}
