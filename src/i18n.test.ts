// Language choice and a few words in each language.
import { assert, test } from 'orca/testing'
import { langOf, relativeTime, translator } from './i18n'

test('Japanese only for a ja locale; English otherwise', () => {
  assert.equal(langOf('ja'), 'ja')
  assert.equal(langOf('ja-JP'), 'ja')
  assert.equal(langOf('ja_JP.UTF-8'), 'ja')
  assert.equal(langOf('en-US'), 'en')
  assert.equal(langOf('pt-BR'), 'en')
  assert.equal(langOf(undefined), 'en')
  assert.equal(langOf('jav'), 'en')
})

test('words and times in both languages', () => {
  const en = translator('en')
  const ja = translator('ja')
  assert.equal(en('goAnswer'), 'Answer in Orca ↗')
  assert.equal(ja('goAnswer'), 'Orca で回答する ↗')
  assert.equal(en('questions', { n: 1 }), '1 question')
  assert.equal(en('questions', { n: 3 }), '3 questions')
  assert.equal(ja('questions', { n: 3 }), '質問 3 件')
  assert.equal(relativeTime(en, 0, 4 * 60_000), '4m ago')
  assert.equal(relativeTime(ja, 0, 4 * 60_000), '4 分前')
  assert.equal(relativeTime(en, 0, 3 * 86_400_000), '3d ago')
})
