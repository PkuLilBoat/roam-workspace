<img src="assets/community-banner.png" alt="Learning and creating in the AI era" width="680">

<table><tr><td width="180"><img src="assets/wechat.jpg" alt="WeChat community QR code" width="156"></td><td>Scan the QR code to join our lifelong learning community and discussion groups.<br>Let's exchange ideas about AI, knowledge management, and productivity tools.<br>WeChat Official Account: 湖畔的赛博格 (same name).</td></tr></table>

---

# Roam Workspace

English | [简体中文](README.zh-CN.md)

Edit journals, connected pages, and recent activity in one Obsidian workspace. This repository contains the current local integration based on source commit `73dc52af342aa104e2e4db1849194a8a3f3aa6e6` (2026-10-18), replacing the older Roam In Ob snapshot.

## Screenshots

Journal and Page Stream: keep related pages beside the journal without losing reading and editing context.

![Journal with a related page in Page Stream](assets/screenshots/journal-page-stream.png)

List Heading: navigate the actual hierarchy of a note's nested lists.

![An editable note with List Heading navigation](assets/screenshots/list-heading.png)

Captured in Obsidian 1.14.4 with the GitHub 0.1.0 release and sample notes in an isolated TEST vault.

Updated navigation, Journal, and Page Stream in version 0.1.1, captured in the isolated TEST vault on Obsidian 1.14.4.

![Roam Workspace 0.1.1](assets/screenshots/workspace-0.1.1.png)

## Features

- **Journal**: continuous daily-note or folder editing, date ranges, sorting, presets, and Markdown export.
- **Page Stream**: keep several connected pages together with embedded Markdown editors.
- **Navigation**: recent files/tasks and filters in one panel.
- **List Heading and Outliner**: compact heading/list navigation and scoped list editing.

## Install

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/PkuLilBoat/roam-workspace/releases/latest). Put all three files directly in `<vault>/<configDir>/plugins/roam-workspace/` (`configDir` is usually `.obsidian`). Reload Obsidian, allow community plugins if needed, and enable **Roam Workspace**. Source ZIP downloads do not contain `main.js`.

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

**Noncommercial use of PkuLilBoat's original contributions is permitted; commercial use requires PkuLilBoat's prior written permission.** See the [license](LICENSE) for scope and terms. Commercial use includes internal business use, paid client work, resale, paid hosting, and paid product integration. Request authorization through [GitHub Issues](https://github.com/PkuLilBoat/roam-workspace/issues) or the maintainer's contact information above; submitting a request is not permission. These are source-available terms, not an OSI-approved open-source license.

Noncommercial redistribution must retain the license and applicable notices, and clearly credit PkuLilBoat, name Roam Workspace, and link to the [original repository](https://github.com/PkuLilBoat/roam-workspace) on the distribution page or in accompanying documentation. Modified versions must identify material changes and must not be presented as official releases by the original author.

Roam Workspace is maintained by PkuLilBoat. The maintainer confirms that the earlier base implementation was subsequently fully rewritten. This replaces the previous description of the current project as inherited Daily Notes Editor code. The installation ID is `roam-workspace`.

The original-contribution license does not replace the terms of separately retained third-party components, including Hover Editor, Outliner, and dependencies. See [third-party notices](THIRD_PARTY_NOTICES.md). Their attribution and licenses remain applicable.

## Feedback

Share issues and suggestions through [GitHub Issues](https://github.com/PkuLilBoat/roam-workspace/issues).
