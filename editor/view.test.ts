// The wide board and its floating box in a real DOM (happy-dom): open, close, focus, keys.
import { Window } from 'happy-dom'
import { afterEach, assert, test } from 'orca/testing'
import { loadBoard, loadItemDetail } from '../src/board'
import { fixtureRunner } from '../src/fixtures/cli'
import type { BoardSnapshot } from '../src/protocol'
import { mountBoardView, type BoardView } from './view'
import { EDITS_MAX, EDITS_WARN, editsSize, parseEdits, serializeEdits, type RequestEdits } from '../src/requests'

let window: Window | undefined
let view: BoardView | undefined
const opened: string[] = []
const botsOpened: number[] = []

afterEach(async () => {
  view?.dispose()
  view = undefined
  await window?.happyDOM.close()
  window = undefined
})

async function setup(): Promise<{ doc: Document; board: BoardSnapshot; details: number[] }> {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const details: number[] = []
  view = mountBoardView(doc, {
    now: () => 10_000,
    openExternal: (url) => opened.push(url),
    openBot: async (item) => {
      botsOpened.push(item.number)
      return { via: 'workspace' as const }
    },
    detail: async (number) => {
      details.push(number)
      return loadItemDetail(fixtureRunner(), number)
    }
  })
  view.update(board)
  return { doc, board, details }
}

function key(doc: Document, name: string, options: { shiftKey?: boolean; target?: Element } = {}): void {
  const event = new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', {
    key: name,
    shiftKey: options.shiftKey ?? false,
    bubbles: true,
    cancelable: true
  })
  ;(options.target ?? doc.activeElement ?? doc.body).dispatchEvent(event)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const card = (doc: Document, n: number) => doc.querySelector<HTMLElement>(`.card[data-n="${n}"]`)!
const scrim = (doc: Document) => doc.querySelector<HTMLElement>('.scrim')!

test('draws a column per status with counts, waits and question hints', async () => {
  const { doc } = await setup()
  const headings = Array.from(doc.querySelectorAll('.col-h')).map((h) => h.textContent)
  // Planned is left out while it has no items.
  assert.deepEqual(headings, ['Needs you1', 'In progress1', 'Waiting1', 'Done1', 'Canceled1'])
  assert.match(card(doc, 7).textContent ?? '', /2 questions · replies/)
  assert.match(card(doc, 5).querySelector('.w')?.textContent ?? '', /CI on #12/)
  assert.match(doc.querySelector('.toolbar')?.textContent ?? '', /Needs you 1/)
})

test('a card opens the box; Esc closes it and focus returns to the card', async () => {
  const { doc, details } = await setup()
  card(doc, 7).focus()
  card(doc, 7).click()
  await settle()
  assert.equal(scrim(doc).hidden, false)
  assert.equal(view!.openNumber, 7)
  assert.equal(doc.querySelector('#f-title')?.textContent, 'Merge without the review?')
  // Focus moved into the box (its close button).
  assert.ok(doc.querySelector('.float')!.contains(doc.activeElement))
  assert.equal(doc.activeElement?.getAttribute('aria-label'), 'Close')
  // Needs you: the summary first, then the history once loaded.
  assert.equal(doc.querySelector('.f-main .blk-h')?.textContent, 'Question summary')
  assert.deepEqual(details, [7])
  assert.equal(doc.querySelectorAll('.ev').length, 5)
  key(doc, 'Escape')
  assert.equal(scrim(doc).hidden, true)
  assert.equal(doc.activeElement, card(doc, 7))
})

test('the close button and a press outside the box close it', async () => {
  const { doc } = await setup()
  card(doc, 7).click()
  doc.querySelector<HTMLElement>('[aria-label="Close"]')!.click()
  assert.equal(scrim(doc).hidden, true)
  card(doc, 5).click()
  assert.equal(view!.openNumber, 5)
  const outside = new (doc.defaultView as unknown as typeof globalThis).MouseEvent('mousedown', { bubbles: true })
  scrim(doc).dispatchEvent(outside)
  assert.equal(scrim(doc).hidden, true)
  assert.equal(doc.activeElement, card(doc, 5))
  // A press inside the box keeps it open.
  card(doc, 5).click()
  doc.querySelector('.float')!.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).MouseEvent('mousedown', { bubbles: true }))
  assert.equal(scrim(doc).hidden, false)
})

