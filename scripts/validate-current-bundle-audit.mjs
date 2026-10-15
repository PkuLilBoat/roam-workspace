import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const sourceRoot = process.cwd();
const vaultRoot = resolveTestVaultRoot();
const buildInfo = JSON.parse(
    await readFile(path.join(sourceRoot, "artifacts", "current-build-info.json"), "utf8")
);
const auditPath =
    process.argv.slice(2).find((argument) => argument !== "--") ??
    path.join(
        vaultRoot,
        ".obsidian",
        "plugins",
        "roam-workspace",
        "ui-audit-latest.json"
    );
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const failures = [];
const expectedFingerprint = pickFingerprint(buildInfo);

if (audit.pluginId !== buildInfo.manifestId) {
    failures.push(`pluginId mismatch: expected=${buildInfo.manifestId} actual=${audit.pluginId}`);
}
if (audit.pluginVersion !== buildInfo.manifestVersion) {
    failures.push(
        `pluginVersion mismatch: expected=${buildInfo.manifestVersion} actual=${audit.pluginVersion}`
    );
}
if (audit.vaultRoot !== vaultRoot) {
    failures.push(`vaultRoot mismatch: expected=${vaultRoot} actual=${audit.vaultRoot}`);
}
for (const [field, expected] of Object.entries(expectedFingerprint)) {
    const actual = audit.buildFingerprint?.[field];
    if (actual !== expected) {
        failures.push(
            `buildFingerprint.${field} mismatch: expected=${expected} actual=${actual}`
        );
    }
}
if (!audit.obsidianVersion || typeof audit.obsidianVersion !== "string") {
    failures.push("obsidianVersion must be present");
}
if (!audit.runAt || Number.isNaN(Date.parse(audit.runAt))) {
    failures.push("runAt must be an ISO timestamp");
}

if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`Runtime build identity OK: ${expectedFingerprint.buildId}`);
console.log(`Obsidian version: ${audit.obsidianVersion}`);
console.log(`Audit: ${auditPath}`);

function pickFingerprint(build) {
    const {
        head,
        dirty,
        sourceStateHash,
        buildId,
        builtAt,
        manifestId,
        manifestVersion,
    } = build;
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
