// Where the board file goes, and which Needs you a command opens.
import { assert, test } from 'orca/testing'
import { BOARD_FILE, botFolderWorkspace, pickBoardWorkspace, pluginWorkspaceId, type Worktree } from './board-file'
import { loadBoard } from './board'
import { fixtureRunner } from './fixtures/cli'
import { oldestNeedsYou, openOnFirstRun } from './worker'

const trees: Worktree[] = [
  { id: 'r1::/w/zeta', path: '/w/zeta', repoId: 'r1', hostId: 'local', isMainWorktree: true, identity: { key: 'wt2:local:z' } },
  { id: 'r2::/w/alpha', path: '/w/alpha', repoId: 'r2', hostId: 'local', isMainWorktree: true, identity: { key: 'wt2:local:a' } },
  { id: 'r2::/w/alpha-feature', path: '/w/alpha-feature', repoId: 'r2', hostId: 'local', isMainWorktree: false },
  { id: 'r3::/remote/x', path: '/remote/x', repoId: 'r3', hostId: 'ssh:box', isMainWorktree: true }
]
const gitDir = (root: string) => root !== '/w/alpha-feature'

test('plugins name a workspace by its identity', () => {
  assert.equal(pluginWorkspaceId(trees[0]!), 'identity:wt2:local:z')
  assert.equal(pluginWorkspaceId(trees[2]!), 'r2::/w/alpha-feature')
})

test('the plugin’s own repository wins, through its main checkout', () => {
  const place = pickBoardWorkspace(trees, { pluginDir: '/w/alpha-feature/src', isGitDir: gitDir })
  assert.deepEqual(place, {
    workspaceId: 'identity:wt2:local:a',
    root: '/w/alpha',
    path: BOARD_FILE,
    file: `/w/alpha/${BOARD_FILE}`
  })
})

test('else the first local main checkout by path; never a linked worktree or a remote host', () => {
  assert.equal(pickBoardWorkspace(trees, { pluginDir: '/elsewhere', isGitDir: gitDir })?.root, '/w/alpha')
  assert.equal(pickBoardWorkspace([trees[2]!, trees[3]!], { isGitDir: () => true }), null)
})

test('the setting picks the checkout, and an unknown one is refused', () => {
  assert.equal(pickBoardWorkspace(trees, { preferredPath: '/w/zeta', isGitDir: gitDir })?.root, '/w/zeta')
  assert.equal(pickBoardWorkspace(trees, { preferredPath: '/w/nowhere', isGitDir: gitDir }), null)
})

test('the file stays inside .git, out of git status', () => {
  assert.ok(BOARD_FILE.startsWith('.git/'))
  assert.ok(BOARD_FILE.endsWith('.itemsboard'))
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
