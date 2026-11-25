// Requests from item origins (stablyai/orca#48086): one per request key across bots, inside a busy
// Home chat and inside a group room, with items that have none still grouped by their chat (a
// room's member chats together). Made-up data.
import { assert, test } from 'orca/testing'
import { fromItemOf, loadBoard, normaliseItem, normaliseOrigin, timeOf } from './board'
import { BLOG, CHECKLIST, FLAKY, LAUNCH, originItems, originRunner } from './fixtures/origin'
import {
  autoRequestId,
  buildRequests,
  madeFrom,
  mergeRequests,
  moveItem,
  NO_EDITS,
  originRequestId,
  parseEdits,
  pruneEdits,
  renameRequest,
  requestOf,
  resetRequest,
  serializeEdits
} from './requests'

const board = () => loadBoard(originRunner(), () => 10_000)
const checklist = originRequestId(CHECKLIST.rootKey)
const flaky = originRequestId(FLAKY.rootKey)
const scheduled = originRequestId('delta-home:u9')
const teammate = originRequestId('gamma-home:u4')
const launch = originRequestId(LAUNCH.rootKey)
const blog = originRequestId(BLOG.rootKey)

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
  // An item from an earlier test build: the time as ISO UTC.
  assert.equal(normaliseOrigin({ rootKey: 'k', kind: 'owner', at: '2026-11-21T10:02:00.000Z', request: null })!.at, Date.UTC(2026, 10, 21, 10, 2))
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

test('fromItem: a uid (Orca), or a uid and number (earlier test builds); else none', () => {
  assert.equal(JSON.stringify(fromItemOf({ uid: 'u1' })), '{"uid":"u1"}')
  assert.equal(JSON.stringify(fromItemOf({ uid: 'u1', number: 7 })), '{"uid":"u1","number":7}')
  assert.equal(fromItemOf({ uid: '' }) === null, true)
  assert.equal(fromItemOf({}) === null, true)
  assert.equal(fromItemOf(null) === null, true)
  assert.equal(fromItemOf('u1') === null, true)
})

test('made from: found by uid among the bot’s items or its maker’s, never shown by uid', async () => {
  const snapshot = await board()
  const item = (n: number) => snapshot.items.find((entry) => entry.number === n)!
  const parent = (n: number) => madeFrom(snapshot.items, item(n))?.number ?? null
  // One of the same bot's.
  assert.equal(parent(102), 101)
  // Made `--for` beta by alpha: alpha's item.
  assert.equal(parent(105), 104)
  // Orca prints the maker as `{ botId, name: string | null }`: found by id when it has no name.
  const unnamed = normaliseItem({ ...originItems.beta!.find((row) => row.number === 105), madeBy: { botId: 'bot-alpha', name: null } })!
  assert.equal(unnamed.madeBy?.id, 'bot-alpha')
  assert.equal(madeFrom(snapshot.items, unnamed)?.number ?? null, 104)
  // An earlier test build's `{ uid, number }`: by uid.
  assert.equal(parent(108), 107)
  assert.equal(parent(101), null)
  // By number only when the uid finds nothing, and only among the same bots.
  assert.equal(madeFrom(snapshot.items, { ...item(108), fromItem: { uid: '', number: 107 } })?.number ?? null, 107)
  assert.equal(madeFrom(snapshot.items, { ...item(108), fromItem: { uid: 'uid-gone', number: 107 } })?.number ?? null, 107)
  // Another bot's item that isn't its maker's, or a uid the board doesn't have: none.
  assert.equal(madeFrom(snapshot.items, { ...item(109), fromItem: { uid: 'uid-104' } }) === null, true)
  assert.equal(madeFrom(snapshot.items, { ...item(109), fromItem: { uid: 'uid-gone' } }) === null, true)
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
  assert.equal(
    JSON.stringify(requests.map((request) => [request.id, request.name, request.items.length, request.needsYou])),
    JSON.stringify([
      // Waiting on the owner comes first.
      [checklist, 'Build the release checklist, then post it to the team.', 3, 1],
      [blog, 'Write the launch blog post.', 1, 0],
      [launch, 'Get the launch out: ship the fix, QA it, and update the status notes.', 4, 0],
      [scheduled, 'Update the status page', 1, 0],
      [flaky, 'Fix the flaky login test and ask beta to QA it.', 2, 0],
      ['c:beta-home', 'Old beta work', 1, 0],
      [teammate, 'Answer the support question', 1, 0],
      ['c:alpha-home', 'Old chore', 1, 0],
      ['g:Launch', 'Book the launch room +1 more', 2, 0]
    ])
  )
  // An owner request with three items on one bot, one made from another in a later turn (no words).
  assert.equal(JSON.stringify(numbers(checklist)), JSON.stringify([101, 102, 103]))
  const first = requests[0]!
  // Named after the owner's words, so every item's title is the summary.
  assert.equal(JSON.stringify(first.summary), JSON.stringify(['Post the checklist', 'Review the checklist with QA', 'Draft the checklist']))
  assert.equal(first.asked, 'Build the release checklist, then post it to the team.')
  assert.equal(first.askedAt, Date.UTC(2026, 10, 20, 9))
  // Alpha's Home holds two requests: its last ask belongs to one of them, so neither shows it.
  assert.equal(first.lastAsk, null)
  assert.equal(JSON.stringify(first.chatNames), JSON.stringify(['Home']))
  // A coordinator and its helper share a key: one request, both bots, the owner's words.
  const fix = requests.find((request) => request.id === flaky)!
  assert.equal(JSON.stringify(numbers(flaky)), JSON.stringify([104, 105]))
  assert.equal(fix.bots.map((bot) => bot.name).join(','), 'beta,alpha')
  assert.equal(fix.askedAt, Date.UTC(2026, 10, 20, 9, 1))
  assert.equal(fix.lastAsk, null)
  // An automation's and a teammate's requests have a key but none of anyone's words: named after
  // their items, with no chat's last ask (gamma's Home last ask is the teammate's message).
  for (const id of [scheduled, teammate]) {
    const request = requests.find((entry) => entry.id === id)!
    assert.equal(request.asked, null)
    assert.equal(request.lastAsk, null)
    assert.equal(request.detail, null)
  }
  assert.equal(requests.find((request) => request.id === teammate)!.name, 'Answer the support question')
  assert.ok(!JSON.stringify(requests).includes('support queue'))
  // Items made before origins keep their chat's request and last ask.
  assert.equal(requests.find((request) => request.id === 'c:beta-home')!.lastAsk, 'Tidy the old beta work.')
  // The rootKey, which holds a session id, is never shown.
  assert.ok(!JSON.stringify(requests).includes('alpha-home:u'))
  assert.ok(!JSON.stringify(requests).includes('launch-post-'))
})

