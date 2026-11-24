// Where the `.itemsboard` file that opens the board lives. Orca opens files only inside a workspace
// (editor.open takes a workspace and a path within it), so the file goes in a local Git main
// checkout's `.git` folder: inside the workspace, but never in `git status`.
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** Relative to the chosen workspace. */
export const BOARD_FILE = '.git/orca-items-board/Bot Items.itemsboard'
const BOARD_TEXT = '{"kind":"orca-items-board","note":"Opens the Bot Items Board plugin. Safe to delete."}\n'

export type Worktree = {
  id: string
  path: string
  repoId?: string
  hostId?: string | null
  isMainWorktree?: boolean
  identity?: { key?: string } | null
}

export type BoardPlace = { workspaceId: string; root: string; path: string; file: string }

/** The id plugins name a workspace by: `identity:<key>` when Orca keeps one, else its raw id. */
export function pluginWorkspaceId(worktree: Worktree): string {
  return worktree.identity?.key ? `identity:${worktree.identity.key}` : worktree.id
}

function hasGitDir(root: string): boolean {
  try {
    return statSync(join(root, '.git')).isDirectory()
  } catch {
    return false
  }
}

function inside(child: string, parent: string): boolean {
  const p = resolve(parent) + sep
  return (resolve(child) + sep).startsWith(p)
}

/**
 * The workspace for the board file, in order: the one at `preferredPath` (a setting); a local main
 * checkout that already holds the file; the main checkout of the repository the plugin itself is
 * in (a development load); else the first local main checkout by path. Only checkouts whose `.git`
 * is a folder qualify (a linked worktree's `.git` is a file).
 */
export function pickBoardWorkspace(
  worktrees: readonly Worktree[],
  options: { preferredPath?: string; pluginDir?: string; isGitDir?: (root: string) => boolean } = {}
): BoardPlace | null {
  const gitDir = options.isGitDir ?? hasGitDir
  const local = worktrees.filter((tree) => (tree.hostId ?? 'local') === 'local' && tree.isMainWorktree !== false)
  const candidates = local.filter((tree) => gitDir(tree.path)).sort((a, b) => a.path.localeCompare(b.path))
  const place = (tree: Worktree): BoardPlace => ({
    workspaceId: pluginWorkspaceId(tree),
    root: tree.path,
    path: BOARD_FILE,
    file: join(tree.path, BOARD_FILE)
  })
  const preferred = options.preferredPath?.trim()
  if (preferred) {
    const tree = candidates.find((entry) => resolve(entry.path) === resolve(preferred))
    return tree ? place(tree) : null
  }
  const existing = candidates.find((tree) => existsSync(join(tree.path, BOARD_FILE)))
  if (existing) {
    return place(existing)
  }
  if (options.pluginDir) {
    const own = worktrees.find((tree) => inside(options.pluginDir!, tree.path))
    const main = own?.repoId ? candidates.find((tree) => tree.repoId === own.repoId) : undefined
    if (main) {
      return place(main)
    }
  }
  return candidates[0] ? place(candidates[0]) : null
}

/** Writes the file if it is missing; its text only marks what it is. */
export function ensureBoardFile(place: BoardPlace): void {
  if (!existsSync(place.file)) {
    mkdirSync(dirname(place.file), { recursive: true })
    writeFileSync(place.file, BOARD_TEXT, 'utf8')
  }
}

/** A chat as `orca agent list --json` lists it. */
export type AgentRow = { orcaSessionId?: string; sessionId?: string; kind?: string; worktreeId?: string; workspace?: string }

/**
 * The folder workspace a bot's chat lives in (`folder:<id>`): the row for the item's own chat,
 * else any chat row of a workspace named after the bot. A bot's Home is a folder workspace.
 */
export function botFolderWorkspace(rows: readonly AgentRow[], botName: string | undefined, chatId: string | undefined): string | null {
  const folder = (row: AgentRow | undefined): string | null =>
    row?.worktreeId && row.worktreeId.startsWith('folder:') ? row.worktreeId : null
  const byChat = chatId ? rows.find((row) => (row.orcaSessionId ?? row.sessionId) === chatId) : undefined
  return (
    folder(byChat) ??
    folder(botName ? rows.find((row) => row.kind === 'chat' && row.workspace === botName && folder(row)) : undefined)
  )
}
