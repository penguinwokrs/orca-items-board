// The Bot Items Board: a custom editor for `.itemsboard` files, so the board fills Orca's main area.
// Items come from the plugin's worker (`board.get`, `item.detail`); Orca sends plugins no Item
// events, so the board polls while it is visible. A file holding {"source":"demo"} draws made-up
// Items instead (screenshots, demos) and never calls the worker.
import { langOf, translator } from '../src/i18n'
import { EDITS_KEY, loadEdits, readEdits, saveEdits, SELECTED_KEY } from '../src/edits-store'
import { ALL, compactId, NO_EDITS, parseEdits, type RequestEdits } from '../src/requests'
import { demoDetail, demoSnapshot } from './demo'
import { syntheticBoard } from './synthetic'
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
  /** Demo: about twenty requests instead of the usual few, to show the search. */
  many?: boolean
  /** Demo: typed into the request search, one key at a time, for still shots. */
  search?: string
  /** Measuring: a big made-up board instead, [requests, items per request]. */
  synthetic?: [number, number]
  /** Measuring: words typed into the search key by key, timed; the times are shown on the board. */
  measure?: string[]
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
      ...(value.showArchived === true ? { showArchived: true } : {}),
      ...(value.many === true ? { many: true } : {}),
      ...(typeof value.search === 'string' ? { search: value.search } : {}),
      ...(Array.isArray(value.synthetic) && value.synthetic.length === 2 && value.synthetic.every((n) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10_000)
        ? { synthetic: value.synthetic as [number, number] }
        : {}),
      ...(Array.isArray(value.measure) && value.measure.every((word) => typeof word === 'string') ? { measure: value.measure as string[] } : {})
    }
  } catch {
    return { source: 'live' }
  }
}

/** Times each keystroke in the request search (input event, matching, the list redrawn and laid
 *  out) and shows the times on the board, for ADR 0015's measurements. Synchronous: each key is
 *  timed with its style and layout forced, the way the next frame would need them. */
function measureSearch(words: string[], board: { items: unknown[]; chats?: unknown[] }): void {
  const input = document.querySelector<HTMLInputElement>('.req-search input')
  const list = document.querySelector<HTMLElement>('.req-list')
  if (!input || !list) {
    return
  }
  const type = (value: string): number => {
    const start = performance.now()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // Style and layout now, as the next frame would.
    void list.scrollHeight
    void list.lastElementChild?.getBoundingClientRect()
    return performance.now() - start
  }
  const chosen = document.querySelector<HTMLElement>('.req.on')?.dataset.req ?? 'all'
  const lines: string[] = [
    `${document.querySelectorAll('.req').length} rows drawn of ${board.chats?.length ?? 0} requests · ${board.items.length} items · chosen: ${chosen}`
  ]
  const focusStart = performance.now()
  input.focus()
  input.dispatchEvent(new FocusEvent('focus'))
  lines.push(`search's view made (on focus, or when idle after a read): ${(performance.now() - focusStart).toFixed(1)} ms`)
  type('')
  const first = type(words[0]?.slice(0, 1) ?? 'a')
  lines.push(`first key: ${first.toFixed(1)} ms`)
  for (const word of words) {
    const times: number[] = []
    // One letter is the first key of every search: more samples for it.
    for (let round = 0; round < (word.length === 1 ? 25 : 5); round++) {
      type('')
      for (let i = 1; i <= word.length; i++) {
        times.push(type(word.slice(0, i)))
      }
    }
    times.sort((a, b) => a - b)
    const at = (q: number): string => times[Math.min(times.length - 1, Math.floor(times.length * q))]!.toFixed(1)
    lines.push(`"${word}": ${times.length} keys, median ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms`)
  }
  type('')
  const out = document.createElement('pre')
  out.className = 'measure'
  out.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9;margin:0;padding:10px 12px;font:12px/1.5 ui-monospace,monospace;background:var(--orca-popover);color:var(--orca-popover-foreground);border:1px solid var(--orca-border);border-radius:8px;white-space:pre'
  out.textContent = lines.join('\n')
  document.body.append(out)
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
  const demoBoard = options.synthetic ? syntheticBoard(options.synthetic[0], options.synthetic[1]) : demoSnapshot(Date.now(), { many: options.many === true })
  view.update(demoBoard)
  if (options.search) {
    // Typed as the owner would: one input event per character.
    const input = document.querySelector<HTMLInputElement>('.req-search input')
    if (input) {
      input.focus()
      for (let i = 1; i <= options.search.length; i++) {
        input.value = options.search.slice(0, i)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }
  if (options.measure) {
    // Before the first paint, so a still shot of the board shows the times.
    measureSearch(options.measure, demoBoard)
  }
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
  // Request edits and the chosen request live in the plugin's storage (storage:own); older settings
  // move there on this first load.
  const kept = await loadEdits(orca.storage, orca.settings).catch(() => ({
    edits: NO_EDITS,
    savedText: '',
    selected: ALL,
    migrated: false
  }))
  const days = await orca.settings.get('archiveAfterDays').catch(() => undefined)
  startLive(
    mountBoardView(document, {
      locale,
      edits: kept.edits,
      selectedRequest: kept.selected,
      ...(typeof days === 'number' && days >= 0 ? { archiveAfterDays: days } : {}),
      savedText: kept.savedText,
      // A refused save (one stored value holds 256 KiB) is shown on the board, never dropped.
      onEditsChange: (edits) => saveEdits(orca.storage, edits),
      onSelectRequest: (id) => {
        void orca.storage.set(SELECTED_KEY, id).catch(() => undefined)
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
  // A changed archive setting reaches an open board.
  orca.settings.onDidChange(({ key }) => {
    if (key === 'archiveAfterDays') {
      void orca.settings.get('archiveAfterDays').then(
        (days) => typeof days === 'number' && days >= 0 && view.setArchiveAfterDays(days),
        () => undefined
      )
    }
  })
  // Edits changed by another open board reach this one.
  orca.storage.onDidChange(({ key }) => {
    if (key === EDITS_KEY) {
      void readEdits(orca.storage).then((edits) => view.replaceEdits(edits), () => undefined)
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
