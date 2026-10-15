import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const validatorPath = path.join(
    root,
    "scripts",
    "validate-read-only-mount-matrix.mjs"
);
const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "journal-stream-read-only-mount-")
);
const originalDigest = "1".repeat(64);
const changedDigest = "2".repeat(64);

const validMatrix = {
    contractId: "UI-01A-read-only-embedded-mount-attribution",
    vaultRoot: "/Users/feng/Documents/OBSIDIAN/TEST",
    pluginId: "roam-workspace",
    buildId: "test-build",
    obsidianVersion: "1.13.7",
    fixture: {
        path: "Journal/_journal_stream_regression_fixture/2026-08-11.md",
        expectedSha256: originalDigest,
    },
    cases: [
        makeCase("journal-stream-only", ["roam-workspace"], false),
        makeCase(
            "journal-stream-with-metadata-menu",
            ["metadata-menu", "roam-workspace"],
            false
        ),
        makeCase(
            "journal-stream-with-auto-properties",
            ["auto-properties", "roam-workspace"],
            true
        ),
    ],
    attribution: {
        candidatePluginId: "auto-properties",
        controlCase: "journal-stream-only",
        comparisonCase: "journal-stream-with-metadata-menu",
        candidateCase: "journal-stream-with-auto-properties",
        trigger: "file-open",
        writeApi: "FileManager.processFrontMatter",
        staticEvidence: {
            file: ".obsidian/plugins/auto-properties/main.js",
            line: 978,
        },
    },
};

try {
    await expectResult("valid", validMatrix, 0);
    await expectResult("missing-case", {
        ...validMatrix,
        cases: validMatrix.cases.slice(0, 2),
    }, 1);
    await expectResult("control-mutated", withCase("journal-stream-only", {
        sourceMutated: true,
        fixtureAfter: { sha256: changedDigest, bytes: 169 },
    }), 1);
    await expectResult("comparison-mutated", withCase(
        "journal-stream-with-metadata-menu",
        {
            sourceMutated: true,
            fixtureAfter: { sha256: changedDigest, bytes: 169 },
        }
    ), 1);
    await expectResult("candidate-did-not-mutate", withCase(
        "journal-stream-with-auto-properties",
        {
            sourceMutated: false,
            fixtureAfter: { sha256: originalDigest, bytes: 167 },
        }
    ), 1);
    await expectResult("candidate-plugin-delta", withCase(
        "journal-stream-with-auto-properties",
        { enabledPlugins: ["metadata-menu", "roam-workspace"] }
    ), 1);
    await expectResult("build-mismatch", withCase(
        "journal-stream-with-metadata-menu",
        { buildId: "other-build" }
    ), 1);
    await expectResult("fixture-before-mismatch", withCase(
        "journal-stream-only",
        { fixtureBefore: { sha256: "3".repeat(64), bytes: 167 } }
    ), 1);
    await expectResult("progress-incomplete", withCase(
        "journal-stream-only",
        {
            render: {
                targetRendered: false,
                pendingFileCount: 1,
                hasMore: true,
            },
        }
    ), 1);
    await expectResult("input-not-excluded", withCase(
        "journal-stream-only",
        { noInput: false }
    ), 1);
    await expectResult("wrong-vault", {
        ...validMatrix,
        vaultRoot: "/Users/feng/Documents/OBSIDIAN/TASK",
    }, 1);
    await expectResult("wrong-fixture-path", {
        ...validMatrix,
        fixture: {
            ...validMatrix.fixture,
            path: "Journal/ordinary-user-note.md",
        },
    }, 1);
    await expectResult("missing-obsidian-version", {
        ...validMatrix,
        obsidianVersion: "",
        cases: validMatrix.cases.map((entry) => ({
            ...entry,
            obsidianVersion: "",
        })),
    }, 1);
    console.log(
        "UI-01A read-only mount matrix contract passed (temporary directory only)"
    );
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

function makeCase(id, enabledPlugins, sourceMutated) {
    return {
        id,
        enabledPlugins,
        buildId: "test-build",
        obsidianVersion: "1.13.7",
        vaultRoot: "/Users/feng/Documents/OBSIDIAN/TEST",
        action: "scroll-to-progressive-end",
        noInput: true,
        render: {
            targetRendered: true,
            pendingFileCount: 0,
            hasMore: false,
        },
        fixtureBefore: { sha256: originalDigest, bytes: 167 },
        fixtureAfter: {
            sha256: sourceMutated ? changedDigest : originalDigest,
            bytes: sourceMutated ? 169 : 167,
        },
        sourceMutated,
    };
}

function withCase(id, patch) {
    return {
        ...validMatrix,
        cases: validMatrix.cases.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry
        ),
    };
}

async function expectResult(name, matrix, expectedStatus) {
    const matrixPath = path.join(temporaryRoot, `${name}.json`);
    await writeFile(matrixPath, JSON.stringify(matrix), "utf8");
    const result = spawnSync(process.execPath, [validatorPath, matrixPath], {
        cwd: root,
        encoding: "utf8",
    });
    assert.equal(
        result.status,
        expectedStatus,
        `${name}: ${result.stdout}${result.stderr}`
    );
}
