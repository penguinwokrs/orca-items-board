// Reads every bot's Items through the `orca` CLI and normalises them for the panel. The CLI runner
// is passed in, so tests feed it canned JSON and never spawn anything.
import {
  ITEM_STATUSES,
  type BoardBot,
  type BoardItem,
  type BoardSnapshot,
  type BotRef,
  type ChatInfo,
  type Decision,
  type EventActor,
  type ItemDetail,
  type ItemEvent,
  type ItemLink,
  type ItemQuestion,
  type ItemStatus
} from './protocol'

/** Runs `orca <args>` and answers the `result` of its `--json` envelope, or throws CliError. */
export type OrcaRunner = (args: readonly string[]) => Promise<unknown>

export class CliError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export const ANSWER_UNAVAILABLE =
  "Orca has no way yet for a plugin to answer as the owner: `orca bot item comment` only runs from a bot's own chat, and the owner's answer (bots.items.owner.comment) refuses the orca CLI. Answer in the bot's Items in Orca."

/** At most this many `orca` processes at once. */
const PARALLEL = 4
/** `item list` and `item show` pages; stop following cursors past this, as a guard. */
const MAX_PAGES = 50

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const optStr = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

function status(value: unknown): ItemStatus {
  const text = str(value).replace(/-/g, '_')
  return (ITEM_STATUSES as readonly string[]).includes(text) ? (text as ItemStatus) : 'planned'
}

function botRef(value: unknown): BotRef | null {
  if (!isObject(value)) {
    return null
  }
  const id = str(value.botId ?? value.id)
  const name = str(value.name)
  return id || name ? { id, name } : null
}

/** A link on an item row (rich) or in a `linked` event ("kind:ref"). */
export function normaliseLink(value: unknown): ItemLink | null {
  if (typeof value === 'string') {
    const at = value.indexOf(':')
    if (/^https?:/.test(value)) {
      return { kind: 'url', ref: value, url: value }
    }
    return at <= 0
      ? { kind: 'file', ref: value }
      : { kind: value.slice(0, at), ref: value.slice(at + 1) }
  }
  if (!isObject(value)) {
    return null
  }
  const kind = str(value.kind) || 'url'
  const ref = str(value.ref)
  const pr = isObject(value.pr) ? value.pr : null
  const url = optStr(pr?.url) ?? (/^https?:/.test(ref) ? ref : undefined)
  return {
    kind,
    ref,
    ...(optStr(value.title) ? { title: str(value.title) } : {}),
    ...(optStr(value.state) ? { state: str(value.state) } : {}),
    ...(url ? { url } : {}),
    ...(pr
      ? {
          pr: {
            ...(num(pr.number) !== null ? { number: num(pr.number)! } : {}),
            ...(optStr(pr.state) ? { state: str(pr.state) } : {}),
            ...(optStr(pr.checks) ? { checks: str(pr.checks) } : {}),
            ...(optStr(pr.review) ? { review: str(pr.review) } : {}),
            ...(optStr(pr.title) ? { title: str(pr.title) } : {})
          }
        }
      : {})
  }
}

/** A list row's `question.decisions[]`: `{ question, replies: [{ label, detail?, recommended }], multi? }`. */
function rowDecisions(value: unknown): Decision[] {
  return arr(value)
    .filter(isObject)
    .map((decision, index) => ({
      index,
      question: str(decision.question),
      multi: decision.multi === true,
      replies: arr(decision.replies)
        .filter(isObject)
        .map((reply, replyIndex) => ({
          index: replyIndex,
          label: str(reply.label),
          ...(optStr(reply.detail) ? { detail: str(reply.detail) } : {}),
          recommended: reply.recommended === true
        }))
    }))
}

/** An event's `data.ask.questions[]`: `{ prompt, options: [{ label, detail? }], recommended?: index, multi? }`. */
function askDecisions(value: unknown): Decision[] {
  return arr(value)
    .filter(isObject)
    .map((decision, index) => {
      const recommended = num(decision.recommended)
      return {
        index,
        question: str(decision.prompt),
        multi: decision.multi === true,
        replies: arr(decision.options)
          .filter(isObject)
          .map((option, optionIndex) => ({
            index: optionIndex,
            label: str(option.label),
            ...(optStr(option.detail) ? { detail: str(option.detail) } : {}),
            recommended: recommended === optionIndex
          }))
      }
    })
}

function question(value: unknown): ItemQuestion | null {
  if (!isObject(value)) {
    return null
  }
  return {
    eventId: optStr(value.eventId) ?? null,
    gist: str(value.gist),
    text: str(value.text),
    decisions: rowDecisions(value.decisions)
  }
}

