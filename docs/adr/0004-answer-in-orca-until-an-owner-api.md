# 4. Answer in Orca until plugins can answer as the owner; keep answer-in-place behind a flag

Date: 2026-11-24

## Status

Accepted. Answering in place is deferred until stablyai/orca#48010.

## Context

Orca answers an Item as its owner through the runtime call `bots.items.owner.comment`. That call
refuses the `orca` CLI on purpose (`ownerOnly`). `orca bot item comment` writes only from a bot's
own chat. The plugin host API has no Item methods. So a plugin can't post the owner's answer.

Orca's deep link `orca://bot/<id>` opens a bot's Home. In tests it did nothing visible while a
file tab such as the board was in front. A bot's Home is a folder workspace, and `orca agent
list` gives the folder workspace of each chat.

## Decision

- The box lists the questions and their replies as text, with the recommended reply marked. It has
  one button, **Answer in Orca ↗**.
- The button asks the worker to show the folder workspace of the Item's chat with `workspace.open`.
  If that workspace can't be found, it falls back to `orca://bot/<id>` through the OS. Then it
  closes the box and tells the owner where to answer: the panel on the right, under Needs you.
- The answer-in-place UI stays in the code behind a flag (`answerInPlace`): reply buttons, free
  text, Send, 1–9, ⌘/Ctrl+Enter. It turns on once the worker reports `answer.available`.
- `src/protocol.ts` keeps what an answer needs: `questionId`, decision and reply indexes, `multi`,
  and the `AnswerInput` shape.
- `docs/answer-in-place.md` records the design and the steps to turn it back on.

## Consequences

- Answering takes one extra step: the bot's screen. It is clearly labelled, and the board says
  what to do next.
- Orca's deep link can't name a Home-chat Item, so the owner opens the Item on the bot's screen.
- The kept UI must not rot. Its tests run with the flag forced on.

## Alternatives considered

- **Mail the bot** (`orca orchestration send --to bot:<name> --item <n>`). Wakes the bot, but the
  answer isn't recorded on the Item, which stays Needs you. Rejected.
- **Pretend to be a desktop or paired-device caller to reach `bots.items.owner.*`.** The gate is
  deliberate. Rejected.
