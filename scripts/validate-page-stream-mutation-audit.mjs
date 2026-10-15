import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const auditPath = process.argv[2];
assert.ok(
    auditPath,
    "Usage: node scripts/validate-page-stream-mutation-audit.mjs <ui-audit.json>"
);

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const mutation = audit?.actions?.pageStreamMutationStability;
assert.equal(
    mutation?.status,
    "passed",
    mutation?.reason ?? "Page Stream mutation audit did not pass"
);

const expectedActions = [
    "insert",
    "moveExisting",
    "removeTop",
    "removeMiddle",
    "trim",
    "continuousReorder",
];

for (const actionName of expectedActions) {
    const action = mutation.actions?.[actionName];
    assert.equal(
        action?.status,
        "passed",
        `${actionName}: ${action?.reason ?? "missing audit result"}`
    );
    assert.equal(action.headerStable, true, `${actionName}: header replaced`);
    assert.equal(action.listStable, true, `${actionName}: list replaced`);
    assert.equal(
        action.editorHostsNeverEmpty,
        true,
        `${actionName}: all editor hosts disappeared during mutation`
    );
    assert.deepEqual(
        action.unstablePaths,
        [],
        `${actionName}: retained card, visible content, or active editor changed`
    );
    for (const frame of action.frames ?? []) {
        for (const [path, state] of Object.entries(frame.preserved ?? {})) {
            assert.equal(
                state.contentAvailable,
                true,
                `${actionName}: ${path} had no ready editor or visible fallback at ${frame.timestampMs}ms`
            );
            if (state.editing) {
                assert.notEqual(
                    state.editorIdentityStable,
                    false,
                    `${actionName}: active editor changed for ${path}`
                );
            }
        }
    }
    assert.deepEqual(
        action.removedPreservedPaths,
        [],
        `${actionName}: retained card was removed from the DOM`
    );
    assert.equal(action.orderMatches, true, `${actionName}: DOM order mismatch`);
    assert.equal(action.uniquePaths, true, `${actionName}: duplicate card path`);
    assert.equal(
        action.poolWithinLimit,
        true,
        `${actionName}: editor pool exceeded its limit`
    );
    assert.ok(action.frameCount >= 2, `${actionName}: insufficient frame samples`);
    const lastFrame = action.frames?.at(-1);
    assert.ok(
        lastFrame?.timestampMs >= 600,
        `${actionName}: stability window was shorter than 600ms`
    );
}

console.log("Page Stream mutation audit passed");
