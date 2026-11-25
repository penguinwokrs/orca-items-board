// The request search on the board (happy-dom): typing, IME, keys, Archived, and drawing in chunks.
import { Window } from 'happy-dom'
import { afterEach, assert, test } from 'orca/testing'
import { demoSnapshot } from './demo'
import { syntheticBoard } from './synthetic'
import { mountBoardView, type BoardView } from './view'

const NOW = Date.UTC(2026, 10, 25, 12)
let window: Window | undefined
let view: BoardView | undefined

afterEach(async () => {
  view?.dispose()
  view = undefined
  await window?.happyDOM.close()
  window = undefined
})

function setup(options: { selected?: string; locale?: string; board?: ReturnType<typeof demoSnapshot> } = {}) {
  window = new Window()
  const doc = window.document as unknown as Document
  const chosen: string[] = []
  view = mountBoardView(doc, {
    now: () => NOW,
    detail: () => new Promise(() => undefined),
    ...(options.selected ? { selectedRequest: options.selected } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
    onSelectRequest: (id) => {
      chosen.push(id)
    }
  })
  view.update(options.board ?? demoSnapshot(NOW, { many: true }))
  const input = doc.querySelector<HTMLInputElement>('.req-search input')!
  const W = window as unknown as typeof globalThis
  const type = (value: string): void => {
    input.value = value
    input.dispatchEvent(new W.Event('input', { bubbles: true }))
  }
  const key = (name: string, target: Element = doc.activeElement ?? doc.body): KeyboardEvent => {
    const event = new W.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }
  const ids = (): string[] => Array.from(doc.querySelectorAll<HTMLElement>('.req[data-req]')).map((row) => row.dataset.req!)
  const count = (): string => doc.querySelector('.req-hits')?.textContent ?? ''
  return { doc, input, type, key, ids, count, chosen, W }
}

test('typing narrows the list at once, counts the matches and marks them', () => {
  const { doc, type, ids, count } = setup()
  const all = ids().length
  assert.ok(all >= 20, `the "many" demo has about twenty requests (${all})`)
  assert.equal(count(), '')
  type('r')
  type('re')
  type('release')
  assert.equal(count(), '7 of 21 requests')
  assert.equal(ids()[0], 'all')
  assert.ok(ids().includes('g:Release v2.3'))
  assert.ok(!ids().includes('c:demo-qa-home'))
  const marks = Array.from(doc.querySelectorAll('.req[data-req="g:Release v2.3"] mark')).map((mark) => mark.textContent)
  assert.ok(marks.includes('Release') && marks.includes('release'))
  // All is not a request: never marked, always there.
  assert.equal(doc.querySelector('.req[data-req="all"] mark'), null)
  type('')
  assert.equal(ids().length, all)
  assert.equal(doc.querySelector('.req mark'), null)
})

test('case, full-width and half-width forms fold; every word must match', () => {
  const { ids, type, count } = setup()
  type('ＲＥＬＥＡＳＥ　ｖ２．３')
  const both = ids()
  assert.ok(both.includes('g:Release v2.3'))
  type('release v2.3 smoke')
  assert.deepEqual(ids(), ['all', 'g:Release v2.3'])
  assert.equal(count(), '1 of 21 requests')
})

test('found only in an item the row does not show (or by number): that item is added as a line', () => {
  const { doc, type } = setup()
  type('#43')
  const hit = doc.querySelector('.req[data-req="g:Release v2.3"] .req-hit')
  assert.equal(hit?.textContent, '#43 Smoke test the v2.3 release candidate')
  assert.equal(hit?.querySelector('mark')?.textContent, '#43')
  // Words the row shows add nothing.
  type('smoke')
  assert.equal(doc.querySelector('.req[data-req="g:Release v2.3"] .req-hit'), null)
})

test('IME: nothing narrows while converting; the committed text does', () => {
  const { doc, input, type, ids, count, W } = setup()
  const all = ids().length
  input.dispatchEvent(new W.Event('compositionstart', { bubbles: true }))
  input.value = 'りり'
  input.dispatchEvent(new W.InputEvent('input', { bubbles: true, isComposing: true }))
  assert.equal(ids().length, all)
  assert.equal(count(), '')
  input.value = 'リリース'
  input.dispatchEvent(new W.Event('compositionend', { bubbles: true }))
  // No demo request has the word: the list says so and offers to clear.
  assert.equal(count(), '0 of 21 requests')
  assert.match(doc.querySelector('.req-empty')?.textContent ?? '', /No requests match/)
  doc.querySelector<HTMLButtonElement>('.req-empty button')!.click()
  assert.equal(input.value, '')
  assert.equal(ids().length, all)
  assert.equal(doc.activeElement, input)
  type('flaky')
  assert.ok(ids().length > 1)
})

test('keys: / goes to the search, ↑ ↓ move, Enter chooses and stays, Esc clears then leaves', () => {
  const { doc, input, type, key, chosen } = setup()
  key('/', doc.body)
  assert.equal(doc.activeElement, input)
  type('v2.3')
  const act = () => doc.querySelector<HTMLElement>('.req.act')?.dataset.req
  const first = act()
  assert.ok(first && first !== 'all', 'the first match is pointed at')
  key('ArrowDown')
  const second = act()
  assert.notEqual(second, first)
  key('ArrowUp')
  assert.equal(act(), first)
  assert.equal(input.getAttribute('aria-activedescendant'), doc.querySelector('.req.act .req-pick')?.id)
  key('ArrowDown')
  const enter = key('Enter')
  assert.ok(enter.defaultPrevented)
  assert.deepEqual(chosen, [second])
  assert.equal(doc.querySelector('.req.on')?.getAttribute('data-req'), second)
  assert.equal(doc.activeElement, input, 'the focus stays in the search')
  // ← → in the field are the caret's: no box opens or moves.
  key('ArrowLeft')
  assert.equal(view!.openNumber, null)
  key('Escape')
  assert.equal(input.value, '')
  assert.equal(doc.activeElement, input)
  key('Escape')
  assert.notEqual(doc.activeElement, input)
  assert.equal((doc.activeElement as HTMLElement | null)?.closest('.req')?.getAttribute('data-req'), second)
  // `/` typed in another field is just a character.
  const other = doc.createElement('input')
  doc.body.append(other)
  other.focus()
  const slash = key('/', other)
  assert.equal(slash.defaultPrevented, false)
  assert.equal(doc.activeElement, other)
})

test('/ does nothing while an item box is open', () => {
  const { doc, input, key } = setup()
  view!.open(41)
  key('/', doc.body)
  assert.notEqual(doc.activeElement, input)
})

test('archived requests are searched too: a match opens Archived, clearing folds it again', () => {
  const { doc, type, ids } = setup()
  assert.equal(doc.querySelector('.req-arch')?.getAttribute('aria-expanded'), 'false')
  assert.ok(!ids().includes('c:demo-docs-onboarding'))
  type('onboarding')
  assert.equal(doc.querySelector('.req-arch')?.getAttribute('aria-expanded'), 'true')
  assert.equal(doc.querySelector('.req-arch .ttl')?.textContent, 'Archived (1)')
  assert.ok(ids().includes('c:demo-docs-onboarding'))
  assert.ok(doc.querySelector('.req[data-req="c:demo-docs-onboarding"].archived mark'))
  // A word no archived request has: the heading goes away.
  type('v2.3')
  assert.equal(doc.querySelector('.req-arch'), null)
  type('')
  assert.equal(doc.querySelector('.req-arch')?.getAttribute('aria-expanded'), 'false')
})

test('the chosen request stays chosen when the search hides it; the board still shows its items', () => {
  const { doc, type, ids, chosen } = setup({ selected: 'g:Release v2.3' })
  const cards = () => Array.from(doc.querySelectorAll<HTMLElement>('.card')).map((card) => Number(card.dataset.n)).sort((a, b) => a - b)
  const before = cards()
  type('flaky')
  assert.ok(!ids().includes('g:Release v2.3'))
  assert.deepEqual(cards(), before)
  assert.deepEqual(chosen, [])
})

test('Japanese words', () => {
  const { doc, type, count } = setup({ locale: 'ja' })
  assert.equal(doc.querySelector<HTMLInputElement>('.req-search input')!.placeholder, '依頼を検索')
  type('v2.3')
  assert.match(count(), /^\d+ 件 \/ 全 21 件$/)
  type('ありえない語')
  assert.match(doc.querySelector('.req-empty')?.textContent ?? '', /一致する依頼はありません/)
  assert.match(doc.querySelector('.req-empty')?.textContent ?? '', /検索をクリア/)
})

test('a long list is drawn a screenful at a time: more as it scrolls or as ↓ reaches the end', () => {
  const { doc, input, type, key, ids, count, W } = setup({ board: syntheticBoard(120, 2, NOW) })
  assert.equal(ids().length, 30)
  type('e')
  assert.match(count(), /^\d+ of 120 requests$/)
  assert.equal(ids().length, 30)
  // Scrolled near the end (happy-dom has no layout: every height is 0, so any scroll is the end).
  const list = doc.querySelector<HTMLElement>('.req-list')!
  list.dispatchEvent(new W.Event('scroll'))
  assert.equal(ids().length, 60)
  // ↓ from the last drawn row draws the next ones.
  input.focus()
  for (let i = 0; i < 60; i++) {
    key('ArrowDown')
  }
  assert.ok(ids().length > 60)
  // It started on the first match (row 1, after All): sixty rows on.
  assert.equal(doc.querySelector('.req.act')?.getAttribute('data-req'), ids()[61])
})