export function normaliseItem(value: unknown, fallbackBot?: BotRef): BoardItem | null {
  if (!isObject(value) || num(value.number) === null) {
    return null
  }
  const owner = botRef(value.owner) ?? fallbackBot ?? { id: '', name: '' }
  const chat = isObject(value.chat)
    ? { id: str(value.chat.id), kind: str(value.chat.kind), title: str(value.chat.title) }
    : null
  const wait = isObject(value.wait) ? { text: str(value.wait.text), at: num(value.wait.at) } : null
  const updatedAt = num(value.updatedAt)
  return {
    uid: str(value.uid),
    number: num(value.number)!,
    bot: owner,
    title: str(value.title),
    description: str(value.description),
    doneMeans: str(value.doneMeans),
    status: status(value.status),
    chat,
    madeBy: botRef(value.madeBy),
    links: arr(value.links)
      .map(normaliseLink)
      .filter((link): link is ItemLink => link !== null),
    wait,
    question: question(value.question),
    closeNote: optStr(value.closeNote) ?? null,
    snoozedUntil: num(value.snoozedUntil),
    createdAt: num(value.createdAt),
    updatedAt,
    lastActivityAt: num(value.lastActivityAt) ?? updatedAt ?? 0,
    closedAt: num(value.closedAt),
    version: num(value.version),
    lastEventId: optStr(value.lastEventId) ?? null,
    othersLastEventId: optStr(value.othersLastEventId) ?? null
  }
}

function actor(value: unknown, botNames: ReadonlyMap<string, string>): EventActor {
  if (isObject(value) && value.kind === 'owner') {
    return optStr(value.device) ? { kind: 'owner', device: str(value.device) } : { kind: 'owner' }
  }
  if (isObject(value) && value.kind === 'bot') {
    const botId = str(value.botId)
    return {
      kind: 'bot',
      botId,
      botName: botNames.get(botId) ?? null,
      chatId: optStr(value.chatId) ?? null
    }
  }
  return { kind: 'other', raw: JSON.stringify(value ?? null) }
}

export function normaliseEvent(
  value: unknown,
  botNames: ReadonlyMap<string, string> = new Map()
): ItemEvent | null {
  if (!isObject(value)) {
    return null
  }
  const data = isObject(value.data) ? value.data : {}
  const kind = str(value.kind)
  const event: ItemEvent = {
    id: str(value.id),
    kind,
    at: num(value.at) ?? 0,
    actor: actor(value.actor, botNames)
  }
  if (kind === 'made') {
    event.made = {
      title: str(data.title),
      ...(optStr(data.status) ? { status: str(data.status) } : {}),
      ...(optStr(data.doneMeans) ? { doneMeans: str(data.doneMeans) } : {})
    }
    if (optStr(data.description)) {
      event.text = str(data.description)
    }
  }
  if (kind === 'status') {
    event.status = {
      from: optStr(data.from) ?? null,
      to: str(data.to),
      ...(optStr(data.cause) ? { cause: str(data.cause) } : {}),
      ...(optStr(data.note) ? { note: str(data.note) } : {})
    }
  }
  if (kind !== 'made' && optStr(data.text)) {
    event.text = str(data.text)
  }
  if (isObject(data.ask)) {
    event.ask = { context: str(data.ask.context), decisions: askDecisions(data.ask.questions) }
  }
  if (optStr(data.answers)) {
    event.answers = str(data.answers)
  }
  const links = arr(data.links)
    .map(normaliseLink)
    .filter((link): link is ItemLink => link !== null)
  if (links.length > 0) {
    event.links = links
  }
  if (arr(data.images).length > 0) {
    event.images = arr(data.images).length
  }
  return event
}

function emptyCounts(): Record<ItemStatus, number> {
  return Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>
}

/** Runs `tasks` with at most `limit` in flight, keeping their order. */
async function pool<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const at = next++
      results[at] = await tasks[at]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane))
  return results
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every item of one bot, closed ones included, following `nextCursor`. */
export async function listBotItems(run: OrcaRunner, bot: BotRef): Promise<BoardItem[]> {
  const items: BoardItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ['bot', 'item', 'list', '--bot', bot.name, '--all', '--limit', '100', '--json']
    if (cursor) {
      args.push('--cursor', cursor)
    }
    const result = await run(args)
    const rows = isObject(result) ? arr(result.items) : []
    for (const row of rows) {
      const item = normaliseItem(row, bot)
      if (item) {
        items.push(item)
      }
    }
    cursor = isObject(result) ? (optStr(result.nextCursor) ?? null) : null
    if (!cursor) {
      break
    }
  }
  return items
}

export async function listBots(run: OrcaRunner): Promise<BoardBot[]> {
  const result = await run(['bot', 'list', '--json'])
  return arr(isObject(result) ? result.bots : undefined)
    .filter(isObject)
    .map((bot) => ({
      id: str(bot.id),
      name: str(bot.name),
      agent: optStr(bot.agent) ?? null,
      paused: bot.paused === true,
      specialty: str(bot.specialty),
      itemCount: 0
    }))
    .filter((bot) => bot.name !== '')
}

