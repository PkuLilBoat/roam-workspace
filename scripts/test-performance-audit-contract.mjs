import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "journal-stream-performance-audit-")
);

try {
    const outfile = path.join(temporaryRoot, "performance-audit-contract.mjs");
    await build({
        entryPoints: ["src/dev/audit/performanceAuditContract.ts"],
        outfile,
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node20",
        logLevel: "silent",
    });

    const {
        isPerformanceFixtureFile,
        resolvePerformanceRecentFileRecorder,
        runPerformanceAuditTransaction,
        waitForPerformanceAuditQuiescence,
        waitForPerformanceEditorReady,
    } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

    await testDelayedReadiness(waitForPerformanceEditorReady);
    await testReadinessTimeout(waitForPerformanceEditorReady);
    await testSuppressionPredicate(isPerformanceFixtureFile);
    await testRecentFileRecorderCapability(
        resolvePerformanceRecentFileRecorder
    );
    await testDelayedQuiescence(waitForPerformanceAuditQuiescence);
    await testQuiescenceTimeout(waitForPerformanceAuditQuiescence);
    await testTransactionSuccess(runPerformanceAuditTransaction);
    await testTransactionFailure(runPerformanceAuditTransaction);
    await testCapabilityFailure(runPerformanceAuditTransaction);

    console.log(
        "BASE-05 performance audit transaction contract passed (temporary directory + spies only)"
    );
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

async function testDelayedQuiescence(waitForPerformanceAuditQuiescence) {
    let now = 0;
    let revision = 0;
    const pendingActivityAt = [300, 700];
    const result = await waitForPerformanceAuditQuiescence({
        now: () => now,
        readRevision: () => revision,
        wait: async (milliseconds) => {
            now += milliseconds;
            while (
                pendingActivityAt.length > 0 &&
                pendingActivityAt[0] <= now
            ) {
                pendingActivityAt.shift();
                revision += 1;
            }
        },
        quietMs: 500,
        timeoutMs: 2000,
        pollIntervalMs: 50,
    });

    assert.equal(result.status, "quiescent");
    assert.equal(result.revision, 2);
    assert.ok(result.elapsedMs >= 1200);
}

async function testQuiescenceTimeout(waitForPerformanceAuditQuiescence) {
    let now = 0;
    let revision = 0;
    const result = await waitForPerformanceAuditQuiescence({
        now: () => now,
        readRevision: () => revision,
        wait: async (milliseconds) => {
            now += milliseconds;
            revision += 1;
        },
        quietMs: 200,
        timeoutMs: 600,
        pollIntervalMs: 50,
    });

    assert.equal(result.status, "timeout");
    assert.equal(result.elapsedMs, 600);
}

async function testRecentFileRecorderCapability(
    resolvePerformanceRecentFileRecorder
) {
    const collect = () => {};
    const recordMostRecentOpenedFile = () => {};
    const tracker = { collect };
    const modern = resolvePerformanceRecentFileRecorder(
        { recentFileTracker: tracker },
        { recordMostRecentOpenedFile }
    );
    assert.equal(modern.kind, "recent-file-tracker");
    assert.equal(modern.target, tracker);

    const legacy = resolvePerformanceRecentFileRecorder(
        {},
        { recordMostRecentOpenedFile }
    );
    assert.equal(legacy.kind, "legacy-workspace");
    assert.equal(legacy.target.recordMostRecentOpenedFile, recordMostRecentOpenedFile);

    assert.equal(resolvePerformanceRecentFileRecorder({}, {}), null);
    assert.equal(
        resolvePerformanceRecentFileRecorder(
            { recentFileTracker: { collect: "not-callable" } },
            {}
        ),
        null
    );
}

async function testDelayedReadiness(waitForPerformanceEditorReady) {
    let now = 0;
    let reads = 0;
    const result = await waitForPerformanceEditorReady({
        readState: () => {
            reads += 1;
            return {
                editorMounted: true,
                editorReady: now >= 6500,
                properties: { mountStatus: "no-frontmatter" },
            };
        },
        now: () => now,
        wait: async (milliseconds) => {
            now += milliseconds;
        },
        timeoutMs: 10000,
        pollIntervalMs: 250,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.state.editorReady, true);
    assert.ok(result.elapsedMs >= 6500);
    assert.ok(reads > 1);
}

async function testReadinessTimeout(waitForPerformanceEditorReady) {
    let now = 0;
    const result = await waitForPerformanceEditorReady({
        readState: () => ({
            editorMounted: false,
            editorReady: false,
            properties: { mountStatus: "native-pending" },
        }),
        now: () => now,
        wait: async (milliseconds) => {
            now += milliseconds;
        },
        timeoutMs: 1000,
        pollIntervalMs: 100,
    });

    assert.equal(result.status, "timeout");
    assert.equal(result.state.editorReady, false);
    assert.ok(result.elapsedMs >= 1000);
}

async function testSuppressionPredicate(isPerformanceFixtureFile) {
    assert.equal(
        isPerformanceFixtureFile({
            path: "Journal/_journal_stream_performance/small/2026-08-24.md",
        }),
        true
    );
    assert.equal(
        isPerformanceFixtureFile({
            path: "Journal/_journal_stream_performance/medium/2021-01-01.md",
        }),
        true
    );
    assert.equal(
        isPerformanceFixtureFile({
            path: "Journal/_journal_stream_performance-other/file.md",
        }),
        false
    );
    assert.equal(isPerformanceFixtureFile({ path: "Journal/normal.md" }), false);
    assert.equal(isPerformanceFixtureFile(null), false);
}

async function testTransactionSuccess(runPerformanceAuditTransaction) {
    let installed = 0;
    let disposed = 0;
    let suppress;
    const value = await runPerformanceAuditTransaction({
        installRecentFileSuppression: (predicate) => {
            installed += 1;
            suppress = predicate;
            return () => {
                disposed += 1;
            };
        },
        run: async () => {
            assert.equal(
                suppress({
                    path: "Journal/_journal_stream_performance/small/fixture.md",
                }),
                true
            );
            assert.equal(suppress({ path: "Journal/normal.md" }), false);
            return "measured";
        },
    });

    assert.equal(value, "measured");
    assert.equal(installed, 1);
    assert.equal(disposed, 1);
}

async function testTransactionFailure(runPerformanceAuditTransaction) {
    const expected = new Error("measurement failed");
    let disposed = 0;
    await assert.rejects(
        runPerformanceAuditTransaction({
            installRecentFileSuppression: () => () => {
                disposed += 1;
            },
            run: async () => {
                throw expected;
            },
        }),
        (error) => error === expected
    );
    assert.equal(disposed, 1);
}

async function testCapabilityFailure(runPerformanceAuditTransaction) {
    let runCount = 0;
    await assert.rejects(
        runPerformanceAuditTransaction({
            installRecentFileSuppression: () => {
                throw new Error("recent-file-suppression-unavailable");
            },
            run: async () => {
                runCount += 1;
            },
        }),
        /recent-file-suppression-unavailable/
    );
    assert.equal(runCount, 0);
}
