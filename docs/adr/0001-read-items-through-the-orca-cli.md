# 1. Read Items through the orca CLI from a trusted worker, by polling

Date: 2026-11-24

## Status

Accepted

## Context

The board shows every bot's Items on this computer and the history behind each one. Orca's plugin
host API (1.10) has nothing for bots or Items: no list, no read, and no Item events. The only
source of the data is the `orca` CLI:

- `orca bot list`
- `orca bot item list --bot <name> --all --json`, paged with `--cursor`
- `orca bot item show <n> --json`, paged with `--after`
- `orca bot chats --bot <name> --json`

Panels and custom editors run sandboxed and cannot start processes. Only a plugin worker can.

## Decision

- The plugin runs as `trusted-worker`. Its worker calls the `orca` CLI with `execFile`, passing an
  argument array (never a shell) with `--json` and a large output buffer.
- The worker normalises the output into one shape (`src/protocol.ts`). Questions read as list rows
  and questions read from events end up in the same form.
- It answers the panel and the board through `orca.panels.handle`:
  - `board.get` returns every bot's Items, cached for a few seconds and shared by open views;
  - `item.detail` returns one Item and its whole history, cached by its newest event id.
- With no events to listen to, it polls. Open views refresh every `pollSeconds` (30 by default).
  The worker also polls so the status bar's `Needs you n` stays current; a status bar item keeps
  the worker alive. A read that finds a change posts `board.changed`, and open views refresh.
- If one bot's read fails, only that bot is marked as failed; the rest of the board still loads.
  The `orca` binary is found on `PATH`, in Orca's CLI folder, or at a path given in a setting.
- The plugin never writes Items through the CLI.

## Consequences

- The plugin works on Orca releases that have the bot CLI, with no new host API.
- Installing it means approving `trusted-worker`: the worker runs with the person's access.
- A read starts one process per bot and per page. That is about 0.4–0.6 s for a handful of bots,
  every poll, even when no board is open.
- Updates show up only at the next poll, not instantly.
- The CLI's JSON is the contract. A change in it shows up as missing fields, which the normaliser
  tolerates and the tests cover.
- When Orca adds Item methods or events to the plugin API, the worker should switch to them
  (stablyai/orca#48010).

## Alternatives considered

- **Reading Orca's own database files.** Rejected: an undocumented, private format that the
  sandbox is meant to keep plugins out of (see ADR 0005).
- **No worker, sandboxed views only.** Not possible: no API returns Items.
