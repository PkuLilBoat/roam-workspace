import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const checklistPath = new URL("./ui-regression-checklist.json", import.meta.url);
const checklist = JSON.parse(await readFile(checklistPath, "utf8"));
const resultsPath = process.argv.slice(2).find((arg) => arg !== "--");

if (!resultsPath) {
    console.error(
        "Usage: node scripts/validate-ui-regression-results.mjs <results.json>"
    );
    process.exit(1);
}

const results = JSON.parse(await readFile(resultsPath, "utf8"));
const resultsDir = path.dirname(path.resolve(resultsPath));
const checklistIds = new Set(checklist.cases.map((testCase) => testCase.id));
const resultIds = new Set();
const failures = [];

if (results.checklist !== checklist.name) {
    failures.push(
        `results.checklist must be ${JSON.stringify(checklist.name)}`
    );
}

for (const field of ["runAt", "operator", "environment", "cases"]) {
    if (!results[field]) {
        failures.push(`Missing results field: ${field}`);
    }
}

validateRunMetadata(results);

if (!Array.isArray(results.cases)) {
    failures.push("results.cases must be an array");
} else {
    for (const resultCase of results.cases) {
        if (!resultCase.id) {
            failures.push("A result case is missing id");
            continue;
        }

        if (resultIds.has(resultCase.id)) {
            failures.push(`Duplicate result case id: ${resultCase.id}`);
        }
        resultIds.add(resultCase.id);

        if (!checklistIds.has(resultCase.id)) {
            failures.push(`Unknown result case id: ${resultCase.id}`);
        }

        if (resultCase.status !== "passed") {
            failures.push(
                `Case ${resultCase.id} status must be passed, got ${JSON.stringify(resultCase.status)}`
            );
        }

        if (!Array.isArray(resultCase.evidence) || resultCase.evidence.length === 0) {
            failures.push(`Case ${resultCase.id} must include evidence`);
        } else {
            for (const evidence of resultCase.evidence) {
                if (!isMeaningfulString(evidence)) {
                    failures.push(
                        `Case ${resultCase.id} evidence entries must be non-empty strings`
                    );
                }
            }
        }

        if (!Array.isArray(resultCase.artifacts) || resultCase.artifacts.length === 0) {
            failures.push(`Case ${resultCase.id} must include artifact paths`);
        } else {
            for (const artifact of resultCase.artifacts) {
                if (!isMeaningfulString(artifact)) {
                    failures.push(
                        `Case ${resultCase.id} artifact paths must be non-empty strings`
                    );
                    continue;
                }
                const artifactPath = resolveArtifactPath(artifact);
                if (!(await fileExists(artifactPath))) {
                    failures.push(
                        `Case ${resultCase.id} artifact does not exist: ${artifact}`
                    );
                }
            }
        }

        if (resultCase.id === "real-ui-performance") {
            validatePerformanceMetrics(resultCase.metrics);
        }
    }

    for (const checklistId of checklistIds) {
        if (!resultIds.has(checklistId)) {
            failures.push(`Missing result case: ${checklistId}`);
        }
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log(`UI regression results passed: ${results.cases.length} cases`);

function validateRunMetadata(results) {
    if (!isMeaningfulString(results.runAt) || results.runAt.includes("YYYY")) {
        failures.push("results.runAt must be an actual ISO timestamp");
    }

    if (!isMeaningfulString(results.operator)) {
        failures.push("results.operator must be a non-empty string");
    }

    const environment = results.environment;
    if (!environment || typeof environment !== "object") {
        failures.push("results.environment must be an object");
        return;
    }

    if (environment.vaultRoot !== checklist.vaultRoot) {
        failures.push(
            `environment.vaultRoot must be ${JSON.stringify(checklist.vaultRoot)}`
        );
    }

    if (environment.pluginId !== checklist.pluginId) {
        failures.push(
            `environment.pluginId must be ${JSON.stringify(checklist.pluginId)}`
        );
    }

    for (const field of ["obsidianVersion", "viewport"]) {
        if (
            !isMeaningfulString(environment[field]) ||
            environment[field].includes("recorded-during-run")
        ) {
            failures.push(`environment.${field} must be recorded during the run`);
        }
    }
}

function resolveArtifactPath(artifactPath) {
    if (typeof artifactPath !== "string" || artifactPath.length === 0) {
        return "";
    }
    return path.isAbsolute(artifactPath)
        ? artifactPath
        : path.join(resultsDir, artifactPath);
}

async function fileExists(filePath) {
    if (!filePath) return false;
    try {
        const fileStat = await stat(filePath);
        return fileStat.isFile();
    } catch {
        return false;
    }
}

function validatePerformanceMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
        failures.push("Case real-ui-performance must include metrics");
        return;
    }

    const thresholds = {
        smallWarmOpenMs: 200,
        mediumWarmOpenMs: 500,
        modifyToUiP95Ms: 300,
    };

    for (const [field, maxValue] of Object.entries(thresholds)) {
        const value = metrics[field];
        if (typeof value !== "number" || Number.isNaN(value)) {
            failures.push(`Case real-ui-performance metric ${field} must be a number`);
        } else if (value > maxValue) {
            failures.push(
                `Case real-ui-performance metric ${field}=${value} exceeds ${maxValue}`
            );
        }
    }
}

function isMeaningfulString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
