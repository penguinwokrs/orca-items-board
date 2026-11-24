# Changelog

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
