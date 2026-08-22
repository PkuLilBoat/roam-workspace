import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const vaultRoot = process.env.ROAM_IN_OB_VAULT_ROOT;
if (!vaultRoot) {
    throw new Error("Set ROAM_IN_OB_VAULT_ROOT to the test vault path.");
}
const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "roam-in-ob");
const auditPath = path.join(pluginDir, "ui-audit-latest.json");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const runId = args.find((arg) => !arg.startsWith("--"));
const timeoutArg = args.find((arg) => arg.startsWith("--timeout-ms="));
const timeoutMs = timeoutArg ? Number(timeoutArg.split("=")[1]) : 15000;
const start = Date.now();

if (!runId) {
    console.error("Usage: node scripts/wait-ui-audit.mjs <runId> [--timeout-ms=15000]");
    process.exit(1);
}

while (Date.now() - start < timeoutMs) {
    const audit = await readAudit();
    if (audit?.runId === runId) {
        console.log(`Journal Stream UI audit observed: ${auditPath}`);
        console.log(`status: ${audit.status}`);
        if (audit.reason) console.log(`reason: ${audit.reason}`);
        process.exit(audit.status === "passed" ? 0 : 2);
    }
    await sleep(500);
}

console.error(`Timed out waiting for Journal Stream UI audit runId=${runId}`);
process.exit(1);

async function readAudit() {
    try {
        const fileStat = await stat(auditPath);
        if (!fileStat.isFile()) return null;
        return JSON.parse(await readFile(auditPath, "utf8"));
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
