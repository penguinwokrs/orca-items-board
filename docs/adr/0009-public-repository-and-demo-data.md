# 9. Keep the public repository free of private data: demo data only, and a check before every push

Date: 2026-11-24

## Status

Accepted

## Context

The plugin is built against a real owner's bots and Items, and the repository and its plugin
listing are public. Real Item text, bot and chat names, ids and screenshots must never reach it.
A real chat id once slipped into a test value. The usual word searches didn't catch it because
it was just a UUID.

## Decision

- **Demo mode for screenshots and docs.** A `.itemsboard` file holding `{"source":"demo", …}` draws
  made-up bots, Items, requests (a group room and archived ones among them) and chats, and never
  calls the worker. Options can:
  - select a request;
  - start from edits;
  - open a box;
  - scroll it;
  - press **Answer in Orca ↗**;
  - preview answer-in-place;
  - open the Archived section;
  - force a language.

  Every image in the repository is shot from demo mode.
- **Fixtures and tests use made-up names**, and only a short list of obviously synthetic UUIDs.
- **A check before every push.** It runs outside the repository, over the commits being pushed and
  the resulting tree. It fails on:
  - this computer's real ids, read from Orca (bot, chat, session and item ids, and workspace and
    repository ids), in full and in the short forms the plugin makes;
  - any UUID that isn't on the synthetic list;
  - a list of internal words;
  - a commit identity other than the project's public one;
  - readable text inside images.
- **Live checks stay local.** Checks against real data print counts only.

## Consequences

- What is public can be shown and reproduced by anyone.
- The check needs Orca running, to read the real ids, and adds a few seconds per push.
- History that was already pushed isn't rewritten by the check. A leak found there needs a
  separate decision.

## Alternatives considered

- **Blurring real screenshots.** Easy to get wrong, and text leaks through. Rejected.
- **Relying on word lists alone.** Missed a bare id. Rejected.
