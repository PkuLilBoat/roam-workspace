import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const resultsPath = path.join(root, "artifacts/ui-regression-results.partial.json");
const performancePath = path.join(root, "artifacts/journal-performance-latest.json");
const results = JSON.parse(await readFile(resultsPath, "utf8"));
const performance = JSON.parse(await readFile(performancePath, "utf8"));
const metrics = performance.metrics ?? {};
const thresholds = performance.thresholds ?? {};

const passed =
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
            `Performance artifact ${performancePath} recorded Small warm-open proxy ${metrics.smallWarmOpenMs}ms against ${thresholds.smallWarmOpenMs}ms.`,
            `Medium warm-open proxy was ${metrics.mediumWarmOpenMs}ms against ${thresholds.mediumWarmOpenMs}ms.`,
            `Incremental single-file update p95 was ${metrics.modifyToUiP95Ms}ms against ${thresholds.modifyToUiP95Ms}ms.`,
            performance.method,
        ],
        artifacts: [performancePath],
        metrics,
    };
});

await writeFile(resultsPath, JSON.stringify(results, null, 2));
console.log(`Performance UI regression result merged: ${resultsPath}`);
