// Requests: the board's left list. Each chat makes one automatically; a group room's member chats
// (one per bot, same title) make one together. The owner's edits (renames, moves, merges) are kept
// as a small JSON value in the plugin's settings and replayed over every read.
import type { BoardItem, BotRef, ChatInfo } from './protocol'

/** The owner's edits, as saved. Ids are request ids (`chat:…`, `group:…`, `bot:…`, `req:…`). */
export type RequestEdits = {
  v: 1
  /** New names, by request id. */
  names: Record<string, string>
  /** Items moved to another request, by item uid. */
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
  /** The owner's name for it, else the chat's. */
  name: string
  /** The name it would have without a rename. */
  autoName: string
  renamed: boolean
  bots: BotRef[]
  /** The newest ask among its chats (`orca bot chats`), when Orca gives one. */
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
}

const GROUP_PREFIX = 'bot-group-member-'

/** The request a chat makes on its own. */
export function autoRequestId(item: Pick<BoardItem, 'chat' | 'bot'>): string {
  const chat = item.chat
  if (!chat || !chat.id) {
    return `bot:${item.bot.id || item.bot.name}`
  }
  // Each bot in a group room has its own member chat; the room's title ties them together.
  if (chat.id.startsWith(GROUP_PREFIX)) {
    return `group:${chat.title || chat.id}`
  }
  return `chat:${chat.id}`
}

function autoName(item: Pick<BoardItem, 'chat' | 'bot'>, homeWord: string): string {
  const chat = item.chat
  if (!chat || !chat.id) {
    return item.bot.name
  }
  if (chat.id.startsWith(GROUP_PREFIX)) {
    return chat.title || item.bot.name
  }
  if (chat.kind === 'home' || chat.title === 'Home') {
    return `${item.bot.name} · ${homeWord}`
  }
  return chat.title || `${item.bot.name} · ${chat.id.slice(0, 8)}`
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

/** The request an item belongs to now. */
export function requestOf(edits: RequestEdits, item: Pick<BoardItem, 'uid' | 'chat' | 'bot'>): string {
  return resolveRequest(edits, edits.moves[item.uid] ?? autoRequestId(item))
}

export function buildRequests(
  items: readonly BoardItem[],
  chats: readonly ChatInfo[],
  edits: RequestEdits,
  words: { home: string; split: (n: number) => string } = { home: 'Home', split: (n) => `Request ${n}` }
): Request[] {
  const byId = new Map<string, Request>()
  const chatOf = new Map(chats.map((chat) => [chat.id, chat]))
  const get = (id: string, name: string): Request => {
    let request = byId.get(id)
    if (!request) {
      request = {
        id,
        name,
        autoName: name,
        renamed: false,
        bots: [],
        lastAsk: null,
        items: [],
        needsYou: 0,
        lastActivityAt: 0,
        custom: id in edits.custom,
        chatIds: []
      }
      byId.set(id, request)
    }
    return request
  }
  const customNumber = (id: string): number =>
    Object.entries(edits.custom)
      .sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))
      .findIndex(([key]) => key === id) + 1
  for (const item of items) {
    const id = requestOf(edits, item)
    const ownId = autoRequestId(item)
    const request = get(id, id in edits.custom ? words.split(customNumber(id)) : autoName(item, words.home))
    // A merged or moved-into request keeps its own chat's name when it has one.
    if (ownId === id && !(id in edits.custom)) {
      request.autoName = autoName(item, words.home)
    }
    request.items.push(item.uid)
    if (item.status === 'needs_you') {
      request.needsYou += 1
    }
    request.lastActivityAt = Math.max(request.lastActivityAt, item.lastActivityAt)
    if (!request.bots.some((bot) => bot.id === item.bot.id && bot.name === item.bot.name)) {
      request.bots.push(item.bot)
    }
    if (item.chat?.id && !request.chatIds.includes(item.chat.id)) {
      request.chatIds.push(item.chat.id)
    }
  }
  for (const request of byId.values()) {
    const named = edits.names[request.id]
    request.name = named ?? request.autoName
    request.renamed = named !== undefined
    const asks = request.chatIds
      .map((id) => chatOf.get(id))
      .filter((chat): chat is ChatInfo => !!chat && !!chat.lastAsked)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    request.lastAsk = asks[0]?.lastAsked ?? null
  }
  return [...byId.values()].sort(
    (a, b) => Number(b.needsYou > 0) - Number(a.needsYou > 0) || b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name)
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
  let id = `req:${now.toString(36)}`
  for (let n = 1; id in edits.custom || id in edits.merges; n++) {
    id = `req:${now.toString(36)}-${n}`
  }
  return id
}

/** Moves one item to another request; `to` may be a new id from `newRequestId`. Moving it back to
 *  where its chat puts it drops the move. */
export function moveItem(edits: RequestEdits, item: Pick<BoardItem, 'uid' | 'chat' | 'bot'>, to: string, now: number): RequestEdits {
  const moves = { ...edits.moves }
  const custom = { ...edits.custom }
  const merges = { ...edits.merges }
  if (to.startsWith('req:') && !(to in custom)) {
    custom[to] = { at: now }
  }
  // Moving into a request that was merged away revives it.
  delete merges[to]
  if (resolveRequest({ ...edits, merges }, autoRequestId(item)) === to) {
    delete moves[item.uid]
  } else {
    moves[item.uid] = to
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

/** Drops edits that no longer name anything the board has, so the saved value stays small. */
export function pruneEdits(edits: RequestEdits, items: readonly BoardItem[]): RequestEdits {
  const uids = new Set(items.map((item) => item.uid))
  const live = new Set(items.map((item) => requestOf(edits, item)))
  const autoIds = new Set(items.map(autoRequestId))
  const moves = Object.fromEntries(Object.entries(edits.moves).filter(([uid]) => uids.has(uid)))
  const custom = Object.fromEntries(Object.entries(edits.custom).filter(([id]) => live.has(id) || Object.values(moves).includes(id)))
  const known = (id: string): boolean => autoIds.has(id) || id in custom
  const merges = Object.fromEntries(Object.entries(edits.merges).filter(([from, to]) => known(from) && known(to)))
  const names = Object.fromEntries(Object.entries(edits.names).filter(([id]) => known(id)))
  return { v: 1, names, moves, merges, custom }
}

/** Reads the saved value; anything unreadable is no edits. */
export function parseEdits(text: unknown): RequestEdits {
  if (typeof text !== 'string' || !text.trim()) {
    return NO_EDITS
  }
  try {
    const value = JSON.parse(text) as Partial<RequestEdits>
    const record = (x: unknown): Record<string, string> =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {}
    const custom =
      value.custom && typeof value.custom === 'object'
        ? Object.fromEntries(
            Object.entries(value.custom as Record<string, unknown>).map(([id, v]) => [
              id,
              { at: typeof (v as { at?: unknown })?.at === 'number' ? (v as { at: number }).at : 0 }
            ])
          )
        : {}
    return { v: 1, names: record(value.names), moves: record(value.moves), merges: record(value.merges), custom }
  } catch {
    return NO_EDITS
  }
}

export function serializeEdits(edits: RequestEdits): string {
  const empty =
    !Object.keys(edits.names).length && !Object.keys(edits.moves).length && !Object.keys(edits.merges).length && !Object.keys(edits.custom).length
  return empty ? '' : JSON.stringify(edits)
}
