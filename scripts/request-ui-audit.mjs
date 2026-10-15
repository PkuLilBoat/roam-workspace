import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const vaultRoot = resolveTestVaultRoot();
const pluginDir = path.join(
    vaultRoot,
    ".obsidian",
    "plugins",
    "roam-workspace"
);
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const runId = args.find((arg) => !arg.startsWith("--")) ?? new Date().toISOString();
const openDefaultView = args.includes("--open-default-view");
const copyExport = args.includes("--copy-export");
const settingsToggle = args.includes("--settings-toggle");
const previewEditSave = args.includes("--preview-edit-save");
const auditTargetReadiness = args.includes("--audit-target-readiness");
const previewEditTransactionCleanup = args.includes(
    "--preview-edit-transaction-cleanup"
);
const productReadyBaseline = args.includes("--product-ready-baseline");
const externalChangeReload = args.includes("--external-change-reload");
const renameRefresh = args.includes("--rename-refresh");
const listHeadingAudit = args.includes("--list-heading-audit");
const pageStreamAudit = args.includes("--page-stream-audit");
const blockLinkAudit = args.includes("--block-link-audit");
const performanceAudit = args.includes("--performance-audit");
const targetFolder = readOption("--target-folder");
const selectedRange = readOption("--range");
const targetProcessId = Number(
    readOption("--target-process-id") ??
        process.env.JOURNAL_STREAM_AUDIT_PROCESS_ID
);
const requestPath = path.join(
    pluginDir,
    Number.isInteger(targetProcessId) && targetProcessId > 0
        ? `ui-audit-request-${targetProcessId}.json`
        : "ui-audit-request.json"
);

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
            ...(auditTargetReadiness ? { auditTargetReadiness: true } : {}),
            ...(previewEditTransactionCleanup
                ? { previewEditTransactionCleanup: true }
                : {}),
            ...(productReadyBaseline ? { productReadyBaseline: true } : {}),
            ...(externalChangeReload ? { externalChangeReload: true } : {}),
            ...(renameRefresh ? { renameRefresh: true } : {}),
            ...(listHeadingAudit ? { listHeadingAudit: true } : {}),
            ...(pageStreamAudit ? { pageStreamAudit: true } : {}),
            ...(blockLinkAudit ? { blockLinkAudit: true } : {}),
            ...(performanceAudit ? { performanceAudit: true } : {}),
            ...(targetFolder ? { targetFolder } : {}),
            ...(selectedRange ? { selectedRange } : {}),
            ...(Number.isInteger(targetProcessId) && targetProcessId > 0
                ? { targetProcessId }
                : {}),
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
