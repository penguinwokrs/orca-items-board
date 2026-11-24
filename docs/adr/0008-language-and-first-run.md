# 8. Follow Orca's display language (English by default); open the board once on first run

Date: 2026-11-24

## Status

Accepted

## Context

The plugin is public, and its first owner works in Japanese. Orca exposes its display language
only to views:

- `orca.locale` in custom editors;
- `env.locale` in components panels.

Workers get no locale. Manifest command titles can't be localised; language packs translate
Orca's own UI.

A plugin that only lives in a palette command and a status bar item is easy to miss after
installing.

## Decision

- **Two languages.** Every string the plugin draws comes from `src/i18n.ts`, in English and
  Japanese. A `ja*` locale gets Japanese; anything else gets English. Status names (Needs you, In
  progress, …) read as Orca shows them, in both languages.
- **The worker's language.** The worker learns the language from the views' requests (`board.get`
  carries `locale`) and uses English until then. The status bar tooltip may be English until a
  board or panel has been opened once.
- **Command titles** are English (`Items: Open Board`, `Items: Answer Next Needs You`).
- **First run.** The first time the worker runs after the plugin is enabled, it opens the board
  once. The flag is the setting `openOnFirstRun`: cleared before opening, so a failure never
  repeats on every start. It retries a few times while Orca's window comes up. The person can turn
  it back on.

## Consequences

- Japanese owners get a Japanese board without any setup.
- Other languages fall back to English.
- The status bar tooltip can briefly be English.
- First-run opening switches Orca to the board's workspace once (ADR 0002).

## Alternatives considered

- **A language setting.** Duplicates Orca's own setting. Rejected.
- **The OS `LANG` in the worker.** Doesn't follow Orca's display language. Rejected.