function signatureOf(bots: readonly BoardBot[], items: readonly BoardItem[], chats: readonly ChatInfo[] = []): string {
  const parts = [
    ...bots.map((bot) => `${bot.id}:${bot.paused ? 1 : 0}:${bot.error ? 'x' : ''}`),
    ...items.map((item) =>
      [
        item.uid || item.number,
        item.status,
        item.lastEventId ?? '',
        item.version ?? '',
        // PR checks/review and worker state change without an Item event.
        ...item.links.map((link) => `${link.ref}/${link.state ?? ''}/${link.pr?.state ?? ''}/${link.pr?.checks ?? ''}/${link.pr?.review ?? ''}`)
      ].join(':')
    ),
    // A new ask changes a row; mere activity in a chat doesn't.
    ...chats.map((chat) => `c:${chat.id}:${chat.title}:${chat.lastAsked ?? ''}`)
  ].sort()
  // FNV-1a over the parts: short and stable, enough to tell "something changed".
  let hash = 0x811c9dc5
  for (const char of parts.join('|')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** One bot's chats, for request names and last asks. A failure leaves them out (the board still
 *  loads; rows just show no last ask). */
export async function listBotChats(run: OrcaRunner, bot: BotRef): Promise<ChatInfo[]> {
  const result = await run(['bot', 'chats', '--bot', bot.name, '--json'])
  return arr(isObject(result) ? result.chats : undefined)
    .filter(isObject)
    .map((chat) => ({
      id: str(chat.id),
      bot,
      title: str(chat.title),
      home: chat.home === true,
      lastAsked: optStr(chat.lastAsked)?.trim() || null,
      lastActivityAt: num(chat.lastActivityAt) ?? 0
    }))
    .filter((chat) => chat.id !== '')
}

/** The whole board: every bot, then each bot's items in parallel. One bot failing marks that bot. */
export async function loadBoard(run: OrcaRunner, now: () => number = Date.now): Promise<BoardSnapshot> {
  const errors: string[] = []
  let bots: BoardBot[] = []
  try {
    bots = await listBots(run)
  } catch (error) {
    errors.push(`Could not list bots: ${message(error)}`)
  }
  const perBot = await pool(
    bots.map((bot) => async () => {
      try {
        return await listBotItems(run, bot)
      } catch (error) {
        bot.error = message(error)
        return []
      }
    }),
    PARALLEL
  )
  const perBotChats = await pool(
    bots.map((bot) => async () => listBotChats(run, bot).catch(() => [] as ChatInfo[])),
    PARALLEL
  )
  const chats = perBotChats.flat()
  const seen = new Set<number>()
  const items: BoardItem[] = []
  perBot.forEach((botItems, at) => {
    bots[at]!.itemCount = botItems.length
    for (const item of botItems) {
      // Numbers are unique per computer; an item made for another bot could list twice.
      if (!seen.has(item.number)) {
        seen.add(item.number)
        items.push(item)
      }
    }
  })
  items.sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.number - a.number)
  const counts = emptyCounts()
  for (const item of items) {
    counts[item.status] += 1
  }
  return {
    fetchedAt: now(),
    bots,
    items,
    counts,
    chats,
    signature: signatureOf(bots, items, chats),
    errors,
    answer: { available: false, reason: ANSWER_UNAVAILABLE }
  }
}

/** One item and every event, paging with `--after <last event>`. */
export async function loadItemDetail(
  run: OrcaRunner,
  number: number,
  botNames: ReadonlyMap<string, string> = new Map()
): Promise<ItemDetail> {
  let item: BoardItem | null = null
  const raw: unknown[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ['bot', 'item', 'show', String(number), '--json']
    if (after) {
      args.push('--after', after)
    }
    const result = await run(args)
    if (!isObject(result)) {
      throw new CliError(`orca bot item show ${number} answered no item`, 'bad_output')
    }
    item ??= normaliseItem(result.item)
    raw.push(...arr(result.events))
    after = optStr(result.nextCursor) ?? null
    if (!after) {
      break
    }
  }
  if (!item) {
    throw new CliError(`orca bot item show ${number} answered no item`, 'bad_output')
  }
  // The item's own bot is always named, even before the board has listed bots.
  const names = new Map(botNames)
  if (item.bot.id && item.bot.name && !names.has(item.bot.id)) {
    names.set(item.bot.id, item.bot.name)
  }
  const events = raw
    .map((event) => normaliseEvent(event, names))
    .filter((event): event is ItemEvent => event !== null)
  return { item, events }
}
