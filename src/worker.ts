// The plugin's worker: answers the board and the panel with every bot's Items, read through the
// `orca` CLI. Orca gives plugins no Item API or events, so it polls: the status bar item's
// "Needs you n" is kept current while the plugin is enabled. Reads within a few seconds share one
// result, and each item's history is cached by its newest event id.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { CliError, loadBoard, loadItemDetail, type OrcaRunner } from './board'
import { botFolderWorkspace, ensureBoardFile, pickBoardWorkspace, type AgentRow, type Worktree } from './board-file'
import { cliRunner, openWithOs, resolveOrca } from './cli'
import { langOf, translator, type Lang } from './i18n'
import type { BoardItem, BoardSnapshot, ItemDetail } from './protocol'

/** Board reads within this window share one result. */
const BOARD_TTL_MS = 5_000
const DETAIL_CACHE_MAX = 50
const DEFAULT_POLL_SECONDS = 30
const STATUS_ITEM = 'needs-you'
/** First-run open: tries while Orca's window is still coming up. */
const FIRST_OPEN_TRIES = 5
const FIRST_OPEN_RETRY_MS = 3_000


/** The Needs you item waiting longest: the one to answer next. */
export function oldestNeedsYou(items: readonly BoardItem[]): BoardItem | null {
  return items
    .filter((item) => item.status === 'needs_you')
    .reduce<BoardItem | null>((oldest, item) => (!oldest || item.lastActivityAt < oldest.lastActivityAt ? item : oldest), null)
}

/**
 * Opens the board once when the flag is on. The flag is cleared before opening, so a failure never
 * turns into an open on every start; Orca's window may still be coming up, so it tries a few times.
 */
