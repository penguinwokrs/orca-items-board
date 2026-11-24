// The data layer against canned CLI output: paging, normalising, one bot failing.
import { assert, test } from 'orca/testing'
import { ANSWER_UNAVAILABLE, loadBoard, loadItemDetail, normaliseLink } from './board'
import { fixtureRunner } from './fixtures/cli'

test('reads every bot, follows the list cursor and sorts newest first', async () => {
  const calls: string[][] = []
  const board = await loadBoard(fixtureRunner(calls), () => 42)
  assert.equal(board.fetchedAt, 42)
  assert.deepEqual(
    board.items.map((item) => item.number),
    [7, 6, 5, 3, 1]
  )
  assert.deepEqual(board.counts, { needs_you: 1, in_progress: 1, waiting: 1, planned: 0, done: 1, canceled: 1 })
  assert.deepEqual(
    board.bots.map((bot) => [bot.name, bot.itemCount, bot.paused]),
    [
      ['alpha', 4, false],
      ['beta', 1, false],
      ['empty', 0, true]
    ]
  )
  // alpha's second page came from its cursor.
  assert.ok(calls.some((args) => args.includes('--cursor') && args.includes('2000:3')))
  assert.ok(calls.every((args) => args.at(-1) === '--json' || args.includes('--json')))
  assert.deepEqual(board.errors, [])
  assert.deepEqual(board.answer, { available: false, reason: ANSWER_UNAVAILABLE })
})

test('normalises a Needs you question with its decisions', async () => {
  const board = await loadBoard(fixtureRunner())
  const item = board.items.find((entry) => entry.number === 7)!
  assert.equal(item.status, 'needs_you')
  assert.equal(item.question?.eventId, 'e72')
  assert.equal(item.question?.gist, 'The reviewer is out until Monday.')
  assert.deepEqual(item.question?.decisions, [
    {
      index: 0,
      question: 'Merge now?',
      multi: false,
      replies: [
        { index: 0, label: 'Merge now', recommended: false },
        { index: 1, label: 'Wait for Monday', detail: 'Two days', recommended: true }
      ]
    },
    {
      index: 1,
      question: 'Which labels?',
      multi: true,
      replies: [
        { index: 0, label: 'bug', recommended: false },
        { index: 1, label: 'ui', recommended: false }
      ]
    }
  ])
})

test('keeps waits, PR links and who made an item', async () => {
  const board = await loadBoard(fixtureRunner())
  const waiting = board.items.find((item) => item.number === 5)!
  assert.deepEqual(waiting.wait, { text: 'CI on #12; a wait wakes me', at: 8_000 })
  assert.deepEqual(waiting.links[0], {
    kind: 'pr',
    ref: 'acme/app#12',
    title: 'Fix the login redirect',
    url: 'https://github.com/acme/app/pull/12',
    pr: { number: 12, state: 'open', checks: 'pending', review: 'REVIEW_REQUIRED', title: 'Fix the login redirect' }
  })
  const made = board.items.find((item) => item.number === 6)!
  assert.deepEqual(made.bot, { id: 'bot-beta', name: 'beta' })
  assert.deepEqual(made.madeBy, { id: 'bot-alpha', name: 'alpha' })
})

test('one bot failing marks that bot and keeps the rest', async () => {
  const board = await loadBoard(fixtureRunner([], { failBot: 'beta' }))
  assert.equal(board.bots.find((bot) => bot.name === 'beta')?.error, 'boom')
  assert.deepEqual(
    board.items.map((item) => item.number),
    [7, 5, 3, 1]
  )
})

test('the bot list failing gives an empty board with the error', async () => {
  const board = await loadBoard(async () => {
    throw new Error('runtime not reachable')
  })
  assert.deepEqual(board.items, [])
  assert.deepEqual(board.errors, ['Could not list bots: runtime not reachable'])
})

test('the signature changes only when an item does', async () => {
  const a = await loadBoard(fixtureRunner())
  const b = await loadBoard(fixtureRunner())
  assert.equal(a.signature, b.signature)
  const c = await loadBoard(fixtureRunner([], { failBot: 'beta' }))
  assert.notEqual(a.signature, c.signature)
})

test('reads a whole history across pages and normalises each event', async () => {
  const calls: string[][] = []
  const detail = await loadItemDetail(fixtureRunner(calls), 7)
  assert.deepEqual(calls[1], ['bot', 'item', 'show', '7', '--json', '--after', 'e71'])
  assert.equal(detail.item.number, 7)
  assert.deepEqual(
    detail.events.map((event) => [event.id, event.kind]),
    [
      ['e70', 'made'],
      ['e71', 'linked'],
      ['e72', 'commented'],
      ['e73', 'status'],
      ['e74', 'commented']
    ]
  )
  const [made, linked, asked, moved, answer] = detail.events
  assert.deepEqual(made!.made, { title: 'Merge without the review?', status: 'planned' })
  assert.equal(made!.text, 'PR #12')
  // The item's own bot is named even with no board read yet.
  assert.deepEqual(made!.actor, { kind: 'bot', botId: 'bot-alpha', botName: 'alpha', chatId: 'chat-home' })
  assert.deepEqual(linked!.links, [
    { kind: 'pr', ref: 'acme/app#12' },
    { kind: 'url', ref: 'https://example.com/x', url: 'https://example.com/x' }
  ])
  assert.equal(asked!.ask?.context, 'The reviewer is out until Monday.')
  assert.deepEqual(
    asked!.ask?.decisions[0]?.replies.map((reply) => reply.recommended),
    [false, true]
  )
  assert.equal(asked!.ask?.decisions[1]?.multi, true)
  assert.deepEqual(moved!.status, { from: 'in_progress', to: 'needs_you' })
  assert.deepEqual(answer!.actor, { kind: 'owner' })
  assert.equal(answer!.answers, 'e60')
})

test('a refused show is an error', async () => {
  await assert.rejects(loadItemDetail(fixtureRunner(), 999), /No item/)
})

test('links spelled as strings', () => {
  assert.deepEqual(normaliseLink('dispatch:ctx_1'), { kind: 'dispatch', ref: 'ctx_1' })
  assert.deepEqual(normaliseLink('/tmp/report.md'), { kind: 'file', ref: '/tmp/report.md' })
})
