# 14. Build requests from item origins where Orca records them; keep chats as the fallback

Date: 2026-11-25

## Status

Accepted. Amends 0005: requests per ask, where Orca records an item's origin. Group rooms stay one
request per room until Orca records a room message's key (see Consequences).

## Context

ADR 0005 made one request per chat because Orca had no request object. A busy Home chat then holds
many asks as one request, and a coordinator's and helper's items for one ask sit in two requests
(stablyai/orca#48086).

Orca with #48086 (penguinwokrs/orca `feat/item-origin-48086`) keeps, on each item's `made` event,
`origin: { rootKey, kind, at, request }` and `fromItem`, and prints them on every row of
`orca bot item list --json` and `orca bot item show --json`, which the plugin already reads
(ADR 0001):

- `rootKey`: the request's chain key, `<session>:<message>` of the turn that took it. A bot's
  request to another bot carries the key on, so all items one request led to share it, across
  bots.
- `kind`: `owner`, `person`, `group`, `automation` or `bot` (a hand-off).
- `at`: when the asking message arrived, ISO UTC, or null. Other item times are epoch ms.
- `request`: the asker's words, their first 500 characters; null deeper in a hand-off chain.
- Items made before the change, and every item on stock Orca, have no origin (null or absent).

In a group room each bot has its own member session, so one room message gets a different
`rootKey` per bot. Its `request` is that bot's whole room turn (a preamble, the room history, then
the message), not the owner's words.

## Decision

- **No new call, no new flag.** Origins are read from the rows the board already lists. The
  plugin doesn't pass `--root-key` (stock Orca refuses unknown flags, and it filters one bot).
  An origin without a `rootKey` is no origin. `at` is parsed to epoch ms; a bad time is null.
- **One request per `rootKey`.** Its id is `o:` and 14 base-36 digits: two 32-bit FNV-1a hashes
  of the key. The key holds a session id, so it is never saved or shown as it is. Saved edits name
  these ids, so the hash never changes (a test pins it).
- **Group rooms stay one request per room** (`g:<room title>`, as in 0005). A `group` item joins
  its room, and so does any item with the same `rootKey` or a key that starts with one of the
  room's member chats (a room bot's hand-off). This is worked out over the whole board when it is
  read (`linkRooms`), so each item still has one request id.
- **Items without an origin keep their chat's request** (0005), so the board works on stock Orca
  and old and new items mix.
- **Named after the asker's words.** The request's name is `origin.request` on one line, ids
  hidden, cut at 80 characters on a whole character ("…"). The whole text shows on hover and in the
  item's box (**Asked for**). Words from a person or an automation win over a hand-off's, then the
  earliest asked. Every item's title is the summary. With no words (a hand-off three hops down,
  a room), the 0005 name is used: the oldest item's title, "+N more".
- **No chat last ask on origin requests.** A chat's last ask may belong to another request in the
  same chat. It still shows for chat and room requests.
- **Order.** Needs you first, then the newest item activity (epoch ms), then the newest ask
  (`origin.at`). The oldest item, which names a request without words, is the earliest made
  (`createdAt`, else `origin.at`).
- **Edits work the same** on every kind of request: rename, merge, split, undo. Moving an item back
  to the request its origin puts it in drops the move.
- **`fromItem`** shows in the item's box as **Made from**, and opens that item when it is on the
  board.

## Consequences

- In a busy Home chat each ask is its own row, and a coordinator's and helpers' items for one ask
  are one row with every bot.
- Edits saved against a chat request still apply to the items that stay in it (those without an
  origin). New items with an origin go to their own request; merge or move them by hand if wanted.
- A room's messages are still one request per room. Splitting them needs Orca to record the room
  message (its id as the key, its text as the words) on a room turn's items. That is an Orca
  change outside #48086 as it stands.
- An owner's follow-up in the same chat ("go on") is a new turn, so a new request. Merge it by hand.

## Alternatives considered

- **`orca bot item list --root-key` per request.** One bot per call, and a key must be known first.
  The grouping needs every item anyway. Rejected.
- **Keying a room by its words.** Each bot's recorded words are its own room turn, so they differ
  per bot. Rejected.
- **The raw `rootKey` as the request id.** Long, and it holds a session id. Rejected for the hash.