test('until Orca allows answers: replies to read, one "Answer in Orca ↗" button', async () => {
  const { doc } = await setup()
  card(doc, 7).click()
  const foot = doc.querySelector<HTMLElement>('.f-foot')!
  assert.equal(foot.hidden, false)
  assert.deepEqual(
    Array.from(foot.querySelectorAll('.q')).map((q) => q.textContent),
    ['Merge now?', 'Which labels?']
  )
  // Replies are a list, not buttons; the recommended one carries a badge.
  assert.deepEqual(
    Array.from(foot.querySelectorAll('.choices li')).map((li) => li.textContent),
    ['Merge now', 'Wait for MondayTwo daysRecommended', 'bug', 'ui']
  )
  assert.equal(foot.querySelectorAll('.opt').length, 0)
  assert.equal(foot.querySelector('.free'), null)
  // The only button in the answer area.
  const buttons = Array.from(foot.querySelectorAll<HTMLButtonElement>('button'))
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ['Answer in Orca ↗']
  )
  assert.match(foot.textContent ?? '', /Orca does not let plugins send answers yet, so you answer on the bot’s screen\./)
  // Digits do nothing here.
  key(doc, '1')
  assert.equal(foot.querySelector('[aria-pressed="true"]'), null)
  buttons[0]!.click()
  await settle()
  assert.deepEqual(botsOpened.splice(0), [7])
  // The box closes and the board says what to do on the bot's screen.
  assert.equal(scrim(doc).hidden, true)
  const notice = doc.querySelector<HTMLElement>('.notice.guide')!
  assert.equal(notice.hidden, false)
  assert.match(notice.textContent ?? '', /Opened alpha in Orca\. In the panel on the right, under Needs you, open #7 and answer there\./)
  notice.querySelector<HTMLButtonElement>('button')!.click()
  assert.equal(notice.hidden, true)
  // Other statuses have no answer area.
  card(doc, 5).click()
  assert.equal(foot.hidden, true)
  assert.equal(doc.querySelector('.waitbox')?.textContent, 'CI on #12; a wait wakes me')
})

test('the deep-link fallback says how to get there by hand', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  view = mountBoardView(doc, { now: () => 10_000, detail: () => new Promise(() => undefined), openBot: async () => ({ via: 'link' as const }) })
  view.update(board)
  card(doc, 7).click()
  doc.querySelector<HTMLButtonElement>('.f-foot .send')!.click()
  await settle()
  assert.match(doc.querySelector('.notice.guide')?.textContent ?? '', /If nothing changed, choose alpha under Bots on the left, then open #7/)
})

