# 12. Keep request edits in the plugin's storage (`storage:own`)

Date: 2026-11-24

## Status

Accepted. Supersedes where ADR 0006 keeps the edits.

## Context

ADR 0006 kept request edits and the chosen request in two settings, to avoid asking for more access.
That works, but:

- a setting string holds 10,000 characters;
- Settings showed the raw JSON;
- the settings could be edited by hand.

The plugin's storage (`storage:own`) holds 256 KiB per value and 5 MiB in all, and Settings doesn't
show it. The plugin is young, so asking existing installs to approve one more capability costs
little.

## Decision

- **Where.** Edits are one value (`requestEdits`, the compact v2 object of ADR 0006) and the chosen
  request another (`selectedRequest`), in `storage:own`. The two settings are no longer declared.
- **Migration.** On the first load the board reads any older edits from the settings, v1 or v2,
  saves them compactly in storage, and only then clears the settings. If storage refuses, the
  settings stay as they were.
- **Limits.**
  - Size is measured in UTF-8 bytes of the compact JSON.
  - An edit that would pass 250,000 bytes is not applied, and the board says why.
  - Past 200,000 bytes it warns.
  - A refused save still shows on the board with what to do; nothing is lost silently.
- **Other boards.** A change in storage reaches other open boards (`storage.onDidChange`).

## Consequences

- Room for far more edits than anyone needs; Settings stays clean.
- Updating to this version asks the person to approve `storage:own`.
- Clearing all edits is no longer a Settings field. "Undo edits" on each request is the way back.

## Alternatives considered

- **Stay in settings.** Smaller room, and raw JSON in Settings. Replaced.
- **A file the worker writes.** Bypasses the capability the person approves. Rejected.
