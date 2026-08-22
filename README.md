# Roam In Ob

Roam In Ob provides a Roam-like journal and page-stream experience for connected Markdown notes.

> [!IMPORTANT]
> This repository is an early development snapshot. It has not been accepted into the Obsidian Community directory and should not be treated as a stable release.

## Features

- Edit multiple journal notes in a continuous stream.
- Filter journal notes by time range, folder, tag, and preset.
- Navigate pages and linked notes through Page Stream and related views.
- Use embedded Markdown editors without leaving the stream.
- Support incremental refresh, external-change synchronization, and export workflows.

## Development

```bash
pnpm install
pnpm run lint
pnpm run build
pnpm run test:journal
```

The plugin ID is `roam-in-ob`. Development and audit scripts that operate on a vault require the `ROAM_IN_OB_VAULT_ROOT` environment variable.

## Provenance and licensing status

Roam In Ob began as a derivative of [Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor). Parts of the embedded editor implementation also originate from [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor), and the project uses [Obsidian Daily Notes Interface](https://github.com/liamcain/obsidian-daily-notes-interface) and [monkey-around](https://github.com/pjeby/monkey-around).

The Daily Notes Editor repository does not currently publish a root license. This repository is public for development transparency, but no new license is asserted over inherited code while provenance and distribution rights remain unresolved. Do not redistribute release builds without independently verifying the applicable permissions.

Attribution and third-party notices will be expanded before any Community-directory submission.
