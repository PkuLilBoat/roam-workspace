import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outfile = "./.tmp-navigation-multifilter-test.mjs";
await build({
    entryPoints: ["./src/navigation/recentMultiFilter.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
});

try {
    const filters = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    const files = [
        filters.normalizeFileMetadata("a.md", {
            tags: ["#Work", "project"],
            status: "active",
            priority: 1,
            reviewed: false,
            due: "2026-09-23",
            meeting: "2026-09-23T09:30:00",
            topics: ["metadata", "obsidian"],
        }),
        filters.normalizeFileMetadata("b.md", { tags: ["personal"], status: "draft" }),
        filters.normalizeFileMetadata("c.md", { tags: ["work"], status: "active", priority: 2 }),
    ];
    assert.deepEqual(files[0].tags, ["work", "project"]);
    assert.equal(files[0].properties.reviewed[0], "checkbox:false");
    assert.equal(files[0].properties.due[0], "date:2026-09-23");
    assert.equal(files[0].properties.meeting[0], "datetime:2026-09-23T09:30:00");
    assert.deepEqual(
        files.filter((file) => filters.matchesRecentFileMetadata(
            file, ["work"], { status: ["text:active"], priority: ["number:1"] }
        )).map((file) => file.path),
        ["a.md"]
    );
    assert.deepEqual(
        files.filter((file) => filters.matchesRecentFileMetadata(
            file, [], { priority: [filters.MISSING_PROPERTY_VALUE] }
        )).map((file) => file.path),
        ["b.md"]
    );
    assert.deepEqual(
        files.filter((file) => filters.matchesRecentFileMetadata(
            file, [], { topics: ["text:obsidian"] }
        )).map((file) => file.path),
        ["a.md"]
    );
    assert.equal(filters.buildPropertyOptions(files).priority.at(-1).count, 1);
    assert.deepEqual(filters.restorePropertyFilters({ status: ["text:active", "text:active"], tags: ["x"] }), {
        status: ["text:active"],
    });

    const root = filters.parseRootTaskMetadata(
        "Plan #waiting [[Project A|alias]] [[Project B#Heading]] [[Project C#^block]]",
        (target) => target.toLowerCase()
    );
    assert.deepEqual(root.tags, ["waiting"]);
    assert.deepEqual(root.pages, ["project a", "project b", "project c"]);
    assert.equal(filters.matchesRecentTaskMetadata(root, ["waiting"], ["project b"]), true);
    assert.equal(filters.matchesRecentTaskMetadata(root, ["urgent"], ["project b"]), false);
    assert.equal(filters.matchesRecentTaskMetadata(root, ["waiting"], ["other"]), false);
    console.log("Navigation multidimensional filter tests passed.");
} finally {
    await unlink(outfile);
}
