import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtureDir, fixtureFiles } from "./ui-fixture-data.mjs";

const mode = process.argv[2] ?? "prepare";

if (mode === "clean") {
    await rm(fixtureDir, { recursive: true, force: true });
    console.log(`Cleaned Journal Stream UI fixture: ${fixtureDir}`);
} else if (mode === "prepare") {
    await rm(fixtureDir, { recursive: true, force: true });
    await mkdir(fixtureDir, { recursive: true });

    await Promise.all(
        fixtureFiles.map((fixture) =>
            writeFile(path.join(fixtureDir, fixture.name), fixture.content, "utf8")
        )
    );

    console.log(`Prepared Journal Stream UI fixture: ${fixtureDir}`);
    for (const fixture of fixtureFiles) {
        console.log(`- ${path.join(fixtureDir, fixture.name)}`);
    }
} else {
    console.error("Usage: node scripts/prepare-ui-fixture.mjs [prepare|clean]");
    process.exitCode = 1;
}
