# Changelog

## Unreleased

- **Requests from item origins.** On Orca that records where an Item came from
  ([stablyai/orca#48086](https://github.com/stablyai/orca/issues/48086)), the request list has one
  row per request instead of one per chat:
  - Items sharing an origin's request key are one request across bots and chats: a coordinator's
    and its helpers' Items together, and each ask in a busy Home chat on its own.
  - It is named after the words that asked, shortened; the whole text shows on hover and in the
    Item's box (**Asked for**). Every Item's title is listed under it. With no words recorded, the
    oldest Item names it as before.
  - A chat's last ask no longer shows on these rows: in a busy chat it may belong to another request.
  - Group rooms too: each owner post in a room is one request, across every member bot that worked
    on it (@mentions, peer requests, hand-offs), named after the post. Two posts in one room are two
    requests. Grouping goes by the request key alone, never by its kind. Room Items without an
    origin still make one request per room.
  - Items without an origin (older ones, or stock Orca) keep their chat's request. Nothing to turn on.
  - Rename, merge, split and undo work on every kind of request.
  - The request key holds a session id: it is hashed for the request id and never shown.
- **Made from.** An Item's box shows the Item whose work it came from, when Orca recorded one, and
  opens it.
- Demo: `"origins": true`. QA guide: [docs/qa-origin.md](docs/qa-origin.md). ADR 0014.

## 0.2.0

- **Request list.** A list of requests on the board's left; **All** comes first.
  - Every chat makes a request on its own. A group room's chats (one per bot) make a single request
    with every bot in the room.
  - Each request is named after its oldest Item, "+N more" when others followed. The newer Items'
    titles are its summary; a one-Item request shows its description's first line.
  - Rows show Item and Needs you counts; requests with Needs you stand out and come first.
  - The chat's name and bots are a small note. The chat's last ask (from `orca bot chats`) shows only
    when it reads like the owner's words: mail from Orca or bots, and text with ids, is left out.
  - No UUIDs or session ids are shown anywhere, in any text the board draws.
  - Choosing a request narrows the five columns to its Items. The choice is saved.
  - Edits:
    - rename a request;
    - merge it into another;
    - split it, by moving an Item to another request or to a new one from its box;
    - undo a request's edits.
  - Edits are kept in the plugin's settings (`settings:own`, no new access), so they survive
    refreshes and restarts. Clearing **Request edits** in Settings undoes them all.
  - Orca keeps at most 10,000 characters in a setting, so edits are saved compactly: short
    request ids, Items by number, moves grouped by request. An Item move takes about 4 characters.
    Edits that no longer do anything are tidied away, and older saves are rewritten on the first read.
  - A save Orca refuses, or an edit that would pass the limit, is shown on the board with what
    to do; nothing is dropped silently. Past 8,000 characters the board warns.
- **The board file moves to a folder of its own.**
  - The file now lives in the OS's app data folder (Linux `~/.local/share/orca-items-board`, macOS
    `~/Library/Application Support/orca-items-board`, Windows `%LOCALAPPDATA%\orca-items-board`).
  - That folder is registered once as a folder project (an existing one is reused) and hidden
    from the sidebar.
  - Files earlier versions wrote in Git checkouts' `.git` are removed, but only ones with the
    plugin's exact text.
  - New settings: **Board folder** and **Hide the board folder in the sidebar**.
- **Request edits move to the plugin's storage** (`storage:own`, new access to approve).
  - Older edits and the chosen request in Settings are moved over on the first load, then cleared.
  - The limit is now 256 KiB per value: a warning past 200,000 bytes, and refusals still show
    on the board.
- **Windows.**
  - `orca.cmd` is no longer run through a shell, which newer Node refuses. The launcher it names
    is run directly; `cmd.exe` with full escaping is only a fallback.
  - APPDATA and LOCALAPPDATA are filled in when missing.
  - URLs open with `rundll32 url.dll,FileProtocolHandler`.
  - Unit-tested only; not yet tried on a real Windows or Mac.
- **Last asks**: Orca's own resume prompt ("Continue where you left off.") is no longer shown as
  one.
- **Status bar `Needs you n` shows, it doesn't open.** Pressing it opens the board on **All**
  (leaving another or an archived request), makes the Needs you column glow and scroll into
  view, and focuses its first card (Enter opens it). No box opens by itself.
  - New command `Items: Show Needs You` does the same.
  - `Items: Answer Next Needs You` still opens the oldest Needs you box.
  - The panel's buttons are now **Open board** and **Show Needs you**.
- **Archived requests.** A request whose Items are all closed, the last one at least
  `archiveAfterDays` days ago (setting, 7 by default, 0 never), moves into a collapsed
  **Archived (n)** section. It is worked out on every read, so a new or reopened Item brings it
  back. **All** leaves archived requests out of its count (and says so) and off the board;
  choosing one shows its Items.
- **Demo.** Demo mode has made-up requests, a group room among them. New demo options:
  `request`, `edits`, `show` and `showArchived`; two archived demo requests.
- English and Japanese for everything new.

## 0.1.0

- First release:
  - the wide board, as a custom editor;
  - the floating box, with the history and the questions;
  - **Answer in Orca ↗**;
  - the status bar's `Needs you n`, the sidebar panel and the commands;
  - the first-run open, English and Japanese, and demo mode.
