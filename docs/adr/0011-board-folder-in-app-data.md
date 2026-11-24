# 11. Keep the board file in the plugin's own app-data folder, registered as a hidden folder project

Date: 2026-11-24

## Status

Accepted. Supersedes the file location in ADR 0002.

## Context

The board is a custom editor, so it needs a `.itemsboard` file inside a workspace (ADR 0002). The
first version kept that file in a Git main checkout's `.git` folder. It never showed in `git status`,
but it borrowed someone's repository for the plugin's own file. It also needed a local Git repository
in Orca, and opening the board switched Orca to that project. Orca can register any folder as a
project (`orca repo add --kind folder`), and plugins can hide projects from the sidebar
(`project.setHidden`, `workspace:write`).

## Decision

- **The folder.** The file lives in a folder of the plugin's own, in the OS's place for app data:
  - Linux: `${XDG_DATA_HOME:-~/.local/share}/orca-items-board`
  - macOS: `~/Library/Application Support/orca-items-board`
  - Windows: `%LOCALAPPDATA%\orca-items-board`, or `<home>\AppData\Local\…` when the variable
    is missing (stablyai/orca#46975)

  It holds only `Bot Items.itemsboard`. The **Board folder** setting can move it.
- **Registration.** The worker registers the folder once with `orca repo add --path <abs> --kind
  folder`, on the computer Orca runs on and never on an SSH or WSL host. A folder project already
  registered for the same path is reused. Paths are compared as real paths, ignoring case on
  Windows and macOS.
- **Opening.** The board opens with `workspace.open` on the folder's workspace and `editor.open`
  with the file's name as the relative path.
- **Hiding.** The project is hidden from the sidebar with `project.setHidden`; a setting turns this
  off. On Linux (Orca 1.4.272) a hidden folder project still opens: `editor.open` succeeds and the
  board loads from it.
- **Old files.** Files earlier versions wrote at `<checkout>/.git/orca-items-board/` are removed
  when the worker starts, but only when their text is exactly what the plugin wrote. The folder
  goes too if that empties it.

## Consequences

- No Git repository is needed, and nobody's repository is touched.
- Opening the board switches Orca to the hidden folder workspace, a workspace that only holds the
  board.
- The registration stays in Orca's project list (hidden) after the plugin is removed. It can be
  shown and removed like any project.
- Windows and macOS paths are unit-tested only, not yet tried on a real machine.

## Alternatives considered

- **Keep using a checkout's `.git` folder.** Borrows a repository and needs one. Replaced.
- **The plugin's install folder.** Replaced on every update, and may be read-only.
- **Leaving the project visible.** A project with one file clutters the sidebar. Hidden by
  default instead.