test('a group room: one request per owner post, across its member bots, by key alone', async () => {
  const snapshot = await board()
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS, undefined, { now: 10_000 })
  const of = (id: string) => requests.find((request) => request.id === id)!
  const numbers = (id: string) =>
    of(id)
      .items.map((uid) => snapshot.items.find((item) => item.uid === uid)!.number)
      .sort((a, b) => a - b)
  // Two owner posts in one room: two requests.
  assert.notEqual(launch, blog)
  assert.equal(JSON.stringify(numbers(blog)), JSON.stringify([111]))
  // One post handled by three member bots: alpha's turn, beta's @mention, gamma's peer request, and
  // a follow-up made from beta's item in beta's Home (no words), all one request.
  assert.equal(JSON.stringify(numbers(launch)), JSON.stringify([106, 107, 108, 110]))
  assert.equal(of(launch).bots.map((bot) => bot.name).join(','), 'gamma,beta,alpha')
  assert.equal(of(launch).chatNames.join(','), 'Launch,Home')
  // Named after the owner's post; every item's title under it; asked when the post came.
  assert.equal(of(launch).asked, LAUNCH.request)
  assert.equal(of(launch).summary.join('|'), 'Update the status notes|Check the launch notes|Run QA on the launch')
  assert.equal(of(launch).askedAt, Date.UTC(2026, 10, 21, 10))
  // The room's last ask may be the other post's: not shown on either.
  assert.equal(of(launch).lastAsk, null)
  assert.equal(of(blog).lastAsk, null)
  // Nothing reads `kind`: with every kind turned around, or missing, the list is the same.
  for (const kind of ['bot', 'person', '']) {
    const flipped = snapshot.items.map((item) => (item.origin ? { ...item, origin: { ...item.origin, kind } } : item))
    const again = buildRequests(flipped, snapshot.chats, NO_EDITS, undefined, { now: 10_000 })
    assert.equal(JSON.stringify(again), JSON.stringify(requests))
  }
  // A post whose words Orca didn't record (null): named after its items instead.
  const silent = snapshot.items.map((item) => (item.origin?.rootKey === LAUNCH.rootKey ? { ...item, origin: { ...item.origin, request: null } } : item))
  const unnamed = buildRequests(silent, snapshot.chats, NO_EDITS).find((request) => request.id === launch)!
  assert.equal(unnamed.asked, null)
  assert.equal(unnamed.name, 'Ship the fix +3 more')
})

