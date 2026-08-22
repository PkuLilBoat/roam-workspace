import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const vaultRoot = process.env.ROAM_IN_OB_VAULT_ROOT;
if (!vaultRoot) {
    throw new Error("Set ROAM_IN_OB_VAULT_ROOT to the test vault path.");
}
const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "roam-in-ob");
const requestPath = path.join(pluginDir, "ui-audit-request.json");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const runId = args.find((arg) => !arg.startsWith("--")) ?? new Date().toISOString();
const openDefaultView = args.includes("--open-default-view");
const copyExport = args.includes("--copy-export");
const settingsToggle = args.includes("--settings-toggle");
const previewEditSave = args.includes("--preview-edit-save");
const externalChangeReload = args.includes("--external-change-reload");
const renameRefresh = args.includes("--rename-refresh");
const listHeadingAudit = args.includes("--list-heading-audit");
const pageStreamAudit = args.includes("--page-stream-audit");
const blockLinkAudit = args.includes("--block-link-audit");
const targetFolder = readOption("--target-folder");
const selectedRange = readOption("--range");

await mkdir(pluginDir, { recursive: true });
await writeFile(
    requestPath,
    JSON.stringify(
        {
            runId,
            openDefaultView,
            ...(copyExport ? { copyExport: true } : {}),
            ...(settingsToggle ? { settingsToggle: true } : {}),
            ...(previewEditSave ? { previewEditSave: true } : {}),
            ...(externalChangeReload ? { externalChangeReload: true } : {}),
            ...(renameRefresh ? { renameRefresh: true } : {}),
            ...(listHeadingAudit ? { listHeadingAudit: true } : {}),
            ...(pageStreamAudit ? { pageStreamAudit: true } : {}),
            ...(blockLinkAudit ? { blockLinkAudit: true } : {}),
            ...(targetFolder ? { targetFolder } : {}),
            ...(selectedRange ? { selectedRange } : {}),
            requestedAt: new Date().toISOString(),
        },
        null,
        2
    )
);

console.log(`Journal Stream UI audit requested: ${requestPath}`);
console.log(`runId: ${runId}`);

function readOption(name) {
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
    const prefix = `${name}=`;
    return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
