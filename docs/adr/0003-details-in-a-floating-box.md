# 3. Show an Item's details in a floating box over the board

Date: 2026-11-24

## Status

Accepted

## Context

A card can only show a few lines. Answering a Needs you Item takes several things at once:

- the question's summary;
- the description and the done-means;
- the history;
- the links;
- the bot's suggested replies.

The owner wants this without leaving the board or losing their place in it.

## Decision

- Pressing a card (or Enter on it) opens a floating box over a dimmed board.
- Closing it puts focus back on the card. It closes with Esc, ×, or a click outside.
- Inside the box:
  - ← and → move to the previous or next Item in the same column;
  - Tab cycles inside the box;
  - only the body scrolls (`overscroll-behavior: contain`);
  - the header (bot, number, status, title) and the answer area stay fixed.
- The body shows, in order:
  - the question summary (Needs you only);
  - what it waits on (Waiting only);
  - the description and the done-means;
  - the history, oldest first: the newest 10 events, the rest behind "Show N older events".
- An info column on the right holds the status, bot, chat, links, the request (where an Item can
  be moved, ADR 0005) and the dates.
- A refresh that changes nothing doesn't redraw the box, so focus and drafts survive polling.

## Consequences

- One screen covers reading and acting; the board stays visible behind the box.
- The box lives inside the board's tab. It can't cover Orca's sidebars.
- Keyboard and focus behaviour is ours to keep right. It is covered by DOM tests (happy-dom),
  since `plugin shot --act` needs Orca's window minimised.

## Alternatives considered

- **A side drawer.** Less room for the history and the replies.
- **Expanding the card in place.** It pushes the column around and breaks ← → between Items.
