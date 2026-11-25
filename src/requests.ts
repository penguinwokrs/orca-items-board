// Requests: the board's left list. On Orca that records where an item came from (its `origin`,
// stablyai/orca#48086), the items one request led to make one request, across bots, whatever chat
// they sit in. Items without an origin (older items, or Orca without it) fall back to their chat:
// each chat makes one, and a group room's member chats (one per bot, same title) make one together,
// as do the room's items with an origin (Orca keys a room's request per bot, so it can't tie them).
// The owner's edits (renames, moves, merges) are kept as one compact JSON value in the plugin's
// storage (src/edits-store.ts) and replayed over every read: short request ids, items by number,
// moves grouped by where they went.
import type { BoardItem, BotRef, ChatInfo, ItemOrigin } from './protocol'

/** The owner's edits. Ids are request ids: `o:` a request Orca recorded (its origin), `c:` a chat,
 *  `g:` a group room, `b:` a bot's items without a chat, `r:` a request made by a split. */
export type RequestEdits = {
  v: 1
  /** New names, by request id. */
  names: Record<string, string>
  /** Items moved to another request, by item number (a uid from an older save until the next save
   *  rewrites it). */
  moves: Record<string, string>
  /** Requests merged into another, by request id. Followed transitively. */
  merges: Record<string, string>
  /** Requests the owner made by splitting, by id, with their creation time for ordering. */
  custom: Record<string, { at: number }>
}

export const NO_EDITS: RequestEdits = { v: 1, names: {}, moves: {}, merges: {}, custom: {} }
/** The list's first row, which shows every item. */
export const ALL = 'all'

export type Request = {
  id: string
  /** The owner's name for it, else the asker's words (shortened) when Orca recorded them, else
   *  made from its items (the oldest one's title, "+N more"). */
  name: string
  /** The name it would have without a rename. */
  autoName: string
  /** Its newer items' titles (newest first, at most three), besides the one that names it; every
   *  item's title when the asker's words name it. */
  summary: string[]
  /** The asker's words as Orca recorded them (up to 500 characters, ids hidden), when they name
   *  the request; null otherwise. */
  asked: string | null
  /** When it was asked (epoch ms): its earliest item origin's time; null when none has one. */
  askedAt: number | null
  /** The first line of the naming item's description, for a request of one item. */
  detail: string | null
  /** The chats it gathers, by their names (Home, a room's title), for a small note. */
  chatNames: string[]
  renamed: boolean
  bots: BotRef[]
  /** The newest ask among its chats that reads like the owner's words (mail headers, ids and
   *  machine text are left out); null when none does. Only for items without an origin: a chat's
   *  last ask may belong to another request in the same chat. */
  lastAsk: string | null
  /** Uids of its items. */
  items: string[]
  needsYou: number
  /** The newest activity among its items: the list's order. */
  lastActivityAt: number
  /** Made by a split (it can be emptied and disappears). */
  custom: boolean
  /** Chats it gathers (for its last ask). */
  chatIds: string[]
  /** When its last item closed, if every item is closed (Done or Canceled); else null. */
  lastClosedAt: number | null
  /** Every item closed, the last at least `archiveAfterDays` days ago: shown under Archived. Worked
   *  out on every read, never saved, so a new or reopened item brings it back. */
  archived: boolean
}

/** Days after its last item closes that a request moves under Archived; 0 never archives. */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 7
const DAY = 86_400_000

const GROUP_PREFIX = 'bot-group-member-'
/** Where a saved value starts to fail: under the 256 KiB Orca allows for one stored value
 *  (PLUGIN_STORAGE_VALUE_MAX_BYTES). Measured in bytes of the compact JSON. */
export const EDITS_MAX = 250_000
/** Past this the board warns that the saved edits are filling up. */
export const EDITS_WARN = 200_000

/** A UUID shortened to its first 12 hex digits (a collision among one owner's chats is not a
 *  practical worry); anything else as it is. */
function shortId(id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.replace(/-/g, '').slice(0, 12).toLowerCase() : id
}

