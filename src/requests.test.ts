// Requests: made from chats, a group room's chats together, and the owner's edits replayed.
import { assert, test } from 'orca/testing'
import { loadBoard } from './board'
import { fixtureRunner } from './fixtures/cli'
import {
  ALL,
  autoRequestId,
  buildRequests,
  mergeRequests,
  moveItem,
  newRequestId,
  NO_EDITS,
  parseEdits,
  pruneEdits,
  renameRequest,
  requestOf,
  resetRequest,
  serializeEdits
} from './requests'

async function board() {
  return loadBoard(fixtureRunner(), () => 10_000)
}

test('each chat makes a request; a group room’s member chats make one, with every bot', async () => {
  const snapshot = await board()
  assert.equal(snapshot.chats.length, 3)
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS)
  assert.deepEqual(
    requests.map((request) => [request.id, request.name, request.items.length, request.needsYou]),
    [
      ['chat:chat-home', 'alpha · Home', 3, 1],
      ['group:Launch', 'Launch', 2, 0]
    ]
  )
  const launch = requests.find((request) => request.id === 'group:Launch')!
  assert.deepEqual(
    launch.bots.map((bot) => bot.name),
    ['beta', 'alpha']
  )
  // The newest ask among its chats.
  assert.equal(launch.lastAsk, 'Run QA on the fix.')
  assert.equal(requests[0]!.lastAsk, 'Ask the reviewer about the merge.')
})

test('requests waiting on the owner come first', async () => {
  const snapshot = await board()
  const requests = buildRequests(snapshot.items, [], NO_EDITS)
  assert.ok(requests[0]!.needsYou > 0)
  assert.equal(requests[0]!.lastAsk, null)
})

test('an item without a chat goes to its bot', () => {
  assert.equal(autoRequestId({ chat: null, bot: { id: 'b', name: 'beta' } }), 'bot:b')
})

test('rename, split into a new request, merge, and undo', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  let edits = renameRequest(NO_EDITS, 'group:Launch', '  Launch week  ')
  assert.equal(edits.names['group:Launch'], 'Launch week')
  // Split: #7 moves to a new request.
  const id = newRequestId(edits, 1_000)
  edits = moveItem(edits, item7, id, 1_000)
  let requests = buildRequests(snapshot.items, snapshot.chats, edits, { home: 'Home', split: (n) => `Request ${n}` })
  const split = requests.find((request) => request.id === id)!
  assert.equal(split.name, 'Request 1')
  assert.equal(split.custom, true)
  assert.equal(requestOf(edits, item7), id)
  assert.equal(requests.find((request) => request.id === 'chat:chat-home')!.items.length, 2)
  // Merge the split request into Launch: #7 follows.
  edits = mergeRequests(edits, id, 'group:Launch')
  requests = buildRequests(snapshot.items, snapshot.chats, edits)
  assert.equal(requestOf(edits, item7), 'group:Launch')
  assert.equal(requests.find((request) => request.id === 'group:Launch')!.name, 'Launch week')
  assert.equal(requests.find((request) => request.id === 'group:Launch')!.items.length, 3)
  // Moving it back where its chat puts it drops the move.
  edits = moveItem(edits, item7, 'chat:chat-home', 2_000)
  assert.equal(edits.moves[item7.uid], undefined)
  // Undo Launch's edits: the rename and anything merged into it.
  edits = resetRequest(edits, 'group:Launch')
  assert.deepEqual(edits.names, {})
  assert.deepEqual(edits.merges, {})
})

test('merging a whole chat request, and no merge into itself', async () => {
  const snapshot = await board()
  let edits = mergeRequests(NO_EDITS, 'group:Launch', 'chat:chat-home')
  const requests = buildRequests(snapshot.items, snapshot.chats, edits)
  assert.deepEqual(
    requests.map((request) => [request.id, request.items.length, request.bots.length]),
    [['chat:chat-home', 5, 2]]
  )
  assert.equal(mergeRequests(edits, 'chat:chat-home', 'group:Launch'), edits)
  // A cycle can't hang the lookup.
  edits = { ...edits, merges: { a: 'b', b: 'a' } }
  assert.ok(['a', 'b'].includes(requestOf({ ...edits, moves: { u: 'a' } }, { uid: 'u', chat: null, bot: { id: 'x', name: 'x' } })))
})

test('edits are saved as JSON, read back, pruned, and empty edits save as empty', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  let edits = moveItem(renameRequest(NO_EDITS, 'chat:chat-home', 'Merge plans'), item7, 'req:x', 5)
  edits = { ...edits, moves: { ...edits.moves, 'gone-uid': 'req:x' }, names: { ...edits.names, 'chat:gone': 'Old' } }
  const pruned = pruneEdits(edits, snapshot.items)
  assert.deepEqual(Object.keys(pruned.moves), [item7.uid])
  assert.deepEqual(Object.keys(pruned.names), ['chat:chat-home'])
  assert.deepEqual(parseEdits(serializeEdits(pruned)), pruned)
  assert.equal(serializeEdits(NO_EDITS), '')
  assert.deepEqual(parseEdits('not json'), NO_EDITS)
  assert.deepEqual(parseEdits(''), NO_EDITS)
  assert.equal(ALL, 'all')
})