test('the answer-in-place UI behind its flag: reply buttons, digits, free text, ⌘Enter', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const sent: unknown[] = []
  view = mountBoardView(doc, {
    now: () => 10_000,
    detail: () => new Promise(() => undefined),
    answerPreview: true,
    answer: async (_item, input) => {
      sent.push(input)
    }
  })
  view.update(board)
  card(doc, 7).click()
  const foot = doc.querySelector<HTMLElement>('.f-foot')!
  const options = () => Array.from(foot.querySelectorAll<HTMLButtonElement>('.opt'))
  assert.equal(options().length, 4)
  const send = () => foot.querySelector<HTMLButtonElement>('.send')!
  assert.equal(send().textContent, 'Send')
  assert.equal(send().disabled, true)
  // 2 picks "Wait for Monday"; 1 then replaces it (one reply per decision).
  key(doc, '2')
  assert.deepEqual(options().map((o) => o.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false'])
  key(doc, '1')
  assert.deepEqual(options().map((o) => o.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false'])
  // A multi decision keeps several.
  options()[2]!.click()
  options()[3]!.click()
  assert.deepEqual(options().map((o) => o.getAttribute('aria-pressed')), ['true', 'false', 'true', 'true'])
  const free = foot.querySelector<HTMLInputElement>('.free')!
  free.value = 'and tag it'
  free.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event('input', { bubbles: true }))
  assert.equal(send().disabled, false)
  const enter = new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
  free.dispatchEvent(enter)
  await settle()
  assert.deepEqual(sent, [
    {
      number: 7,
      questionId: 'e72',
      picks: [
        { decision: 0, replies: [0] },
        { decision: 1, replies: [0, 1] }
      ],
      text: 'and tag it'
    }
  ])
  assert.match(foot.textContent ?? '', /Sent\. alpha picks it up/)
})

test('arrows move within the column, and stop at its ends', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  // Three Needs you items, newest first.
  const items = [
    { ...board.items[0]!, number: 31, uid: 'a', title: 'A', lastActivityAt: 9_900 },
    { ...board.items[0]!, number: 32, uid: 'b', title: 'B', lastActivityAt: 9_800 },
    { ...board.items[0]!, number: 33, uid: 'c', title: 'C', lastActivityAt: 9_700 }
  ]
  view = mountBoardView(doc, {
    now: () => 10_000,
    detail: () => new Promise(() => undefined),
    // The answer-in-place UI has the free-text box this test types in.
    answerPreview: true,
    answer: async () => undefined
  })
  view.update({ ...board, items: [...items, ...board.items.slice(1)], counts: { ...board.counts, needs_you: 3 } })
  card(doc, 31).click()
  const prev = doc.querySelector<HTMLButtonElement>('[aria-label="Previous item"]')!
  const next = doc.querySelector<HTMLButtonElement>('[aria-label="Next item"]')!
  assert.equal(prev.disabled, true)
  key(doc, 'ArrowRight')
  assert.equal(view.openNumber, 32)
  next.click()
  assert.equal(view.openNumber, 33)
  assert.equal(next.disabled, true)
  key(doc, 'ArrowRight')
  assert.equal(view.openNumber, 33)
  key(doc, 'ArrowLeft')
  assert.equal(view.openNumber, 32)
  // Typing in the free-text box keeps arrows for the caret.
  const free = doc.querySelector<HTMLInputElement>('.free')!
  free.focus()
  key(doc, 'ArrowLeft', { target: free })
  assert.equal(view.openNumber, 32)
  // Closing returns focus to the card of the item now shown.
  key(doc, 'Escape')
  assert.equal(doc.activeElement, card(doc, 32))
})

test('Tab cycles inside the box', async () => {
  const { doc } = await setup()
  card(doc, 5).click()
  await settle()
  const float = doc.querySelector('.float')!
  const nodes = Array.from(float.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.disabled && !b.closest('[hidden]'))
  // Close and the PR link (prev/next are disabled: Waiting has one item).
  assert.equal(nodes.length, 2)
  nodes[1]!.click()
  assert.deepEqual(opened.splice(0), ['https://github.com/acme/app/pull/12'])
  nodes.at(-1)!.focus()
  key(doc, 'Tab')
  assert.equal(doc.activeElement, nodes[0])
  key(doc, 'Tab', { shiftKey: true })
  assert.equal(doc.activeElement, nodes.at(-1))
})

test('older history waits behind "Show N older events"', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const detail = await loadItemDetail(fixtureRunner(), 7)
  const many = Array.from({ length: 14 }, (_, i) => ({ ...detail.events[3]!, id: `e${100 + i}`, at: 1_000 + i }))
  view = mountBoardView(doc, { now: () => 10_000, detail: async () => ({ ...detail, events: many }) })
  view.update(board)
  card(doc, 7).click()
  await settle()
  assert.equal(doc.querySelectorAll('.ev').length, 10)
  const older = doc.querySelector<HTMLButtonElement>('.older')!
  assert.equal(older.textContent, 'Show 4 older events')
  older.click()
  assert.equal(doc.querySelectorAll('.ev').length, 14)
})

