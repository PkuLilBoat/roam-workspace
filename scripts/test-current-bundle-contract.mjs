import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUNDLE_FILES, PLUGIN_ID, installBundle } from "./install-test-bundle.mjs";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "journal-stream-bundle-"));
try {
    const sourceRoot = path.join(temporaryRoot, "source");
    const installedPluginDir = path.join(temporaryRoot, "installed");
    const backupDir = path.join(temporaryRoot, "backup");
    await Promise.all([mkdir(path.join(sourceRoot, "artifacts"), { recursive: true }), mkdir(installedPluginDir)]);
    const manifest = { id: PLUGIN_ID, version: "9.8.7" };
    const original = {
        "main.js": "old-main",
        "manifest.json": JSON.stringify(manifest),
        "styles.css": "old-style",
    };
    const current = {
        "main.js": "new-main-with-build-id",
        "manifest.json": JSON.stringify(manifest),
        "styles.css": "new-style",
    };
    for (const filename of BUNDLE_FILES) {
        await writeFile(path.join(sourceRoot, filename), current[filename]);
        await writeFile(path.join(installedPluginDir, filename), original[filename]);
    }
    const buildInfo = {
        schemaVersion: 1,
        head: "a".repeat(40),
        dirty: true,
        sourceStateHash: "b".repeat(64),
        buildId: "contract-build-id",
        builtAt: "2026-08-24T00:00:00.000Z",
        manifestId: PLUGIN_ID,
        manifestVersion: manifest.version,
        artifactHashes: Object.fromEntries(
            await Promise.all(
                BUNDLE_FILES.map(async (filename) => [filename, sha256(current[filename])])
            )
        ),
    };
    await writeFile(
        path.join(sourceRoot, "artifacts", "current-build-info.json"),
        JSON.stringify(buildInfo)
    );

    const record = await installBundle({ sourceRoot, installedPluginDir, backupDir });
    assert.equal(record.buildFingerprint.buildId, buildInfo.buildId);
    for (const filename of BUNDLE_FILES) {
        assert.equal(await readFile(path.join(installedPluginDir, filename), "utf8"), current[filename]);
        assert.equal(await readFile(path.join(backupDir, filename), "utf8"), original[filename]);
    }

    const secondInstalled = path.join(temporaryRoot, "installed-invalid");
    const secondBackup = path.join(temporaryRoot, "backup-invalid");
    await mkdir(secondInstalled);
    for (const filename of BUNDLE_FILES) {
        await writeFile(path.join(secondInstalled, filename), original[filename]);
    }
    await writeFile(path.join(sourceRoot, "main.js"), "tampered-main");
    await assert.rejects(
        installBundle({ sourceRoot, installedPluginDir: secondInstalled, backupDir: secondBackup }),
        /does not match current build info/
    );
    for (const filename of BUNDLE_FILES) {
        assert.equal(await readFile(path.join(secondInstalled, filename), "utf8"), original[filename]);
    }
    console.log("BASE-02 current bundle contract passed (temporary directories only)");
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
