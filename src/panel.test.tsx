// The sidebar entry over a stubbed worker answering with fixture data.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import { loadBoard } from './board'
import { fixtureRunner } from './fixtures/cli'
import * as panel from './panel'

let view: TestPanel | undefined
// Unmount even after a failed assertion: the poll timer would keep Node running.
afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('shows the counts and only the Needs you items', async () => {
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const opens: unknown[] = []
  view = await mount(panel, {
    host: mockHost({
      requests: {
        'board.get': () => board,
        'board.open': (input) => {
          opens.push(input)
          return { file: '', number: 7 }
        }
      }
    })
  })
  assert.ok(view.find({ text: 'Needs you 1' }))
  await view.press({ text: 'Show Needs you' })
  await view.press({ text: 'Open board' })
  // Like the status bar: the board on All with Needs you shown, no box opened.
  assert.deepEqual(opens, [{ needsYou: true }, { needsYou: false }])
  assert.ok(view.find({ text: 'Waiting 1' }))
  const titles = view.findAll({ type: 'ListItem' }).map((node) => node.props.title)
  // Other statuses stay on the board.
  assert.deepEqual(titles, ['Merge without the review?'])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('nothing waiting says so', async () => {
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const calm = { ...board, items: board.items.filter((item) => item.status !== 'needs_you'), counts: { ...board.counts, needs_you: 0 } }
  view = await mount(panel, { host: mockHost({ requests: { 'board.get': () => calm } }) })
  assert.ok(view.summary().some((line) => line.includes('Nothing needs you')))
})

test('the counts follow the board: Planned first when there are any', async () => {
  const board = await loadBoard(fixtureRunner(), () => 10_000)
  const planned = { ...board, counts: { ...board.counts, planned: 2 } }
  view = await mount(panel, { host: mockHost({ requests: { 'board.get': () => planned } }) })
  const badges = view.findAll({ type: 'Badge' }).map((node) => node.text)
  assert.deepEqual(badges, ['Planned 2', 'Needs you 1', 'In progress 1', 'Waiting 1'])
})
