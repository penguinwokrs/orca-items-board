// The Bot Items Board: a custom editor for `.itemsboard` files, so the board fills Orca's main area.
// Items come from the plugin's worker (`board.get`, `item.detail`); Orca sends plugins no Item
// events, so the board polls while it is visible. A file holding {"source":"demo"} draws made-up
// Items instead (screenshots, demos) and never calls the worker.
import { langOf, translator } from '../src/i18n'
import { ALL, compactId, NO_EDITS, parseEdits, serializeEdits, type RequestEdits } from '../src/requests'
import { demoDetail, demoSnapshot } from './demo'
import { mountBoardView, type BoardView } from './view'

const DEFAULT_POLL_SECONDS = 30
/** Orca's display language; the worker hears it with each read, for the status bar. */
const locale = orca.locale
const t = translator(langOf(locale))

/** What the file asks for: live Items (any other text), or the demo, optionally with one item's
 *  box open (`open`), its body scrolled to the end (`scroll: "end"`), "Answer in Orca ↗" pressed
 *  (`press: "answer"`), or the answer-in-place preview (`answerInPlace`), for still shots. */
type FileOptions = {
  source: 'demo' | 'live'
  /** Demo: the request selected at start. */
  request?: string
  /** Demo: request edits to start from (renames, moves, merges). */
  edits?: RequestEdits
  /** Demo: a request tool shown open for still shots. */
  show?: 'rename' | 'merge' | 'move'
  /** Demo: the Archived section shown open. */
  showArchived?: boolean
  open?: number
  scroll?: 'end'
  answerInPlace?: boolean
  press?: 'answer' | 'needsYou'
  /** Draws the demo in this language instead of Orca's (`en`, `ja`). */
  locale?: string
}

function fileOptions(text: string | undefined): FileOptions {
  try {
    const value = JSON.parse(text ?? '') as Record<string, unknown>
    if (value.source !== 'demo') {
      return { source: 'live' }
    }
    return {
      source: 'demo',
      ...(typeof value.open === 'number' ? { open: value.open } : {}),
      ...(value.scroll === 'end' ? { scroll: 'end' as const } : {}),
      ...(value.answerInPlace === true ? { answerInPlace: true } : {}),
      ...(value.press === 'answer' || value.press === 'needsYou' ? { press: value.press } : {}),
      ...(typeof value.locale === 'string' ? { locale: value.locale } : {}),
      ...(typeof value.request === 'string' ? { request: value.request } : {}),
      ...(value.edits ? { edits: parseEdits(JSON.stringify(value.edits)) } : {}),
      ...(value.show === 'rename' || value.show === 'merge' || value.show === 'move' ? { show: value.show } : {}),
      ...(value.showArchived === true ? { showArchived: true } : {})
    }
  } catch {
    return { source: 'live' }
  }
}

const document_ = await orca.document?.get()
const options = fileOptions(document_?.content.kind === 'text' ? document_.content.text : undefined)

