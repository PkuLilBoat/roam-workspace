import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const fixturePath = "Journal/_journal_stream_regression_fixture/260812.md";
const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "journal-stream-target-readiness-")
);

try {
    const outfile = path.join(tempRoot, "contract.mjs");
    await build({
        entryPoints: ["src/dev/audit/auditTargetReadinessContract.ts"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });
    const { runAuditTargetReadinessProbe } = await import(
        `${pathToFileURL(outfile).href}?t=${Date.now()}`
    );

    await testSuccess(runAuditTargetReadinessProbe);
    await testWrongPathFailsClosed(runAuditTargetReadinessProbe);
    await testMountedBaselineFails(runAuditTargetReadinessProbe);
    await testAcquireFailureReleases(runAuditTargetReadinessProbe);
    await testTimeoutReleases(runAuditTargetReadinessProbe);
    await testVisibleOwnershipFails(runAuditTargetReadinessProbe);
    await testReleaseFailure(runAuditTargetReadinessProbe);
    await testOwnershipLeak(runAuditTargetReadinessProbe);
    console.log(
        "INFRA-UI-03A target readiness contract passed (temporary directory + spies only)"
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

function createHarness(overrides = {}) {
    let clock = 0;
    let waitCount = 0;
    let state = offscreenState();
    let ownership = cleanOwnership();
    let releaseCount = 0;
    const options = {
        expectedPath: fixturePath,
        readState: () => ({ ...state }),
        readOwnership: () => ({ ...ownership }),
        acquire: async () => {
            ownership = { auditPinActive: true, visible: false, renderRequested: true };
        },
        release: async () => {
            releaseCount += 1;
            ownership = cleanOwnership();
        },
        wait: async (milliseconds) => {
            clock += milliseconds;
            waitCount += 1;
            if (waitCount === 1) state = readyState();
        },
        now: () => clock,
        timeoutMs: 100,
        pollMs: 10,
        ...overrides,
    };
    return {
        options,
        setState: (next) => { state = next; },
        setOwnership: (next) => { ownership = next; },
        releaseCount: () => releaseCount,
    };
}

async function testSuccess(run) {
    const harness = createHarness();
    const result = await run(harness.options);
    assert.equal(result.status, "passed");
    assert.equal(result.ready.editorMountId, "mount-1");
    assert.equal(result.ownershipHeld.visible, false);
    assert.equal(result.cleanup.ownershipClean, true);
    assert.equal(harness.releaseCount(), 1);
}

async function testWrongPathFailsClosed(run) {
    const harness = createHarness();
    harness.setState({ ...offscreenState(), path: "Journal/wrong.md" });
    const result = await run(harness.options);
    assert.equal(result.reason, "unexpected-target-path");
    assert.equal(result.cleanup.acquireAttempted, false);
    assert.equal(result.cleanup.releaseAttempted, true);
}

async function testMountedBaselineFails(run) {
    const harness = createHarness();
    harness.setState(readyState());
    const result = await run(harness.options);
    assert.equal(result.reason, "target-not-offscreen-at-baseline");
    assert.equal(result.cleanup.releaseAttempted, true);
}

async function testAcquireFailureReleases(run) {
    const harness = createHarness({
        acquire: async () => { throw new Error("acquire-failed"); },
    });
    const result = await run(harness.options);
    assert.equal(result.reason, "audit-ownership-acquire-failed");
    assert.equal(result.cleanup.acquireError, "acquire-failed");
    assert.equal(harness.releaseCount(), 1);
}

async function testTimeoutReleases(run) {
    let clock = 0;
    let ownership = cleanOwnership();
    let releaseCount = 0;
    const result = await run({
        expectedPath: fixturePath,
        readState: () => offscreenState(),
        readOwnership: () => ({ ...ownership }),
        acquire: async () => {
            ownership = {
                auditPinActive: true,
                visible: false,
                renderRequested: true,
            };
        },
        release: async () => {
            releaseCount += 1;
            ownership = cleanOwnership();
        },
        wait: async (milliseconds) => { clock += milliseconds; },
        now: () => clock,
        timeoutMs: 20,
        pollMs: 10,
    });
    assert.equal(result.reason, "target-readiness-timeout");
    assert.equal(releaseCount, 1);
}

async function testVisibleOwnershipFails(run) {
    const harness = createHarness({
        acquire: async () => {
            harness.setOwnership({
                auditPinActive: true,
                visible: true,
                renderRequested: true,
            });
        },
    });
    const result = await run(harness.options);
    assert.equal(result.reason, "audit-ownership-invalid");
    assert.equal(harness.releaseCount(), 1);
}

async function testReleaseFailure(run) {
    const harness = createHarness({
        release: async () => { throw new Error("release-failed"); },
    });
    const result = await run(harness.options);
    assert.equal(result.reason, "audit-ownership-release-failed");
    assert.equal(result.cleanup.releaseError, "release-failed");
}

async function testOwnershipLeak(run) {
    const harness = createHarness({ release: async () => {} });
    const result = await run(harness.options);
    assert.equal(result.reason, "audit-ownership-not-released");
    assert.equal(result.cleanup.ownershipClean, false);
}

function offscreenState() {
    return {
        path: fixturePath,
        editorMounted: false,
        editorReady: false,
        editorMountId: null,
    };
}

function readyState() {
    return {
        path: fixturePath,
        editorMounted: true,
        editorReady: true,
        editorMountId: "mount-1",
    };
}

function cleanOwnership() {
    return { auditPinActive: false, visible: false, renderRequested: false };
}
