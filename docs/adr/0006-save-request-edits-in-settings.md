# 6. Save request edits in a plugin setting, compactly, and show every save failure

Date: 2026-11-24

## Status

Accepted

## Context

Request edits (renames, moves, merges, splits; ADR 0005) must survive refreshes and restarts.
`settings:own` is already approved. `storage:own` would add access, and every installed copy would
need approval again. A setting string holds at most 10,000 characters
(`PLUGIN_SETTING_STRING_MAX_LENGTH`). A longer one is refused with `action_failed`.

The first format stored item uids and long ids: about 90 characters a move. Items are never
deleted, so pruning by "item gone" never shrank it. A refused save was dropped silently, so edits
vanished on the next load.

## Decision

- **Where.** Edits live in the setting `requestEdits` as compact JSON, and the selection in
  `selectedRequest`. Both are `settings:own`; no new capability.
- **Format v2.** `{"v":2,"n":{id:name},"m":{to:[item numbers]},"g":{from:into}}`, with empty parts
  left out.
  - Request ids are short. A chat's UUID is cut to 12 hex digits.
  - Items are kept by number, and moves are grouped by target: about 4 characters a move.
  - Splits aren't stored: they are the `r:` ids the edits mention.
- **Tidying.** On every save, edits that no longer do anything are dropped:
  - moves of Items the board doesn't have;
  - moves that only repeat where an Item already is;
  - empty splits;
  - names of requests with no Items.
- **Older saves.** A v1 save is read, and rewritten in v2 on the first full read.
- **Failures are shown.**
  - An edit that would pass 9,500 characters is not applied. A banner says why and what to do:
    undo edits, or clear the setting.
  - A save Orca refuses shows the same banner, with Orca's reason.
  - Past 8,000 characters a warning shows how much is used.
- **Outside changes.** When the setting changes in Settings, an open board picks it up.
- **Partial reads.** A read that missed a bot keeps the selection and the edits it can't see.

## Consequences

- Hundreds of edits fit (300 moves take under 2,500 characters), and nothing is lost silently.
- Settings shows the raw JSON. Clearing it undoes every edit, a documented way out.
- If edits outgrow the setting anyway, moving them to `storage:own` (256 KB a value) is the next
  step. It costs one approval.

## Alternatives considered

- **`storage:own` now.** More room and hidden from Settings, but every installed copy would need
  approval again. Kept for later.
- **A file the worker writes.** Bypasses the capability the person approved. Rejected.
- **Saving the edits in the board's `.itemsboard` file.** Edits leave the tab unsaved until the
  person saves it, and the file can be replaced or deleted. Rejected.