/** A request id in the current short form; older saves used `chat:`, `group:`, `bot:`, `req:`. */
export function compactId(id: string): string {
  const at = id.indexOf(':')
  const kind = at < 0 ? '' : id.slice(0, at)
  const rest = id.slice(at + 1)
  switch (kind) {
    case 'chat':
      return `c:${shortId(rest)}`
    case 'bot':
      return `b:${shortId(rest)}`
    case 'group':
      return `g:${rest}`
    case 'req':
      return `r:${rest}`
    default:
      return id
  }
}

/**
 * The request id for one of Orca's request keys (`origin.rootKey`): `o:` and 14 base-36 digits,
 * two 32-bit FNV-1a hashes of the key. The key holds a session id, so it is never kept or shown as
 * it is. Saved edits name these ids: this must never change.
 */
export function originRequestId(rootKey: string): string {
  let a = 0x811c9dc5
  let b = 0x050c5d1f
  for (let at = 0; at < rootKey.length; at++) {
    const code = rootKey.charCodeAt(at)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x01000193) >>> 0
  }
  return `o:${a.toString(36).padStart(7, '0')}${b.toString(36).padStart(7, '0')}`
}

type Origin = { origin?: ItemOrigin | null }

/** The request an item's chat makes on its own. */
function chatRequestId(item: Pick<BoardItem, 'chat' | 'bot'>): string {
  const chat = item.chat
  if (!chat || !chat.id) {
    return `b:${shortId(item.bot.id || item.bot.name)}`
  }
  // Each bot in a group room has its own member chat; the room's title ties them together.
  if (chat.id.startsWith(GROUP_PREFIX)) {
    return `g:${chat.title || shortId(chat.id.slice(GROUP_PREFIX.length))}` // the key only; never shown
  }
  return `c:${shortId(chat.id)}`
}

/** The request an item makes on its own: the one Orca recorded it came from (a group room's for
 *  a room's request), else its chat's. */
export function autoRequestId(item: Pick<BoardItem, 'chat' | 'bot'> & Origin): string {
  const origin = item.origin
  if (!origin) {
    return chatRequestId(item)
  }
  if (origin.room) {
    return origin.room
  }
  return origin.kind === 'group' ? chatRequestId(item) : originRequestId(origin.rootKey)
}

/**
 * Ties a group room's requests to the room. Orca keys a request by the session that took it, and
 * each bot in a room has its own member session, so one room message gets a key per bot (and its
 * recorded words are the bot's whole room turn, not the owner's). Items whose request started in a
 * room, directly (`group`) or through a room bot's hand-off (`bot`, same key), get `origin.room`:
 * the room's request id, as its chats make it. Returns new items; the rest are kept as they are.
 */
