// Where the board file goes, and which Needs you a command opens.
import { assert, test } from 'orca/testing'
import {
  BOARD_FILE_NAME,
  BOARD_TEXT,
  boardFolderPath,
  botFolderWorkspace,
  findFolderRepo,
  folderWorkspace,
  LEGACY_BOARD_FILE,
  pluginWorkspaceId,
  removeLegacyBoardFiles,
  samePath,
  type Worktree
} from './board-file'
import { loadBoard } from './board'
import { fixtureRunner } from './fixtures/cli'
import { oldestNeedsYou, openOnFirstRun } from './worker'

test('the board folder is in the OS app data place, or where the setting says', () => {
  assert.equal(boardFolderPath({ platform: 'linux', env: {}, home: '/h/u' }), '/h/u/.local/share/orca-items-board')
  assert.equal(boardFolderPath({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, home: '/h/u' }), '/data/orca-items-board')
  assert.equal(boardFolderPath({ platform: 'darwin', env: {}, home: '/Users/u' }), '/Users/u/Library/Application Support/orca-items-board')
  assert.equal(
    boardFolderPath({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, home: 'C:\\Users\\u' }),
    'C:\\Users\\u\\AppData\\Local\\orca-items-board'
  )
  // No LOCALAPPDATA in the worker (stablyai/orca#46975): from the home folder.
  assert.equal(boardFolderPath({ platform: 'win32', env: {}, home: 'C:\\Users\\u' }), 'C:\\Users\\u\\AppData\\Local\\orca-items-board')
  assert.equal(boardFolderPath({ platform: 'linux', env: {}, home: '/h/u', configured: ' /srv/board ' }), '/srv/board')
  assert.equal(BOARD_FILE_NAME, 'Bot Items.itemsboard')
})

test('paths are compared as real paths, ignoring case on Windows and macOS', () => {
  const realpath = (p: string) => (p === '/link' ? '/real' : p)
  assert.ok(samePath('/link', '/real/', { platform: 'linux', realpath }))
  assert.ok(!samePath('/Real', '/real', { platform: 'linux', realpath }))
  assert.ok(samePath('/Users/U/Board', '/users/u/board', { platform: 'darwin', realpath }))
  assert.ok(samePath('C:\\Users\\U\\Board', 'c:\\users\\u\\board\\', { platform: 'win32', realpath }))
})

test('an already registered local folder project is reused; git repos and remote hosts are not', () => {
  const repos = [
    { id: 'g', path: '/data/orca-items-board', kind: 'git' },
    { id: 'r', path: '/data/orca-items-board', kind: 'folder', hostId: 'ssh:box' },
    { id: 'f', path: '/data/orca-items-board/', kind: 'folder' }
  ]
  const opts = { platform: 'linux' as const, realpath: (p: string) => p }
  assert.equal(findFolderRepo(repos, '/data/orca-items-board', opts)?.id, 'f')
  assert.equal(findFolderRepo(repos.slice(0, 2), '/data/orca-items-board', opts), null)
  const trees: Worktree[] = [
    { id: 'f::/data/orca-items-board', path: '/data/orca-items-board', repoId: 'f', hostId: 'local' },
    { id: 'x', path: '/x', repoId: 'x', identity: { key: 'wt2:local:x' } }
  ]
  assert.equal(folderWorkspace(trees, 'f'), 'f::/data/orca-items-board')
  assert.equal(pluginWorkspaceId(trees[1]!), 'identity:wt2:local:x')
  assert.equal(folderWorkspace(trees, 'missing'), null)
})

test('old board files inside checkouts are removed only when the plugin wrote them', () => {
  const files: Record<string, string> = {
    [`/w/a/${LEGACY_BOARD_FILE}`]: BOARD_TEXT,
    [`/w/b/${LEGACY_BOARD_FILE}`]: '{"kind":"orca-items-board","note":"changed by hand"}\n'
  }
  const removed: string[] = []
  const dirs: string[] = []
  const trees: Worktree[] = [
    { id: 'a', path: '/w/a', isMainWorktree: true },
    { id: 'b', path: '/w/b', isMainWorktree: true },
    { id: 'c', path: '/w/c', isMainWorktree: true },
    { id: 'r', path: '/w/a', hostId: 'ssh:box' }
  ]
  const result = removeLegacyBoardFiles(trees, {
    read: (p) => files[p] ?? null,
    remove: (p) => removed.push(p),
    removeDirIfEmpty: (p) => dirs.push(p)
  })
  assert.deepEqual(result, [`/w/a/${LEGACY_BOARD_FILE}`])
  assert.deepEqual(removed, [`/w/a/${LEGACY_BOARD_FILE}`])
  assert.deepEqual(dirs, ['/w/a/.git/orca-items-board'])
})

test('the next Needs you is the one waiting longest', async () => {
  const board = await loadBoard(fixtureRunner())
  assert.equal(oldestNeedsYou(board.items)?.number, 7)
  const more = [...board.items, { ...board.items[0]!, number: 99, lastActivityAt: 1 }]
  assert.equal(oldestNeedsYou(more)?.number, 99)
  assert.equal(oldestNeedsYou(board.items.filter((item) => item.status !== 'needs_you')), null)
})

test('a bot’s Home is the folder workspace of the item’s chat, else of a chat in its workspace', () => {
  const rows = [
    { orcaSessionId: 'chat-home', kind: 'chat', worktreeId: 'folder:aaa', workspace: 'alpha' },
    { orcaSessionId: 'chat-group', kind: 'chat', worktreeId: 'folder:bbb', workspace: 'beta' },
    { orcaSessionId: 'term-1', kind: 'terminal', worktreeId: 'r1::/w/zeta', workspace: 'zeta' }
  ]
  assert.equal(botFolderWorkspace(rows, 'alpha', 'chat-home'), 'folder:aaa')
  // An unknown chat falls back to the bot's name.
  assert.equal(botFolderWorkspace(rows, 'beta', 'gone'), 'folder:bbb')
  // A Git worktree row is never a bot's Home.
  assert.equal(botFolderWorkspace(rows, 'zeta', 'term-1'), null)
  assert.equal(botFolderWorkspace(rows, 'nobody', undefined), null)
})

test('first run: opens once, clears the flag first, and retries while Orca comes up', async () => {
  const log: string[] = []
  let flag: unknown = true
  let tries = 0
  const deps = {
    flag: async () => flag,
    clear: async () => {
      flag = false
    },
    open: async () => {
      tries += 1
      if (tries < 3) {
        throw new Error('unavailable')
      }
    },
    log: (line: string) => log.push(line),
    retryMs: 0
  }
  assert.equal(await openOnFirstRun(deps), true)
  assert.equal(flag, false)
  assert.equal(tries, 3)
  assert.equal(log.at(-1), 'opened the board on first run')
  // The next start does nothing.
  assert.equal(await openOnFirstRun(deps), false)
  assert.equal(tries, 3)
})

test('first run: gives up after its tries, with the flag already off', async () => {
  let flag: unknown = true
  const result = await openOnFirstRun({
    flag: async () => flag,
    clear: async () => {
      flag = false
    },
    open: async () => {
      throw new Error('no window')
    },
    log: () => undefined,
    tries: 2,
    retryMs: 0
  })
  assert.equal(result, false)
  assert.equal(flag, false)
})
