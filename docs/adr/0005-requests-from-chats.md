# 5. Build the request list from chats; name requests after their Items; let the owner fix them

Date: 2026-11-24

## Status

Accepted. Requests per ask (one per owner message) wait on Orca (discussed in stablyai/orca#48010).

## Context

The owner thinks in requests: the things they asked their bots to do. Orca has no request
object. Each Item belongs to a chat (`chat.id`, `chat.title`). Each bot in a group room has its
own member chat (`bot-group-member-…`), and all of them carry the room's title.

Chat titles say little ("Home" or a room's name). `orca bot chats` gives each chat's
`lastAsked`, but that is the chat's last incoming message. It is often mail from Orca or another
bot, with headers and session ids. There is no way to read the owner's original words per chat.
`orca search` indexes bot chats, but only answers queries.

## Decision

- **One request per chat.** A group room's member chats form one request, keyed by the room's
  title, and list every bot in the room. Request ids are short: `c:` chat, `g:` room, `b:` bot
  without a chat, `r:` split (ADR 0006).
- **Named after its Items.**
  - The name is the oldest Item's title, plus "+N more" when others followed.
  - The newer Items' titles (up to three) are its summary. A one-Item request shows the first line
    of its description instead.
  - The chat's name and the bots are a small note.
- **The last ask only when it looks human.** `lastAsked` shows only when it reads like the owner's
  words. Text starting with mail headers (`────`, `From:`, `Subject:`, `件名:` …), or containing
  ids, session ids, `ctx_`/`msg_`/`task_` ids, long hex runs, commands or markup, is left out.
  When in doubt it is left out.
- **No ids on screen.** Every text the board draws passes through `hideIds`, which replaces UUIDs
  and `orca_session_id:…` with "…".
- **Fixed by hand.** The owner can rename a request, merge it into another, split one by moving an
  Item to another or a new request, and undo a request's edits. The edits are saved (ADR 0006)
  and replayed on every read.
- **Narrowing.** Choosing a request narrows the board, and the choice is saved.

## Consequences

- Rows read as work ("Delete stale preview environments? +2 more"), not as chat names.
- A request is still per chat. Two asks in one chat share a request until the owner splits them.
- Renaming a group room changes its key, so its edits stop applying. Two rooms with the same title
  merge.
- `bot chats` adds one CLI call per bot to every read.

## Alternatives considered

- **Reading Orca's internal databases** (the chat and session stores) to find each owner message.
  Rejected:
  - an undocumented, private format that can change in any release;
  - it needs file access the plugin model does not grant for it;
  - it bypasses the permission the person approved;
  - one owner message can start several Items, and the stores don't link them, so it wouldn't
    give requests per ask anyway.
- **`orca search` to find the owner's first message.** Query-only, no per-chat listing. Rejected.
- **Showing `lastAsked` as is.** Mostly bot mail and ids. Rejected.