test('a new board keeps the box on its item and reloads a changed history', async () => {
  const { doc, board, details } = await setup()
  card(doc, 7).click()
  await settle()
  view!.update(board)
  await settle()
  assert.deepEqual(details, [7])
  const changed = board.items.map((item) => (item.number === 7 ? { ...item, lastEventId: 'e99', title: 'Renamed' } : item))
  view!.update({ ...board, items: changed, signature: 'x' })
  await settle()
  assert.equal(view!.openNumber, 7)
  assert.equal(doc.querySelector('#f-title')?.textContent, 'Renamed')
  assert.deepEqual(details, [7, 7])
})

test('Done and Canceled show their newest 20, the rest behind +N', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const done = Array.from({ length: 25 }, (_, i) => ({ ...board.items[3]!, number: 100 + i, uid: `d${i}`, lastActivityAt: 5_000 - i }))
  view = mountBoardView(doc, { now: () => 10_000, detail: () => new Promise(() => undefined) })
  view.update({ ...board, items: [...board.items, ...done] })
  const col = doc.querySelector('.col[data-status="done"]')!
  assert.equal(col.querySelectorAll('.card').length, 20)
  const more = col.querySelector<HTMLButtonElement>('.more')!
  assert.equal(more.textContent, '+6 more')
  more.click()
  assert.equal(doc.querySelector('.col[data-status="done"]')!.querySelectorAll('.card').length, 26)
})

test('Japanese when Orca shows Japanese', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  view = mountBoardView(doc, {
    locale: 'ja-JP',
    now: () => 10_000,
    detail: () => new Promise(() => undefined),
    openBot: async () => ({ via: 'workspace' as const })
  })
  view.update(board)
  assert.equal(doc.documentElement.lang, 'ja')
  assert.match(card(doc, 7).textContent ?? '', /質問 2 件 · 選択肢あり/)
  card(doc, 7).click()
  assert.equal(doc.activeElement?.getAttribute('aria-label'), '閉じる')
  assert.equal(doc.querySelector('.f-main .blk-h')?.textContent, '質問の要約')
  assert.equal(doc.querySelector('.f-foot .send')?.textContent, 'Orca で回答する ↗')
  assert.match(doc.querySelector('.f-foot')?.textContent ?? '', /いまの Orca ではプラグインから回答を送れないため、bot の画面で答えます。/)
  // Status names read as Orca shows them, in both languages.
  assert.equal(doc.querySelector('.st')?.textContent, 'Needs you')
})

test('a poll with nothing new keeps focus in the box', async () => {
  const { doc, board } = await setup()
  card(doc, 7).click()
  await settle()
  const go = doc.querySelector<HTMLButtonElement>('.f-foot .send')!
  go.focus()
  view!.update({ ...board, fetchedAt: 20_000 })
  assert.equal(doc.activeElement, go)
  // A changed item redraws the box.
  const changed = board.items.map((item) => (item.number === 7 ? { ...item, title: 'Renamed', lastEventId: 'e80' } : item))
  view!.update({ ...board, items: changed, signature: 'y' })
  assert.equal(doc.querySelector('#f-title')?.textContent, 'Renamed')
})

// The request list on the left.

async function withRequests(
  options: {
    edits?: RequestEdits
    selected?: string
    savedText?: string
    save?: (edits: RequestEdits) => Promise<unknown>
    snapshot?: BoardSnapshot
  } = {}
) {
  window = new Window()
  const doc = window.document as unknown as Document
  const snapshot = options.snapshot ?? (await loadBoard(fixtureRunner(), () => 10_000))
  const saved: { edits: RequestEdits[]; selected: string[] } = { edits: [], selected: [] }
  view = mountBoardView(doc, {
    now: () => 10_000,
    detail: () => new Promise(() => undefined),
    ...(options.edits ? { edits: options.edits } : {}),
    ...(options.selected ? { selectedRequest: options.selected } : {}),
    ...(options.savedText !== undefined ? { savedText: options.savedText } : {}),
    onEditsChange: (edits) => {
      saved.edits.push(edits)
      return options.save?.(edits)
    },
    onSelectRequest: (id) => {
      saved.selected.push(id)
    }
  })
  view.update(snapshot)
  return { doc, snapshot, saved }
}

