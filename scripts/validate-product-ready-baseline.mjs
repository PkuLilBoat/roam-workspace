import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const vaultRoot = resolveTestVaultRoot();
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const auditPath =
    args.find((argument) => !argument.startsWith("--")) ??
    path.join(
        vaultRoot,
        ".obsidian/plugins/roam-workspace/ui-audit-latest.json"
    );
const expectedRunId = readOption("--run-id");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const action = audit.actions?.productReadyBaseline;
const baseline = action?.readiness?.baseline;
const failures = [];

expect(audit.status === "passed", "audit status must be passed");
if (expectedRunId) expect(audit.runId === expectedRunId, "runId mismatch");
expect(action?.status === "passed", "product-ready baseline action must pass");
expect(action?.expectedPath === fixturePath, "registered fixture path mismatch");
expect(action?.readiness?.status === "ready", "readiness must be ready");
expect(baseline?.path === fixturePath, "baseline target path mismatch");
expect(baseline?.editorMounted === true, "baseline editor must be mounted");
expect(baseline?.editorReady === true, "baseline editor must be ready");
expect(
    typeof baseline?.editorMountId === "string" &&
        baseline.editorMountId.length > 0,
    "baseline mount ID must be nonempty"
);
expect(
    baseline?.properties?.mountStatus === "native",
    "baseline Properties mount must be native"
);
expect(action?.ownershipHeld?.auditPinActive === true, "audit pin must be held");
expect(action?.ownershipHeld?.visible === false, "real visibility must remain false");
expect(action?.ownershipHeld?.renderRequested === true, "render must be requested");
expect(action?.source?.beforeBytes > 0, "source baseline must be nonempty");
expect(action?.source?.exact === true, "source must remain exact");
expect(action?.cleanup?.releaseAttempted === true, "ownership release not attempted");
expect(action?.cleanup?.releaseError === null, "ownership release reported an error");
expect(action?.cleanup?.ownershipClean === true, "ownership cleanup not proven");
expect(cleanOwnership(action?.cleanup?.ownershipReleased), "ownership remains after release");

if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`INFRA-UI-03C runtime evidence OK: ${auditPath}`);
console.log(`Target: ${fixturePath}`);
console.log(`Mount ID: ${baseline.editorMountId}`);

function cleanOwnership(ownership) {
    return (
        ownership?.auditPinActive === false &&
        ownership?.visible === false &&
        ownership?.renderRequested === false
    );
}

function expect(condition, message) {
    if (!condition) failures.push(message);
}

function readOption(name) {
    const index = args.indexOf(name);
    if (index !== -1) return args[index + 1];
    const prefix = `${name}=`;
    return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
