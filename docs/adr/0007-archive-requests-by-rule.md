# 7. Archive requests by rule: all Items closed for N days; nothing saved

Date: 2026-11-24

## Status

Accepted. Manual archiving is deferred (see stablyai/orca#46839).

## Context

Items are never deleted: Orca has no retention or archive for them yet (stablyai/orca#46839). Over
time the request list fills with requests whose work is long finished. The owner wants them out
of the way but still reachable.

## Decision

- **The rule.** A request is archived when all its Items are closed (Done or Canceled) and the last
  one closed at least `archiveAfterDays` days ago. The setting defaults to 7; 0 never archives.
- **Nothing saved.** The rule is worked out on every read. A new or reopened Item brings the
  request straight back.
- **The list.** Archived requests sit in a collapsed **Archived (n)** section at the bottom of the
  list. Its heading says the rule and the number of Items.
- **The counts.** **All** leaves archived requests out of its count and says how many it leaves
  out. The toolbar does the same.
- **The board.** With **All** chosen, archived requests' Items stay off the board. Choosing an
  archived request shows them, and keeps its section open.
- **Manual archiving waits.**

## Consequences

- The list stays short with no new storage and no stale state.
- A finished request reappears if a bot adds or reopens an Item in that chat. That is intended.
- When Orca archives Items itself (#46839), "archived" should follow Orca's flag instead. A manual
  archive in the plugin would then be a view-only state, since the plugin can't write Items as the
  owner (ADR 0004).

## Alternatives considered

- **A manual archive saved per request.** Needs storage, likely `storage:own` (ADR 0006), and
  overlaps with Orca's planned archive. Deferred.
- **Hiding closed Items only.** Requests would still crowd the list. Rejected.
