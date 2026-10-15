import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveTestVaultRoot } from "./test-vault-root.mjs";

const root = process.cwd();
const vaultRoot = resolveTestVaultRoot();
const pluginDir = `${vaultRoot}/.obsidian/plugins/roam-workspace`;
const checklist = JSON.parse(
    readFileSync(path.join(root, "scripts/ui-regression-checklist.json"), "utf8")
);
const resultsPath = process.argv.slice(2).find((arg) => arg !== "--");
const checks = [];

check("source-build-artifacts", ["manifest.json", "main.js", "styles.css"].every(existsInRoot));
check("installed-plugin-artifacts", ["manifest.json", "main.js", "styles.css"].every(existsInPlugin));
check(
    "ui-audit-tooling",
    [
        "scripts/request-ui-audit.mjs",
        "scripts/wait-ui-audit.mjs",
        "scripts/validate-ui-audit.mjs",
    ].every(existsInRoot)
);
check(
    "ui-regression-tooling",
    [
        "scripts/ui-regression-checklist.json",
        "scripts/ui-regression-results.example.json",
        "scripts/validate-ui-regression-results.mjs",
    ].every(existsInRoot)
);
check("ui-regression-checklist-8-cases", checklist.cases?.length === 8);
check(
    "fixture-clean",
    !existsSync(path.join(vaultRoot, "Journal", "_journal_stream_regression_fixture")) &&
        !existsSync(path.join(vaultRoot, "Journal", "_journal_stream_performance"))
);

if (resultsPath) {
    const results = JSON.parse(readFileSync(resultsPath, "utf8"));
    const resultCases = new Map((results.cases ?? []).map((item) => [item.id, item]));
    for (const checklistCase of checklist.cases) {
        const resultCase = resultCases.get(checklistCase.id);
        check(`ui-case:${checklistCase.id}`, resultCase?.status === "passed");
    }
} else {
    for (const checklistCase of checklist.cases) {
        check(`ui-case:${checklistCase.id}`, false, "missing-ui-regression-results");
    }
}

const complete = checks.every((item) => item.status === "passed");
const output = {
    runAt: new Date().toISOString(),
    complete,
    uiCasesPassed: checks.filter((item) => item.id.startsWith("ui-case:") && item.status === "passed").length,
    uiCasesTotal: checklist.cases.length,
    checks,
};

console.log(JSON.stringify(output, null, 2));
process.exit(complete ? 0 : 1);

function check(id, condition, reason = "not-proven") {
    checks.push({
        id,
        status: condition ? "passed" : "pending",
        ...(condition ? {} : { reason }),
    });
}

function existsInRoot(relativePath) {
    return isFile(path.join(root, relativePath));
}

function existsInPlugin(fileName) {
    return isFile(path.join(pluginDir, fileName));
}

function isFile(filePath) {
    try {
        return statSync(filePath).isFile();
    } catch {
        return false;
    }
}
