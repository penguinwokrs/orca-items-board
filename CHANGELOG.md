# Changelog

## 0.2.0

- **Request list.** A list of requests on the board's left; **All** comes first.
  - Every chat makes a request on its own. A group room's chats (one per bot) make a single request
    with every bot in the room.
  - Each row shows the chat's name, its bots, the chat's last ask (from `orca bot chats`), how many
    Items it holds and how many need you. Requests with Needs you stand out and come first.
  - Choosing a request narrows the five columns to its Items. The choice is saved.
  - Edits:
    - rename a request;
    - merge it into another;
    - split it, by moving an Item to another request or to a new one from its box;
    - undo a request's edits.
  - Edits are kept in the plugin's settings (`settings:own`, no new access), so they survive
    refreshes and restarts. Clearing **Request edits** in Settings undoes them all.
- **Demo.** Demo mode has made-up requests, a group room among them. New demo options:
  `request`, `edits` and `show`.
- English and Japanese for everything new.

## 0.1.0

- First release:
  - the wide board, as a custom editor;
  - the floating box, with the history and the questions;
  - **Answer in Orca ↗**;
  - the status bar's `Needs you n`, the sidebar panel and the commands;
  - the first-run open, English and Japanese, and demo mode.
