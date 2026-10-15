import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "journal-stream-ui03b-cleanup-")
);
const root = process.cwd();
const validatorPath = path.join(
    root,
    "scripts",
    "validate-preview-edit-transaction-cleanup.mjs"
);

try {
    const outfile = path.join(tempRoot, "contract.mjs");
    await build({
        entryPoints: ["src/dev/audit/previewEditTransactionCleanupContract.ts"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });
    const contract = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    await testInjectedFailureRestores(contract);
    await testBaselineMismatchFailsClosed(contract);
    await testMarkerCollisionFailsClosed(contract);
    await testWriteFailureStillRestores(contract);
    await testRestoreFailure(contract);
    await testLateWriteFails(contract);
    await testQuiescenceTimeout(contract);
    await testQuiescenceClock(contract.waitForNoLateTargetWrites);
    await testRuntimeValidator(contract);
    console.log(
        "INFRA-UI-03B transaction cleanup contract passed (temporary directory + spies only)"
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

function harness(overrides = {}) {
    const marker = "ui03b-marker";
    let source = "original\n";
    let editor = source;
    let restoreCount = 0;
    const options = {
        marker,
        readSource: async () => source,
        readEditor: () => editor,
        writeMarker: async () => {
            source += `${marker}\n`;
            editor = source;
        },
        restore: async (original) => {
            restoreCount += 1;
            source = original;
            editor = original;
        },
        waitForQuiescence: async () => quiet(),
        ...overrides,
    };
    return {
        options,
        marker,
        setSource: (value) => { source = value; },
        setEditor: (value) => { editor = value; },
        restoreCount: () => restoreCount,
    };
}

async function testInjectedFailureRestores(contract) {
    const state = harness();
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.status, "passed");
    assert.equal(
        result.injectedFailure.observed,
        contract.INJECTED_PREVIEW_EDIT_FAILURE
    );
    assert.equal(result.write.observed, true);
    assert.equal(result.cleanup.restored, true);
    assert.equal(result.cleanup.noLateWrites, true);
    assert.equal(state.restoreCount(), 1);
}

async function testBaselineMismatchFailsClosed(contract) {
    const state = harness();
    state.setEditor("different\n");
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "source-editor-mismatch-at-baseline");
    assert.equal(result.write.attempted, false);
    assert.equal(result.cleanup.restoreAttempted, false);
}

async function testMarkerCollisionFailsClosed(contract) {
    const state = harness();
    state.setSource(`original\n${state.marker}\n`);
    state.setEditor(`original\n${state.marker}\n`);
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "marker-already-present");
    assert.equal(result.write.attempted, false);
}

async function testWriteFailureStillRestores(contract) {
    const state = harness({
        writeMarker: async () => { throw new Error("write-failed"); },
    });
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "write-failed");
    assert.equal(result.cleanup.restoreAttempted, true);
    assert.equal(state.restoreCount(), 1);
}

async function testRestoreFailure(contract) {
    const state = harness({
        restore: async () => { throw new Error("restore-failed"); },
    });
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "fixture-restore-failed");
    assert.equal(result.cleanup.restoreError, "restore-failed");
}

async function testLateWriteFails(contract) {
    const state = harness({
        waitForQuiescence: async () => ({
            ...quiet(),
            revisionAfter: 3,
            revisionAtBarrier: 2,
            changesObserved: 1,
        }),
    });
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "late-target-write-after-restore");
    assert.equal(result.cleanup.noLateWrites, false);
}

async function testQuiescenceTimeout(contract) {
    const state = harness({
        waitForQuiescence: async () => ({ ...quiet(), status: "timeout" }),
    });
    const result = await contract.runInjectedPreviewEditCleanupProbe(state.options);
    assert.equal(result.reason, "write-quiescence-timeout");
}

async function testQuiescenceClock(waitForNoLateTargetWrites) {
    let now = 0;
    let revision = 4;
    let waitCount = 0;
    const stable = await waitForNoLateTargetWrites({
        readRevision: () => revision,
        wait: async (milliseconds) => { now += milliseconds; },
        now: () => now,
        pollMs: 10,
        quietWindowMs: 30,
        timeoutMs: 100,
    });
    assert.equal(stable.status, "quiescent");
    assert.equal(stable.changesObserved, 0);

    now = 0;
    revision = 4;
    const late = await waitForNoLateTargetWrites({
        readRevision: () => revision,
        wait: async (milliseconds) => {
            now += milliseconds;
            waitCount += 1;
            if (waitCount === 2) revision += 1;
        },
        now: () => now,
        pollMs: 10,
        quietWindowMs: 30,
        timeoutMs: 100,
    });
    assert.equal(late.status, "quiescent");
    assert.equal(late.changesObserved, 1);
}

function quiet() {
    return {
        status: "quiescent",
        revisionAtBarrier: 2,
        revisionAfter: 2,
        changesObserved: 0,
        quietForMs: 1000,
    };
}

async function testRuntimeValidator(contract) {
    const state = harness();
    const transaction = await contract.runInjectedPreviewEditCleanupProbe(
        state.options
    );
    const valid = {
        runId: "ui03b-validator",
        pluginId: "roam-workspace",
        vaultRoot: "/Users/feng/Documents/OBSIDIAN/TEST",
        obsidianVersion: "1.13.7",
        status: "passed",
        actions: {
            previewEditTransactionCleanup: {
                status: "passed",
                path: "Journal/_journal_stream_regression_fixture/260812.md",
                readiness: {
                    status: "passed",
                    before: {
                        editorMounted: false,
                        editorReady: false,
                        editorMountId: null,
                    },
                },
                editorReadiness: { status: "ready" },
                transaction,
                ownershipReleased: {
                    auditPinActive: false,
                    visible: false,
                    renderRequested: false,
                },
            },
        },
    };
    await expectValidator("valid", valid, true);
    for (const [name, mutate] of [
        ["wrong-path", (audit) => {
            audit.actions.previewEditTransactionCleanup.path = "Journal/wrong.md";
        }],
        ["late-write", (audit) => {
            audit.actions.previewEditTransactionCleanup.transaction.cleanup.quiescence.changesObserved = 1;
        }],
        ["source-not-exact", (audit) => {
            audit.actions.previewEditTransactionCleanup.transaction.cleanup.sourceExact = false;
        }],
        ["wrong-injected-error", (audit) => {
            audit.actions.previewEditTransactionCleanup.transaction.injectedFailure.observed = "other-error";
        }],
        ["ownership-leak", (audit) => {
            audit.actions.previewEditTransactionCleanup.ownershipReleased.auditPinActive = true;
        }],
    ]) {
        const invalid = JSON.parse(JSON.stringify(valid));
        mutate(invalid);
        await expectValidator(name, invalid, false);
    }
}

async function expectValidator(name, audit, shouldPass) {
    const auditPath = path.join(tempRoot, `${name}.json`);
    await writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
    const result = spawnSync(
        process.execPath,
        [validatorPath, auditPath, "--run-id=ui03b-validator"],
        {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                JOURNAL_STREAM_VAULT_ROOT: "/Users/feng/Documents/OBSIDIAN/TEST",
            },
        }
    );
    if ((result.status === 0) !== shouldPass) {
        throw new Error(
            `${name} expected ${shouldPass ? "pass" : "failure"}, got ${result.status}: ${result.stdout}${result.stderr}`
        );
    }
}
