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
  compactId,
  EDITS_MAX,
  editsSize,
  hideIds,
  ownerAsk,
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
      ['c:chat-home', 'Dropped idea +2 more', 3, 1],
      ['g:Launch', 'Ship the fix +1 more', 2, 0]
    ]
  )
  // Named after the oldest item; the newer ones are its summary, newest first.
  assert.deepEqual(requests[0]!.summary, ['Merge without the review?', 'Old work'])
  // The chat's name is only a note.
  assert.deepEqual(requests[0]!.chatNames, ['Home'])
  assert.deepEqual(requests[1]!.chatNames, ['Launch'])
  const launch = requests.find((request) => request.id === 'g:Launch')!
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
  assert.equal(autoRequestId({ chat: null, bot: { id: 'b', name: 'beta' } }), 'b:b')
})

test('rename, split into a new request, merge, and undo', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  let edits = renameRequest(NO_EDITS, 'g:Launch', '  Launch week  ')
  assert.equal(edits.names['g:Launch'], 'Launch week')
  // Split: #7 moves to a new request.
  const id = newRequestId(edits, 1_000)
  edits = moveItem(edits, item7, id, 1_000)
  let requests = buildRequests(snapshot.items, snapshot.chats, edits)
  const split = requests.find((request) => request.id === id)!
  // A request of one item is named after it.
  assert.equal(split.name, 'Merge without the review?')
  assert.deepEqual(split.summary, [])
  assert.equal(split.custom, true)
  assert.equal(requestOf(edits, item7), id)
  assert.equal(requests.find((request) => request.id === 'c:chat-home')!.items.length, 2)
  // Merge the split request into Launch: #7 follows.
  edits = mergeRequests(edits, id, 'g:Launch')
  requests = buildRequests(snapshot.items, snapshot.chats, edits)
  assert.equal(requestOf(edits, item7), 'g:Launch')
  assert.equal(requests.find((request) => request.id === 'g:Launch')!.autoName, 'Ship the fix +2 more')
  assert.equal(requests.find((request) => request.id === 'g:Launch')!.name, 'Launch week')
  assert.equal(requests.find((request) => request.id === 'g:Launch')!.items.length, 3)
  // Moving it back where its chat puts it drops the move.
  edits = moveItem(edits, item7, 'c:chat-home', 2_000)
  assert.equal(edits.moves[item7.uid], undefined)
  // Undo Launch's edits: the rename and anything merged into it.
  edits = resetRequest(edits, 'g:Launch')
  assert.deepEqual(edits.names, {})
  assert.deepEqual(edits.merges, {})
})

test('merging a whole chat request, and no merge into itself', async () => {
  const snapshot = await board()
  let edits = mergeRequests(NO_EDITS, 'g:Launch', 'c:chat-home')
  const requests = buildRequests(snapshot.items, snapshot.chats, edits)
  assert.deepEqual(
    requests.map((request) => [request.id, request.items.length, request.bots.length]),
    [['c:chat-home', 5, 2]]
  )
  assert.equal(mergeRequests(edits, 'c:chat-home', 'g:Launch'), edits)
  // A cycle can't hang the lookup.
  edits = { ...edits, merges: { a: 'b', b: 'a' } }
  assert.ok(['a', 'b'].includes(requestOf({ ...edits, moves: { u: 'a' } }, { uid: 'u', number: 99, chat: null, bot: { id: 'x', name: 'x' } })))
})

test('edits are saved as JSON, read back, pruned, and empty edits save as empty', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  let edits = moveItem(renameRequest(NO_EDITS, 'c:chat-home', 'Merge plans'), item7, 'r:x', 5)
  edits = { ...edits, moves: { ...edits.moves, 'gone-uid': 'r:x' }, names: { ...edits.names, 'c:gone': 'Old' } }
  const pruned = pruneEdits(edits, snapshot.items)
  // Moves are kept by item number; ones for items the board doesn't have go.
  assert.deepEqual(Object.keys(pruned.moves), ['7'])
  assert.deepEqual(Object.keys(pruned.names), ['c:chat-home'])
  const back = parseEdits(serializeEdits(pruned))
  assert.deepEqual({ ...back, custom: {} }, { ...pruned, custom: {} })
  assert.deepEqual(Object.keys(back.custom), ['r:x'])
  assert.equal(serializeEdits(NO_EDITS), '')
  assert.deepEqual(parseEdits('not json'), NO_EDITS)
  assert.deepEqual(parseEdits(''), NO_EDITS)
  assert.equal(ALL, 'all')
})

