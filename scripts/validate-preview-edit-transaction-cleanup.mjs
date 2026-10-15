import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const injectedFailure = "injected-preview-edit-failure-after-write";
const vaultRoot = resolveTestVaultRoot();
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const auditPath = args.find((argument) => !argument.startsWith("--")) ??
    path.join(
        vaultRoot,
        ".obsidian/plugins/roam-workspace/ui-audit-latest.json"
    );
const expectedRunId = readOption("--run-id");
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const action = audit.actions?.previewEditTransactionCleanup;
const transaction = action?.transaction;
const cleanup = transaction?.cleanup;
const quiescence = cleanup?.quiescence;
const failures = [];

expect(audit.status === "passed", "audit status must be passed");
expect(audit.pluginId === "roam-workspace", "plugin ID mismatch");
expect(audit.vaultRoot === vaultRoot, "TEST vault root mismatch");
expect(
    typeof audit.obsidianVersion === "string" && audit.obsidianVersion.length > 0,
    "Obsidian version must be present"
);
if (expectedRunId) expect(audit.runId === expectedRunId, "runId mismatch");
expect(action?.status === "passed", "transaction cleanup action must pass");
expect(action?.path === fixturePath, "registered fixture path mismatch");
expect(action?.readiness?.status === "passed", "readiness prerequisite must pass");
expect(
    action?.readiness?.before?.editorMounted === false &&
        action?.readiness?.before?.editorReady === false &&
        action?.readiness?.before?.editorMountId === null,
    "readiness prerequisite must begin offscreen and unmounted"
);
expect(action?.editorReadiness?.status === "ready", "transaction editor not ready");
expect(transaction?.status === "passed", "injected transaction must pass cleanup");
expect(transaction?.write?.attempted === true, "marker write not attempted");
expect(transaction?.write?.observed === true, "marker write not observed");
expect(
    transaction?.write?.sourceContainsMarker === true &&
        transaction?.write?.editorContainsMarker === true,
    "marker must reach both source and editor before failure"
);
expect(
    transaction?.injectedFailure?.expected === injectedFailure &&
        transaction?.injectedFailure?.observed === injectedFailure,
    "expected injected failure was not observed"
);
expect(cleanup?.restoreAttempted === true, "restore not attempted");
expect(cleanup?.restoreError === null, "restore reported an error");
expect(cleanup?.quiescenceError === null, "quiescence reported an error");
expect(cleanup?.verificationError === null, "verification reported an error");
expect(quiescence?.status === "quiescent", "target writes did not quiesce");
expect(quiescence?.changesObserved === 0, "late target write observed");
expect(
    quiescence?.revisionAfter === quiescence?.revisionAtBarrier,
    "target revision changed after cleanup barrier"
);
expect(cleanup?.sourceExact === true, "source content not restored exactly");
expect(cleanup?.editorExact === true, "editor content not restored exactly");
expect(
    cleanup?.markerRemovedFromSource === true &&
        cleanup?.markerRemovedFromEditor === true,
    "marker remains after cleanup"
);
expect(cleanup?.noLateWrites === true, "no-late-write invariant not proven");
expect(cleanup?.restored === true, "transaction cleanup not restored");
expect(cleanOwnership(action?.ownershipReleased), "audit ownership not released");

if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`INFRA-UI-03B runtime evidence OK: ${auditPath}`);
console.log(`Target: ${fixturePath}`);
console.log(`Injected failure: ${injectedFailure}`);
console.log(`Quiet window: ${quiescence.quietForMs}ms`);

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
