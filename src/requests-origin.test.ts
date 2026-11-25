// Requests from item origins (stablyai/orca#48086): one per request across bots and inside a busy
// Home chat, with items that have none still grouped by their chat. Made-up data.
import { assert, test } from 'orca/testing'
import { loadBoard, normaliseItem, normaliseOrigin, timeOf } from './board'
import { CHECKLIST, FLAKY, originRunner } from './fixtures/origin'
import {
  autoRequestId,
  buildRequests,
  linkRooms,
  mergeRequests,
  moveItem,
  NO_EDITS,
  originRequestId,
  parseEdits,
  pruneEdits,
  renameRequest,
  requestOf,
  serializeEdits
} from './requests'

const board = () => loadBoard(originRunner(), () => 10_000)
const checklist = originRequestId(CHECKLIST.rootKey)
const flaky = originRequestId(FLAKY.rootKey)
const handoff = originRequestId('delta-home:u9')

test('origin: times from ISO or epoch ms; a missing or keyless origin is none', () => {
  assert.equal(timeOf('2026-11-20T09:00:00.000Z'), Date.UTC(2026, 10, 20, 9))
  assert.equal(timeOf(1_234), 1_234)
  assert.equal(timeOf('not a time'), null)
  assert.equal(timeOf(null), null)
  assert.deepEqual(normaliseOrigin(CHECKLIST), {
    rootKey: CHECKLIST.rootKey,
    kind: 'owner',
    at: Date.UTC(2026, 10, 20, 9),
    request: CHECKLIST.request
  })
  assert.deepEqual(normaliseOrigin({ rootKey: 'k', kind: 'bot', at: null, request: null }), {
    rootKey: 'k',
    kind: 'bot',
    at: null,
    request: null
  })
  assert.equal(normaliseOrigin(null), null)
  assert.equal(normaliseOrigin(undefined), null)
  assert.equal(normaliseOrigin({ kind: 'owner', request: 'no key' }), null)
  assert.equal(normaliseOrigin({ rootKey: '  ' }), null)
  // A row from Orca without origins at all.
  const old = normaliseItem({ number: 1, title: 'Old', chat: { id: 'c1', kind: 'home', title: 'Home' } })!
  assert.equal(old.origin, null)
  assert.equal(old.fromItem, null)
  assert.equal(autoRequestId(old), 'c:c1')
})

test('origin request ids are short, stable and never the key itself', () => {
  assert.match(checklist, /^o:[0-9a-z]{14}$/)
  assert.equal(originRequestId(CHECKLIST.rootKey), checklist)
  assert.notEqual(checklist, flaky)
  // Pinned: saved edits name these ids, so the hash must never change.
  assert.equal(originRequestId('alpha-home:u1'), 'o:031mtib18q5og1')
  assert.equal(originRequestId(''), 'o:0ztntfp01efc4f')
})

test('one request per origin across bots and in one busy Home chat; old items keep their chat', async () => {
  const snapshot = await board()
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS, undefined, { now: 10_000 })
  const numbers = (id: string) =>
    requests
      .find((request) => request.id === id)!
      .items.map((uid) => snapshot.items.find((item) => item.uid === uid)!.number)
      .sort((a, b) => a - b)
  assert.deepEqual(
    requests.map((request) => [request.id, request.name, request.items.length, request.needsYou]),
    [
      // Waiting on the owner comes first.
      [checklist, 'Build the release checklist, then post it to the team.', 3, 1],
      [handoff, 'Update the status page', 1, 0],
      ['g:Launch', 'Ship the fix +2 more', 3, 0],
      [flaky, 'Fix the flaky login test and ask beta to QA it.', 2, 0],
      ['c:beta-home', 'Old beta work', 1, 0],
      ['c:alpha-home', 'Old chore', 1, 0]
    ]
  )
  // An owner request with three items on one bot.
  assert.deepEqual(numbers(checklist), [101, 102, 103])
  const first = requests[0]!
  // Named after the owner's words, so every item's title is the summary.
  assert.deepEqual(first.summary, ['Post the checklist', 'Review the checklist with QA', 'Draft the checklist'])
  assert.equal(first.asked, 'Build the release checklist, then post it to the team.')
  assert.equal(first.askedAt, Date.UTC(2026, 10, 20, 9))
  // Alpha's Home holds two requests: its last ask belongs to one of them, so neither shows it.
  assert.equal(first.lastAsk, null)
  assert.deepEqual(first.chatNames, ['Home'])
  // A coordinator and its helper share a key: one request, both bots, the owner's words.
  const fix = requests.find((request) => request.id === flaky)!
  assert.deepEqual(numbers(flaky), [104, 105])
  assert.deepEqual(
    fix.bots.map((bot) => bot.name),
    ['beta', 'alpha']
  )
  assert.equal(fix.askedAt, Date.UTC(2026, 10, 20, 9, 1))
  assert.equal(fix.lastAsk, null)
  // A room: Orca keys it per bot, so the room ties them, with a hand-off made from its turn.
  assert.deepEqual(numbers('g:Launch'), [106, 107, 108])
  const launch = requests.find((request) => request.id === 'g:Launch')!
  assert.equal(launch.asked, null)
  assert.equal(launch.lastAsk, 'Get the launch out.')
  // A hand-off three hops down has a key but no words: named after its item.
  assert.equal(requests[1]!.asked, null)
  // Items made before origins keep their chat's request and last ask.
  assert.equal(requests.find((request) => request.id === 'c:beta-home')!.lastAsk, 'Tidy the old beta work.')
  // The rootKey, which holds a session id, is never shown.
  assert.ok(!JSON.stringify(requests).includes('alpha-home:u'))
})

