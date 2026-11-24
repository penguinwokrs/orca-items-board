// Request edits in the plugin's storage, and the one-time move from older settings.
import { assert, test } from 'orca/testing'
import { EDITS_KEY, loadEdits, readEdits, saveEdits, SELECTED_KEY } from './edits-store'
import { NO_EDITS, renameRequest } from './requests'

function kv(initial: Record<string, unknown> = {}, failSet = false) {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: async (key: string) => (key in data ? data[key] : null),
    set: async (key: string, value: unknown) => {
      if (failSet) throw new Error('refused')
      data[key] = value
    },
    delete: async (key: string) => {
      delete data[key]
    }
  }
}

test('v1 edits in the settings move to storage (compact) and the settings are cleared', async () => {
  const storage = kv()
  const settings = kv({
    [EDITS_KEY]: JSON.stringify({ v: 1, names: { 'group:Launch': 'Launch week' }, moves: {}, merges: {}, custom: {} }),
    [SELECTED_KEY]: 'group:Launch'
  })
  const loaded = await loadEdits(storage, settings)
  assert.equal(loaded.migrated, true)
  assert.deepEqual(loaded.edits.names, { 'g:Launch': 'Launch week' })
  assert.equal(loaded.selected, 'g:Launch')
  assert.deepEqual(storage.data[EDITS_KEY], { v: 2, n: { 'g:Launch': 'Launch week' } })
  assert.equal(storage.data[SELECTED_KEY], 'g:Launch')
  assert.equal(settings.data[EDITS_KEY], '')
  assert.equal(settings.data[SELECTED_KEY], 'all')
  // The next load reads storage only.
  const again = await loadEdits(storage, settings)
  assert.equal(again.migrated, false)
  assert.deepEqual(again.edits.names, { 'g:Launch': 'Launch week' })
})

test('v2 edits in the settings move too; storage already holding edits wins', async () => {
  const storage = kv({ [EDITS_KEY]: { v: 2, n: { 'c:x': 'Kept' } } })
  const settings = kv({ [EDITS_KEY]: '{"v":2,"n":{"c:y":"Older"}}' })
  const loaded = await loadEdits(storage, settings)
  assert.deepEqual(loaded.edits.names, { 'c:x': 'Kept' })
  assert.equal(settings.data[EDITS_KEY], '')
  assert.equal(loaded.savedText, '{"v":2,"n":{"c:x":"Kept"}}')
})

test('a move that storage refuses leaves the settings as they were', async () => {
  const storage = kv({}, true)
  const old = '{"v":2,"n":{"c:y":"Older"}}'
  const settings = kv({ [EDITS_KEY]: old })
  await assert.rejects(loadEdits(storage, settings))
  assert.equal(settings.data[EDITS_KEY], old)
})

test('saving writes compact JSON, and removes the value when there are no edits', async () => {
  const storage = kv()
  await saveEdits(storage, renameRequest(NO_EDITS, 'c:x', 'Name'))
  assert.deepEqual(storage.data[EDITS_KEY], { v: 2, n: { 'c:x': 'Name' } })
  assert.deepEqual((await readEdits(storage)).names, { 'c:x': 'Name' })
  await saveEdits(storage, NO_EDITS)
  assert.equal(EDITS_KEY in storage.data, false)
  const refusing = kv({}, true)
  await assert.rejects(saveEdits(refusing, renameRequest(NO_EDITS, 'c:x', 'Name')))
})
