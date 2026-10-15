import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "journal-stream-product-ready-")
);
const validatorPath = path.join(
    process.cwd(),
    "scripts",
    "validate-product-ready-baseline.mjs"
);

try {
    const outfile = path.join(tempRoot, "contract.mjs");
    await build({
        entryPoints: ["src/dev/audit/productReadyBaselineContract.ts"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });
    const { waitForProductReadyBaseline } = await import(
        `${pathToFileURL(outfile).href}?t=${Date.now()}`
    );

    await testDelayedSuccess(waitForProductReadyBaseline);
    await testImmediateSuccess(waitForProductReadyBaseline);
    await testWrongPathFailsImmediately(waitForProductReadyBaseline);
    await testTimeoutReason(waitForProductReadyBaseline, unmountedState(), [
        "editor-mounted",
        "editor-ready",
        "editor-mount-id",
        "properties-native",
    ]);
    await testTimeoutReason(
        waitForProductReadyBaseline,
        { ...readyState(), editorReady: false },
        ["editor-ready"]
    );
    await testTimeoutReason(
        waitForProductReadyBaseline,
        { ...readyState(), editorMountId: null },
        ["editor-mount-id"]
    );
    await testTimeoutReason(
        waitForProductReadyBaseline,
        {
            ...readyState(),
            properties: { mountStatus: "native-pending" },
        },
        ["properties-native"]
    );
    await testInvalidDurationFails(waitForProductReadyBaseline);
    await testValidatorContract();

    console.log(
        "INFRA-UI-03C product-ready baseline contract passed (temporary directory + spies only)"
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

async function testValidatorContract() {
    const valid = validAudit();
    await expectValidation("valid", valid, true);
    for (const [name, update] of [
        ["unmounted", (audit) => { audit.actions.productReadyBaseline.readiness.baseline.editorMounted = false; }],
        ["unready", (audit) => { audit.actions.productReadyBaseline.readiness.baseline.editorReady = false; }],
        ["missing-mount-id", (audit) => { audit.actions.productReadyBaseline.readiness.baseline.editorMountId = null; }],
        ["properties-pending", (audit) => { audit.actions.productReadyBaseline.readiness.baseline.properties.mountStatus = "native-pending"; }],
        ["ownership-leak", (audit) => { audit.actions.productReadyBaseline.cleanup.ownershipReleased.auditPinActive = true; }],
        ["source-changed", (audit) => { audit.actions.productReadyBaseline.source.exact = false; }],
        ["wrong-path", (audit) => { audit.actions.productReadyBaseline.readiness.baseline.path = "Journal/wrong.md"; }],
    ]) {
        const audit = structuredClone(valid);
        update(audit);
        await expectValidation(name, audit, false);
    }
}

async function expectValidation(name, audit, expectedPass) {
    const auditPath = path.join(tempRoot, `${name}.json`);
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
    const result = spawnSync(process.execPath, [validatorPath, auditPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
            ...process.env,
            JOURNAL_STREAM_VAULT_ROOT: "/Users/feng/Documents/OBSIDIAN/TEST",
        },
    });
    assert.equal(
        result.status === 0,
        expectedPass,
        `${name} expected ${expectedPass ? "pass" : "failure"}, got ${result.status}: ${result.stdout}${result.stderr}`
    );
}

function validAudit() {
    const ownershipHeld = {
        auditPinActive: true,
        visible: false,
        renderRequested: true,
    };
    const ownershipReleased = {
        auditPinActive: false,
        visible: false,
        renderRequested: false,
    };
    return {
        runId: "ui03c-valid",
        status: "passed",
        actions: {
            productReadyBaseline: {
                status: "passed",
                expectedPath: fixturePath,
                readiness: { status: "ready", baseline: readyState() },
                ownershipHeld,
                source: { beforeBytes: 242, exact: true },
                cleanup: {
                    releaseAttempted: true,
                    releaseError: null,
                    ownershipClean: true,
                    ownershipReleased,
                },
            },
        },
    };
}

async function testDelayedSuccess(waitForReady) {
    let clock = 0;
    let state = unmountedState();
    const result = await waitForReady({
        ...baseOptions(),
        readState: () => structuredClone(state),
        wait: async (milliseconds) => {
            clock += milliseconds;
            state = readyState();
        },
        now: () => clock,
    });
    assert.equal(result.status, "ready");
    assert.equal(result.baseline.editorMountId, "mount-1");
    assert.equal(result.baseline.properties.mountStatus, "native");
    assert.equal(result.polls, 1);
}

async function testImmediateSuccess(waitForReady) {
    let waitCount = 0;
    const result = await waitForReady({
        ...baseOptions(),
        readState: readyState,
        wait: async () => {
            waitCount += 1;
        },
        now: () => 0,
    });
    assert.equal(result.status, "ready");
    assert.equal(waitCount, 0);
}

async function testWrongPathFailsImmediately(waitForReady) {
    let waitCount = 0;
    const result = await waitForReady({
        ...baseOptions(),
        readState: () => ({ ...unmountedState(), path: "Journal/wrong.md" }),
        wait: async () => {
            waitCount += 1;
        },
        now: () => 0,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "unexpected-target-path");
    assert.equal(waitCount, 0);
}

async function testTimeoutReason(waitForReady, state, expectedUnmet) {
    let clock = 0;
    const result = await waitForReady({
        ...baseOptions(),
        readState: () => structuredClone(state),
        wait: async (milliseconds) => {
            clock += milliseconds;
        },
        now: () => clock,
        timeoutMs: 20,
        pollMs: 10,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.reason, "product-ready-baseline-timeout");
    assert.deepEqual(result.unmet, expectedUnmet);
}

async function testInvalidDurationFails(waitForReady) {
    await assert.rejects(
        waitForReady({
            ...baseOptions(),
            readState: readyState,
            wait: async () => {},
            timeoutMs: 0,
        }),
        /timeoutMs must be a positive finite number/
    );
}

function baseOptions() {
    return {
        expectedPath: fixturePath,
        expectedPropertiesMountStatus: "native",
        timeoutMs: 100,
        pollMs: 10,
    };
}

function unmountedState() {
    return {
        path: fixturePath,
        editorMounted: false,
        editorReady: false,
        editorMountId: null,
        properties: { mountStatus: null },
    };
}

function readyState() {
    return {
        path: fixturePath,
        editorMounted: true,
        editorReady: true,
        editorMountId: "mount-1",
        properties: { mountStatus: "native" },
    };
}