export function linkRooms(items: readonly BoardItem[], chats: readonly ChatInfo[] = []): BoardItem[] {
  const memberRoom = new Map<string, string>()
  const remember = (chat: { id: string; title: string } | null, bot: BotRef): void => {
    if (chat?.id.startsWith(GROUP_PREFIX) && !memberRoom.has(chat.id)) {
      memberRoom.set(chat.id, chatRequestId({ chat: { id: chat.id, kind: 'chat', title: chat.title }, bot }))
    }
  }
  for (const chat of chats) {
    remember(chat, chat.bot)
  }
  for (const item of items) {
    remember(item.chat, item.bot)
  }
  const keyRoom = new Map<string, string>()
  for (const item of items) {
    if (item.origin?.kind === 'group' && item.chat && memberRoom.has(item.chat.id)) {
      keyRoom.set(item.origin.rootKey, memberRoom.get(item.chat.id)!)
    }
  }
  const roomOf = (rootKey: string): string | undefined => {
    const known = keyRoom.get(rootKey)
    if (known) {
      return known
    }
    // A key starts with the session that took the request: a room's member chat.
    for (const [chatId, room] of memberRoom) {
      if (rootKey.startsWith(`${chatId}:`)) {
        return room
      }
    }
    return undefined
  }
  return items.map((item) => {
    const room = item.origin ? roomOf(item.origin.rootKey) : undefined
    return room && item.origin ? { ...item, origin: { ...item.origin, room } } : item
  })
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Text with ids the owner can't use (UUIDs, `orca_session_id:…`) replaced by "…". Everything the
 *  board shows goes through it. */
export function hideIds(text: string): string {
  return text
    .replace(/orca[_ ]?session[_ ]?id\s*:\s*[0-9a-z_-]+/gi, '…')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
}

/** A chat's name for the small note: its title, never an id. */
function chatName(item: Pick<BoardItem, 'chat'>, homeWord: string): string | null {
  const chat = item.chat
  if (!chat) {
    return null
  }
  if (chat.kind === 'home' || chat.title === 'Home') {
    return homeWord
  }
  const title = chat.title.trim()
  return title && !UUID.test(title) ? title : null
}

/**
 * `orca bot chats`' last ask, when it reads like something the owner wrote. It is the chat's last
 * incoming message, often a mail from Orca or another bot ("──── From: …", "Subject: …") or text
 * with session ids. When in doubt, nothing is shown.
 */
export function ownerAsk(text: string | null | undefined): string | null {
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  if (value.length < 4) {
    return null
  }
  const machine = [
    /^[─━\-=_*#>[(<]{2,}/, // mail and markdown headers, quotes, brackets
    /\b(from|subject|to|reply|re|fwd?)\s*:|件名\s*[:：]|差出人\s*[:：]|宛先\s*[:：]/i,
    /orca[_ -]?session[_ -]?id|session[_ -]?id|ORCA:|orchestration|worker_done|dispatch|ctx_[0-9a-z]+|msg_[0-9a-z]+|task_[0-9a-z]+/i,
    UUID,
    /\b[0-9a-f]{16,}\b/i,
    /^\//, // slash commands
    // Prompts Orca or an agent sends on its own (resuming a session), not the owner's words.
    /^(continue where you left off|continue|resume|please continue)\.?$/i,
    /<[a-z][^>]*>/i // markup
  ]
  return machine.some((pattern) => pattern.test(value)) ? null : value
}

/** At most `max` characters (whole graphemes where the runtime can tell), with "…" when cut. */
function shorten(text: string, max: number): string {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  const parts =
    typeof Segmenter === 'function'
      ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment)
      : Array.from(text)
  return parts.length > max ? `${parts.slice(0, max - 1).join('').trimEnd()}…` : text
}

/** How long a request's name drawn from the asker's words may be. */
export const ASKED_NAME_MAX = 80

/** The asker's words as a request shows them: on one line, ids hidden. */
function askedText(origin: ItemOrigin): string | null {
  const text = hideIds(origin.request ?? '').replace(/\s+/g, ' ').trim()
  return text && text !== '…' ? text : null
}

/** The first non-empty line of a description, plain. */
function firstLine(text: string): string | null {
  const line = text
    .split('\n')
    .map((part) => part.replace(/^[#>*\-\s]+/, '').trim())
    .find((part) => part !== '')
  return line ? line.slice(0, 160) : null
}

/** Follows merges to the request that now holds an id (a cycle stops where it started). */
export function resolveRequest(edits: RequestEdits, id: string): string {
  const seen = new Set<string>()
  let at = id
  while (edits.merges[at] && !seen.has(at)) {
    seen.add(at)
    at = edits.merges[at]!
  }
  return at
}

type ItemRef = Pick<BoardItem, 'uid' | 'number' | 'chat' | 'bot'> & Origin

/** The request an item belongs to now. */
export function requestOf(edits: RequestEdits, item: ItemRef): string {
  return resolveRequest(edits, edits.moves[String(item.number)] ?? edits.moves[item.uid] ?? autoRequestId(item))
}

export function buildRequests(
  items: readonly BoardItem[],
  chats: readonly ChatInfo[],
  edits: RequestEdits,
  words: { home: string; more: (n: number) => string } = { home: 'Home', more: (n) => ` +${n} more` },
  archive: { now?: number; afterDays?: number } = {}
): Request[] {
  const now = archive.now ?? Date.now()
  const afterDays = archive.afterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS
  const byId = new Map<string, { request: Request; members: BoardItem[] }>()
  const chatOf = new Map(chats.map((chat) => [chat.id, chat]))
  for (const item of items) {
    const id = requestOf(edits, item)
    let entry = byId.get(id)
    if (!entry) {
      entry = {
        request: {
          id,
          name: '',
          autoName: '',
          summary: [],
          asked: null,
          askedAt: null,
          detail: null,
          chatNames: [],
          renamed: false,
          bots: [],
          lastAsk: null,
          items: [],
          needsYou: 0,
          lastActivityAt: 0,
          custom: id in edits.custom,
          chatIds: [],
          lastClosedAt: null,
          archived: false
        },
        members: []
      }
      byId.set(id, entry)
    }
    const { request } = entry
    entry.members.push(item)
    request.items.push(item.uid)
    if (item.status === 'needs_you') {
      request.needsYou += 1
    }
    request.lastActivityAt = Math.max(request.lastActivityAt, item.lastActivityAt)
    if (!request.bots.some((bot) => bot.id === item.bot.id && bot.name === item.bot.name)) {
      request.bots.push(item.bot)
    }
    // A chat's last ask speaks for its items only when they have no origin of their own (a room's
    // do, but their recorded words are a bot's turn, so the room's last ask still says it best).
    if (item.chat?.id && (!item.origin || item.origin.room) && !request.chatIds.includes(item.chat.id)) {
      request.chatIds.push(item.chat.id)
    }
    const askedAt = item.origin?.at ?? null
    if (askedAt !== null) {
      request.askedAt = request.askedAt === null ? askedAt : Math.min(request.askedAt, askedAt)
    }
    const name = chatName(item, words.home)
    if (name && !request.chatNames.includes(name)) {
      request.chatNames.push(name)
    }
  }
  const started = (item: BoardItem): number => item.createdAt ?? item.origin?.at ?? item.lastActivityAt
  for (const { request, members } of byId.values()) {
    // Named after the asker's words when Orca recorded them: from a person (the owner, a teammate)
    // or an automation before a bot's hand-off, the earliest asked first. A room's are a bot's turn.
    const asked = members
      .filter((item) => item.origin && !item.origin.room && item.origin.kind !== 'group' && askedText(item.origin))
      .sort(
        (a, b) =>
          Number(a.origin!.kind === 'bot') - Number(b.origin!.kind === 'bot') ||
          (a.origin!.at ?? Infinity) - (b.origin!.at ?? Infinity) ||
          started(a) - started(b) ||
          a.number - b.number
      )[0]
    const askedWords = asked ? askedText(asked.origin!) : null
    // Else named after where it started: the oldest item; the rest follow from it.
    const byAge = [...members].sort((a, b) => started(a) - started(b) || a.number - b.number)
    const oldest = byAge[0]!
    const newestFirst = (list: BoardItem[]): string[] =>
      [...list]
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.number - a.number)
        .slice(0, 3)
        .map((item) => item.title)
    if (askedWords) {
      request.asked = askedWords
      request.autoName = shorten(askedWords, ASKED_NAME_MAX)
      request.summary = newestFirst(members)
      request.detail = null
    } else {
      request.autoName = `${oldest.title}${members.length > 1 ? words.more(members.length - 1) : ''}`
      request.summary = newestFirst(byAge.slice(1))
      request.detail = members.length === 1 ? firstLine(oldest.description) : null
    }
    const named = edits.names[request.id]
    request.name = named ?? request.autoName
    request.renamed = named !== undefined
    const asks = request.chatIds
      .map((id) => chatOf.get(id))
      .filter((chat): chat is ChatInfo => !!chat)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map((chat) => ownerAsk(chat.lastAsked))
      .filter((ask): ask is string => ask !== null)
    request.lastAsk = asks[0] ?? null
    const closed = members.every((item) => item.status === 'done' || item.status === 'canceled')
    request.lastClosedAt = closed ? Math.max(...members.map((item) => item.closedAt ?? item.lastActivityAt)) : null
    request.archived = afterDays > 0 && request.lastClosedAt !== null && now - request.lastClosedAt >= afterDays * DAY
  }
  return [...byId.values()]
    .map(({ request }) => request)
    .sort(
      (a, b) =>
        Number(b.needsYou > 0) - Number(a.needsYou > 0) ||
        b.lastActivityAt - a.lastActivityAt ||
        (b.askedAt ?? 0) - (a.askedAt ?? 0) ||
        a.name.localeCompare(b.name)
    )
}

// Edits. Each returns a new value; nothing is changed in place.

export function renameRequest(edits: RequestEdits, id: string, name: string): RequestEdits {
  const names = { ...edits.names }
  const trimmed = name.trim()
  if (trimmed) {
    names[id] = trimmed.slice(0, 120)
  } else {
    delete names[id]
  }
  return { ...edits, names }
}

/** A new request id for a split, unique among the saved ones. */
export function newRequestId(edits: RequestEdits, now: number): string {
  const base = `r:${Math.floor(now / 1000).toString(36)}`
  let id = base
  for (let n = 1; id in edits.custom || id in edits.merges; n++) {
    id = `${base}${n.toString(36)}`
  }
  return id
}

/** Moves one item to another request; `to` may be a new id from `newRequestId`. Moving it back to
 *  where its chat puts it drops the move. */
export function moveItem(edits: RequestEdits, item: ItemRef, to: string, now: number): RequestEdits {
  const moves = { ...edits.moves }
  const custom = { ...edits.custom }
  const merges = { ...edits.merges }
  if (to.startsWith('r:') && !(to in custom)) {
    custom[to] = { at: now }
  }
  // Moving into a request that was merged away revives it.
  delete merges[to]
  delete moves[item.uid]
  if (resolveRequest({ ...edits, merges }, autoRequestId(item)) === to) {
    delete moves[String(item.number)]
  } else {
    moves[String(item.number)] = to
  }
  return { ...edits, moves, custom, merges }
}

/** Merges `from` into `into`: its items show under `into` from now on. */
export function mergeRequests(edits: RequestEdits, from: string, into: string): RequestEdits {
  const target = resolveRequest(edits, into)
  if (from === target || resolveRequest(edits, from) === target) {
    return edits
  }
  const merges = { ...edits.merges, [from]: target }
  // Items moved straight to `from` follow it.
  const moves = Object.fromEntries(Object.entries(edits.moves).map(([uid, id]) => [uid, id === from ? target : id]))
  return { ...edits, merges, moves }
}

/** Undoes a request's rename, its merges into others and the merges of others into it. */
export function resetRequest(edits: RequestEdits, id: string): RequestEdits {
  const names = { ...edits.names }
  delete names[id]
  const merges = Object.fromEntries(Object.entries(edits.merges).filter(([from, to]) => from !== id && to !== id))
  const moves = Object.fromEntries(Object.entries(edits.moves).filter(([, to]) => to !== id))
  const custom = { ...edits.custom }
  delete custom[id]
  return { v: 1, names, merges, moves, custom }
}

/**
 * Drops edits that no longer do anything, so the saved value stays small: moves of items the board
 * doesn't have, moves keyed by an older save's uid (rewritten by number), names and merges of
 * requests that hold no items, and split requests left empty.
 */
export function pruneEdits(edits: RequestEdits, items: readonly BoardItem[]): RequestEdits {
  const numberOfUid = new Map(items.map((item) => [item.uid, String(item.number)]))
  const numbers = new Set(items.map((item) => String(item.number)))
  const moves: Record<string, string> = {}
  for (const [key, to] of Object.entries(edits.moves)) {
    const number = numbers.has(key) ? key : numberOfUid.get(key)
    if (number !== undefined && !(number in moves && key !== number)) {
      moves[number] = to
    }
  }
  // A move that only repeats where the item's chat and the merges put it does nothing.
  for (const item of items) {
    const key = String(item.number)
    const to = moves[key]
    if (to !== undefined) {
      const without = { ...moves }
      delete without[key]
      if (requestOf({ ...edits, moves: without }, item) === resolveRequest(edits, to)) {
        delete moves[key]
      }
    }
  }
  const autoIds = new Set(items.map(autoRequestId))
  const moveTargets = new Set(Object.values(moves))
  const custom = Object.fromEntries(Object.entries(edits.custom).filter(([id]) => moveTargets.has(id) || Object.values(edits.merges).includes(id)))
  const known = (id: string): boolean => autoIds.has(id) || id in custom || moveTargets.has(id)
  const merges = Object.fromEntries(Object.entries(edits.merges).filter(([from, to]) => known(from) && known(to)))
  const live = new Set(items.map((item) => requestOf({ v: 1, names: {}, moves, merges, custom }, item)))
  const names = Object.fromEntries(Object.entries(edits.names).filter(([id]) => live.has(id)))
  return { v: 1, names, moves, merges, custom }
}

/** Reads the saved value, in the current form (`v: 2`) or an older one (`v: 1`); anything
 *  unreadable is no edits. Older ids are rewritten to the short form. */
export function parseEdits(text: unknown): RequestEdits {
  if (typeof text !== 'string' || !text.trim()) {
    return NO_EDITS
  }
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const record = (x: unknown): Record<string, string> =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? (Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>)
        : {}
    const ids = (x: Record<string, string>, keys: boolean, values: boolean): Record<string, string> =>
      Object.fromEntries(Object.entries(x).map(([k, v]) => [keys ? compactId(k) : k, values ? compactId(v) : v]))
    let names: Record<string, string>
    let moves: Record<string, string>
    let merges: Record<string, string>
    if (value.v === 2) {
      names = ids(record(value.n), true, false)
      merges = ids(record(value.g), true, true)
      moves = {}
      const grouped = value.m && typeof value.m === 'object' && !Array.isArray(value.m) ? (value.m as Record<string, unknown>) : {}
      for (const [to, list] of Object.entries(grouped)) {
        for (const number of Array.isArray(list) ? list : []) {
          if (typeof number === 'number' || typeof number === 'string') {
            moves[String(number)] = compactId(to)
          }
        }
      }
    } else {
      names = ids(record(value.names), true, false)
      moves = ids(record(value.moves), false, true)
      merges = ids(record(value.merges), true, true)
    }
    // Split requests are the `r:` ids the edits mention.
    const custom: Record<string, { at: number }> = {}
    for (const id of [...Object.keys(names), ...Object.values(moves), ...Object.keys(merges), ...Object.values(merges)]) {
      if (id.startsWith('r:')) {
        custom[id] = { at: 0 }
      }
    }
    return { v: 1, names, moves, merges, custom }
  } catch {
    return NO_EDITS
  }
}

/** The saved form: `{"v":2,"n":{id:name},"m":{to:[numbers…]},"g":{from:into}}`, empty parts left
 *  out; no edits at all saves as an empty string. */
export function serializeEdits(edits: RequestEdits): string {
  const grouped: Record<string, (number | string)[]> = {}
  for (const [key, to] of Object.entries(edits.moves)) {
    ;(grouped[to] ??= []).push(/^\d+$/.test(key) ? Number(key) : key)
  }
  const value: Record<string, unknown> = { v: 2 }
  if (Object.keys(edits.names).length) value.n = edits.names
  if (Object.keys(grouped).length) value.m = grouped
  if (Object.keys(edits.merges).length) value.g = edits.merges
  return Object.keys(value).length === 1 ? '' : JSON.stringify(value)
}

/** How many characters the edits take when saved. */
export function editsSize(edits: RequestEdits): number {
  // Bytes, as Orca measures a stored value (names can be Japanese).
  return new TextEncoder().encode(serializeEdits(edits)).length
}
