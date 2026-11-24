# 2. Show the board in the main area as a custom editor; keep its file inside a checkout's .git

Date: 2026-11-24

## Status

Accepted. Where the board's file lives is superseded by ADR 0011.

## Context

The board is wide: five status columns plus a list of requests. Plugins can draw in the right
sidebar (panels) or in the main area only as a custom editor for a file type. The API has no view
of its own for the main area (stablyai/orca#26565).

A custom editor needs a file inside a workspace: `editor.open` takes a workspace and a path
relative to it. A file in someone's repository must not show up in their `git status`.

## Decision

- The board is a custom editor for `.itemsboard` files (`frame: isolated`). It draws with the DOM,
  which a components panel can't do (overlays, keyboard handling, focus). It reads data from the
  worker with `orca.plugin.request`. The file's text is ignored, except in demo mode (ADR 0009).
- The worker writes `.git/orca-items-board/Bot Items.itemsboard` in a local Git main checkout, then
  opens it with `workspace.open` and `editor.open` (`workspace:write`). The checkout is chosen in
  this order: a setting, a checkout that already has the file, the plugin's own repository, then
  the first local main checkout by path. Linked worktrees, where `.git` is a file, and remote
  hosts are never used.
- Ways to open it:
  - the command palette (`Items: Open Board`);
  - the status bar's `Needs you n` (what it shows: ADR 0010);
  - the sidebar panel's buttons;
  - the tab bar's **+** menu (a new `.itemsboard`).
- The sidebar panel stays small: counts, the Needs you list, and buttons to open the board.

## Consequences

- The board gets the full main area and full DOM control.
- Opening the board switches Orca to the workspace that holds its file.
- The tab shows a file name.
- The plugin needs `workspace:write`, and the person must have at least one local Git repository
  in Orca.
- Files under `.git` never appear in `git status`, and the board's own file holds no data.
- If Orca adds main-area views for plugins, the board can move there and drop the file.

## Alternatives considered

- **Only the right-sidebar panel.** Too narrow for the board, and components panels have no DOM
  for the floating box.
- **A file in the working tree.** Shows up in `git status` and can be committed by accident.
- **A folder workspace made for the board.** No plugin API creates one.