test('the last ask shows only what reads like the owner: no mail, ids or machine text', () => {
  assert.equal(ownerAsk('Ship the fix today.'), 'Ship the fix today.')
  assert.equal(ownerAsk('  Cをベースに進めて  '), 'Cをベースに進めて')
  for (const text of [
    '──── From: ORCA_SESSION_ID:11111111-2222-4333-8444-555555555555 (status) ──── Subject: Re: plan',
    '──── From: ORCA:ITEMS ────',
    'Subject: Re: smoke test',
    'From: release-bot',
    '件名: 週次レポート',
    'Look at 11111111-2222-4333-8444-555555555555 please',
    'orca_session_id:abc is done',
    'worker_done for task_abc',
    '/compact',
    'ok',
    '',
    null
  ]) {
    assert.equal(ownerAsk(text), null, String(text))
  }
})

test('ids are hidden from anything shown', () => {
  assert.equal(hideIds('From orca_session_id:11111111-2222-4333-8444-555555555555 ok'), 'From … ok')
  assert.equal(hideIds('chat 11111111-2222-4333-8444-555555555555'), 'chat …')
  assert.equal(hideIds('plain text'), 'plain text')
})

test('a one-item request shows its description’s first line', async () => {
  const snapshot = await board()
  const items = snapshot.items.map((item) => (item.number === 6 ? { ...item, description: '\n## Run the QA suite\nmore' } : item))
  const edits = moveItem(NO_EDITS, items.find((item) => item.number === 6)!, 'r:solo', 1)
  const solo = buildRequests(items, [], edits).find((request) => request.id === 'r:solo')!
  assert.equal(solo.name, 'Run QA')
  assert.equal(solo.detail, 'Run the QA suite')
})

test('the saved form is compact: short ids, items by number, moves grouped by target', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  const item5 = snapshot.items.find((item) => item.number === 5)!
  let edits = moveItem(NO_EDITS, item7, 'r:a', 1_000)
  edits = moveItem(edits, item5, 'r:a', 1_000)
  edits = renameRequest(edits, 'r:a', 'Split')
  assert.equal(serializeEdits(edits), '{"v":2,"n":{"r:a":"Split"},"m":{"r:a":[5,7]}}')
  // A chat's UUID is shortened to 12 hex digits in its request id.
  assert.equal(compactId('chat:abcdef01-2345-4678-9abc-def012345678'), 'c:abcdef012345')
  assert.equal(compactId('group:Release v2.3'), 'g:Release v2.3')
  assert.equal(compactId('c:already'), 'c:already')
})

test('hundreds of moves stay far under the setting limit', async () => {
  // 300 items, each moved: roughly 4 characters an item.
  const snapshot = await board()
  const base = snapshot.items[0]!
  const items = Array.from({ length: 300 }, (_, i) => ({ ...base, uid: `u${i}`, number: 1000 + i }))
  let edits = NO_EDITS
  for (const item of items) {
    edits = moveItem(edits, item, i(item.number) ? 'r:even' : 'r:odd', 1)
  }
  function i(n: number): boolean {
    return n % 2 === 0
  }
  edits = renameRequest(renameRequest(edits, 'r:even', 'Even'), 'r:odd', 'Odd')
  assert.ok(editsSize(edits) < 2_500, String(editsSize(edits)))
  assert.ok(editsSize(edits) < EDITS_MAX)
})

test('an older save (v1, uids and long ids) is read and rewritten on the next prune', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  const old = JSON.stringify({
    v: 1,
    names: { 'group:Launch': 'Launch week', 'req:abc': 'Split' },
    moves: { [item7.uid]: 'req:abc' },
    merges: { 'chat:chat-home': 'group:Launch' },
    custom: { 'req:abc': { at: 5 } }
  })
  const read = parseEdits(old)
  assert.deepEqual(read.names, { 'g:Launch': 'Launch week', 'r:abc': 'Split' })
  assert.deepEqual(read.merges, { 'c:chat-home': 'g:Launch' })
  // The uid still finds the item until the next save rewrites it by number.
  assert.equal(requestOf(read, item7), 'r:abc')
  const pruned = pruneEdits(read, snapshot.items)
  assert.deepEqual(pruned.moves, { '7': 'r:abc' })
  assert.ok(serializeEdits(pruned).length < old.length)
})

test('pruning drops moves that change nothing, empty splits and names of empty requests', async () => {
  const snapshot = await board()
  const item7 = snapshot.items.find((item) => item.number === 7)!
  // #7 moved to Launch, then Launch merged into #7's own chat: the move now does nothing.
  let edits = moveItem(NO_EDITS, item7, 'g:Launch', 1)
  edits = { ...edits, merges: { 'g:Launch': 'c:chat-home' } }
  edits = { ...edits, names: { 'r:gone': 'Nobody', 'c:chat-home': 'Kept' }, custom: { 'r:gone': { at: 1 } } }
  const pruned = pruneEdits(edits, snapshot.items)
  assert.deepEqual(pruned.moves, {})
  assert.deepEqual(pruned.custom, {})
  assert.deepEqual(pruned.names, { 'c:chat-home': 'Kept' })
  assert.deepEqual(pruned.merges, { 'g:Launch': 'c:chat-home' })
})
