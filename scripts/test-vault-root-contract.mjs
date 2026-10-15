import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
    assertTestVaultPayloadRoot,
    resolveTestVaultPath,
    resolveTestVaultRoot,
    TEST_VAULT_ROOT,
} from "./test-vault-root.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDir, "..");

assert.equal(resolveTestVaultRoot({}), TEST_VAULT_ROOT);
assert.equal(
    resolveTestVaultRoot({ JOURNAL_STREAM_VAULT_ROOT: TEST_VAULT_ROOT }),
    TEST_VAULT_ROOT
);
assert.equal(
    resolveTestVaultRoot({
        JOURNAL_STREAM_VAULT_ROOT: `${TEST_VAULT_ROOT}${path.sep}`,
    }),
    TEST_VAULT_ROOT
);

for (const rejectedRoot of [
    "",
    "TEST",
    "/Users/feng/Documents/OBSIDIAN/TASK",
    "/Users/feng/Documents/OBSIDIAN/TEST-copy",
    `${TEST_VAULT_ROOT}/..`,
]) {
    assert.throws(
        () =>
            resolveTestVaultRoot({
                JOURNAL_STREAM_VAULT_ROOT: rejectedRoot,
            }),
        undefined,
        `Expected vault root to be rejected: ${JSON.stringify(rejectedRoot)}`
    );
}

assert.equal(
    resolveTestVaultPath(
        "Journal/_journal_stream_regression_fixture",
        {}
    ),
    `${TEST_VAULT_ROOT}/Journal/_journal_stream_regression_fixture`
);

for (const rejectedPath of [
    "",
    ".",
    "..",
    "../TASK/Journal",
    "/Users/feng/Documents/OBSIDIAN/TASK/Journal",
]) {
    assert.throws(
        () => resolveTestVaultPath(rejectedPath, {}),
        undefined,
        `Expected fixture path to be rejected: ${JSON.stringify(rejectedPath)}`
    );
}

assert.equal(
    assertTestVaultPayloadRoot(TEST_VAULT_ROOT, "Audit", {}),
    TEST_VAULT_ROOT
);
assert.throws(
    () =>
        assertTestVaultPayloadRoot(
            "/Users/feng/Documents/OBSIDIAN/TASK",
            "Audit",
            {}
        ),
    /Audit vaultRoot must be/
);

const guardedConsumers = [
    ["prepare-ui-fixture.mjs", "unsupported"],
    ["check-ui-fixture.mjs"],
    ["prepare-performance-fixture.mjs", "unsupported"],
    ["check-install-state.mjs"],
    ["completion-audit.mjs"],
    ["request-ui-audit.mjs", "contract-test"],
    ["wait-ui-audit.mjs", "contract-test", "--timeout-ms=0"],
    ["validate-ui-audit.mjs"],
    ["validate-ui-regression-results.mjs"],
    ["write-partial-ui-results-from-audit.mjs"],
    ["write-performance-ui-result.mjs"],
];

for (const [script, ...args] of guardedConsumers) {
    const result = spawnSync(
        process.execPath,
        [path.join(scriptsDir, script), ...args],
        {
            cwd: projectRoot,
            encoding: "utf8",
            env: {
                ...process.env,
                JOURNAL_STREAM_VAULT_ROOT:
                    "/Users/feng/Documents/OBSIDIAN/TASK",
            },
        }
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `${script} must reject TASK`);
    assert.match(
        output,
        /Refusing non-TEST vault root/,
        `${script} must fail at the shared vault-root guard`
    );
}

const activeConsumers = [
    "check-install-state.mjs",
    "completion-audit.mjs",
    "request-ui-audit.mjs",
    "wait-ui-audit.mjs",
    "validate-ui-audit.mjs",
    "validate-ui-regression-results.mjs",
    "write-partial-ui-results-from-audit.mjs",
    "write-performance-ui-result.mjs",
    "ui-fixture-data.mjs",
    "prepare-performance-fixture.mjs",
];
for (const script of activeConsumers) {
    const source = readFileSync(path.join(scriptsDir, script), "utf8");
    assert.doesNotMatch(
        source,
        /\/Users\/feng\/Documents\/OBSIDIAN\/TASK/,
        `${script} must not contain a TASK fallback`
    );
}

for (const fixtureDocument of [
    "ui-regression-checklist.json",
    "ui-regression-results.example.json",
]) {
    const document = JSON.parse(
        readFileSync(path.join(scriptsDir, fixtureDocument), "utf8")
    );
    const serialized = JSON.stringify(document);
    assert.doesNotMatch(serialized, /\/Users\/feng\/Documents\/OBSIDIAN\/TASK/);
    assert.match(serialized, /\/Users\/feng\/Documents\/OBSIDIAN\/TEST/);
}

const packageJson = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8")
);
assert.equal(
    packageJson.scripts["test:vault-root"],
    "node scripts/test-vault-root-contract.mjs"
);

console.log(
    `BASE-01-isolated-vault: passed (${guardedConsumers.length} consumers + payload guard)`
);
