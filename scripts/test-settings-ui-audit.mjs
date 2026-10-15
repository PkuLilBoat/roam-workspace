import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const validatorPath = path.join(root, "scripts", "validate-ui-audit.mjs");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "journal-stream-ui02-"));

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
        renderedFileCount: 1,
        pendingFileCount: 0,
        hasMore: false,
        visibleNoteCount: 1,
        renderedFilePaths: ["Journal/2026-08-24.md"],
        visibleNotePaths: ["Journal/2026-08-24.md"],
        titles: ["2026-08-24"],
        dom: { noteContainerCount: 1, previewCount: 0, editorCount: 1 },
    },
    actions: {
        settingsToggle: {
            status: "passed",
            settingsLayout: {
                status: "passed",
                containerVisible: true,
                overlapCount: 0,
                requiredControlCounts: {
                    "Journal folder": 1,
                    "Default open mode": 1,
                    "Initial range": 1,
                    "Enable Markdown export": 1,
                },
            },
            before: {
                settingsRevision: 4,
                viewSettingsRevision: 4,
                exportCommandAvailable: true,
                settings: {
                    journalFolder: "Journal",
                    defaultOpenMode: "journal-folder",
                    initialRange: "recent-30",
                    enableExportMarkdown: true,
                },
            },
            temporary: {
                settingsRevision: 5,
                viewSettingsRevision: 5,
                exportCommandAvailable: false,
                persistedSettingsMatch: true,
                settings: {
                    journalFolder: "Journal/_settings_audit",
                    defaultOpenMode: "daily",
                    initialRange: "recent-7",
                    enableExportMarkdown: false,
                },
            },
            afterRestore: {
                settingsRevision: 6,
                viewSettingsRevision: 6,
                exportCommandAvailable: true,
                persistedSettingsMatch: true,
                dataBytesRestored: true,
                settings: {
                    journalFolder: "Journal",
                    defaultOpenMode: "journal-folder",
                    initialRange: "recent-30",
                    enableExportMarkdown: true,
                },
            },
        },
    },
};

try {
    await expectValidation("legacy-zero-count-fake-green", legacyFakeGreen(), false);
    await expectValidation("valid", validAudit, true);
    await expectValidation(
        "layout-overlap",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.settingsLayout.overlapCount = 1;
        }),
        false
    );
    await expectValidation(
        "layout-control-missing",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.settingsLayout.requiredControlCounts[
                "Initial range"
            ] = 0;
        }),
        false
    );
    await expectValidation(
        "revision-did-not-advance",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.temporary.viewSettingsRevision = 4;
        }),
        false
    );
    await expectValidation(
        "command-does-not-follow-setting",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.temporary.exportCommandAvailable = true;
        }),
        false
    );
    await expectValidation(
        "temporary-not-persisted",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.temporary.persistedSettingsMatch = false;
        }),
        false
    );
    await expectValidation(
        "one-setting-not-changed",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.temporary.settings.initialRange = "recent-30";
        }),
        false
    );
    await expectValidation(
        "restore-bytes-differ",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.afterRestore.dataBytesRestored = false;
        }),
        false
    );
    await expectValidation(
        "restore-value-differs",
        mutate(validAudit, (audit) => {
            audit.actions.settingsToggle.afterRestore.settings.journalFolder = "Other";
        }),
        false
    );
    console.log("UI-02 settings audit contract passed (temporary directory only)");
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

function legacyFakeGreen() {
    const audit = mutate(validAudit, () => {});
    audit.actions.settingsToggle = {
        status: "passed",
        before: { exportButtonCount: 0 },
        afterDisabled: { exportButtonCount: 0 },
        afterRestore: { exportButtonCount: 0 },
    };
    return audit;
}

function mutate(value, update) {
    const copy = JSON.parse(JSON.stringify(value));
    update(copy);
    return copy;
}

async function expectValidation(name, audit, shouldPass) {
    const auditPath = path.join(tempRoot, `${name}.json`);
    await writeFile(auditPath, JSON.stringify(audit, null, 2), "utf8");
    const result = spawnSync(
        process.execPath,
        [validatorPath, auditPath, "--require-settings-toggle"],
        {
            cwd: root,
            encoding: "utf8",
            env: {
                ...process.env,
                JOURNAL_STREAM_VAULT_ROOT: "/Users/feng/Documents/OBSIDIAN/TEST",
            },
        }
    );
    if ((result.status === 0) !== shouldPass) {
        throw new Error(
            `${name} expected ${shouldPass ? "pass" : "failure"}, got exit ${result.status}: ${result.stdout}${result.stderr}`
        );
    }
}