const rows = (doc: Document) =>
  Array.from(doc.querySelectorAll<HTMLElement>('.req')).map((row) => ({
    id: row.dataset.req,
    name: row.querySelector('.nm')?.textContent,
    on: row.classList.contains('on'),
    needs: row.classList.contains('needs')
  }))
const rowOf = (doc: Document, id: string) => doc.querySelector<HTMLElement>(`.req[data-req="${id}"]`)!
const cardNumbers = (doc: Document) => Array.from(doc.querySelectorAll<HTMLElement>('.card')).map((c) => Number(c.dataset.n)).sort((a, b) => a - b)
const change = (doc: Document, select: HTMLSelectElement, value: string) => {
  select.value = value
  select.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).Event('change', { bubbles: true }))
}

test('All first, then one row per chat; a group room’s chats share one; Needs you stands out', async () => {
  const { doc } = await withRequests()
  assert.deepEqual(rows(doc), [
    { id: 'all', name: 'All', on: true, needs: true },
    { id: 'c:chat-home', name: 'Dropped idea +2 more', on: false, needs: true },
    { id: 'g:Launch', name: 'Ship the fix +1 more', on: false, needs: false }
  ])
  const launch = rowOf(doc, 'g:Launch')
  // The room's name and its bots are a small note; the newer items are the summary.
  assert.equal(launch.querySelector('.req-note')?.textContent, 'Launch · beta · alpha')
  assert.deepEqual(
    Array.from(launch.querySelectorAll('.req-sum li')).map((li) => li.textContent),
    ['Run QA']
  )
  assert.equal(launch.querySelector('.req-ask')?.textContent, 'Last askRun QA on the fix.')
  assert.equal(launch.querySelector('.req-count')?.textContent, '2 items')
  assert.equal(rowOf(doc, 'c:chat-home').querySelector('.req-count')?.textContent, '3 items · Needs you 1')
})

test('choosing a request narrows the board, and the choice is saved and restored', async () => {
  const { doc, saved } = await withRequests()
  assert.deepEqual(cardNumbers(doc), [1, 3, 5, 6, 7])
  rowOf(doc, 'g:Launch').querySelector<HTMLButtonElement>('.req-pick')!.click()
  assert.deepEqual(cardNumbers(doc), [5, 6])
  assert.deepEqual(saved.selected, ['g:Launch'])
  assert.equal(rows(doc).find((row) => row.on)?.id, 'g:Launch')
  view?.dispose()
  const again = await withRequests({ selected: 'g:Launch' })
  assert.deepEqual(cardNumbers(again.doc), [5, 6])
})

test('rename: Enter saves, Escape cancels', async () => {
  const { doc, saved } = await withRequests({ selected: 'g:Launch' })
  rowOf(doc, 'g:Launch').querySelector<HTMLButtonElement>('.req-tools .tbtn')!.click()
  let input = rowOf(doc, 'g:Launch').querySelector<HTMLInputElement>('input')!
  input.value = 'Launch week'
  input.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'Launch week')
  assert.deepEqual(saved.edits.at(-1)?.names, { 'g:Launch': 'Launch week' })
  rowOf(doc, 'g:Launch').querySelector<HTMLButtonElement>('.req-tools .tbtn')!.click()
  input = rowOf(doc, 'g:Launch').querySelector<HTMLInputElement>('input')!
  input.value = 'Nope'
  input.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'Launch week')
  // "Undo edits" brings the chat's name back.
  const undo = Array.from(rowOf(doc, 'g:Launch').querySelectorAll<HTMLButtonElement>('.tbtn')).find((b) => b.textContent === 'Undo edits')!
  undo.click()
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'Ship the fix +1 more')
})

test('merge: the selected request joins another, which stays selected', async () => {
  const { doc, saved } = await withRequests({ selected: 'g:Launch' })
  const merge = rowOf(doc, 'g:Launch').querySelector<HTMLSelectElement>('.req-tools select')!
  change(doc, merge, 'c:chat-home')
  assert.deepEqual(
    rows(doc).map((row) => row.id),
    ['all', 'c:chat-home']
  )
  assert.equal(rows(doc).find((row) => row.on)?.id, 'c:chat-home')
  assert.deepEqual(cardNumbers(doc), [1, 3, 5, 6, 7])
  assert.deepEqual(saved.edits.at(-1)?.merges, { 'g:Launch': 'c:chat-home' })
  assert.equal(saved.selected.at(-1), 'c:chat-home')
})

