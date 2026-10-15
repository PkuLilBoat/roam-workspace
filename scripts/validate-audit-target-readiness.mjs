import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const vaultRoot = resolveTestVaultRoot();
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const auditPath = args.find((argument) => !argument.startsWith("--")) ??
    path.join(
        vaultRoot,
        ".obsidian/plugins/roam-workspace/ui-audit-latest.json"
    );
const expectedRunId = readOption("--run-id");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const action = audit.actions?.auditTargetReadiness;
const failures = [];

expect(audit.status === "passed", "audit status must be passed");
if (expectedRunId) expect(audit.runId === expectedRunId, "runId mismatch");
expect(action?.status === "passed", "target readiness action must pass");
expect(action?.expectedPath === fixturePath, "registered fixture path mismatch");
expect(action?.before?.path === fixturePath, "baseline target path mismatch");
expect(action?.before?.editorMounted === false, "baseline editor must be unmounted");
expect(action?.before?.editorReady === false, "baseline editor must not be ready");
expect(action?.before?.editorMountId === null, "baseline mount ID must be null");
expect(cleanOwnership(action?.ownershipBefore), "baseline ownership must be clean");
expect(action?.ownershipHeld?.auditPinActive === true, "audit pin must be held");
expect(action?.ownershipHeld?.visible === false, "real visibility must remain false");
expect(action?.ownershipHeld?.renderRequested === true, "render must be requested");
expect(action?.ready?.path === fixturePath, "ready target path mismatch");
expect(action?.ready?.editorMounted === true, "ready editor must be mounted");
expect(action?.ready?.editorReady === true, "editor readiness not observed");
expect(
    typeof action?.ready?.editorMountId === "string" &&
        action.ready.editorMountId.length > 0,
    "ready mount ID must be nonempty"
);
expect(action?.cleanup?.acquireAttempted === true, "ownership acquire not attempted");
expect(action?.cleanup?.acquireError === null, "ownership acquire reported an error");
expect(action?.cleanup?.releaseAttempted === true, "ownership release not attempted");
expect(action?.cleanup?.releaseError === null, "ownership release reported an error");
expect(action?.cleanup?.ownershipClean === true, "ownership cleanup not proven");
expect(cleanOwnership(action?.cleanup?.ownershipReleased), "ownership remains after release");

if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`INFRA-UI-03A runtime evidence OK: ${auditPath}`);
console.log(`Target: ${fixturePath}`);
console.log(`Mount ID: ${action.ready.editorMountId}`);

function cleanOwnership(ownership) {
    return ownership?.auditPinActive === false &&
        ownership?.visible === false &&
        ownership?.renderRequested === false;
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
