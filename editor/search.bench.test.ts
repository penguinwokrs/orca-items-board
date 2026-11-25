// How long one keystroke in the request search takes (match + redraw of the list) on a big made-up
// board: 500 requests, 5,000 items. Skipped unless ITEMS_BENCH=1 (`ITEMS_BENCH=1 npm test`).
// Numbers from it are in ADR 0015.
import { Window } from 'happy-dom'
import { test } from 'orca/testing'
import type { BoardItem, BoardSnapshot, ChatInfo } from '../src/protocol'
import { syntheticBoard } from './synthetic'
import { mountBoardView } from './view'

const run = process.env.ITEMS_BENCH === '1'

if (run) test('bench: one keystroke in the request search, 500 requests and 5,000 items', async () => {
  const window = new Window()
  const doc = window.document as unknown as Document
  const board: BoardSnapshot = syntheticBoard(500, 10, 1_800_000_000_000)
  const view = mountBoardView(doc, { now: () => 1_800_000_000_000, detail: () => new Promise(() => undefined) })
  view.update(board)
  const input = doc.querySelector<HTMLInputElement>('.req-search input')!
  const type = (value: string): number => {
    const start = performance.now()
    input.value = value
    input.dispatchEvent(new (window as unknown as typeof globalThis).Event('input', { bubbles: true }))
    // Read the list back, as a browser would before painting.
    void doc.querySelectorAll('.req').length
    return performance.now() - start
  }
  const report = (label: string, words: string[]): void => {
    const times: number[] = []
    for (let round = 0; round < 5; round++) {
      type('')
      for (const word of words) {
        for (let i = 1; i <= word.length; i++) {
          times.push(type(word.slice(0, i)))
        }
      }
    }
    times.sort((a, b) => a - b)
    const median = times[Math.floor(times.length / 2)]!
    const p95 = times[Math.floor(times.length * 0.95)]!
    console.log(`${label}: ${times.length} keystrokes, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${times[times.length - 1]!.toFixed(2)} ms, rows ${doc.querySelectorAll('.req').length}`)
  }
  report('typing "release notes"', ['release notes'])
  report('typing "e" (matches almost every request)', ['e'])
  report('typing "#4321"', ['#4321'])
  report('typing "データ移行"', ['データ移行'])
  const first = (() => {
    const start = performance.now()
    view.update({ ...board, fetchedAt: board.fetchedAt + 1, signature: 'again' })
    return performance.now() - start
  })()
  console.log(`a fresh read with the search on (rebuilds the search's view): ${first.toFixed(2)} ms`)
  view.dispose()
  await window.happyDOM.close()
  void ({} as BoardItem | ChatInfo)
})
