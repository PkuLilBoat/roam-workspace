import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const metadataOutfile = "./.tmp-metadata-menu-contracts-test.mjs";
const superchargedOutfile = "./.tmp-supercharged-links-contracts-test.mjs";
const sectionStateOutfile = "./.tmp-navigation-section-state-test.mjs";
const recentFileClassOutfile = "./.tmp-recent-fileclass-filter-test.mjs";
const recentTaskBlocksOutfile = "./.tmp-recent-task-blocks-test.mjs";

await Promise.all([
    build({
        entryPoints: ["./src/integrations/metadataMenuContracts.ts"],
        outfile: metadataOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
    }),
    build({
        entryPoints: ["./src/integrations/superchargedLinksContracts.ts"],
        outfile: superchargedOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
    }),
    build({
        entryPoints: ["./src/navigation/sectionState.ts"],
        outfile: sectionStateOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
    }),
    build({
        entryPoints: ["./src/navigation/recentFileClassFilter.ts"],
        outfile: recentFileClassOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
    }),
    build({
        entryPoints: ["./src/navigation/recentTaskBlocks.ts"],
        outfile: recentTaskBlocksOutfile,
        bundle: true,
        format: "esm",
        platform: "node",
        logLevel: "silent",
    }),
]);

try {
    const metadata = await import(
        `${pathToFileURL(metadataOutfile).href}?t=${Date.now()}`
    );
    const supercharged = await import(
        `${pathToFileURL(superchargedOutfile).href}?t=${Date.now()}`
    );
    const sectionState = await import(
        `${pathToFileURL(sectionStateOutfile).href}?t=${Date.now()}`
    );
    const recentFileClass = await import(
        `${pathToFileURL(recentFileClassOutfile).href}?t=${Date.now()}`
    );
    const recentTasks = await import(
        `${pathToFileURL(recentTaskBlocksOutfile).href}?t=${Date.now()}`
    );

    assert.deepEqual(sectionState.DEFAULT_NAVIGATION_SECTION_COLLAPSED, {
        bookmarks: false,
        recentFiles: false,
        recentTasks: false,
    });
    assert.deepEqual(
        sectionState.restoreNavigationSectionCollapsed({
            bookmarks: true,
            recentFiles: "yes",
            recentTasks: false,
        }),
        { bookmarks: true, recentFiles: false, recentTasks: false }
    );
    const collapsedRecent = sectionState.setNavigationSectionCollapsed(
        sectionState.DEFAULT_NAVIGATION_SECTION_COLLAPSED,
        "recentFiles",
        true
    );
    assert.deepEqual(collapsedRecent, {
        bookmarks: false,
        recentFiles: true,
        recentTasks: false,
    });
    assert.equal(
        sectionState.setNavigationSectionCollapsed(
            collapsedRecent,
            "recentFiles",
            true
        ),
        collapsedRecent,
        "an unchanged section state should preserve object identity"
    );

    assert.deepEqual(
        recentFileClass.normalizeRecentFileClassFilter([
            " ProjectFile ",
            "ProjectFile",
            "",
            null,
            recentFileClass.UNCLASSIFIED_FILTER_VALUE,
        ]),
        ["ProjectFile", recentFileClass.UNCLASSIFIED_FILTER_VALUE]
    );
    const fileClassAssignments = [
        { path: "Project/one.md", fileClassName: "ProjectFile" },
        { path: "Journal/two.md", fileClassName: null },
        { path: "Project/three.md", fileClassName: "ProjectFile" },
        { path: "Tool/four.md", fileClassName: "Tool" },
    ];
    assert.deepEqual(
        recentFileClass.buildRecentFileClassOptions(fileClassAssignments),
        [
            { value: "ProjectFile", label: "ProjectFile", count: 2 },
            {
                value: recentFileClass.UNCLASSIFIED_FILTER_VALUE,
                label: "Unclassified",
                count: 1,
            },
            { value: "Tool", label: "Tool", count: 1 },
        ]
    );
    assert.deepEqual(
        recentFileClass
            .filterRecentFileClassAssignments(
                fileClassAssignments,
                ["ProjectFile", "Tool"],
                true
            )
            .map((assignment) => assignment.path),
        ["Project/one.md", "Project/three.md", "Tool/four.md"],
        "FileClass multi-select should use OR while preserving MRU order"
    );
    assert.deepEqual(
        recentFileClass.filterRecentFileClassAssignments(
            fileClassAssignments,
            ["Missing"],
            true
        ),
        [],
        "an active unmatched selection should produce the explicit empty projection"
    );
    assert.deepEqual(
        recentFileClass.filterRecentFileClassAssignments(
            fileClassAssignments,
            ["ProjectFile"],
            false
        ),
        fileClassAssignments,
        "capability loss should show the complete MRU without discarding selection"
    );
    assert.deepEqual(
        recentFileClass.toggleRecentFileClassFilter(
            ["ProjectFile"],
            recentFileClass.UNCLASSIFIED_FILTER_VALUE
        ),
        ["ProjectFile", recentFileClass.UNCLASSIFIED_FILTER_VALUE]
    );

    const taskText = [
        "- [ ] Alpha task",
        "\t- [ ] Alpha child",
        "\t  child detail",
        "- [ ] Duplicate task",
        "\t- first subtree",
        "- [ ] Duplicate task",
        "\t- second subtree",
        "- [x] Completed task",
    ].join("\n");
    const parsedTasks = recentTasks.parseIncompleteRootTaskBlocks(taskText);
    assert.deepEqual(
        parsedTasks.map((block) => [
            block.rootLine,
            block.endLine,
            block.normalizedRootText,
        ]),
        [
            [0, 2, "Alpha task"],
            [3, 4, "Duplicate task"],
            [5, 6, "Duplicate task"],
        ],
        "only unfinished indentation-zero tasks should own nested subtrees"
    );
    assert.equal(
        recentTasks.findRootTaskBlockAtLine(parsedTasks, 2)?.rootLine,
        0,
        "editing a child line should resolve to its top-level root"
    );
    let taskRecords = recentTasks.reconcileRecentTaskRecordsForPath(
        [],
        "Task/demo.md",
        taskText,
        2,
        100
    );
    assert.deepEqual(taskRecords[0], {
        path: "Task/demo.md",
        lineHint: 0,
        normalizedRootText: "Alpha task",
        subtreeSignature: parsedTasks[0].subtreeSignature,
        lastTouchedAt: 100,
    });
    taskRecords = recentTasks.reconcileRecentTaskRecordsForPath(
        taskRecords,
        "Task/demo.md",
        taskText,
        4,
        200
    );
    taskRecords = recentTasks.reconcileRecentTaskRecordsForPath(
        taskRecords,
        "Task/demo.md",
        taskText,
        6,
        300
    );
    assert.deepEqual(
        taskRecords.map((record) => [
            record.lineHint,
            record.subtreeSignature,
            record.lastTouchedAt,
        ]),
        [
            [5, parsedTasks[2].subtreeSignature, 300],
            [3, parsedTasks[1].subtreeSignature, 200],
            [0, parsedTasks[0].subtreeSignature, 100],
        ],
        "duplicate root text should remain distinct by subtree and line hint"
    );
    const shiftedText = `# Inserted heading\n${taskText}`;
    const shiftedRecords = recentTasks.reconcileRecentTaskRecordsForPath(
        taskRecords,
        "Task/demo.md",
        shiftedText
    );
    assert.deepEqual(
        shiftedRecords.map((record) => record.lineHint),
        [6, 4, 1],
        "unchanged subtree signatures should relocate after lines are inserted above"
    );
    assert.equal(
        recentTasks.resolveRecentTaskRecord(shiftedText, shiftedRecords[0])?.rootLine,
        6
    );
    const ambiguousDuplicateEdit = shiftedText.replace(
        "\t- second subtree",
        "\t- externally changed subtree"
    );
    assert.equal(
        recentTasks.resolveRecentTaskRecord(
            ambiguousDuplicateEdit,
            shiftedRecords[0]
        ),
        null,
        "a duplicate whose signature no longer matches must not resolve by line alone"
    );
    assert.equal(
        recentTasks.reconcileRecentTaskRecordsForPath(
            shiftedRecords,
            "Task/demo.md",
            ambiguousDuplicateEdit
        ).length,
        2,
        "ambiguous duplicate records should be removed during passive cleanup"
    );
    const completedAlpha = shiftedText.replace("- [ ] Alpha task", "- [x] Alpha task");
    const afterCompletion = recentTasks.reconcileRecentTaskRecordsForPath(
        shiftedRecords,
        "Task/demo.md",
        completedAlpha,
        1,
        400
    );
    assert.equal(
        afterCompletion.some((record) => record.normalizedRootText === "Alpha task"),
        false,
        "completing a root should remove it instead of recording a completed task"
    );
    assert.deepEqual(
        recentTasks.renameRecentTaskPath(
            afterCompletion,
            "Task/demo.md",
            "Task/renamed.md"
        ).map((record) => record.path),
        ["Task/renamed.md", "Task/renamed.md"]
    );
    assert.deepEqual(
        recentTasks.removeRecentTaskPath(afterCompletion, "Task/demo.md"),
        []
    );
    assert.deepEqual(
        recentTasks.restoreRecentTaskBlockRecords([
            { ...taskRecords[0], lastTouchedAt: 1 },
            { ...taskRecords[1], lastTouchedAt: 3 },
            { path: "", lineHint: -1 },
        ]).map((record) => record.lastTouchedAt),
        [3, 1],
        "stored task records should be sanitized and sorted newest-first"
    );
    const manyTasksText = Array.from(
        { length: recentTasks.RECENT_TASK_BLOCK_LIMIT + 2 },
        (_, index) => `- [ ] Task ${index}`
    ).join("\n");
    let limitedRecords = [];
    for (let index = 0; index < recentTasks.RECENT_TASK_BLOCK_LIMIT + 2; index += 1) {
        limitedRecords = recentTasks.reconcileRecentTaskRecordsForPath(
            limitedRecords,
            "Task/many.md",
            manyTasksText,
            index,
            index
        );
    }
    assert.equal(limitedRecords.length, recentTasks.RECENT_TASK_BLOCK_LIMIT);
    assert.deepEqual(
        limitedRecords.map((record) => record.normalizedRootText).slice(0, 2),
        ["Task 21", "Task 20"],
        "the task MRU should keep only the newest twenty roots"
    );

    assert.deepEqual(metadata.parseSemanticVersion("0.8.12"), {
        major: 0,
        minor: 8,
        patch: 12,
    });
    assert.deepEqual(metadata.parseSemanticVersion("0.8.12-beta.1"), {
        major: 0,
        minor: 8,
        patch: 12,
    });
    assert.equal(metadata.parseSemanticVersion("0.8"), null);
    assert.equal(metadata.supportsMetadataMenuTargetedActions("0.8.12"), true);
    assert.equal(metadata.supportsMetadataMenuTargetedActions("0.8.11"), false);
    assert.equal(metadata.supportsMetadataMenuTargetedActions("0.8.13"), false);
    assert.equal(metadata.supportsMetadataMenuTargetedActions("0.9.0"), false);
    assert.equal(metadata.supportsMetadataMenuTargetedActions("1.0.0"), false);

    const openFields = () => "open";
    const addFileClass = () => "add";
    const menuActions = [
        {
            title: "Manage all fields",
            icon: "clipboard-list",
            section: "metadata-menu",
            action: () => "generic",
        },
        {
            title: "Open fields modal",
            icon: "map",
            section: "metadata-menu",
            action: openFields,
        },
        {
            title: "Add fileClass to Feature",
            icon: "plus-square",
            section: "metadata-menu-fileclass",
            action: addFileClass,
        },
    ];
    assert.equal(
        metadata.selectMetadataMenuTargetAction(menuActions, "open-fields", "Feature"),
        openFields
    );
    assert.equal(
        metadata.selectMetadataMenuTargetAction(
            menuActions,
            "add-file-class",
            "Feature"
        ),
        addFileClass
    );
    assert.equal(
        metadata.selectMetadataMenuTargetAction(
            menuActions,
            "add-file-class",
            "Different"
        ),
        null
    );
    assert.equal(metadata.createContentSignature("[]"), metadata.createContentSignature("[]"));
    assert.notEqual(
        metadata.createContentSignature('{"items":[]}'),
        metadata.createContentSignature('{"items":[1]}')
    );

    const fileClasses = [
        { name: "Parent", usable: true },
        { name: "Broken", usable: false },
        { name: "ProjectFile", usable: true },
    ];
    assert.equal(
        metadata.selectHighestPriorityFileClass(
            fileClasses,
            (fileClass) => fileClass.usable
        ).name,
        "ProjectFile"
    );
    assert.equal(metadata.selectHighestPriorityFileClass([], () => true), null);

    const settings = supercharged.parseSuperchargedLinksSettings({
        targetAttributes: [
            "fileClass",
            " status ",
            "status",
            12,
            "",
            "task type",
        ],
        targetTags: true,
    });
    assert.deepEqual(settings, {
        targetAttributes: ["fileClass", "status", "task type"],
        targetTags: true,
    });
    assert.deepEqual(supercharged.parseSuperchargedLinksSettings(null), {
        targetAttributes: [],
        targetTags: false,
    });
    assert.equal(
        supercharged.createSuperchargedLinksStateSignature(true, settings),
        supercharged.createSuperchargedLinksStateSignature(true, {
            targetAttributes: ["task type", "fileClass", "status"],
            targetTags: true,
        })
    );
    assert.notEqual(
        supercharged.createSuperchargedLinksStateSignature(true, settings),
        supercharged.createSuperchargedLinksStateSignature(false, settings)
    );
    assert.equal(supercharged.isLatestAsyncGeneration(3, 3), true);
    assert.equal(supercharged.isLatestAsyncGeneration(2, 3), false);

    assert.deepEqual(
        supercharged.buildSuperchargedLinkAttributes(
            {
                fileClass: "ProjectFile",
                status: ["active", "review"],
                tags: ["project", "p0"],
                "task type": "prd",
                ignored: "value",
                missing: null,
            },
            ["#inline", "#nested"],
            "Project/Feature.md",
            {
                targetAttributes: [
                    "fileClass",
                    "status",
                    "tags",
                    "task type",
                    "missing",
                ],
                targetTags: true,
            }
        ),
        {
            fileClass: "ProjectFile",
            status: "active,review",
            "task-type": "prd",
            tags: "project,p0#inline #nested",
            path: "Project/Feature.md",
        }
    );
    assert.equal(supercharged.toContractKey("task type"), "task-type");
    assert.equal(
        supercharged.toContractCssValue("https://example.com/icon.svg"),
        "url(https://example.com/icon.svg)"
    );
    assert.equal(supercharged.toContractCssValue("active"), "active");

    console.log("Navigation integration contract tests passed.");
} finally {
    await Promise.allSettled([
        unlink(metadataOutfile),
        unlink(superchargedOutfile),
        unlink(sectionStateOutfile),
        unlink(recentFileClassOutfile),
        unlink(recentTaskBlocksOutfile),
    ]);
}
