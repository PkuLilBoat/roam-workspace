<img src="assets/community-banner.png" alt="Learning and creating in the AI era" width="680">

<table><tr><td width="180"><img src="assets/wechat.jpg" alt="WeChat community QR code" width="156"></td><td>Scan the QR code to join our lifelong learning community and discussion groups.<br>Let's exchange ideas about AI, knowledge management, and productivity tools.<br>WeChat Official Account: 湖畔的赛博格 (same name).</td></tr></table>

---

# Roam Workspace

English | [简体中文](README.zh-CN.md)

Edit journals, connected pages, and recent activity in one Obsidian workspace. This repository contains the current local integration based on source commit `55818810dae2d28ca065843905a77436051258d8` (2026-10-09), replacing the older Roam In Ob snapshot.

## Screenshots

Journal and Page Stream: keep related pages beside the journal without losing reading and editing context.

![Journal with a related page in Page Stream](assets/screenshots/journal-page-stream.png)

List Heading: navigate the actual hierarchy of a note's nested lists.

![An editable note with List Heading navigation](assets/screenshots/list-heading.png)

Captured in Obsidian 1.14.4 with the GitHub 0.1.0 release and sample notes in an isolated TEST vault.

## Features

- **Journal**: continuous daily-note or folder editing, date ranges, sorting, presets, and Markdown export.
- **Page Stream**: keep several connected pages together with embedded Markdown editors.
- **Navigation**: recent files/tasks and filters in one panel.
- **List Heading and Outliner**: compact heading/list navigation and scoped list editing.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from the [0.1.0 release](https://github.com/PkuLilBoat/roam-workspace/releases/tag/0.1.0). Put all three files directly in `<vault>/<configDir>/plugins/roam-workspace/` (`configDir` is usually `.obsidian`). Reload Obsidian, allow community plugins if needed, and enable **Roam Workspace**. Source ZIP downloads do not contain `main.js`.

Back up an existing plugin folder before updating and preserve `data.json`. The plugin ID is `roam-workspace`; an older `roam-in-ob` or Daily Notes Editor installation is separate. Disable overlapping plugins when checking compatibility, and do not delete or migrate their data automatically.

This is a development snapshot for manual installation. It is not listed in the Obsidian Community directory. The manifest declares Obsidian 1.8.7 or newer and mobile support, but this snapshot has not been independently validated across minimum-version and mobile platforms. Start with a test vault.

## Quick start and settings

Open the command palette and run **Roam Workspace: Open journal stream**, **Open page stream**, **Open roam navigation**, or **Open list heading**. Choose the journal folder in plugin settings; the default is `Journal`. Settings also control startup behavior, date range, presets, source paths, frontmatter, backlinks, navigation filters, recent tasks, and Outliner scope. Recent tasks are disabled by default.

## Privacy and AI

Notes and plugin settings stay in the vault. This plugin does not include an AI service, an AI account, or an MCP server. An external local AI assistant can help install the three files and edit settings; its own access and privacy policy are separate. Personal `data.json`, notes, and local deployment targets are not included in this release. The local multi-vault deployment list is intentionally empty in the public copy; installers should not run the author's deployment scripts.

## Build

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:journal
pnpm run test:compat-quality
pnpm run test:navigation
pnpm run lint
```

`build` includes Svelte/TypeScript checking and writes `main.js`, `styles.css`, and build fingerprints. Consult the release notes for actual check results. Runtime audit scripts are maintainer tools with a fixed local TEST-vault boundary, not general installation commands.

## Provenance and license

Derived from [Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor), with embedded-editor origins in [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor). See [third-party notices](THIRD_PARTY_NOTICES.md) and the [historical README](docs/UPSTREAM-README.md).

The earlier repository records unresolved root licensing for inherited Daily Notes Editor code. This update preserves that status and does not claim a new blanket MIT license or clear inherited distribution rights. The Outliner module retains its own MIT notice and license. This development publication is not a claim of Community-directory approval or production readiness.

## Feedback

Share issues and suggestions through [GitHub Issues](https://github.com/PkuLilBoat/roam-workspace/issues).
