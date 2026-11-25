# 14. Build requests from item origins where Orca records them; keep chats as the fallback

Date: 2026-11-25

## Status

Accepted. Amends 0005: requests per ask, where Orca records an item's origin, group rooms included
(one request per owner post in a room). Chats stay the fallback for items without an origin.

## Context

ADR 0005 made one request per chat because Orca had no request object. A busy Home chat then holds
many asks as one request, and a coordinator's and helper's items for one ask sit in two requests
(stablyai/orca#48086).

Orca with #48086 (penguinwokrs/orca `feat/item-origin-48086`) keeps, on each item's `made` event,
`origin: { rootKey, kind, at, request }` and `fromItem`, and prints them on every row of
`orca bot item list --json` and `orca bot item show --json`, which the plugin already reads
(ADR 0001):

- `rootKey`: the request's chain key. A bot's request to another bot carries the key on, so all
  items one request led to share it, across bots. The plugin treats it as opaque: it only compares
  keys, never parses them.
- `kind`: `owner`, `person`, `group`, `automation` or `bot` (a hand-off, or a peer request).
- `at`: when the asking message arrived, ISO UTC, or null. Other item times are epoch ms.
- `request`: the asker's words, their first 500 characters; null deeper in a hand-off chain.
- Items made before the change, and every item on stock Orca, have no origin (null or absent).

In a group room each bot has its own member session. Orca (the same branch, from 0d9a22b7) keys a
room by the owner's post: one `rootKey` per post, shared by every member bot, @mention hand-offs,
peer requests between members, their answers and worker reports. `request` is the owner's post
text (500 characters, cut on a whole character); it can be null for rows started by item changes
or reports after Stop. `kind` is `group` for the owner's post and @mention turns, but `bot` for a
turn a peer request woke. Items made with `--from-item` inherit their parent's origin, and a turn
opened only by item mail (an owner comment, a Needs you answer) inherits its items' `rootKey`.

## Decision

- **No new call, no new flag.** Origins are read from the rows the board already lists. The
  plugin doesn't pass `--root-key` (stock Orca refuses unknown flags, and it filters one bot).
  An origin without a `rootKey` is no origin. `at` is parsed to epoch ms; a bad time is null.
- **One request per `rootKey`.** Its id is `o:` and 14 base-36 digits: two 32-bit FNV-1a hashes
  of the key. The key holds a session id, so it is never saved or shown as it is. Saved edits name
  these ids, so the hash never changes (a test pins it).
- **Group rooms too.** A room item with an origin goes by its `rootKey` like any other, never by
  its `kind` or chat: two owner posts in one room are two requests, and one post handled by several
  member bots (a peer request's `bot` items included) is one. Only room items without an origin
  fall back to the room (`g:<room title>`, as in 0005).
- **Items without an origin keep their chat's request** (0005), so the board works on stock Orca
  and old and new items mix.
- **Named after the asker's words.** The request's name is `origin.request` on one line, ids
  hidden, cut at 80 characters on a whole character ("…"). The whole text shows on hover and in the
  item's box (**Asked for**). Words from a person or an automation win over a hand-off's, then the
  earliest asked. Every item's title is the summary. In a room the words are the owner's post.
  With no words (a hand-off three hops down, a room post Orca kept none for), the 0005 name is
  used: the oldest item's title, "+N more".
- **No chat last ask on origin requests.** A chat's last ask may belong to another request in the
  same chat (or room). It still shows for requests made from chats, a room's included.
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
- A room's posts are one request each, named after the post, with every member bot that worked on
  it. Edits saved against a room request (`g:<title>`) still apply to the room's items without an
  origin; new room items go to their post's request.
- Items made on an earlier build of the Orca branch (before 0d9a22b7) carry a key per member bot
  and a bot's room turn as their words, so they show one request per bot. Nothing guesses them back
  together; merge them by hand if wanted.
- An owner's follow-up in the same chat ("go on") is a new turn, so a new request. Merge it by hand.

## Alternatives considered

- **`orca bot item list --root-key` per request.** One bot per call, and a key must be known first.
  The grouping needs every item anyway. Rejected.
- **Keying a room by the room** (`g:<title>` for every room item, as in the first version of this
  record, which tied a room's per-bot keys together by parsing them). Every post in a room became
  one request, and it relied on the key's shape. Dropped once Orca keyed each post once.
- **Grouping by `kind`.** A peer request's turn is `bot`, though it belongs to the room's post.
  Rejected: `rootKey` alone decides.
- **The raw `rootKey` as the request id.** Long, and it holds a session id. Rejected for the hash.
