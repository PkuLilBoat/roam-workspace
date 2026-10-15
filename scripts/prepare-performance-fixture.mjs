import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTestVaultPath } from "./test-vault-root.mjs";

const mode = process.argv.slice(2).find((arg) => arg !== "--") ?? "prepare";
const fixtureRoot = "Journal/_journal_stream_performance";
const fixtures = [
    { name: "small", fileCount: 100, entriesPerFile: 10 },
    { name: "medium", fileCount: 2000, entriesPerFile: 10 },
];

const absoluteRoot = resolveTestVaultPath(fixtureRoot);

if (mode === "clean") {
    await rm(absoluteRoot, { recursive: true, force: true });
    console.log(`Removed Journal Stream performance fixture: ${absoluteRoot}`);
    process.exit(0);
}

if (mode !== "prepare") {
    throw new Error(`Unsupported performance fixture mode: ${mode}`);
}

await rm(absoluteRoot, { recursive: true, force: true });
await mkdir(absoluteRoot, { recursive: true });

for (const fixture of fixtures) {
    const folder = path.join(absoluteRoot, fixture.name);
    await mkdir(folder, { recursive: true });

    for (let offset = 0; offset < fixture.fileCount; offset += 100) {
        const batch = Array.from(
            { length: Math.min(100, fixture.fileCount - offset) },
            (_, batchIndex) => offset + batchIndex
        );
        await Promise.all(
            batch.map((index) => {
                const date = new Date(Date.UTC(2026, 7, 22));
                date.setUTCDate(date.getUTCDate() - index);
                const filename = date.toISOString().slice(0, 10);
                const entries = Array.from(
                    { length: fixture.entriesPerFile },
                    (_, entryIndex) =>
                        `- ${fixture.name} performance entry ${index + 1}.${entryIndex + 1}`
                ).join("\n");
                const content = [
                    "---",
                    `performance_fixture: ${fixture.name}`,
                    `fixture_index: ${index + 1}`,
                    "---",
                    "",
                    entries,
                    "",
                ].join("\n");
                return writeFile(path.join(folder, `${filename}.md`), content);
            })
        );
    }

    console.log(
        `Prepared ${fixture.name}: ${fixture.fileCount} files / ${fixture.fileCount * fixture.entriesPerFile} entries`
    );
}

console.log(`Journal Stream performance fixture ready: ${absoluteRoot}`);