export async function openOnFirstRun(deps: {
  flag: () => Promise<unknown>
  clear: () => Promise<unknown>
  open: () => Promise<void>
  log: (line: string) => void
  tries?: number
  retryMs?: number
}): Promise<boolean> {
  if ((await deps.flag().catch(() => false)) !== true) {
    return false
  }
  await deps.clear()
  const tries = deps.tries ?? FIRST_OPEN_TRIES
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await deps.open()
      deps.log('opened the board on first run')
      return true
    } catch (error) {
      deps.log(`first-run open, attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt < tries) {
        await new Promise((resolve) => setTimeout(resolve, deps.retryMs ?? FIRST_OPEN_RETRY_MS))
      }
    }
  }
  return false
}

function pluginDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return undefined
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  let boardRead: { at: number; value: Promise<BoardSnapshot> } | null = null
  let lastSignature: string | null = null
  const details = new Map<number, { lastEventId: string | null; value: ItemDetail }>()
  /** An item a command asked the board to open; the board takes it once. */
  let pendingFocus: number | null = null
  /** Orca's display language, as the last board or panel reported it; English until then. */
  let lang: Lang = 'en'
  const t = (...args: Parameters<ReturnType<typeof translator>>): string => translator(lang)(...args)

  async function runner(): Promise<OrcaRunner> {
    const configured = await orca.settings.get('orcaPath')
    const binary = resolveOrca(typeof configured === 'string' ? configured : undefined)
    if (!binary) {
      throw new CliError(t('cliNotFound'), 'cli_not_found')
    }
    return cliRunner(binary)
  }

  async function readBoard(): Promise<BoardSnapshot> {
    let run: OrcaRunner
    try {
      run = await runner()
    } catch (error) {
      const empty = await loadBoard(async () => {
        throw error
      })
      return { ...empty, errors: [error instanceof Error ? error.message : String(error)] }
    }
    const started = Date.now()
    const snapshot = await loadBoard(run)
    orca.log(
      `board read: ${snapshot.bots.length} bots, ${snapshot.items.length} items, ${Date.now() - started} ms, signature ${snapshot.signature}`
    )
    if (snapshot.signature !== lastSignature) {
      lastSignature = snapshot.signature
      orca.panels.post('board.changed', {
        signature: snapshot.signature,
        fetchedAt: snapshot.fetchedAt
      })
    }
    return snapshot
  }

  function board(force = false): Promise<BoardSnapshot> {
    const now = Date.now()
    if (!force && boardRead && now - boardRead.at < BOARD_TTL_MS) {
      return boardRead.value
    }
    const value = readBoard()
    boardRead = { at: now, value }
    value.then(showNeedsYou, () => {
      if (boardRead?.value === value) {
        boardRead = null
      }
    })
    return value
  }

  orca.panels.handle('board.get', async (input) => {
    if (typeof input?.locale === 'string' && input.locale) {
      const next = langOf(input.locale)
      if (next !== lang) {
        lang = next
        if (boardRead) {
          void boardRead.value.then(showNeedsYou, () => undefined)
        }
      }
    }
    return board(input?.force === true)
  })

  function showNeedsYou(snapshot: BoardSnapshot): void {
    const count = snapshot.counts.needs_you
    const failed = snapshot.errors.length > 0
    void orca.host
      .call('statusBar.update', {
        id: STATUS_ITEM,
        text: failed ? 'Needs you ?' : t('needsYouCount', { n: count }),
        tone: failed ? 'danger' : count > 0 ? 'warning' : 'neutral',
        tooltip: failed
          ? t('tipFailed', { error: snapshot.errors[0] ?? '' })
          : count > 0
            ? t('tipWaiting', { n: count })
            : t('tipNone')
      })
      .catch((error: unknown) => orca.log(`statusBar.update failed: ${String(error)}`))
  }

  /** Opens the board file in its workspace, writing it first if missing. */
  async function openBoard(focus: number | null): Promise<string> {
    const run = await runner()
    const listed = await run(['worktree', 'list', '--json'])
    const worktrees = ((listed as { worktrees?: Worktree[] } | null)?.worktrees ?? []) as Worktree[]
    const preferred = await orca.settings.get('boardWorkspacePath')
    const place = pickBoardWorkspace(worktrees, {
      preferredPath: typeof preferred === 'string' ? preferred : undefined,
      pluginDir: pluginDir()
    })
    if (!place) {
      throw new CliError(
        typeof preferred === 'string' && preferred.trim() ? t('badWorkspace', { path: preferred }) : t('noWorkspace'),
        'no_workspace'
      )
    }
    ensureBoardFile(place)
    pendingFocus = focus
    await orca.host.call('workspace.open', { workspaceId: place.workspaceId })
    await orca.host.call('editor.open', { workspaceId: place.workspaceId, path: place.path })
    if (focus !== null) {
      // A board already open takes it now; one just opening asks for it once it has loaded.
      orca.panels.post('board.focus', { number: focus })
    }
    orca.log(`opened the board: ${place.file}${focus !== null ? ` (item ${focus})` : ''}`)
    return place.file
  }

  async function openNext(): Promise<BoardItem | null> {
    const next = oldestNeedsYou((await board(true)).items)
    await openBoard(next?.number ?? null)
    return next
  }

  orca.commands.register('items-board.open', async () => {
    await openBoard(null)
    return t('boardOpened')
  })

  orca.commands.register('items-board.answerNext', async () => {
    const next = await openNext()
    return next ? t('itemOpened', { n: next.number, bot: next.bot.name }) : t('tipNone')
  })

  // The sidebar panel's buttons: the same as the two commands.
  orca.panels.handle('board.open', async (input) => {
    if (input?.next) {
      const next = await openNext()
      return { file: '', number: next?.number ?? null }
    }
    return { file: await openBoard(null), number: null }
  })

  // The status bar keeps the worker running: poll so "Needs you n" stays current.
  const poll = async (): Promise<void> => {
    await board().catch(() => undefined)
    const seconds = await orca.settings.get('pollSeconds').catch(() => undefined)
    setTimeout(() => void poll(), (typeof seconds === 'number' && seconds >= 10 ? seconds : DEFAULT_POLL_SECONDS) * 1000)
  }
  void poll()

  // The first time the plugin runs after it is enabled, open the board once. The flag is a
  // setting (settings:own), so the person can also turn it back on in Settings.
  void openOnFirstRun({
    flag: () => orca.settings.get('openOnFirstRun'),
    clear: () => orca.settings.set('openOnFirstRun', false),
    open: () => openBoard(null).then(() => undefined),
    log: (line) => orca.log(line)
  })

  // `orca://bot/<id>` opens the bot's Home in Orca. Orca's deep link names an item only for an
  // outside thread's conversation, so a Home-chat item can't be opened directly.
  orca.panels.handle('bot.open', async ({ botId, botName, chatId }) => {
    if (typeof botId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(botId)) {
      throw new CliError('bot.open takes a bot id', 'invalid_argument')
    }
    // A bot's Home is a folder workspace; showing it is what the sidebar does. The deep link does
    // nothing visible while a file tab (such as this board) is in front, so it is only the fallback.
    try {
      const listed = (await (await runner())(['agent', 'list', '--json'])) as { agents?: AgentRow[] } | null
      const workspaceId = botFolderWorkspace(listed?.agents ?? [], botName, chatId)
      if (workspaceId) {
        await orca.host.call('workspace.open', { workspaceId })
        orca.log(`opened ${botName ?? botId}'s home: ${workspaceId}`)
        return { via: 'workspace' as const, workspaceId }
      }
    } catch (error) {
      orca.log(`opening ${botName ?? botId}'s home failed, using the link: ${error instanceof Error ? error.message : String(error)}`)
    }
    const url = `orca://bot/${botId}`
    await openWithOs(url)
    orca.log(`opened ${url}`)
    return { via: 'link' as const, url }
  })

  orca.panels.handle('board.takeFocus', async (input) => {
    const number = pendingFocus
    pendingFocus = null
    if (number !== null) {
      orca.log(`board took item ${number} (${input?.via ?? 'unknown'})`)
    }
    return { number }
  })

  orca.panels.handle('item.detail', async ({ number }) => {
    if (!Number.isInteger(number) || number <= 0) {
      throw new CliError('item.detail takes a positive item number', 'invalid_argument')
    }
    // The board's row says the newest event; an unchanged item answers from cache.
    const board = boardRead ? await boardRead.value.catch(() => null) : null
    const row = board?.items.find((item) => item.number === number)
    const cached = details.get(number)
    if (cached && row && row.lastEventId === cached.lastEventId) {
      return cached.value
    }
    const botNames = new Map((board?.bots ?? []).map((bot) => [bot.id, bot.name]))
    const value = await loadItemDetail(await runner(), number, botNames)
    details.delete(number)
    details.set(number, { lastEventId: value.item.lastEventId, value })
    while (details.size > DETAIL_CACHE_MAX) {
      details.delete(details.keys().next().value!)
    }
    return value
  })
}