test('split: an item moves to a new request from its box, and back again', async () => {
  const { doc, saved } = await withRequests({ selected: 'c:chat-home' })
  card(doc, 7).click()
  const move = () => doc.querySelector<HTMLSelectElement>('.f-side select')!
  assert.equal(move().value, 'c:chat-home')
  change(doc, move(), '__new__')
  const id = Object.keys(saved.edits.at(-1)!.custom)[0]!
  assert.ok(id.startsWith('r:'))
  assert.equal(rowOf(doc, id).querySelector('.nm')?.textContent, 'Merge without the review?')
  // #7 left the selected request's board; its box stays open on it.
  assert.deepEqual(cardNumbers(doc), [1, 3])
  assert.equal(view!.openNumber, 7)
  assert.equal(move().value, id)
  change(doc, move(), 'c:chat-home')
  assert.deepEqual(saved.edits.at(-1)?.moves, {})
  assert.deepEqual(cardNumbers(doc), [1, 3, 7])
})

test('saved edits are replayed on the next load', async () => {
  const edits: RequestEdits = { v: 1, names: { 'c:chat-home': 'Merge plans' }, moves: {}, merges: { 'g:Launch': 'c:chat-home' }, custom: {} }
  const { doc } = await withRequests({ edits })
  assert.deepEqual(rows(doc).map((row) => row.name), ['All', 'Merge plans'])
})

test('the request list in Japanese', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  view = mountBoardView(doc, { locale: 'ja', now: () => 10_000, detail: () => new Promise(() => undefined), selectedRequest: 'g:Launch' })
  view.update(await loadBoard(fixtureRunner(), () => 10_000))
  assert.equal(doc.querySelector('.req-h')?.textContent, '依頼')
  assert.equal(rows(doc)[0]!.name, 'すべて')
  assert.equal(rows(doc)[1]!.name, 'Dropped idea ＋2 件')
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.req-ask .lbl')?.textContent, '最後の依頼')
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.req-count')?.textContent, 'Item 2 件')
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.req-tools .tbtn')?.textContent, '名前を変える')
})

test('a refresh keeps a rename in progress and an open merge menu', async () => {
  const { doc, snapshot } = await withRequests({ selected: 'g:Launch' })
  rowOf(doc, 'g:Launch').querySelector<HTMLButtonElement>('.req-tools .tbtn')!.click()
  const input = rowOf(doc, 'g:Launch').querySelector<HTMLInputElement>('input')!
  input.focus()
  input.value = 'Launch we'
  view!.update({ ...snapshot, fetchedAt: 20_000 })
  assert.equal(rowOf(doc, 'g:Launch').querySelector('input'), input)
  assert.equal(input.value, 'Launch we')
  input.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const merge = rowOf(doc, 'g:Launch').querySelector<HTMLSelectElement>('.req-tools select')!
  merge.focus()
  view!.update({ ...snapshot, fetchedAt: 30_000 })
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.req-tools select'), merge)
})

test('arrows on the box’s request menu stay in the menu', async () => {
  const { doc } = await withRequests()
  card(doc, 5).click()
  const move = doc.querySelector<HTMLSelectElement>('.f-side select')!
  move.focus()
  key(doc, 'ArrowRight', { target: move })
  assert.equal(view!.openNumber, 5)
})

