import {
    resolveTestVaultPath,
    resolveTestVaultRoot,
} from "./test-vault-root.mjs";

export const vaultRoot = resolveTestVaultRoot();

export const fixtureDir = resolveTestVaultPath(
    "Journal/_journal_stream_regression_fixture"
);

export const fixtureFiles = [
    {
        name: "260812.md",
        content: [
            "---",
            "date: 2026-08-12",
            "tags:",
            "  - journal-stream-fixture",
            "---",
            "# Journal Stream Fixture 260812",
            "",
            "- [ ] checkbox item",
            "- nested",
            "  - child bullet",
            "",
            "[[260810]]",
            "",
            "> [!note]",
            "> Fixture callout for preview rendering.",
            "",
            "```js",
            "console.log('fixture fence');",
            "```",
            "",
        ].join("\n"),
    },
    {
        name: "2026-08-11.md",
        content: [
            "---",
            "created: 2026-08-11",
            "tags: [journal-stream-fixture]",
            "---",
            "# Journal Stream Fixture 2026-08-11",
            "",
            "Fixture file with ISO filename and inline #journal-stream-fixture tag.",
            "",
        ].join("\n"),
    },
    {
        name: "bad-yaml-260813.md",
        content: [
            "---",
            "date: [2026-08-13",
            "tags:",
            "  - journal-stream-fixture",
            "---",
            "# Bad YAML Fixture",
            "",
            "This file intentionally has malformed YAML for UI fallback checks.",
            "",
        ].join("\n"),
    },
    {
        name: "unparsed-fixture.md",
        content: [
            "# Unparsed Fixture",
            "",
            "Filename cannot be parsed as a Journal date; UI should show fallback metadata.",
            "",
        ].join("\n"),
    },
];
