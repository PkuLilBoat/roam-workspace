import { readFile } from "node:fs/promises";

const checklistPath = new URL("./ui-regression-checklist.json", import.meta.url);
const checklist = JSON.parse(await readFile(checklistPath, "utf8"));

validateChecklist(checklist);

if (process.argv.includes("--json")) {
    console.log(JSON.stringify(checklist, null, 2));
} else {
    console.log(`# ${checklist.name}`);
    console.log(`vaultRoot: ${checklist.vaultRoot}`);
    console.log(`pluginId: ${checklist.pluginId}`);
    console.log(`fixture.prepare: ${checklist.fixture.prepare}`);
    console.log(`fixture.check: ${checklist.fixture.check}`);
    console.log(`fixture.clean: ${checklist.fixture.clean}`);
    for (const testCase of checklist.cases) {
        console.log(`\n## ${testCase.id}`);
        console.log(`setup: ${testCase.setup.join(" && ") || "(none)"}`);
        console.log("steps:");
        for (const step of testCase.steps) {
            console.log(`- ${step}`);
        }
        console.log("evidence:");
        for (const evidence of testCase.evidence) {
            console.log(`- ${evidence}`);
        }
        console.log(`cleanup: ${testCase.cleanup.join(" && ") || "(none)"}`);
    }
}

function validateChecklist(checklist) {
    const requiredTopLevel = ["name", "vaultRoot", "pluginId", "fixture", "cases"];
    for (const key of requiredTopLevel) {
        assertValue(checklist[key], `Missing top-level field: ${key}`);
    }

    for (const key of ["prepare", "check", "clean", "directory"]) {
        assertValue(checklist.fixture[key], `Missing fixture field: ${key}`);
    }

    if (!Array.isArray(checklist.cases) || checklist.cases.length === 0) {
        throw new Error("Checklist must include at least one case");
    }

    const ids = new Set();
    for (const [index, testCase] of checklist.cases.entries()) {
        assertValue(testCase.id, `Case ${index} missing id`);
        if (ids.has(testCase.id)) {
            throw new Error(`Duplicate case id: ${testCase.id}`);
        }
        ids.add(testCase.id);

        for (const field of ["setup", "steps", "evidence", "cleanup"]) {
            if (!Array.isArray(testCase[field])) {
                throw new Error(`Case ${testCase.id} field ${field} must be an array`);
            }
        }
        if (testCase.steps.length === 0 || testCase.evidence.length === 0) {
            throw new Error(`Case ${testCase.id} must include steps and evidence`);
        }
    }
}

function assertValue(value, message) {
    if (value === undefined || value === null || value === "") {
        throw new Error(message);
    }
}