test('a partial read keeps the selection and the saved edits', async () => {
  const edits: RequestEdits = { v: 1, names: { 'g:Launch': 'Launch week' }, moves: {}, merges: {}, custom: {} }
  const { doc, snapshot, saved } = await withRequests({ edits, selected: 'g:Launch' })
  // beta and alpha's Launch items fail to read this time.
  const partial = {
    ...snapshot,
    items: snapshot.items.filter((item) => item.chat?.title !== 'Launch'),
    bots: snapshot.bots.map((bot) => (bot.name === 'beta' ? { ...bot, error: 'boom' } : bot))
  }
  view!.update(partial)
  assert.equal(saved.selected.length, 0)
  // An edit now keeps what this read can't see.
  rowOf(doc, 'c:chat-home')?.querySelector<HTMLButtonElement>('.req-pick')?.click()
  const renameButton = rowOf(doc, 'c:chat-home').querySelector<HTMLButtonElement>('.req-tools .tbtn')!
  renameButton.click()
  const input = rowOf(doc, 'c:chat-home').querySelector<HTMLInputElement>('input')!
  input.value = 'Home work'
  input.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  assert.deepEqual(saved.edits.at(-1)?.names, { 'g:Launch': 'Launch week', 'c:chat-home': 'Home work' })
  // The next full read shows Launch again, still renamed.
  view!.update(snapshot)
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'Launch week')
})

test('edits changed in Settings reach an open board without being saved back', async () => {
  const { doc, saved } = await withRequests()
  view!.replaceEdits({ v: 1, names: { 'g:Launch': 'From settings' }, moves: {}, merges: {}, custom: {} })
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'From settings')
  assert.equal(saved.edits.length, 0)
})

test('no UUID or session id anywhere on the board, whatever the data says', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  const snapshot = await loadBoard(fixtureRunner(), () => 10_000)
  const id = '11111111-2222-4333-8444-555555555555'
  const items = snapshot.items.map((item) =>
    item.number === 6 ? { ...item, title: `Mail from orca_session_id:${id}`, chat: { id: `bot-group-member-${id}`, kind: 'chat', title: id } } : item
  )
  const chats = snapshot.chats.map((chat) => ({ ...chat, lastAsked: `──── From: ORCA_SESSION_ID:${id.toUpperCase()} ────` }))
  view = mountBoardView(doc, { now: () => 10_000, detail: () => new Promise(() => undefined), selectedRequest: 'all' })
  view.update({ ...snapshot, items, chats, errors: [`failed for ${id}`] })
  card(doc, 6).click()
  const text = doc.body.textContent ?? ''
  const attrs = Array.from(doc.querySelectorAll('[title],[aria-label]')).map((node) => `${node.getAttribute('title') ?? ''} ${node.getAttribute('aria-label') ?? ''}`).join(' ')
  const options = Array.from(doc.querySelectorAll('option')).map((o) => o.textContent).join(' ')
  for (const shown of [text, attrs, options]) {
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(shown), false, shown)
    assert.equal(/session[_ ]?id/i.test(shown), false, shown)
  }
  // The mail-like last ask isn't shown at all.
  assert.equal(doc.querySelectorAll('.req-ask').length, 0)
})

// Saving request edits: Orca keeps at most 10,000 characters in a plugin setting.

