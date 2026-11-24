// `orca plugin check` renders the panel once per scenario. `board.get` is stubbed with fixture
// data, so the panel never shows real Items. The worker is mounted too, and its status-bar poll
// does run the real `orca` CLI (read-only); nothing it reads reaches the panel.
import { defineCheck } from 'orca/testing'
import { ANSWER_UNAVAILABLE, loadBoard } from './board'
import { fixtureRunner } from './fixtures/cli'
import type { BoardSnapshot } from './protocol'

const board = await loadBoard(fixtureRunner(), () => 10_000)

const empty: BoardSnapshot = {
  fetchedAt: 10_000,
  bots: [],
  items: [],
  counts: { needs_you: 0, in_progress: 0, waiting: 0, planned: 0, done: 0, canceled: 0 },
  signature: '0',
  errors: [],
  answer: { available: false, reason: ANSWER_UNAVAILABLE }
}

// The worker's first-run open would run the real CLI and open the board: off in checks.
const settings = { openOnFirstRun: false }

export default defineCheck({
  board: { settings, requests: { 'board.get': () => board } },
  empty: { settings, requests: { 'board.get': () => empty } },
  cliMissing: {
    settings,
    requests: {
      'board.get': () => ({
        ...empty,
        errors: ['The orca CLI was not found on PATH or in Orca’s CLI folder.']
      })
    }
  }
})