if (options.source === 'demo') {
  const view = mountBoardView(document, {
    locale: options.locale ?? locale,
    // Demo edits live only in this tab: nothing is saved.
    edits: options.edits ?? NO_EDITS,
    selectedRequest: options.request ? compactId(options.request) : ALL,
    ...(options.showArchived ? { showArchived: true } : {}),
    detail: async (number) => demoDetail(number),
    // Demo bots don't exist: pretend their Home opened, so the board shows what comes next.
    openBot: async () => ({ via: 'workspace' as const }),
    // "answerInPlace": a preview of the answer-in-place UI kept for when Orca allows it.
    ...(options.answerInPlace ? { answerPreview: true, answer: async () => undefined } : {})
  })
  view.update(demoSnapshot())
  if (options.press === 'needsYou') {
    // What the status bar does: back to All, the Needs you column highlighted, its first card focused.
    view.showNeedsYou()
  }
  if (options.show === 'rename') {
    document.querySelector<HTMLButtonElement>('.req.on .req-tools .tbtn')?.click()
  }
  if (options.open !== undefined) {
    view.open(options.open)
    // The demo history arrives on the next turn; then the body can scroll to its end.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (options.press === 'answer') {
      // The real button and its handler: the demo's openBot stands in for opening the bot.
      document.querySelector<HTMLButtonElement>('.f-foot .send.go')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (options.show === 'move') {
      document.querySelector<HTMLSelectElement>('.f-side select')?.focus()
    }
    if (options.scroll === 'end') {
      const body = document.querySelector<HTMLElement>('.f-body')
      if (body) {
        body.scrollTop = body.scrollHeight
      }
    }
  }
  setInterval(() => view.tick(), 15_000)
} else {
  const saved = await Promise.all([
    orca.settings.get('requestEdits').catch(() => ''),
    orca.settings.get('selectedRequest').catch(() => ALL),
    orca.settings.get('archiveAfterDays').catch(() => undefined)
  ])
  startLive(
    mountBoardView(document, {
      locale,
      edits: parseEdits(saved[0]),
      selectedRequest: typeof saved[1] === 'string' && saved[1] ? compactId(saved[1]) : ALL,
      ...(typeof saved[2] === 'number' && saved[2] >= 0 ? { archiveAfterDays: saved[2] } : {}),
      // The owner's request edits and choice are plugin settings (settings:own), so they survive
      // reloads; clearing "Request edits" in Settings undoes every edit.
      savedText: typeof saved[0] === 'string' ? saved[0] : '',
      // A refused save (Orca allows 10,000 characters) is shown on the board, never dropped.
      onEditsChange: (edits) => orca.settings.set('requestEdits', serializeEdits(edits)),
      onSelectRequest: (id) => {
        void orca.settings.set('selectedRequest', id).catch(() => undefined)
      },
      detail: (number) => orca.plugin.request('item.detail', { number }, { timeoutMs: 60_000 }),
      openBot: async (item) => {
        const opened = await orca.plugin.request(
          'bot.open',
          { botId: item.bot.id, botName: item.bot.name, ...(item.chat ? { chatId: item.chat.id } : {}) },
          { timeoutMs: 30_000 }
        )
        return { via: opened.via }
      },
      openExternal: (url) => {
        void orca.shell?.openExternal(url).catch(() => undefined)
      }
    })
  )
}

function startLive(view: BoardView): void {
  // "Request edits" cleared or changed in Settings reaches an open board.
  orca.settings.onDidChange(({ key }) => {
    if (key === 'archiveAfterDays') {
      void orca.settings.get('archiveAfterDays').then(
        (days) => typeof days === 'number' && days >= 0 && view.setArchiveAfterDays(days),
        () => undefined
      )
    }
    if (key === 'requestEdits') {
      void orca.settings.get('requestEdits').then((text) => view.replaceEdits(parseEdits(text)), () => undefined)
    }
  })
  let inFlight: Promise<void> | null = null
  const load = async (force: boolean): Promise<void> => {
    try {
      view.update(await orca.plugin.request('board.get', { force, locale }, { timeoutMs: 120_000 }))
    } catch (error) {
      view.fail(t('boardFailed', { error: error instanceof Error ? error.message : String(error) }))
    }
  }
  /** One read at a time; a forced read waits for the one in flight, then reads again. */
  const refresh = async (force = false): Promise<void> => {
    if (inFlight) {
      await inFlight
      if (!force) {
        return
      }
    }
    const current = load(force)
    inFlight = current
    try {
      await current
    } finally {
      if (inFlight === current) {
        inFlight = null
      }
    }
  }
  // A command, the status bar or the panel asked the board to show something: the worker keeps it.
  const takeFocus = async (via: 'load' | 'event'): Promise<void> => {
    const focus = await orca.plugin
      .request('board.takeFocus', { via })
      .catch(() => ({ number: null, needsYou: false }) as { number: number | null; needsYou?: boolean })
    if (focus.needsYou) {
      await refresh(true)
      view.showNeedsYou()
    } else if (focus.number !== null) {
      await refresh(true)
      view.open(focus.number)
    }
  }
  const pollSeconds = async (): Promise<number> => {
    const value = await orca.settings.get('pollSeconds').catch(() => undefined)
    return typeof value === 'number' && value >= 10 ? value : DEFAULT_POLL_SECONDS
  }
  const poll = async (): Promise<void> => {
    setTimeout(
      () => {
        if (document.visibilityState !== 'hidden') {
          void refresh()
        }
        void poll()
      },
      (await pollSeconds()) * 1000
    )
  }
  orca.plugin.on('board.changed', () => void refresh())
  orca.plugin.on('board.focus', () => void takeFocus('event'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refresh()
    }
  })
  setInterval(() => view.tick(), 15_000)
  void refresh().then(() => takeFocus('load'))
  void poll()
}
