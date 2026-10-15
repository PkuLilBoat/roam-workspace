import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
    assertTestVaultPayloadRoot,
    resolveTestVaultRoot,
} from "./test-vault-root.mjs";

const root = process.cwd();
const resultsPath = path.join(root, "artifacts/ui-regression-results.partial.json");
const performancePath = path.join(root, "artifacts/journal-performance-latest.json");
const vaultRoot = resolveTestVaultRoot();
const runtimeAuditPath =
    process.argv.slice(2).find((arg) => arg !== "--") ??
    path.join(
        vaultRoot,
        ".obsidian/plugins/roam-workspace/ui-audit-latest.json"
    );
const results = JSON.parse(await readFile(resultsPath, "utf8"));
const performance = JSON.parse(await readFile(performancePath, "utf8"));
const runtimeAudit = JSON.parse(await readFile(runtimeAuditPath, "utf8"));
assertTestVaultPayloadRoot(runtimeAudit.vaultRoot, "Runtime audit");
const runtimePerformance = runtimeAudit.actions?.performance ?? {};
const metrics = runtimePerformance.metrics ?? {};
const thresholds = runtimePerformance.thresholds ?? {};
const runtimeArtifactPath = path.join(
    root,
    `artifacts/ui-audit-${sanitizeRunId(runtimeAudit.runId ?? "performance")}.json`
);
const screenshotPath = path.join(
    root,
    "artifacts/ui-performance-medium-202608222230.png"
);
await writeFile(runtimeArtifactPath, JSON.stringify(runtimeAudit, null, 2));

const passed =
    runtimeAudit.status === "passed" &&
    runtimePerformance.status === "passed" &&
    Number.isFinite(metrics.smallWarmOpenMs) &&
    Number.isFinite(metrics.mediumWarmOpenMs) &&
    Number.isFinite(metrics.modifyToUiP95Ms) &&
    metrics.smallWarmOpenMs <= thresholds.smallWarmOpenMs &&
    metrics.mediumWarmOpenMs <= thresholds.mediumWarmOpenMs &&
    metrics.modifyToUiP95Ms <= thresholds.modifyToUiP95Ms;

results.runAt = new Date().toISOString();
results.cases = results.cases.map((testCase) => {
    if (testCase.id !== "real-ui-performance") return testCase;

    return {
        id: testCase.id,
        status: passed ? "passed" : "failed",
        evidence: [
            `TEST runtime audit measured Small warm open at ${metrics.smallWarmOpenMs}ms against ${thresholds.smallWarmOpenMs}ms.`,
            `TEST runtime audit measured Medium warm open at ${metrics.mediumWarmOpenMs}ms against ${thresholds.mediumWarmOpenMs}ms.`,
            `TEST runtime audit measured vault.modify-to-embedded-editor p95 at ${metrics.modifyToUiP95Ms}ms against ${thresholds.modifyToUiP95Ms}ms.`,
            runtimePerformance.method,
            `The separate core benchmark remains supporting algorithm evidence: ${performance.method}`,
        ],
        artifacts: [
            runtimeArtifactPath,
            performancePath,
            ...(existsSync(screenshotPath) ? [screenshotPath] : []),
        ],
        metrics,
    };
});

await writeFile(resultsPath, JSON.stringify(results, null, 2));
console.log(`Performance UI regression result merged: ${resultsPath}`);

function sanitizeRunId(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}
