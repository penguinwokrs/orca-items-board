// A big made-up board for measuring (search keystrokes): `requests` chats with `perRequest` items
// each, titles drawn from a small word list. No real names. Used by editor/search.bench.test.ts
// and by a demo file holding {"source":"demo","synthetic":[500,10]} to measure inside Orca.
import { ANSWER_UNAVAILABLE } from '../src/board'
import type { BoardItem, BoardSnapshot, ChatInfo, ItemStatus } from '../src/protocol'

const WORDS = [
  'release', 'notes', 'smoke', 'test', 'deploy', 'preview', 'cleanup', 'database', 'password', 'rotate',
  'backup', 'bucket', 'guide', 'screenshots', 'API', 'reference', 'export', 'endpoint', 'checkout', 'flaky',
  'search', 'load', 'onboarding', 'checklist', 'changelog', 'translate', 'links', 'FAQ', 'billing', 'invoice',
  'データ移行', 'ログ', '請求書', '検索', '手順書', 'リリース', '確認', '設定', 'テスト', '画面'
]
const STATUSES: ItemStatus[] = ['planned', 'needs_you', 'in_progress', 'waiting', 'done', 'done', 'done', 'canceled']
const MIN = 60_000

/** A small fixed-seed random generator, so every run measures the same board. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

export function syntheticBoard(requests: number, perRequest: number, now: number = Date.now()): BoardSnapshot {
  const next = random(7)
  const pick = (): string => WORDS[Math.floor(next() * WORDS.length)]!
  const title = (): string => {
    const words = [pick(), pick(), pick(), pick()]
    return words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1) + ' ' + words.slice(1).join(' ')
  }
  const bots = Array.from({ length: 8 }, (_, i) => ({ id: `synthetic-bot-${i}`, name: `bot-${i}` }))
  const chats: ChatInfo[] = []
  const items: BoardItem[] = []
  let number = 1
  for (let r = 0; r < requests; r++) {
    const bot = bots[r % bots.length]!
    const chatId = `synthetic-chat-${r}`
    chats.push({ id: chatId, bot, title: `Chat ${r} ${pick()}`, home: false, lastAsked: `${title()} please`, lastActivityAt: now - r * MIN })
    for (let i = 0; i < perRequest; i++) {
      const status = STATUSES[Math.floor(next() * STATUSES.length)]!
      const at = now - (r * perRequest + i) * MIN
      items.push({
        uid: `synthetic-${number}`,
        number,
        bot,
        title: title(),
        status,
        description: '',
        doneMeans: '',
        madeBy: null,
        links: [],
        wait: null,
        question: null,
        closeNote: null,
        snoozedUntil: null,
        createdAt: at - 30 * MIN,
        updatedAt: at,
        lastActivityAt: at,
        closedAt: status === 'done' || status === 'canceled' ? at : null,
        version: 1,
        lastEventId: `s${number}`,
        othersLastEventId: `s${number}`,
        chat: { id: chatId, kind: 'chat', title: `Chat ${r}` }
      } as BoardItem)
      number++
    }
  }
  const counts = { needs_you: 0, in_progress: 0, waiting: 0, planned: 0, done: 0, canceled: 0 } as Record<ItemStatus, number>
  for (const item of items) {
    counts[item.status] += 1
  }
  return {
    fetchedAt: now,
    bots: bots.map((bot) => ({ ...bot, agent: 'claude', paused: false, specialty: '', itemCount: items.filter((item) => item.bot.id === bot.id).length })),
    items,
    counts,
    chats,
    signature: 'synthetic',
    errors: [],
    answer: { available: false, reason: ANSWER_UNAVAILABLE }
  }
}
