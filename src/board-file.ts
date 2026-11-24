// Where the `.itemsboard` file that opens the board lives. Orca opens files only inside a workspace
// (editor.open takes a workspace and a path within it), so the plugin keeps a folder of its own in
// the OS's place for app data, holding only that file, and registers it in Orca as a folder project.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { posix, win32 } from 'node:path'

/** The file's name inside the board folder; editor.open takes it as the relative path. */
export const BOARD_FILE_NAME = 'Bot Items.itemsboard'
/** The folder's own name, inside the OS's app data folder. */
export const BOARD_FOLDER_NAME = 'orca-items-board'
/** What the plugin writes in the file; anything else is never deleted as "ours". */
export const BOARD_TEXT = '{"kind":"orca-items-board","note":"Opens the Bot Items Board plugin. Safe to delete."}\n'
/** Where versions before 0.2.0 put the file, inside a Git main checkout. */
export const LEGACY_BOARD_FILE = '.git/orca-items-board/Bot Items.itemsboard'

export type Platform = NodeJS.Platform
export type Env = Record<string, string | undefined>

function pathFor(platform: Platform) {
  return platform === 'win32' ? win32 : posix
}

/**
 * The board folder: the setting when given, else the OS's app data folder:
 * Linux `${XDG_DATA_HOME:-~/.local/share}/orca-items-board`, macOS
 * `~/Library/Application Support/orca-items-board`, Windows `%LOCALAPPDATA%\orca-items-board`
 * (`<home>\AppData\Local\…` when the variable is missing, stablyai/orca#46975).
 */
export function boardFolderPath(options: { platform?: Platform; env?: Env; home?: string; configured?: string } = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? osHomedir()
  const path = pathFor(platform)
  const configured = options.configured?.trim()
  if (configured) {
    return path.resolve(configured)
  }
  switch (platform) {
    case 'win32':
      return path.join(env.LOCALAPPDATA?.trim() || path.join(home, 'AppData', 'Local'), BOARD_FOLDER_NAME)
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', BOARD_FOLDER_NAME)
    default:
      return path.join(env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share'), BOARD_FOLDER_NAME)
  }
}

/** Two paths name the same folder: real paths compared, case-insensitively on Windows and macOS. */
export function samePath(a: string, b: string, options: { platform?: Platform; realpath?: (p: string) => string } = {}): boolean {
  const platform = options.platform ?? process.platform
  const real = options.realpath ?? ((p: string) => {
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  })
  const path = pathFor(platform)
  const norm = (p: string): string => {
    const value = path.resolve(real(p)).replace(/[\\/]+$/, '')
    return platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value
  }
  return norm(a) === norm(b)
}

/** A project as `orca repo list --json` lists it. */
export type RepoRow = { id: string; path: string; kind?: string; hostId?: string | null; hiddenAt?: number | null }

/** The local folder project already registered for `folder`, if any. */
export function findFolderRepo(repos: readonly RepoRow[], folder: string, options: Parameters<typeof samePath>[2] = {}): RepoRow | null {
  return (
    repos.find((repo) => (repo.kind ?? 'git') === 'folder' && (repo.hostId ?? 'local') === 'local' && samePath(repo.path, folder, options)) ?? null
  )
}

/** Writes the folder and its one file when missing. */
export function ensureBoardFolder(folder: string): string {
  mkdirSync(folder, { recursive: true })
  const file = pathFor(process.platform).join(folder, BOARD_FILE_NAME)
  if (!existsSync(file)) {
    writeFileSync(file, BOARD_TEXT, 'utf8')
  }
  return file
}

export type Worktree = {
  id: string
  path: string
  repoId?: string
  hostId?: string | null
  isMainWorktree?: boolean
  identity?: { key?: string } | null
}

/** The id plugins name a workspace by: `identity:<key>` when Orca keeps one, else its raw id. */
export function pluginWorkspaceId(worktree: Worktree): string {
  return worktree.identity?.key ? `identity:${worktree.identity.key}` : worktree.id
}

/** The folder project's workspace among `orca worktree list` rows. */
export function folderWorkspace(worktrees: readonly Worktree[], repoId: string): string | null {
  const row = worktrees.find((tree) => tree.repoId === repoId && (tree.hostId ?? 'local') === 'local')
  return row ? pluginWorkspaceId(row) : null
}

/**
 * Removes board files earlier versions wrote inside Git checkouts, but only ones whose text is
 * exactly what the plugin wrote; the folder goes too when that leaves it empty. Returns the files
 * removed.
 */
export function removeLegacyBoardFiles(
  worktrees: readonly Worktree[],
  fs: { read: (p: string) => string | null; remove: (p: string) => void; removeDirIfEmpty: (p: string) => void } = {
    read: (p) => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return null
      }
    },
    remove: (p) => unlinkSync(p),
    removeDirIfEmpty: (p) => {
      try {
        if (readdirSync(p).length === 0) {
          rmdirSync(p)
        }
      } catch {
        // gone already
      }
    }
  }
): string[] {
  const removed: string[] = []
  const path = pathFor(process.platform)
  for (const tree of worktrees) {
    if ((tree.hostId ?? 'local') !== 'local' || tree.isMainWorktree === false) {
      continue
    }
    const file = path.join(tree.path, LEGACY_BOARD_FILE)
    if (fs.read(file) === BOARD_TEXT) {
      fs.remove(file)
      fs.removeDirIfEmpty(path.dirname(file))
      removed.push(file)
    }
  }
  return removed
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
