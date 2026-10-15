import { readFile } from "node:fs/promises";
import path from "node:path";

const [matrixPath] = process.argv.slice(2).filter((argument) => argument !== "--");

if (!matrixPath) {
    console.error(
        "Usage: node scripts/validate-read-only-mount-matrix.mjs <matrix.json>"
    );
    process.exit(2);
}

const matrix = JSON.parse(await readFile(path.resolve(matrixPath), "utf8"));
const failures = [];
const expectedContractId = "UI-01A-read-only-embedded-mount-attribution";
const expectedVaultRoot = "/Users/feng/Documents/OBSIDIAN/TEST";
const expectedPluginId = "roam-workspace";
const expectedFixturePath =
    "Journal/_journal_stream_regression_fixture/2026-08-11.md";
const candidatePluginId = "auto-properties";
const comparisonPluginId = "metadata-menu";

if (matrix.contractId !== expectedContractId) {
    failures.push(`contractId must be ${expectedContractId}`);
}
if (matrix.vaultRoot !== expectedVaultRoot) {
    failures.push(`vaultRoot must be ${expectedVaultRoot}`);
}
if (matrix.pluginId !== expectedPluginId) {
    failures.push(`pluginId must be ${expectedPluginId}`);
}
if (typeof matrix.buildId !== "string" || !matrix.buildId.trim()) {
    failures.push("buildId must be a non-empty string");
}
if (
    typeof matrix.obsidianVersion !== "string" ||
    !matrix.obsidianVersion.trim()
) {
    failures.push("obsidianVersion must be a non-empty string");
}
if (matrix.fixture?.path !== expectedFixturePath) {
    failures.push(`fixture.path must be ${expectedFixturePath}`);
}
if (!isSha256(matrix.fixture?.expectedSha256)) {
    failures.push("fixture.expectedSha256 must be a SHA-256 digest");
}

const cases = Array.isArray(matrix.cases) ? matrix.cases : [];
const casesById = new Map(cases.map((entry) => [entry?.id, entry]));
const requiredCases = [
    {
        id: "journal-stream-only",
        enabledPlugins: [expectedPluginId],
        sourceMutated: false,
    },
    {
        id: "journal-stream-with-metadata-menu",
        enabledPlugins: [comparisonPluginId, expectedPluginId],
        sourceMutated: false,
    },
    {
        id: "journal-stream-with-auto-properties",
        enabledPlugins: [candidatePluginId, expectedPluginId],
        sourceMutated: true,
    },
];

for (const requirement of requiredCases) {
    const entry = casesById.get(requirement.id);
    if (!entry) {
        failures.push(`missing case: ${requirement.id}`);
        continue;
    }
    validateCase(entry, requirement);
}

if (cases.length !== requiredCases.length) {
    failures.push(`cases must contain exactly ${requiredCases.length} entries`);
}

const attribution = matrix.attribution;
if (attribution?.candidatePluginId !== candidatePluginId) {
    failures.push(`attribution.candidatePluginId must be ${candidatePluginId}`);
}
if (attribution?.controlCase !== "journal-stream-only") {
    failures.push("attribution.controlCase must be journal-stream-only");
}
if (attribution?.comparisonCase !== "journal-stream-with-metadata-menu") {
    failures.push(
        "attribution.comparisonCase must be journal-stream-with-metadata-menu"
    );
}
if (attribution?.candidateCase !== "journal-stream-with-auto-properties") {
    failures.push(
        "attribution.candidateCase must be journal-stream-with-auto-properties"
    );
}
if (attribution?.trigger !== "file-open") {
    failures.push("attribution.trigger must be file-open");
}
if (attribution?.writeApi !== "FileManager.processFrontMatter") {
    failures.push(
        "attribution.writeApi must be FileManager.processFrontMatter"
    );
}
if (
    typeof attribution?.staticEvidence?.file !== "string" ||
    !attribution.staticEvidence.file.trim() ||
    !Number.isInteger(attribution?.staticEvidence?.line) ||
    attribution.staticEvidence.line < 1
) {
    failures.push("attribution.staticEvidence must identify a file and line");
}

if (failures.length) {
    console.error("Read-only mount attribution matrix failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(
    "UI-01A read-only embedded mount attribution matrix passed: " +
        `${candidatePluginId} is the single enabled-plugin delta associated with the source rewrite`
);

function validateCase(entry, requirement) {
    if (!sameArray(entry.enabledPlugins, requirement.enabledPlugins)) {
        failures.push(
            `${requirement.id}.enabledPlugins must equal ${JSON.stringify(requirement.enabledPlugins)}`
        );
    }
    if (entry.buildId !== matrix.buildId) {
        failures.push(`${requirement.id}.buildId must match matrix.buildId`);
    }
    if (entry.obsidianVersion !== matrix.obsidianVersion) {
        failures.push(
            `${requirement.id}.obsidianVersion must match matrix.obsidianVersion`
        );
    }
    if (entry.vaultRoot !== expectedVaultRoot) {
        failures.push(`${requirement.id}.vaultRoot must match the TEST vault`);
    }
    if (entry.action !== "scroll-to-progressive-end" || entry.noInput !== true) {
        failures.push(
            `${requirement.id} must scroll to the progressive end without input`
        );
    }
    if (
        entry.render?.targetRendered !== true ||
        entry.render?.pendingFileCount !== 0 ||
        entry.render?.hasMore !== false
    ) {
        failures.push(`${requirement.id} must fully render the target fixture`);
    }
    if (
        !isSha256(entry.fixtureBefore?.sha256) ||
        entry.fixtureBefore.sha256 !== matrix.fixture?.expectedSha256 ||
        !Number.isInteger(entry.fixtureBefore?.bytes) ||
        entry.fixtureBefore.bytes < 1
    ) {
        failures.push(
            `${requirement.id}.fixtureBefore must match the registered fixture`
        );
    }
    if (
        !isSha256(entry.fixtureAfter?.sha256) ||
        !Number.isInteger(entry.fixtureAfter?.bytes) ||
        entry.fixtureAfter.bytes < 1
    ) {
        failures.push(`${requirement.id}.fixtureAfter must be measured`);
    }
    if (entry.sourceMutated !== requirement.sourceMutated) {
        failures.push(
            `${requirement.id}.sourceMutated must be ${requirement.sourceMutated}`
        );
    }
    const digestChanged =
        entry.fixtureBefore?.sha256 !== entry.fixtureAfter?.sha256;
    if (digestChanged !== entry.sourceMutated) {
        failures.push(
            `${requirement.id} sourceMutated must agree with the fixture digests`
        );
    }
}

function sameArray(actual, expected) {
    return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
    );
}

function isSha256(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