test('a room’s requests join the room, by its items or by its chats', async () => {
  const snapshot = await board()
  const room = (n: number) => snapshot.items.find((item) => item.number === n)!.origin?.room
  assert.equal(room(106), 'g:Launch')
  assert.equal(room(107), 'g:Launch')
  assert.equal(room(108), 'g:Launch')
  assert.equal(room(101), undefined)
  // A hand-off from a room whose own items aren't on the board: its chats name the room.
  const alone = snapshot.items.filter((item) => item.number === 108).map((item) => ({ ...item, origin: { ...item.origin!, room: undefined } }))
  assert.equal(linkRooms(alone)[0]!.origin!.room, undefined)
  assert.equal(linkRooms(alone, snapshot.chats)[0]!.origin!.room, 'g:Launch')
})

test('the owner’s words are shortened for the name and lose any ids', async () => {
  const snapshot = await board()
  const long = 'Please '.repeat(30) + 'ship it'
  const items = snapshot.items
    .filter((item) => item.number === 101)
    .map((item) => ({ ...item, origin: { ...item.origin!, request: `${long} for orca_session_id:abc and 11111111-2222-4333-8444-555555555555` } }))
  const [request] = buildRequests(items, [], NO_EDITS)
  assert.equal([...request!.name].length, 80)
  assert.ok(request!.name.endsWith('…'))
  assert.ok(request!.asked!.endsWith('for … and …'))
})

test('split and merge work across origin and chat requests, and survive a save', async () => {
  const snapshot = await board()
  const item = (n: number) => snapshot.items.find((entry) => entry.number === n)!
  // Move #102 out of the checklist into the old chat request, then back: the move is dropped.
  let edits = moveItem(NO_EDITS, item(102), 'c:alpha-home', 1_000)
  assert.equal(requestOf(edits, item(102)), 'c:alpha-home')
  let requests = buildRequests(snapshot.items, snapshot.chats, edits)
  assert.equal(requests.find((request) => request.id === checklist)!.items.length, 2)
  edits = moveItem(edits, item(102), checklist, 1_000)
  assert.deepEqual(edits.moves, {})
  // Merge the old chat request into the checklist, and rename it.
  edits = renameRequest(mergeRequests(edits, 'c:alpha-home', checklist), checklist, 'Release checklist')
  requests = buildRequests(snapshot.items, snapshot.chats, edits)
  const merged = requests.find((request) => request.id === checklist)!
  assert.equal(merged.name, 'Release checklist')
  assert.equal(merged.items.length, 4)
  assert.ok(!requests.some((request) => request.id === 'c:alpha-home'))
  // Saved and read back, pruned against the board: unchanged.
  const again = parseEdits(serializeEdits(edits))
  assert.deepEqual(pruneEdits(again, snapshot.items), again)
  assert.deepEqual(buildRequests(snapshot.items, snapshot.chats, again), requests)
  // Merging the helper's request into the room's works the same way.
  const joined = buildRequests(snapshot.items, snapshot.chats, mergeRequests(NO_EDITS, flaky, 'g:Launch'))
  assert.equal(joined.find((request) => request.id === 'g:Launch')!.items.length, 5)
})
