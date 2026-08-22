import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fixtureDir, fixtureFiles } from "./ui-fixture-data.mjs";

let failed = false;

try {
    const fixtureStat = await stat(fixtureDir);
    if (!fixtureStat.isDirectory()) {
        fail(`Fixture path is not a directory: ${fixtureDir}`);
    }
} catch {
    fail(`Fixture directory is missing: ${fixtureDir}`);
}

if (!failed) {
    const actualFiles = (await readdir(fixtureDir))
        .filter((name) => name.endsWith(".md"))
        .sort();
    const expectedFiles = fixtureFiles.map((fixture) => fixture.name).sort();

    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
        fail(
            `Fixture files mismatch. Expected ${expectedFiles.join(", ")}, got ${actualFiles.join(", ")}`
        );
    }

    for (const fixture of fixtureFiles) {
        const fixturePath = path.join(fixtureDir, fixture.name);
        const content = await readFile(fixturePath, "utf8");
        if (content !== fixture.content) {
            fail(`Fixture content mismatch: ${fixturePath}`);
        }
    }
}

if (failed) {
    process.exitCode = 1;
} else {
    console.log(`Journal Stream UI fixture OK: ${fixtureDir}`);
}

function fail(message) {
    failed = true;
    console.error(message);
}
