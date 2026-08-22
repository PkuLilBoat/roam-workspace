import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = "./.tmp-journal-core-bench.mjs";

await build({
    entryPoints: ["./src/utils/journalCore.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { filterJournalFilesByRange, sortJournalFiles } = await import(
    `${pathToFileURL(outfile).href}?t=${Date.now()}`
);

const incrementalOutfile = "./.tmp-incremental-file-set-bench.mjs";

await build({
    entryPoints: ["./src/utils/incrementalFileSet.ts"],
    outfile: incrementalOutfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

const { updateIncrementalFileSet } = await import(
    `${pathToFileURL(incrementalOutfile).href}?t=${Date.now()}`
);

const now = new Date(2026, 7, 12).valueOf();
const scenarios = [
    { name: "Small", files: 100, budgetMs: 200 },
    { name: "Medium", files: 2_000, budgetMs: 500 },
    { name: "Large", files: 10_000, budgetMs: 2_000 },
];
const scenarioResults = [];

for (const scenario of scenarios) {
    const files = makeFiles(scenario.files);
    const started = performance.now();
    const sorted = sortJournalFiles(files, "journalDate");
    const filtered = filterJournalFilesByRange(
        sorted,
        "journalDate",
        "recent-30",
        now
    );
    const elapsed = performance.now() - started;

    assert.equal(sorted.length, scenario.files);
    assert.ok(filtered.length > 0);
    assert.ok(
        elapsed <= scenario.budgetMs,
        `${scenario.name} exceeded ${scenario.budgetMs}ms: ${elapsed.toFixed(2)}ms`
    );

    console.log(
        `${scenario.name}: ${scenario.files} files sorted+filtered in ${elapsed.toFixed(2)}ms; visible=${filtered.length}`
    );
    scenarioResults.push({
        name: scenario.name,
        files: scenario.files,
        budgetMs: scenario.budgetMs,
        elapsedMs: Number(elapsed.toFixed(2)),
        visible: filtered.length,
    });
}

const incrementalScenario = {
    name: "Incremental",
    files: 10_000,
    iterations: 1_000,
    budgetP95Ms: 20,
};
let allFiles = sortJournalFiles(
    makeFiles(incrementalScenario.files),
    "journalDate"
);
let filteredFiles = filterJournalFilesByRange(
    allFiles,
    "journalDate",
    "recent-30",
    now
);
const incrementalTimes = [];

for (let i = 0; i < incrementalScenario.iterations; i++) {
    const fileIndex = Math.floor((i * 97) % allFiles.length);
    const sourceFile = allFiles[fileIndex];
    const modifiedFile = {
        ...sourceFile,
        stat: {
            ...sourceFile.stat,
            mtime: sourceFile.stat.mtime + i + 1,
        },
    };
    const started = performance.now();
    const result = updateIncrementalFileSet(allFiles, modifiedFile, {
        belongsToSource: true,
        timeRange: "recent-30",
        timeField: "journalDate",
        now,
    });
    incrementalTimes.push(performance.now() - started);
    allFiles = result.allFiles;
    filteredFiles = result.filteredFiles;
}

const incrementalP95 = percentile(incrementalTimes, 0.95);
assert.ok(filteredFiles.length > 0);
assert.ok(
    incrementalP95 <= incrementalScenario.budgetP95Ms,
    `${incrementalScenario.name} p95 exceeded ${incrementalScenario.budgetP95Ms}ms: ${incrementalP95.toFixed(2)}ms`
);
console.log(
    `${incrementalScenario.name}: ${incrementalScenario.iterations} single-file updates on ${incrementalScenario.files} files p95=${incrementalP95.toFixed(2)}ms; visible=${filteredFiles.length}`
);

const artifactDir = "./artifacts";
const artifactPath = `${artifactDir}/journal-performance-latest.json`;
await mkdir(artifactDir, { recursive: true });
await writeFile(
    artifactPath,
    JSON.stringify(
        {
            runAt: new Date().toISOString(),
            method:
                "Node benchmark for Journal date parse/sort/filter and incremental single-file update paths used by the Obsidian view.",
            thresholds: {
                smallWarmOpenMs: 200,
                mediumWarmOpenMs: 500,
                modifyToUiP95Ms: 300,
            },
            metrics: {
                smallWarmOpenMs:
                    scenarioResults.find((result) => result.name === "Small")
                        ?.elapsedMs ?? null,
                mediumWarmOpenMs:
                    scenarioResults.find((result) => result.name === "Medium")
                        ?.elapsedMs ?? null,
                modifyToUiP95Ms: Number(incrementalP95.toFixed(2)),
            },
            scenarios: scenarioResults,
            incremental: {
                ...incrementalScenario,
                p95Ms: Number(incrementalP95.toFixed(2)),
                visible: filteredFiles.length,
            },
        },
        null,
        2
    )
);
console.log(`Performance artifact written: ${artifactPath}`);

await Promise.allSettled([unlink(outfile), unlink(incrementalOutfile)]);

function makeFiles(count) {
    const files = [];
    const start = new Date(now);
    start.setDate(start.getDate() - Math.floor(count / 2));

    for (let i = 0; i < count; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const basename =
            i % 3 === 0
                ? formatYYMMDD(date)
                : i % 3 === 1
                    ? formatISO(date)
                    : `unparsed-${String(i).padStart(5, "0")}`;
        const mtime = date.valueOf();

        files.push({
            basename,
            name: `${basename}.md`,
            stat: {
                ctime: mtime,
                mtime,
            },
            frontmatter:
                i % 17 === 0
                    ? {
                          date: formatISO(date),
                      }
                    : undefined,
        });
    }

    return files;
}

function formatYYMMDD(date) {
    return `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatISO(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * p) - 1)
    );
    return sorted[index];
}
