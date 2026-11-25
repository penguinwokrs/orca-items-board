// Matching for the request search: folding, words, highlights and the added item line.
import { assert, test } from 'orca/testing'
import { fold, matchEntry, matchRanges, queryTerms, searchEntry } from './search'

test('folding: case, full-width and half-width forms, half-width kana with sound marks', () => {
  assert.equal(fold('Release v2.3'), 'release v2.3')
  assert.equal(fold('ＲＥＬＥＡＳＥ　ｖ２．３'), 'release v2.3')
  assert.equal(fold('ﾘﾘｰｽﾉｰﾄ'), 'リリースノート')
  assert.equal(fold('ｶﾞｲﾄﾞ'), 'ガイド')
  assert.equal(fold('データ'), 'データ')
})

test('the query splits into words on any space, full-width included; blank is no words', () => {
  assert.deepEqual(queryTerms('  Release  ＮＯＴＥＳ　v2.3 '), ['release', 'notes', 'v2.3'])
  assert.deepEqual(queryTerms(' 　 '), [])
})

test('highlights map back to the text as shown, merged where they touch', () => {
  assert.deepEqual(matchRanges('Release notes for v2.3', queryTerms('notes rel')), [[0, 3], [8, 13]])
  // A full-width query marks the half-width text and the other way round.
  assert.deepEqual(matchRanges('ｖ２．３ release', queryTerms('v2.3')), [[0, 4]])
  // Half-width kana: ｶﾞ is two characters shown, one folded.
  assert.deepEqual(matchRanges('ｶﾞｲﾄﾞを更新', queryTerms('ガイド')), [[0, 5]])
  assert.deepEqual(matchRanges('Smoke test', queryTerms('st est')), [[7, 10]])
  assert.deepEqual(matchRanges('Smoke test', []), [])
})

const entry = searchEntry({
  id: 'c:release',
  shown: ['Release notes for v2.3 +2 more', 'Smoke test the release candidate', 'Release v2.3 · release-bot · qa-runner'],
  items: [
    { number: 44, title: 'Release notes for v2.3' },
    { number: 43, title: 'Smoke test the release candidate' },
    { number: 40, title: 'Tag v2.3 once the candidate passes' }
  ]
})

test('every word must be found (AND), each anywhere in the request', () => {
  assert.ok(matchEntry(entry, queryTerms('release qa-runner')))
  assert.equal(matchEntry(entry, queryTerms('release billing')), null)
  assert.deepEqual(matchEntry(entry, queryTerms('ＳＭＯＫＥ')), { extra: null })
})

test('a word found only in an item the row does not show adds that item as one line', () => {
  // The title of #40 is not shown on the row; nor are item numbers.
  assert.deepEqual(matchEntry(entry, queryTerms('tag')), { extra: '#40 Tag v2.3 once the candidate passes' })
  assert.deepEqual(matchEntry(entry, queryTerms('#43')), { extra: '#43 Smoke test the release candidate' })
  // The item holding most of the hidden words wins.
  assert.deepEqual(matchEntry(entry, queryTerms('passes #40')), { extra: '#40 Tag v2.3 once the candidate passes' })
})
