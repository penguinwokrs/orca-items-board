// The wide board and its floating box in a real DOM (happy-dom): open, close, focus, keys.
import { Window } from 'happy-dom'
import { afterEach, assert, test } from 'orca/testing'
import { loadBoard, loadItemDetail } from '../src/board'
import { fixtureRunner } from '../src/fixtures/cli'
import type { BoardSnapshot } from '../src/protocol'
import { mountBoardView, type BoardView } from './view'

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
  const notice = doc.querySelector<HTMLElement>('.notice')!
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
  assert.match(doc.querySelector('.notice')?.textContent ?? '', /If nothing changed, choose alpha under Bots on the left, then open #7/)
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
