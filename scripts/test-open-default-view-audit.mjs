import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const validatorPath = path.join(root, "scripts", "validate-ui-audit.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "journal-stream-ui01-"));
const firstFixture =
    "Journal/_journal_stream_regression_fixture/260812.md";
const secondFixture =
    "Journal/_journal_stream_regression_fixture/2026-08-11.md";

const validAudit = {
    runAt: "2026-08-24T00:00:00.000Z",
    pluginId: "roam-workspace",
    pluginVersion: "0.1.0",
    obsidianVersion: "1.13.7",
    vaultRoot: "/Users/feng/Documents/OBSIDIAN/TEST",
    viewport: { width: 1600, height: 970, devicePixelRatio: 2 },
    settings: {
        journalFolder: "Journal",
        defaultOpenMode: "journal-folder",
        initialRange: "recent-30",
        enableExportMarkdown: true,
    },
    status: "passed",
    viewState: {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDate",
        selectedRange: "recent-30",
    },
    snapshot: {
        selectionMode: "folder",
        target: "Journal",
        timeField: "journalDate",
        selectedRange: "recent-30",
        renderedFileCount: 2,
        pendingFileCount: 0,
        hasMore: false,
        visibleNoteCount: 2,
        renderedFilePaths: [firstFixture, secondFixture],
        visibleNotePaths: [firstFixture, secondFixture],
        titles: ["2026-08-12", "2026-08-11"],
        dom: {
            noteContainerCount: 2,
            previewCount: 0,
            editorCount: 2,
        },
    },
};

await expectValidation("valid", validAudit, true);
await expectValidation(
    "missing-fixture-without-flag",
    withSnapshotPaths(validAudit, [firstFixture]),
    true,
    false
);
await expectValidation(
    "missing-fixture",
    withSnapshotPaths(validAudit, [firstFixture]),
    false
);
await expectValidation(
    "reversed-fixtures",
    withSnapshotPaths(validAudit, [secondFixture, firstFixture]),
    false
);
await expectValidation(
    "duplicate-path",
    withSnapshotPaths(validAudit, [firstFixture, secondFixture, secondFixture]),
    false
);
await expectValidation(
    "wrong-view-state",
    {
        ...validAudit,
        viewState: { ...validAudit.viewState, target: "Journal/Other" },
    },
    false
);
await expectValidation(
    "wrong-snapshot-state",
    {
        ...validAudit,
        snapshot: { ...validAudit.snapshot, selectedRange: "recent-7" },
    },
    false
);
await expectValidation(
    "wrong-default-settings",
    {
        ...validAudit,
        settings: { ...validAudit.settings, initialRange: "recent-7" },
    },
    false
);
await expectValidation(
    "partial-progressive-window",
    {
        ...validAudit,
        snapshot: {
            ...validAudit.snapshot,
            pendingFileCount: 1,
            hasMore: true,
        },
    },
    false
);
await expectValidation(
    "dom-count-mismatch",
    {
        ...validAudit,
        snapshot: {
            ...validAudit.snapshot,
            dom: { ...validAudit.snapshot.dom, noteContainerCount: 1 },
        },
    },
    false
);

await rm(tempRoot, { recursive: true });
console.log(
    "UI-01 open-default-view audit contract passed (temporary directory only)"
);

function withSnapshotPaths(audit, renderedFilePaths) {
    return {
        ...audit,
        snapshot: {
            ...audit.snapshot,
            renderedFileCount: renderedFilePaths.length,
            renderedFilePaths,
        },
    };
}

async function expectValidation(name, audit, shouldPass, requireContract = true) {
    const auditPath = path.join(tempRoot, `${name}.json`);
    await writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
    const result = spawnSync(
        process.execPath,
        [
            validatorPath,
            auditPath,
            ...(requireContract ? ["--require-open-default-view"] : []),
        ],
        {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                JOURNAL_STREAM_VAULT_ROOT: "/Users/feng/Documents/OBSIDIAN/TEST",
            },
        }
    );
    const passed = result.status === 0;
    if (passed !== shouldPass) {
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        throw new Error(
            `${name} expected ${shouldPass ? "pass" : "failure"}, got exit ${result.status}: ${output}`
        );
    }
    if (!shouldPass) {
        const output = await readFile(auditPath, "utf8");
        if (!output.trim()) throw new Error(`${name} audit fixture is empty`);
    }
}