test('a group room without origins: its member chats make one request, with the room’s last ask', async () => {
  const snapshot = await board()
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS, undefined, { now: 10_000 })
  const room = requests.find((request) => request.id === 'g:Launch')!
  const numbers = room.items.map((uid) => snapshot.items.find((item) => item.uid === uid)!.number).sort((a, b) => a - b)
  assert.equal(JSON.stringify(numbers), JSON.stringify([112, 113]))
  assert.equal(room.bots.map((bot) => bot.name).join(','), 'beta,alpha')
  assert.equal(room.asked, null)
  assert.equal(room.lastAsk, BLOG.request)
  // On stock Orca (no origins at all), every room item falls back to the room.
  const stock = snapshot.items.map((item) => ({ ...item, origin: null }))
  // Without origins, gamma's Home last ask shows on its chat's request: the fixture's text is one the
  // board would show, so the checks that it never shows on origin requests mean something.
  assert.equal(buildRequests(stock, snapshot.chats, NO_EDITS).find((request) => request.id === 'c:gamma-home')?.lastAsk, 'Can someone look at the support queue today?')
  const ids = buildRequests(stock, snapshot.chats, NO_EDITS).map((request) => request.id)
  assert.equal(ids.filter((id) => id.startsWith('o:')).length, 0)
  const roomItems = buildRequests(stock, snapshot.chats, NO_EDITS).find((request) => request.id === 'g:Launch')!.items.length
  // #106, #107, #110, #111, #112, #113 sit in the room's member chats (#108 is in beta's Home).
  assert.equal(roomItems, 6)
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
  assert.equal(JSON.stringify(edits.moves), JSON.stringify({}))
  // Merge the old chat request into the checklist, and rename it.
  edits = renameRequest(mergeRequests(edits, 'c:alpha-home', checklist), checklist, 'Release checklist')
  requests = buildRequests(snapshot.items, snapshot.chats, edits)
  const merged = requests.find((request) => request.id === checklist)!
  assert.equal(merged.name, 'Release checklist')
  assert.equal(merged.items.length, 4)
  assert.ok(!requests.some((request) => request.id === 'c:alpha-home'))
  // Saved and read back, pruned against the board: unchanged.
  const again = parseEdits(serializeEdits(edits))
  assert.equal(serializeEdits(pruneEdits(again, snapshot.items)), serializeEdits(again))
  assert.equal(JSON.stringify(buildRequests(snapshot.items, snapshot.chats, again)), JSON.stringify(requests))
  // Merging the helper's request into the room's fallback request works the same way.
  const joined = buildRequests(snapshot.items, snapshot.chats, mergeRequests(NO_EDITS, flaky, 'g:Launch'))
  assert.equal(joined.find((request) => request.id === 'g:Launch')!.items.length, 4)
})

test('rename, merge, split and undo work on a room post’s request, and survive a save', async () => {
  const snapshot = await board()
  const item = (n: number) => snapshot.items.find((entry) => entry.number === n)!
  const count = (edits: ReturnType<typeof parseEdits>, id: string) =>
    buildRequests(snapshot.items, snapshot.chats, edits).find((request) => request.id === id)?.items.length ?? 0
  // Rename.
  let edits = renameRequest(NO_EDITS, launch, 'Launch')
  assert.equal(buildRequests(snapshot.items, snapshot.chats, edits).find((request) => request.id === launch)!.name, 'Launch')
  // Merge the second post into the first.
  edits = mergeRequests(edits, blog, launch)
  assert.equal(count(edits, launch), 5)
  assert.equal(count(edits, blog), 0)
  // Split gamma's peer-request item out to a new request, then back: the move is dropped.
  edits = moveItem(edits, item(110), 'r:split', 2_000)
  assert.equal(requestOf(edits, item(110)), 'r:split')
  assert.equal(count(edits, launch), 4)
  edits = moveItem(edits, item(110), launch, 2_000)
  assert.equal(Object.keys(edits.moves).length, 0)
  // Move the old room items' request into the post's.
  edits = mergeRequests(edits, 'g:Launch', launch)
  assert.equal(count(edits, launch), 7)
  // Saved and read back, pruned against the board: unchanged.
  const saved = parseEdits(serializeEdits(edits))
  assert.equal(serializeEdits(pruneEdits(saved, snapshot.items)), serializeEdits(saved))
  assert.equal(count(saved, launch), 7)
  // Undo puts every request back where its key or chat puts it.
  const undone = resetRequest(saved, launch)
  assert.equal(count(undone, launch), 4)
  assert.equal(count(undone, blog), 1)
  assert.equal(count(undone, 'g:Launch'), 2)
  assert.equal(buildRequests(snapshot.items, snapshot.chats, undone).find((request) => request.id === launch)!.name, LAUNCH.request)
})
