// The demo drawn as Orca with item origins draws it (`"origins": true`), and as before without.
import { assert, test } from 'orca/testing'
import { buildRequests, madeFrom, NO_EDITS, originRequestId } from '../src/requests'
import { demoDetail, demoSnapshot } from './demo'

const NOW = Date.UTC(2026, 10, 25, 12)

test('demo: without origins, requests come from chats as before', () => {
  const snapshot = demoSnapshot(NOW)
  assert.ok(snapshot.items.every((item) => item.origin === null))
  assert.ok(buildRequests(snapshot.items, snapshot.chats, NO_EDITS).every((request) => !request.id.startsWith('o:')))
})

test('demo with origins: a busy Home splits, a hand-off joins its request, a room post is one', () => {
  const snapshot = demoSnapshot(NOW, { origins: true })
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS, undefined, { now: NOW })
  const numbers = (id: string) =>
    requests
      .find((request) => request.id === id)!
      .items.map((uid) => snapshot.items.find((item) => item.uid === uid)!.number)
      .sort((a, b) => a - b)
  assert.equal(JSON.stringify(numbers(originRequestId('demo-infra-home:u1'))), JSON.stringify([41]))
  assert.equal(JSON.stringify(numbers(originRequestId('demo-infra-home:u2'))), JSON.stringify([36]))
  // Made before origins: still its chat's.
  assert.equal(JSON.stringify(numbers('c:demo-infra-home')), JSON.stringify([34]))
  const checkout = originRequestId('demo-qa-home:u1')
  assert.equal(JSON.stringify(numbers(checkout)), JSON.stringify([35, 45]))
  assert.equal(
    requests.find((request) => request.id === checkout)!.name,
    'The checkout test fails now and then. Find out why, and have the testing guide…'
  )
  // The room's post: release-bot's items and qa-runner's (made on a peer request) together.
  const release = originRequestId('demo-release-room:p1')
  assert.equal(JSON.stringify(numbers(release)), JSON.stringify([40, 43, 44]))
  assert.equal(requests.find((request) => request.id === release)!.name, 'Get v2.3 out this week: notes, smoke test, tag.')
  assert.ok(!requests.some((request) => request.id === 'g:Release v2.3'))
  // The hand-off's box can load its history.
  // The hand-off names qa-runner's #35 by uid alone; the box finds it among its maker's items.
  const handoff = demoDetail(45, NOW, { origins: true }).item
  assert.equal(JSON.stringify(handoff.fromItem), '{"uid":"demo-35"}')
  assert.equal(madeFrom(demoSnapshot(NOW, { origins: true }).items, handoff)?.number ?? null, 35)
})
