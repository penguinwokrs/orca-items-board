// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
// Shapes are normalised in the worker (src/board.ts) from `orca bot … --json`, so the panel never
// sees the CLI's two spellings of a question (list rows vs. events).

export type ItemStatus = 'needs_you' | 'in_progress' | 'waiting' | 'planned' | 'done' | 'canceled'

export const ITEM_STATUSES: readonly ItemStatus[] = [
  'needs_you',
  'in_progress',
  'waiting',
  'planned',
  'done',
  'canceled'
]

export type BotRef = { id: string; name: string }

export type ItemLink = {
  /** pr | dispatch | url | file | … as the CLI names it. */
  kind: string
  ref: string
  title?: string
  /** A worker's state (working, completed, …). */
  state?: string
  /** Where it opens: a PR's or URL link's address. */
  url?: string
  pr?: { number?: number; state?: string; checks?: string; review?: string; title?: string }
}

export type QuickReply = {
  /** Its position in the decision, as the owner answer RPC's `skipped`/picks count it. */
  index: number
  label: string
  detail?: string
  recommended: boolean
}

export type Decision = {
  /** Its position in the ask (0-based). Each decision is answered on its own. */
  index: number
  question: string
  replies: QuickReply[]
  /** The owner may pick several replies. */
  multi: boolean
}

export type ItemQuestion = {
  /** The event that asked it, e.g. "e169": the `questionId` an owner answer names. */
  eventId: string | null
  /** The context the bot wrote above its questions. */
  gist: string
  /** The whole question as plain text, for readers without decisions. */
  text: string
  decisions: Decision[]
}

export type BoardItem = {
  uid: string
  /** Unique on this computer: `orca bot item show <number>`. */
  number: number
  bot: BotRef
  title: string
  description: string
  doneMeans: string
  status: ItemStatus
  chat: { id: string; kind: string; title: string } | null
  /** Another bot that made this item for `bot`, if any. */
  madeBy: BotRef | null
  links: ItemLink[]
  /** Waiting: what it waits on. */
  wait: { text: string; at: number | null } | null
  question: ItemQuestion | null
  closeNote: string | null
  snoozedUntil: number | null
  createdAt: number | null
  updatedAt: number | null
  lastActivityAt: number
  closedAt: number | null
  version: number | null
  /** The newest event; a detail read is cached against it. */
  lastEventId: string | null
  othersLastEventId: string | null
}

export type BoardBot = BotRef & {
  agent: string | null
  paused: boolean
  specialty: string
  itemCount: number
  /** Set when this bot's items could not be read; the rest of the board still loads. */
  error?: string
}

/** One of a bot's chats, as `orca bot chats --json` lists it: what makes a request's name and
 *  last ask. */
export type ChatInfo = {
  id: string
  bot: BotRef
  title: string
  home: boolean
  /** What the chat was last asked, as Orca shortens it; null when Orca gives none. */
  lastAsked: string | null
  lastActivityAt: number
}

export type BoardSnapshot = {
  fetchedAt: number
  bots: BoardBot[]
  /** Newest activity first. */
  items: BoardItem[]
  counts: Record<ItemStatus, number>
  /** Changes whenever any item or bot changes: the panel skips a redraw when it is the same. */
  signature: string
  /** Every bot's chats, for the request list; empty when they could not be read. */
  chats: ChatInfo[]
  /** Whole-board failures (the bot list itself, the CLI not found). */
  errors: string[]
  /** Whether this plugin can post an owner answer. False on every Orca so far: see README. */
  answer: { available: boolean; reason: string }
}

export type EventActor =
  | { kind: 'owner'; device?: string }
  | { kind: 'bot'; botId: string; botName: string | null; chatId: string | null }
  | { kind: 'other'; raw: string }

export type ItemEvent = {
  id: string
  kind: string
  at: number
  actor: EventActor
  /** Comment text, a made item's description, or a link list in words. */
  text?: string
  /** `status` events. */
  status?: { from: string | null; to: string; cause?: string; note?: string }
  /** A comment that asked the owner (Needs you). */
  ask?: { context: string; decisions: Decision[] }
  /** An owner comment answering the question asked at this event id. */
  answers?: string
  /** `made` events. */
  made?: { title: string; status?: string; doneMeans?: string }
  links?: ItemLink[]
  images?: number
}

/**
 * An owner's answer from the box, as the answer-in-place UI would send it once Orca has an API for
 * it (stablyai/orca#48010). It maps onto Orca's own `bots.items.owner.comment`: `questionId`, the
 * picked replies (their labels make the comment) and `text`. Not sent by this version.
 */
export type AnswerInput = {
  number: number
  /** The event that asked (`question.eventId`), so a stale answer is refused. */
  questionId: string | null
  /** Per decision (by index), the reply indexes picked. Decisions left out are unanswered. */
  picks: { decision: number; replies: number[] }[]
  text: string
}

export type ItemDetail = {
  item: BoardItem
  /** Oldest first, every page read. */
  events: ItemEvent[]
}

declare module 'orca' {
  interface PluginRequests {
    /** Every bot's items. `force` skips the few-second cache shared by open panels; `locale` is
     *  the caller's Orca display language, which the worker then uses for the status bar. */
    'board.get': { input: { force?: boolean; locale?: string }; output: BoardSnapshot }
    /** One item and its whole history, cached by its newest event. */
    'item.detail': { input: { number: number }; output: ItemDetail }
    /** Brings the bot's screen (its Home, where its Items pane is) to the front: `workspace.open`
     *  on the folder workspace of the item's chat, else `orca://bot/<id>` through the OS. */
    'bot.open': {
      input: { botId: string; botName?: string; chatId?: string }
      output: { via: 'workspace' | 'link'; workspaceId?: string; url?: string }
    }
    /** Opens the board in Orca's main area. `needsYou`: on All with the Needs you column shown and
     *  its first card focused (no box). `next`: with the oldest Needs you item's box open. */
    'board.open': { input: { next?: boolean; needsYou?: boolean }; output: { file: string; number: number | null } }
    /** What a command asked the board to show, once: an item's box (`number`), the Needs you
     *  column (`needsYou`), or nothing. */
    'board.takeFocus': { input: { via?: 'load' | 'event' }; output: { number: number | null; needsYou?: boolean } }
  }
  interface PluginPanelEvents {
    /** Posted to open panels when a board read finds something changed. */
    'board.changed': { signature: string; fetchedAt: number }
    /** A command asked the board to show something; an open board takes it with `board.takeFocus`. */
    'board.focus': { number: number | null; needsYou?: boolean }
  }
}
