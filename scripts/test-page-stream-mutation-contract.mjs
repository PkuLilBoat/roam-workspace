import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const actionNames = [
    "insert",
    "moveExisting",
    "removeTop",
    "removeMiddle",
    "trim",
    "continuousReorder",
];
const state = {
    cardConnected: true,
    cardIdentityStable: true,
    contentAvailable: true,
    editing: false,
    editorIdentityStable: false,
};
const action = {
    status: "passed",
    headerStable: true,
    listStable: true,
    editorHostsNeverEmpty: true,
    unstablePaths: [],
    removedPreservedPaths: [],
    orderMatches: true,
    uniquePaths: true,
    poolWithinLimit: true,
    frameCount: 2,
    frames: [0, 600].map((timestampMs) => ({
        timestampMs,
        preserved: { "fixture.md": { ...state } },
    })),
};
const audit = {
    actions: {
        pageStreamMutationStability: {
            status: "passed",
            actions: Object.fromEntries(
                actionNames.map((name) => [name, structuredClone(action)])
            ),
        },
    },
};
const directory = await mkdtemp(path.join(os.tmpdir(), "page-stream-mutation-"));
const auditPath = path.join(directory, "audit.json");
const validator = path.join(import.meta.dirname, "validate-page-stream-mutation-audit.mjs");

async function validate(candidate) {
    await writeFile(auditPath, JSON.stringify(candidate));
    return spawnSync(process.execPath, [validator, auditPath], {
        encoding: "utf8",
    });
}

try {
    assert.equal((await validate(audit)).status, 0, "idle editor recycling is allowed");

    const blank = structuredClone(audit);
    blank.actions.pageStreamMutationStability.actions.insert.frames[1]
        .preserved["fixture.md"].contentAvailable = false;
    assert.notEqual((await validate(blank)).status, 0, "blank content must fail");

    const active = structuredClone(audit);
    active.actions.pageStreamMutationStability.actions.insert.frames[1]
        .preserved["fixture.md"].editing = true;
    assert.notEqual((await validate(active)).status, 0, "active editor replacement must fail");
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Page Stream mutation contract tests passed");
