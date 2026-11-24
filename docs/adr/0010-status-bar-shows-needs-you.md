# 10. The status bar shows what needs you on the board; it doesn't open an Item

Date: 2026-11-24

## Status

Accepted. Changes how the status bar and the panel reach the board (ADR 0002). The box itself
(ADR 0003) is unchanged.

## Context

`Needs you n` in the status bar first opened the board with the oldest Needs you Item's box
already open. In use this was too much:

- it jumped into one Item when the owner wanted to see everything that waited;
- it skipped the board's overview;
- it could pick an Item the owner wasn't ready for.

When another request, or an archived one, was chosen in the list, the Needs you cards could also
be hidden from the board.

## Decision

- Pressing `Needs you n` (command `items-board.showNeedsYou`, "Items: Show Needs You") opens the
  board and shows what needs you. No box opens.
  - The request list goes back to **All**, leaving another or an archived request. The Archived
    section folds and the list scrolls to its top.
  - The Needs you column glows for about two seconds (a steady outline with reduced motion) and
    scrolls into view, its list back at the top.
  - The first Needs you card gets the keyboard focus and a visible mark, so Enter opens its box.
- `Items: Answer Next Needs You` stays in the command palette and still opens the oldest Needs you
  box, for those who want to go straight in.
- The sidebar panel's buttons follow the same idea: **Open board** and **Show Needs you**.
- The worker hands the request to the board as a focus (`{ needsYou: true }` next to the existing
  `{ number }`), so a board already open and one just opening both act on it once.
- The status bar tooltip says "Press to see them on the board" (or the Japanese equivalent).

## Consequences

- The status bar is a calm way in: the overview first, one key to the first Item.
- Pressing it changes the chosen request to All, and the choice is saved.
- Answering the oldest Item directly is one palette command away, not one click.

## Alternatives considered

- **Keep opening the oldest box.** The behaviour this replaces.
- **Open the board unchanged** (keep the chosen request). Needs you could stay hidden behind
  another or an archived request. Rejected.
