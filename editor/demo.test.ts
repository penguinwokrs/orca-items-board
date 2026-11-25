// The demo drawn as Orca with item origins draws it (`"origins": true`), and as before without.
import { assert, test } from 'orca/testing'
import { buildRequests, NO_EDITS, originRequestId } from '../src/requests'
import { demoDetail, demoSnapshot } from './demo'

const NOW = Date.UTC(2026, 10, 25, 12)

test('demo: without origins, requests come from chats as before', () => {
  const snapshot = demoSnapshot(NOW)
  assert.ok(snapshot.items.every((item) => item.origin === null))
  assert.ok(buildRequests(snapshot.items, snapshot.chats, NO_EDITS).every((request) => !request.id.startsWith('o:')))
})

test('demo with origins: a busy Home splits, a hand-off joins its request, the room stays one', () => {
  const snapshot = demoSnapshot(NOW, { origins: true })
  const requests = buildRequests(snapshot.items, snapshot.chats, NO_EDITS, undefined, { now: NOW })
  const numbers = (id: string) =>
    requests
      .find((request) => request.id === id)!
      .items.map((uid) => snapshot.items.find((item) => item.uid === uid)!.number)
      .sort((a, b) => a - b)
  assert.deepEqual(numbers(originRequestId('demo-infra-home:u1')), [41])
  assert.deepEqual(numbers(originRequestId('demo-infra-home:u2')), [36])
  // Made before origins: still its chat's.
  assert.deepEqual(numbers('c:demo-infra-home'), [34])
  const checkout = originRequestId('demo-qa-home:u1')
  assert.deepEqual(numbers(checkout), [35, 45])
  assert.equal(
    requests.find((request) => request.id === checkout)!.name,
    'The checkout test fails now and then. Find out why, and have the testing guide…'
  )
  assert.deepEqual(numbers('g:Release v2.3'), [40, 43, 44])
  // The hand-off's box can load its history.
  assert.equal(demoDetail(45, NOW, { origins: true }).item.fromItem?.number, 35)
})