function renameVia(doc: Document, id: string, name: string): void {
  rowOf(doc, id).querySelector<HTMLButtonElement>('.req-pick')!.click()
  rowOf(doc, id).querySelector<HTMLButtonElement>('.req-tools .tbtn')!.click()
  const input = rowOf(doc, id).querySelector<HTMLInputElement>('input')!
  input.value = name
  input.dispatchEvent(new (doc.defaultView as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

/** A board of `n` items, each in a chat of its own. */
async function manyChats(n: number): Promise<BoardSnapshot> {
  const snapshot = await loadBoard(fixtureRunner(), () => 10_000)
  const base = snapshot.items[1]!
  const items = Array.from({ length: n }, (_, i) => ({
    ...base,
    uid: `u${i}`,
    number: 100 + i,
    status: 'in_progress' as const,
    chat: { id: `chat-${i}`, kind: 'chat', title: `Chat ${i}` }
  }))
  return { ...snapshot, items, counts: { ...snapshot.counts, needs_you: 0, in_progress: n } }
}

test('a save Orca refuses is shown, with what to do', async () => {
  const { doc } = await withRequests({ save: async () => Promise.reject(new Error('value is too long')) })
  renameVia(doc, 'g:Launch', 'Launch week')
  await settle()
  const problem = doc.querySelector<HTMLElement>('.notice.err')!
  assert.equal(problem.hidden, false)
  assert.equal(problem.getAttribute('role'), 'alert')
  assert.match(problem.textContent ?? '', /couldn't be saved \(value is too long\)/)
  assert.match(problem.textContent ?? '', /clear “Request edits”/)
  // The edit still shows until the board closes.
  assert.equal(rowOf(doc, 'g:Launch').querySelector('.nm')?.textContent, 'Launch week')
})

test('an edit that would pass the limit is not kept, and says why', async () => {
  const snapshot = await manyChats(90)
  const long = 'x'.repeat(110)
  const names: Record<string, string> = {}
  for (let i = 0; i < 70; i++) {
    names[`c:chat-${i}`] = `${long}${i}`
  }
  const edits: RequestEdits = { v: 1, names, moves: {}, merges: {}, custom: {} }
  assert.ok(editsSize(edits) < EDITS_MAX)
  const { doc, saved } = await withRequests({ snapshot, edits, save: async () => undefined })
  let i = 70
  while (editsSize({ ...edits, names: { ...edits.names, [`c:chat-${i}`]: long } }) <= EDITS_MAX) {
    edits.names[`c:chat-${i}`] = long
    i++
  }
  view!.replaceEdits({ ...edits })
  renameVia(doc, `c:chat-${i}`, long)
  await settle()
  assert.equal(saved.edits.length, 0)
  assert.equal(rowOf(doc, `c:chat-${i}`).querySelector('.nm')?.textContent, 'Run QA')
  const problem = doc.querySelector<HTMLElement>('.notice.err')!
  assert.equal(problem.hidden, false)
  assert.match(problem.textContent ?? '', /wasn't kept/)
  assert.match(problem.textContent ?? '', /Undo edits/)
})

test('nearly full: a warning after the save', async () => {
  const snapshot = await manyChats(90)
  const names: Record<string, string> = {}
  for (let i = 0; editsSize({ v: 1, names, moves: {}, merges: {}, custom: {} }) < EDITS_WARN; i++) {
    names[`c:chat-${i}`] = 'y'.repeat(100)
  }
  const { doc } = await withRequests({ snapshot, edits: { v: 1, names, moves: {}, merges: {}, custom: {} }, save: async () => undefined })
  renameVia(doc, 'c:chat-89', 'One more')
  await settle()
  const problem = doc.querySelector<HTMLElement>('.notice.warn')!
  assert.equal(problem.hidden, false)
  assert.match(problem.textContent ?? '', /Request edits are using [\d,]+ of 9,500 characters/)
})

test('an older save is rewritten compactly on the first full read', async () => {
  const snapshot = await loadBoard(fixtureRunner(), () => 10_000)
  const item7 = snapshot.items.find((item) => item.number === 7)!
  const savedText = JSON.stringify({ v: 1, names: { 'group:Launch': 'Launch week' }, moves: { [item7.uid]: 'group:Launch' }, merges: {}, custom: {} })
  const { saved } = await withRequests({ snapshot, edits: parseEdits(savedText), savedText })
  assert.equal(saved.edits.length, 1)
  assert.equal(serializeEdits(saved.edits[0]!), '{"v":2,"n":{"g:Launch":"Launch week"},"m":{"g:Launch":[7]}}')
  // A save already in the compact form is left alone.
  view?.dispose()
  const again = await withRequests({ snapshot, edits: parseEdits(serializeEdits(saved.edits[0]!)), savedText: serializeEdits(saved.edits[0]!) })
  assert.equal(again.saved.edits.length, 0)
})

test('saving problems in Japanese', async () => {
  window = new Window()
  const doc = window.document as unknown as Document
  view = mountBoardView(doc, {
    locale: 'ja',
    now: () => 10_000,
    detail: () => new Promise(() => undefined),
    onEditsChange: async () => Promise.reject(new Error('too long'))
  })
  view.update(await loadBoard(fixtureRunner(), () => 10_000))
  renameVia(doc, 'g:Launch', '発売週')
  await settle()
  assert.match(doc.querySelector('.notice.err')?.textContent ?? '', /依頼の編集を保存できませんでした（too long）/)
})
