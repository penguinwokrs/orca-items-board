// The wide board and its floating box, drawn into any Document: Orca's editor frame at run time,
// happy-dom in tests. It knows nothing of Orca; editor/board.ts feeds it snapshots and details.
import { langOf, relativeTime as relative, translator, type Translate } from '../src/i18n'
import type { AnswerInput, BoardItem, BoardSnapshot, ItemDetail, ItemEvent, ItemLink, ItemStatus } from '../src/protocol'
import {
  ALL,
  buildRequests,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  EDITS_MAX,
  EDITS_WARN,
  editsSize,
  hideIds,
  serializeEdits,
  mergeRequests,
  moveItem,
  newRequestId,
  NO_EDITS,
  pruneEdits,
  renameRequest,
  requestOf,
  resetRequest,
  resolveRequest,
  type Request,
  type RequestEdits
} from '../src/requests'
import { matchEntry, matchRanges, queryTerms, searchEntry, type SearchEntry, type SearchHit } from '../src/search'

export type BoardViewDeps = {
  /** One item and its whole history (the worker's `item.detail`). */
  detail: (number: number) => Promise<ItemDetail>
  /** Takes the owner to the item's bot in Orca, to answer there ("Answer in Orca ↗"). `workspace`:
   *  its Home is now in front; `link`: Orca was asked through `orca://bot/<id>`, which may not show. */
  openBot?: (item: BoardItem) => Promise<{ via: 'workspace' | 'link' }>
  /** Sends the owner's answer from the box. Only used while the answer-in-place UI is on. */
  answer?: (item: BoardItem, input: AnswerInput) => Promise<void>
  /** Draws the answer-in-place UI even though Orca can't take the answer yet (demo and docs only). */
  answerPreview?: boolean
  /** Opens a link's address outside Orca; called from a press only. */
  openExternal?: (url: string) => void
  now?: () => number
  /** Orca's display language (BCP 47): Japanese for `ja*`, else English. */
  locale?: string
  /** The owner's saved request edits (renames, moves, merges). */
  edits?: RequestEdits
  /** Called with the new edits after each rename, move, merge or reset, to save them. */
  onEditsChange?: (edits: RequestEdits) => void | Promise<unknown>
  /** The saved text the edits came from: on the first full read, an older or untidy save is
   *  rewritten in the current compact form. */
  savedText?: string
  /** The request selected last time (`all` for every item). */
  selectedRequest?: string
  /** Called when the owner selects a request, to save it. */
  onSelectRequest?: (id: string) => void
  /** Days after its last item closes that a request moves under Archived; 0 never archives. */
  archiveAfterDays?: number
  /** Archived requests shown at start (demo shots). */
  showArchived?: boolean
  /** Size limits for saved edits, in bytes (tests use small ones). */
  editsLimits?: { max: number; warn: number }
}

type Column = { status: ItemStatus; label: string; color: string; recent?: number }

export const STATUS_LABEL: Record<ItemStatus, string> = {
  needs_you: 'Needs you',
  in_progress: 'In progress',
  waiting: 'Waiting',
  planned: 'Planned',
  done: 'Done',
  canceled: 'Canceled'
}

const STATUS_COLOR: Record<ItemStatus, string> = {
  needs_you: 'var(--st-needs)',
  in_progress: 'var(--st-progress)',
  waiting: 'var(--st-waiting)',
  planned: 'var(--st-planned)',
  done: 'var(--st-done)',
  canceled: 'var(--st-cancel)'
}

/** Done and Canceled show their newest few; the rest behind "+N more". */
const RECENT_CLOSED = 20
/** The box shows the newest events; older ones behind "Show N older events". */
const RECENT_EVENTS = 10
/** Rows of the request list drawn at once; more are drawn as it scrolls (ADR 0015). */
const ROW_CHUNK = 30
/** The Archived heading's place among the list's rows. */
const ARCH_HEAD = '\u0000archived'
/** How long the Needs you column glows after the status bar or panel asks for it. */
const FLASH_MS = 2_400

const STYLE = `
:root { --st-needs: #e0a43a; --st-progress: #4f93d8; --st-waiting: #9a8fd0; --st-planned: #8a9a96; --st-done: #4fae7d; --st-cancel: #7a8481; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--orca-background); color: var(--orca-foreground);
  font: 12px/1.55 var(--orca-font-sans, system-ui, sans-serif); }
button { font: inherit; color: inherit; }
.stage { position: relative; height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.toolbar { display: flex; gap: 12px; align-items: center; padding: 9px 14px 0; color: var(--orca-muted-foreground); font-size: 11px; }
.toolbar .needs { color: var(--st-needs); font-weight: 600; }
.toolbar .sp { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.toolbar .err { color: var(--orca-destructive); }
.tbtn { cursor: pointer; background: none; border: 1px solid var(--orca-border); border-radius: 5px; padding: 1px 8px; color: var(--orca-muted-foreground); }
.board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(155px, 1fr); gap: 8px; padding: 10px 14px 14px; min-height: 0; overflow-x: auto; }
.col { background: var(--orca-card); border: 1px solid var(--orca-border); border-radius: 7px; padding: 7px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 7px; min-width: 0; min-height: 0; }
.col-h { display: flex; align-items: center; gap: 6px; color: var(--orca-muted-foreground); font-size: 11px; margin: 0; font-weight: 500; }
.col-h .sw { width: 7px; height: 7px; border-radius: 2px; }
.col-h .n { font-family: var(--orca-font-mono, monospace); margin-left: auto; }
.col-list { display: grid; gap: 7px; align-content: start; overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding-right: 2px; }
.card { all: unset; box-sizing: border-box; cursor: pointer; background: var(--orca-background); border: 1px solid var(--orca-border); border-radius: 6px; padding: 8px 9px; display: grid; gap: 4px; min-width: 0; }
.card:hover { border-color: color-mix(in srgb, var(--orca-foreground) 30%, var(--orca-border)); }
.card:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.card.needs { border-color: color-mix(in srgb, var(--st-needs) 65%, var(--orca-border)); }
.card .t { font-weight: 500; line-height: 1.45; }
.card .m { color: var(--orca-muted-foreground); font-size: 11px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.card .w { color: var(--orca-muted-foreground); font-size: 11px; border-left: 2px solid var(--st-waiting); padding-left: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card .askhint { color: var(--st-needs); font-size: 11px; }
.botchip { font-family: var(--orca-font-mono, monospace); font-size: 10px; padding: 0 5px; border-radius: 3px; background: var(--orca-muted); border: 1px solid var(--orca-border); }
.more { all: unset; cursor: pointer; color: var(--orca-muted-foreground); font-size: 11px; padding: 2px; }
.empty { color: var(--orca-muted-foreground); font-size: 11px; padding: 2px; }
.scrim { position: absolute; inset: 0; background: color-mix(in srgb, #000 55%, transparent); display: grid; place-items: center; padding: 22px 28px; z-index: 5; }
.scrim[hidden] { display: none !important; }
.float { width: min(980px, 100%); height: 100%; max-height: 760px; background: var(--orca-popover); color: var(--orca-popover-foreground); border: 1px solid var(--orca-border); border-radius: 10px; box-shadow: 0 18px 48px rgba(0,0,0,.45); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
@media (prefers-reduced-motion: no-preference) { .float { animation: rise .14s ease-out; } @keyframes rise { from { transform: translateY(6px); opacity: .6; } to { transform: none; opacity: 1; } } }
.f-head { padding: 12px 14px 10px; border-bottom: 1px solid var(--orca-border); display: grid; gap: 6px; }
.f-top { display: flex; align-items: center; gap: 8px; color: var(--orca-muted-foreground); font-size: 11px; }
.f-top .sp { margin-left: auto; display: flex; gap: 4px; align-items: center; }
.st { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 3px; color: #1b1f1e; }
.ibtn { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 5px; display: grid; place-items: center; color: var(--orca-muted-foreground); }
.ibtn:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.ibtn:focus-visible, .linkbtn:focus-visible, .older:focus-visible { outline: 2px solid var(--orca-ring); }
.ibtn:disabled { opacity: .35; cursor: default; }
.ibtn svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 2; }
.esc { font-family: var(--orca-font-mono, monospace); font-size: 10px; border: 1px solid var(--orca-border); border-radius: 3px; padding: 0 4px; }
.f-title { font-size: 15px; font-weight: 700; line-height: 1.4; margin: 0; }
.f-body { overflow-y: auto; overscroll-behavior: contain; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 220px; }
.f-main { padding: 14px 16px 20px; display: grid; gap: 16px; align-content: start; min-width: 0; }
.f-side { padding: 14px; margin: 0; border-left: 1px solid var(--orca-border); display: grid; gap: 4px 0; align-content: start; font-size: 11px; position: sticky; top: 0; align-self: start; }
.f-side dt { color: var(--orca-muted-foreground); margin-top: 8px; }
.f-side dt:first-child { margin-top: 0; }
.f-side dd { margin: 0; word-break: break-word; }
.linkbtn { all: unset; cursor: pointer; color: var(--st-progress); display: block; }
.linkbtn.plain { cursor: default; color: inherit; }
.blk { display: grid; gap: 6px; }
.blk-h { font-size: 10px; letter-spacing: .07em; text-transform: uppercase; color: var(--orca-muted-foreground); }
.blk-b { white-space: pre-wrap; }
.gist { background: var(--orca-background); border-radius: 6px; padding: 9px 11px; border-left: 3px solid var(--st-needs); white-space: pre-wrap; }
.waitbox { background: var(--orca-background); border-radius: 6px; padding: 9px 11px; border-left: 3px solid var(--st-waiting); white-space: pre-wrap; }
.tl { display: grid; }
.ev { display: grid; grid-template-columns: 74px 14px minmax(0, 1fr); gap: 8px; padding-bottom: 12px; }
.ev .when { font-family: var(--orca-font-mono, monospace); color: var(--orca-muted-foreground); font-size: 11px; }
.ev .rail { position: relative; }
.ev .rail::before { content: ""; position: absolute; left: 6px; top: 6px; bottom: -12px; width: 1px; background: var(--orca-border); }
.ev:last-child .rail::before { display: none; }
.ev .rail i { position: absolute; left: 2px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--orca-border); }
.ev.owner .rail i { background: var(--st-needs); }
.ev.status .rail i { background: transparent; border: 1px solid var(--orca-muted-foreground); }
.ev .what { min-width: 0; white-space: pre-wrap; word-break: break-word; }
.ev .who { color: var(--orca-muted-foreground); font-size: 11px; display: block; }
.ev.status .what { color: var(--orca-muted-foreground); }
.older { all: unset; cursor: pointer; color: var(--st-progress); font-size: 11px; margin: 0 0 10px 96px; }
.note { color: var(--orca-muted-foreground); font-size: 11px; }
.f-foot { border-top: 1px solid var(--orca-border); padding: 10px 14px 12px; background: var(--orca-card); display: grid; gap: 8px; max-height: 40vh; overflow-y: auto; }
.f-foot[hidden] { display: none !important; }
.q { font-weight: 500; }
.opts { display: flex; flex-wrap: wrap; gap: 6px; }
.opt { font-size: 11.5px; background: var(--orca-background); border: 1px solid var(--orca-border); border-radius: 5px; padding: 5px 10px; display: inline-flex; gap: 6px; align-items: baseline; }
.opt.rec { border-color: color-mix(in srgb, var(--st-needs) 70%, var(--orca-border)); }
.opt .tag { font-size: 9px; color: var(--st-needs); border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; }
.opt .detail { color: var(--orca-muted-foreground); font-size: 10.5px; }
.opt:disabled, .free:disabled, .send:disabled { opacity: .6; cursor: not-allowed; }
.footrow { display: flex; gap: 8px; align-items: center; }
.free { font-size: 11.5px; flex: 1; min-width: 0; background: var(--orca-background); border: 1px solid var(--orca-input); border-radius: 5px; padding: 6px 9px; color: inherit; font-family: inherit; }
.send { font-size: 11.5px; background: var(--st-needs); color: #1b1f1e; border: 0; border-radius: 5px; padding: 6px 14px; font-weight: 700; white-space: nowrap; cursor: pointer; }
.send:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.footnote { color: var(--orca-muted-foreground); font-size: 10.5px; }
.choices { margin: 0; padding-left: 1.2em; display: grid; gap: 3px; }
.choices li { line-height: 1.5; }
.choices .detail { color: var(--orca-muted-foreground); font-size: 10.5px; margin-left: 6px; }
.badge { font-size: 9.5px; color: var(--st-needs); border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; margin-left: 6px; }
.footbar { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.opt { cursor: pointer; }
.opt[aria-pressed="true"] { background: color-mix(in srgb, var(--st-needs) 24%, var(--orca-background)); }
.opt:focus-visible, .free:focus-visible { outline: 2px solid var(--orca-ring); }
.sent { color: var(--st-done); font-size: 11px; }
.notice { display: flex; gap: 10px; align-items: center; margin: 8px 14px 0; padding: 8px 12px; border-radius: 6px;
  background: color-mix(in srgb, var(--st-progress) 16%, var(--orca-card)); border: 1px solid color-mix(in srgb, var(--st-progress) 45%, var(--orca-border)); }
.notice[hidden] { display: none !important; }
.notice .txt { flex: 1; }
.stage { grid-template-rows: auto auto minmax(0, 1fr); }
/* Pinned rows: the notice is usually hidden, and the board must still take the last, flexible row. */
.stage > .toolbar { grid-row: 1; }
.stage > .banners { grid-row: 2; display: grid; }
.notice.err { background: color-mix(in srgb, var(--orca-destructive) 16%, var(--orca-card)); border-color: color-mix(in srgb, var(--orca-destructive) 55%, var(--orca-border)); }
.notice.warn { background: color-mix(in srgb, var(--st-needs) 14%, var(--orca-card)); border-color: color-mix(in srgb, var(--st-needs) 50%, var(--orca-border)); }
.stage > .work { grid-row: 3; }
.work { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 0; }
.req-list, .col-list, .f-body, .board { scrollbar-width: thin; scrollbar-color: var(--orca-border) transparent; }
.work > .board { min-height: 0; }
.requests { min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); border-right: 1px solid var(--orca-border); margin: 10px 0 14px 14px; }
.req-h { margin: 0 0 6px; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; color: var(--orca-muted-foreground); padding-right: 10px; }
.req-list { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; align-content: start; padding-right: 8px; }
.req, .req-pick, .req-pick > * { min-width: 0; }
.req-tools select { width: 100%; }
.req { border: 1px solid transparent; border-radius: 6px; }
.req.on { background: var(--orca-card); border-color: var(--orca-border); }
.req.needs { border-left: 3px solid var(--st-needs); }
.req-pick { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 3px; width: 100%; padding: 7px 8px; }
.req-pick:focus-visible { outline: 2px solid var(--orca-ring); border-radius: 6px; }
.req-name { font-weight: 600; display: flex; gap: 6px; align-items: baseline; }
.req-name .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-ask { color: var(--orca-muted-foreground); font-size: 10.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.req-ask .lbl { margin-right: 4px; text-transform: uppercase; letter-spacing: .05em; font-size: 9.5px; }
.req-sum { margin: 0; padding-left: 1.1em; color: var(--orca-muted-foreground); font-size: 11px; display: grid; gap: 1px; }
.req-sum li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-detail { color: var(--orca-muted-foreground); font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.req-note { color: var(--orca-muted-foreground); font-size: 10px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req-name .nm { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.req-count { color: var(--orca-muted-foreground); font-size: 11px; }
.req-count .ny { color: var(--st-needs); font-weight: 600; }
.req-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 0 8px 8px; }
.req-tools select, .req-tools input, .f-side select { font: inherit; font-size: 11px; color: inherit; background: var(--orca-background); border: 1px solid var(--orca-input); border-radius: 5px; padding: 2px 6px; max-width: 100%; }
@keyframes needs-flash { 0%, 55% { box-shadow: 0 0 0 2px var(--st-needs); background: color-mix(in srgb, var(--st-needs) 14%, var(--orca-card)); } 100% { box-shadow: 0 0 0 2px transparent; } }
.col.flash { animation: needs-flash 2.4s ease-out; }
.card.target { outline: 2px solid var(--st-needs); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .col.flash { animation: none; box-shadow: 0 0 0 2px var(--st-needs); } }
.req-arch { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: auto 1fr; gap: 0 6px; padding: 8px; margin-top: 6px; border-top: 1px solid var(--orca-border); color: var(--orca-muted-foreground); font-size: 11px; }
.req-arch:focus-visible { outline: 2px solid var(--orca-ring); border-radius: 6px; }
.req-arch .ttl { font-weight: 600; color: var(--orca-foreground); }
.req-arch .hint { grid-column: 2; font-size: 10.5px; }
.req.archived .req-name { color: var(--orca-muted-foreground); }
.req-search { display: grid; gap: 3px; margin: 0 10px 8px 0; }
.req-search input { font: inherit; font-size: 12px; color: var(--orca-foreground); background: var(--orca-background); border: 1px solid var(--orca-input); border-radius: 5px; padding: 4px 7px; min-width: 0; }
.req-search input:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: -1px; }
.req-hits { color: var(--orca-muted-foreground); font-size: 10.5px; }
.req-hits:empty { display: none; }
.req mark { background: color-mix(in srgb, var(--st-needs) 38%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
.req-hit { color: var(--orca-muted-foreground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.req.act { border-color: var(--orca-ring); }
.req-empty { display: grid; gap: 6px; justify-items: start; padding: 8px; color: var(--orca-muted-foreground); font-size: 11.5px; }
.req-tools input { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; padding: 4px 6px; color: var(--orca-foreground); }
.req-tools input::selection { background: color-mix(in srgb, var(--st-progress) 45%, transparent); color: var(--orca-foreground); }
`

const ICON = {
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18'
}

function stamp(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusWord(value: string | null | undefined): string {
  return value ? (STATUS_LABEL[value.replace(/-/g, '_') as ItemStatus] ?? value) : '—'
}

function linkWords(link: ItemLink): string {
  // PR, worker and checks read the same in both languages.
  if (link.pr) {
    const bits = [link.pr.state, link.pr.checks && `checks ${link.pr.checks}`, link.pr.review?.toLowerCase().replace(/_/g, ' ')]
    return `PR ${link.ref}${bits.some(Boolean) ? ` (${bits.filter(Boolean).join(', ')})` : ''}`
  }
  if (link.kind === 'dispatch') {
    return `worker${link.title ? `: ${link.title}` : ''}${link.state ? ` (${link.state})` : ''}`
  }
  return `${link.kind}: ${link.title ?? link.ref}`
}

export function eventWords(event: ItemEvent, t: Translate = translator('en')): { who: string; what: string } {
  const actor = event.actor.kind === 'owner' ? t('you') : event.actor.kind === 'bot' ? (event.actor.botName ?? 'bot') : '?'
  switch (event.kind) {
    case 'status': {
      const status = event.status
      const move = status ? `${statusWord(status.from)} → ${statusWord(status.to)}` : 'status'
      return { who: `${actor} · ${t('evStatus')}`, what: status?.note ? `${move}\n${status.note}` : move }
    }
    case 'made':
      return { who: `${actor} · ${t('evMade')}`, what: event.made?.title ?? '' }
    case 'linked':
      return { who: `${actor} · ${t('evLinked')}`, what: (event.links ?? []).map(linkWords).join('\n') }
    default: {
      let what = event.text ?? event.kind
      if (event.ask) {
        what = [
          event.ask.context,
          ...event.ask.decisions.map(
            (decision) =>
              `Q. ${decision.question}\n${decision.replies.map((reply) => `  - ${reply.label}${reply.recommended ? t('recommendedInline') : ''}`).join('\n')}`
          )
        ]
          .filter(Boolean)
          .join('\n\n')
      }
      if (event.images) {
        what += `\n${t('images', { n: event.images })}`
      }
      return { who: event.answers ? `${actor} · ${t('evAnswer')}` : actor, what }
    }
  }
}

/** An id inside a quoted attribute selector. */
function attr(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

/** Whether a fresh read of an item would draw the same box. */
function sameItem(a: BoardItem, b: BoardItem): boolean {
  const key = (item: BoardItem): string =>
    JSON.stringify([item.lastEventId, item.version, item.status, item.title, item.wait, item.links, item.question?.eventId])
  return key(a) === key(b)
}

export type BoardView = {
  update(snapshot: BoardSnapshot): void
  /** A whole-board failure, shown in the toolbar; the last good board stays. */
  fail(message: string): void
  /** Re-renders the "Updated N ago" label. */
  tick(): void
  open(number: number): void
  /** Request edits changed outside the board (Settings): replace them without saving back. */
  replaceEdits(edits: RequestEdits): void
  /** The status bar's and the panel's "show me": All selected, no box, the Needs you column
   *  highlighted and in view, its first card focused (Enter opens it). Returns how many it shows. */
  showNeedsYou(): number
  /** The archive setting changed. */
  setArchiveAfterDays(days: number): void
  close(): void
  step(direction: -1 | 1): void
  readonly openNumber: number | null
  dispose(): void
}

export function mountBoardView(doc: Document, deps: BoardViewDeps): BoardView {
  const now = deps.now ?? (() => Date.now())
  const translate = translator(langOf(deps.locale))
  // Words can carry error messages and names: ids in them are hidden too.
  const t: Translate = (key, vars) => hideIds(translate(key, vars))
  const relativeTime = (at: number, when: number): string => relative(t, at, when)
  doc.documentElement.lang = langOf(deps.locale)

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag)
    if (cls) {
      node.className = cls
    }
    if (text !== undefined) {
      // Never show ids the owner can't use (UUIDs, session ids), whatever the text came from.
      node.textContent = hideIds(text)
    }
    return node
  }
  const option = (label: string, value: string): HTMLOptionElement => {
    const node = doc.createElement('option')
    node.textContent = hideIds(label)
    node.value = value
    return node
  }
  const svgButton = (cls: string, path: string, label: string): HTMLButtonElement => {
    const button = el('button', cls)
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.title = label
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    const d = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
    d.setAttribute('d', path)
    svg.append(d)
    button.append(svg)
    return button
  }

  const style = el('style')
  style.textContent = STYLE
  doc.head.append(style)

  const stage = el('div', 'stage')
  const toolbar = el('div', 'toolbar')
  const summary = el('span')
  const toolbarRight = el('span', 'sp')
  const errorLine = el('span', 'err')
  const updated = el('span')
  toolbarRight.append(errorLine, updated)
  toolbar.append(summary, toolbarRight)
  const board = el('div', 'board')
  board.setAttribute('aria-label', 'Bot Items')
  /** The left list of requests; choosing one narrows the board to its items. */
  const requestsPane = el('nav', 'requests')
  requestsPane.setAttribute('aria-label', t('requests'))
  const requestList = el('div', 'req-list')
  requestList.id = 'req-list'
  requestList.setAttribute('role', 'listbox')
  requestList.setAttribute('aria-label', t('requests'))
  /** Narrows the list as you type (incremental); never saved. */
  const searchBox = el('div', 'req-search')
  const searchInput = el('input')
  searchInput.type = 'search'
  searchInput.placeholder = t('searchPlaceholder')
  searchInput.title = t('searchHint')
  searchInput.setAttribute('aria-label', t('searchPlaceholder'))
  searchInput.setAttribute('role', 'combobox')
  searchInput.setAttribute('aria-controls', 'req-list')
  searchInput.setAttribute('aria-expanded', 'true')
  searchInput.setAttribute('aria-autocomplete', 'list')
  searchInput.autocomplete = 'off'
  searchInput.spellcheck = false
  const searchCount = el('span', 'req-hits')
  searchCount.setAttribute('aria-live', 'polite')
  searchBox.append(searchInput, searchCount)
  requestsPane.append(el('h2', 'req-h', t('requests')), searchBox, requestList)
  const work = el('div', 'work')
  work.append(requestsPane, board)

  const scrim = el('div', 'scrim')
  scrim.hidden = true
  const float = el('div', 'float')
  float.setAttribute('role', 'dialog')
  float.setAttribute('aria-modal', 'true')
  float.setAttribute('aria-labelledby', 'f-title')
  const head = el('div', 'f-head')
  const top = el('div', 'f-top')
  const fBot = el('span', 'botchip')
  const fNum = el('span')
  const fStatus = el('span', 'st')
  const fUpdated = el('span')
  const controls = el('span', 'sp')
  const prev = svgButton('ibtn', ICON.prev, t('previous'))
  const next = svgButton('ibtn', ICON.next, t('next'))
  const closeButton = svgButton('ibtn', ICON.close, t('close'))
  controls.append(prev, next, el('span', 'esc', 'Esc'), closeButton)
  top.append(fBot, fNum, fStatus, fUpdated, controls)
  const fTitle = el('h1', 'f-title')
  fTitle.id = 'f-title'
  head.append(top, fTitle)
  const body = el('div', 'f-body')
  const main = el('div', 'f-main')
  const side = el('dl', 'f-side')
  body.append(main, side)
  const foot = el('div', 'f-foot')
  foot.hidden = true
  float.append(head, body, foot)
  scrim.append(float)
  /** What to do next after "Answer in Orca ↗": stays until dismissed or the next one. */
  const notice = el('div', 'notice guide')
  notice.hidden = true
  notice.setAttribute('role', 'status')
  const noticeText = el('span', 'txt')
  const noticeClose = el('button', 'tbtn', '×')
  noticeClose.type = 'button'
  noticeClose.setAttribute('aria-label', t('dismiss'))
  noticeClose.addEventListener('click', () => {
    notice.hidden = true
  })
  notice.append(noticeText, noticeClose)
  /** Saving request edits went wrong, or is close to Orca's limit: what happened and what to do. */
  const problem = el('div', 'notice err')
  problem.hidden = true
  problem.setAttribute('role', 'alert')
  const problemText = el('span', 'txt')
  const problemClose = el('button', 'tbtn', '×')
  problemClose.type = 'button'
  problemClose.setAttribute('aria-label', t('dismiss'))
  problemClose.addEventListener('click', () => {
    problem.hidden = true
  })
  problem.append(problemText, problemClose)
  const banners = el('div', 'banners')
  banners.append(problem, notice)
  stage.append(toolbar, banners, work, scrim)
  doc.body.append(stage)

  let snapshot: BoardSnapshot | null = null
  let current: BoardItem | null = null
  /** The card that opened the box: focus goes back to the current item's card, or this one. */
  let opener: HTMLElement | null = null
  const showAll = new Set<ItemStatus>()
  const detailOf = new Map<number, { lastEventId: string | null; value: ItemDetail }>()
  const olderShown = new Set<number>()
  let detailError: string | null = null
  /** Answer-in-place drafts per item: picked replies per decision, and the free text. */
  const drafts = new Map<number, { picks: Map<number, Set<number>>; text: string; sent: boolean }>()
  const answerInPlace = (): boolean => !!deps.answer && (snapshot?.answer.available === true || deps.answerPreview === true)
  let detailToken = 0
  let edits: RequestEdits = deps.edits ?? NO_EDITS
  let selected: string = deps.selectedRequest || ALL
  let requests: Request[] = []
  /** What the list shows of the requests, as text: a fresh read redraws the list only when it changed. */
  let listKey = ''
  /** The request whose name is being edited, if any. */
  let renaming: string | null = null
  let archiveDays = deps.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS
  /** The Archived section is open. */
  let showArchived = deps.showArchived === true
  /** The Needs you column glows until then (set by showNeedsYou). */
  let flashUntil = 0
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  /** The selection the list last scrolled to. */
  let scrolledTo: string | null = null
  /** The search: what's typed, and its words (folded). Empty words: the whole list. */
  let query = ''
  let terms: string[] = []
  /** Typing through an IME: the list waits for the text to be committed. */
  let composing = false
  /** The row ↑ ↓ point at from the search field (Enter chooses it). */
  let activeReq: string | null = null
  /** The search's view of each request, made once per list (a read or an edit), not per key. */
  let searchIndex: { key: string; entries: Map<string, SearchEntry> } | null = null

  function archivedIds(): Set<string> {
    return new Set(requests.filter((request) => request.archived).map((request) => request.id))
  }

  function columns(): Column[] {
    // Not started first, closed last. Planned is left out while no bot has a planned Item.
    const cols: Column[] = []
    if (snapshot && snapshot.counts.planned > 0) {
      cols.push({ status: 'planned', label: STATUS_LABEL.planned, color: STATUS_COLOR.planned })
    }
    cols.push(
      { status: 'needs_you', label: STATUS_LABEL.needs_you, color: STATUS_COLOR.needs_you },
      { status: 'in_progress', label: STATUS_LABEL.in_progress, color: STATUS_COLOR.in_progress },
      { status: 'waiting', label: STATUS_LABEL.waiting, color: STATUS_COLOR.waiting },
      { status: 'done', label: STATUS_LABEL.done, color: STATUS_COLOR.done, recent: RECENT_CLOSED },
      { status: 'canceled', label: STATUS_LABEL.canceled, color: STATUS_COLOR.canceled, recent: RECENT_CLOSED }
    )
    return cols
  }

  /** The items the selected request holds (all of them for "All"). */
  function visibleItems(): BoardItem[] {
    if (!snapshot) {
      return []
    }
    if (selected === ALL) {
      // All leaves out archived requests' items; choosing an archived request shows them.
      const archived = archivedIds()
      return archived.size ? snapshot.items.filter((item) => !archived.has(requestOf(edits, item))) : snapshot.items
    }
    return snapshot.items.filter((item) => requestOf(edits, item) === selected)
  }

  function itemsIn(status: ItemStatus): BoardItem[] {
    return visibleItems().filter((item) => item.status === status)
  }

  function requestWords() {
    return { home: t('homeChat'), more: (n: number) => t('moreItems', { n }) }
  }

  /** A read where a bot's items could not be fetched: its items are missing, not gone. */
  function partial(): boolean {
    return !snapshot || snapshot.errors.length > 0 || snapshot.bots.some((bot) => bot.error)
  }

  function computeRequests(): void {
    requests = snapshot
      ? buildRequests(snapshot.items, snapshot.chats ?? [], edits, requestWords(), { now: now(), afterDays: archiveDays })
      : []
    listKey = JSON.stringify(
      requests.map((r) => [r.id, r.name, r.items.length, r.needsYou, r.lastAsk, r.bots.map((b) => b.name), r.renamed, r.custom, r.archived])
    )
    // A merged-away or emptied request falls back to where it went, or to All (not after a partial
    // read, where its items may only be missing for now).
    if (selected !== ALL) {
      const resolved = resolveRequest(edits, selected)
      selected = requests.some((request) => request.id === resolved) ? resolved : partial() ? selected : ALL
    }
    // A selected archived request keeps its section open.
    if (requests.some((request) => request.id === selected && request.archived)) {
      showArchived = true
    }
  }

  function showProblem(kind: 'err' | 'warn', text: string): void {
    problem.className = `notice ${kind}`
    problem.setAttribute('role', kind === 'err' ? 'alert' : 'status')
    problemText.textContent = hideIds(text)
    problem.hidden = false
  }

  function setEdits(next: RequestEdits): void {
    const candidate = partial() ? next : pruneEdits(next, snapshot!.items)
    const size = editsSize(candidate)
    const limits = deps.editsLimits ?? { max: EDITS_MAX, warn: EDITS_WARN }
    if (size > limits.max) {
      // Orca would refuse to save it: keep the last edits that fit, and say why.
      showProblem('err', t('editsTooBig', { max: limits.max.toLocaleString() }))
      renaming = null
      redraw()
      return
    }
    edits = candidate
    const saving = deps.onEditsChange?.(edits)
    redraw()
    const afterSave = (): void => {
      if (size > limits.warn) {
        showProblem('warn', t('editsNearlyFull', { used: size.toLocaleString(), max: limits.max.toLocaleString() }))
      } else if (!problem.hidden) {
        problem.hidden = true
      }
    }
    if (saving && typeof (saving as Promise<unknown>).then === 'function') {
      ;(saving as Promise<unknown>).then(afterSave, (error: unknown) => {
        showProblem('err', t('editsSaveFailed', { error: error instanceof Error ? error.message : String(error) }))
      })
    } else {
      afterSave()
    }
  }

  /** On the first full read: an older or untidy save is rewritten in the compact form. */
  let tidied = deps.savedText === undefined
  function tidySavedEdits(): void {
    if (tidied || partial()) {
      return
    }
    tidied = true
    const tidy = pruneEdits(edits, snapshot!.items)
    if (serializeEdits(tidy) !== (deps.savedText ?? '')) {
      setEdits(tidy)
    }
  }

  function select(id: string): void {
    selected = id
    renaming = null
    deps.onSelectRequest?.(id)
    redraw()
    requestList.querySelector<HTMLElement>(`.req[data-req="${attr(id)}"] .req-pick`)?.focus()
  }

  /** Redraws everything that depends on requests: the list, the board and an open box. */
  function redraw(): void {
    computeRequests()
    renderToolbar()
    renderRequests()
    renderBoard()
    if (current && !scrim.hidden) {
      renderBox(current, false)
    }
  }

  let requestsKey = ''
  /** Re-renders the list when what it shows changed, never under the owner's typing or open menu. */
  function refreshRequests(): void {
    const active = doc.activeElement as HTMLElement | null
    if (renaming || active?.closest?.('.req-tools')) {
      return
    }
    const key = JSON.stringify([
      query,
      selected,
      snapshot?.items.length ?? 0,
      snapshot?.counts.needs_you ?? 0,
      showArchived,
      listKey
    ])
    if (key !== requestsKey) {
      renderRequests()
    }
  }

  /** Rows of the list not drawn yet: they are drawn as the list scrolls near its end (or ↑ ↓ reach
   *  them), so a keystroke in the search draws only what can be seen (ADR 0015). */
  let pendingRows: Array<{ id: string | null; make: () => HTMLElement }> = []

  /** Draws the next rows, at least up to `upTo` of the pending ones. */
  function drawMoreRows(upTo = 0): void {
    if (pendingRows.length === 0) {
      return
    }
    const take = pendingRows.splice(0, Math.max(ROW_CHUNK, upTo))
    requestList.append(...take.map((row) => row.make()))
  }

  requestList.addEventListener('scroll', () => {
    if (pendingRows.length && requestList.scrollTop + requestList.clientHeight >= requestList.scrollHeight - 400) {
      drawMoreRows()
      markActive(false)
    }
  })

  function renderRequests(): void {
    const focusedReq = ((doc.activeElement as HTMLElement | null)?.closest?.('.req') as HTMLElement | null)?.dataset.req
    const archFocused = (doc.activeElement as HTMLElement | null)?.classList?.contains('req-arch') === true
    const active = requests.filter((request) => !request.archived)
    const archived = requests.filter((request) => request.archived)
    const total = active.reduce((n, request) => n + request.items.length, 0)
    const totalNeeds = active.reduce((n, request) => n + request.needsYou, 0)
    // Searching: only the requests holding every word; archived ones too, in an opened Archived.
    const searching = terms.length > 0
    const hits = searching ? searchHits() : null
    const activeShown = hits ? active.filter((request) => hits.has(request.id)) : active
    const archivedShown = hits ? archived.filter((request) => hits.has(request.id)) : archived
    const archivedOpen = showArchived || (searching && archivedShown.length > 0)
    searchCount.textContent = hits ? t('searchCount', { n: hits.size, m: requests.length }) : ''
    const rows: Array<{ id: string | null; make: () => HTMLElement }> = [
      {
        id: ALL,
        make: () =>
          requestRow({
            id: ALL,
            name: t('allRequests'),
            items: total,
            needsYou: totalNeeds,
            // Say how All is counted: archived requests are left out.
            ...(archived.length ? { note: t('allNote', { n: archived.length }) } : {})
          })
      }
    ]
    for (const request of activeShown) {
      rows.push({
        id: request.id,
        make: () =>
          requestRow({ id: request.id, name: request.name, items: request.items.length, needsYou: request.needsYou, request, hit: hits?.get(request.id) })
      })
    }
    if (hits && hits.size === 0) {
      rows.push({
        id: null,
        make: () => {
          const empty = el('div', 'req-empty')
          const clear = el('button', 'tbtn', t('clearSearch'))
          clear.type = 'button'
          clear.addEventListener('click', () => {
            clearSearch()
            searchInput.focus()
          })
          empty.append(el('span', undefined, t('noMatch')), clear)
          return empty
        }
      })
    }
    if (archivedShown.length) {
      const items = archived.reduce((n, request) => n + request.items.length, 0)
      rows.push({
        id: ARCH_HEAD,
        make: () => {
          const head = el('button', 'req-arch')
          head.type = 'button'
          head.setAttribute('aria-expanded', archivedOpen ? 'true' : 'false')
          head.append(
            el('span', 'arr', archivedOpen ? '▾' : '▸'),
            el('span', 'ttl', t('archivedHeading', { n: archivedShown.length })),
            el('span', 'hint', t('archivedHint', { days: archiveDays, items }))
          )
          head.addEventListener('click', () => {
            showArchived = !showArchived
            renderRequests()
            const again = requestList.querySelector<HTMLElement>('.req-arch')
            again?.focus()
            // Opened: bring the section into view, it sits below every listed request.
            if (showArchived) {
              again?.scrollIntoView?.({ block: 'start' })
            }
          })
          return head
        }
      })
      if (archivedOpen) {
        for (const request of archivedShown) {
          rows.push({
            id: request.id,
            make: () =>
              requestRow({
                id: request.id,
                name: request.name,
                items: request.items.length,
                needsYou: 0,
                request,
                hit: hits?.get(request.id),
                note: t('archivedRowNote', { when: relativeTime(request.lastClosedAt ?? 0, now()) })
              })
          })
        }
      }
    }
    // Draw a first screenful, and far enough to hold what must be there now: the selection, the
    // focused row, the row ↑ ↓ point at, a name being edited, an Archived section opened at start.
    const must = [selected, focusedReq, activeReq, renaming, archFocused || (deps.showArchived && showArchived) ? ARCH_HEAD : null]
    const upTo = Math.max(ROW_CHUNK, ...must.map((id) => (id ? rows.findIndex((row) => row.id === id) + 1 : 0)))
    pendingRows = rows.slice(upTo)
    requestList.replaceChildren(...rows.slice(0, upTo).map((row) => row.make()))
    markActive(false)
    // Keep the selected request in view when the selection (or the first draw) puts it out of sight.
    if (scrolledTo !== selected) {
      scrolledTo = selected
      const at = requestList.querySelector<HTMLElement>(`.req[data-req="${attr(selected)}"]`)
      if (at && selected !== ALL) {
        at.scrollIntoView?.({ block: 'nearest' })
      } else if (deps.showArchived && showArchived) {
        requestList.querySelector<HTMLElement>('.req-arch')?.scrollIntoView?.({ block: 'start' })
      }
    }
    requestsKey = JSON.stringify([
      query,
      selected,
      snapshot?.items.length ?? 0,
      snapshot?.counts.needs_you ?? 0,
      showArchived,
      listKey
    ])
    if (focusedReq && !renaming) {
      requestList.querySelector<HTMLElement>(`.req[data-req="${attr(focusedReq)}"] .req-pick`)?.focus()
    } else if (archFocused) {
      requestList.querySelector<HTMLElement>('.req-arch')?.focus()
    }
  }

  function requestRow(row: { id: string; name: string; items: number; needsYou: number; request?: Request; note?: string; hit?: SearchHit }): HTMLElement {
    const on = row.id === selected
    const wrap = el('div', `req${on ? ' on' : ''}${row.needsYou > 0 ? ' needs' : ''}${row.request?.archived ? ' archived' : ''}`)
    wrap.dataset.req = row.id
    if (renaming === row.id && row.request) {
      const tools = el('div', 'req-tools')
      const input = el('input')
      input.value = row.request.name
      input.setAttribute('aria-label', t('renameLabel'))
      const finish = (save: boolean): void => {
        if (renaming !== row.id) {
          return
        }
        renaming = null
        if (save) {
          setEdits(renameRequest(edits, row.id, input.value === row.request!.autoName ? '' : input.value))
        } else {
          redraw()
        }
        requestList.querySelector<HTMLElement>(`.req[data-req="${attr(row.id)}"] .req-pick`)?.focus()
      }
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(false)
        }
      })
      input.addEventListener('blur', () => finish(true))
      tools.append(input)
      wrap.append(tools)
      setTimeout(() => {
        input.focus()
        input.select()
      }, 0)
      return wrap
    }
    const pick = el('button', 'req-pick')
    pick.type = 'button'
    pick.id = `req-pick-${rowSeq++}`
    pick.setAttribute('aria-pressed', on ? 'true' : 'false')
    pick.setAttribute('role', 'option')
    const name = el('span', 'req-name')
    // Matches are marked in what the row shows; All is not a request and is never marked.
    name.append(row.request ? marked('span', 'nm', row.name) : el('span', 'nm', row.name))
    pick.append(name)
    if (row.request) {
      const request = row.request
      // Made from its items; the chat's own name and the bots are only a note.
      if (request.summary.length > 0) {
        const list = el('ul', 'req-sum')
        list.append(...request.summary.map((title) => marked('li', undefined, title)))
        pick.append(list)
      } else if (request.detail) {
        pick.append(el('span', 'req-detail', request.detail))
      }
      // A word found only in an item the row doesn't list: that item, on one line.
      if (row.hit?.extra) {
        pick.append(marked('span', 'req-hit', row.hit.extra))
      }
      if (request.lastAsk) {
        const ask = el('span', 'req-ask')
        ask.append(el('span', 'lbl', t('lastAsk')), marked('span', undefined, request.lastAsk))
        pick.append(ask)
      }
      const note = noteOf(request)
      if (note.length > 0) {
        pick.append(marked('span', 'req-note', note.join(' · ')))
      }
    }
    const count = el('span', 'req-count', t('itemCount', { n: row.items }))
    if (row.needsYou > 0) {
      count.append(' · ', el('span', 'ny', t('needsYouCount', { n: row.needsYou })))
    }
    pick.append(count)
    if (row.note) {
      pick.append(el('span', 'req-note', row.note))
    }
    pick.addEventListener('click', () => select(row.id))
    wrap.append(pick)
    // The selected request's tools: rename, merge into another, undo its edits.
    if (on && row.request) {
      const request = row.request
      const tools = el('div', 'req-tools')
      const rename = el('button', 'tbtn', t('rename'))
      rename.type = 'button'
      rename.addEventListener('click', () => {
        renaming = request.id
        renderRequests()
      })
      tools.append(rename)
      const others = requests.filter((other) => other.id !== request.id)
      if (others.length > 0) {
        const merge = el('select')
        merge.setAttribute('aria-label', t('mergeInto'))
        merge.append(option(t('mergeInto'), ''))
        for (const other of others) {
          merge.append(option(other.name, other.id))
        }
        merge.addEventListener('change', () => {
          if (merge.value) {
            const into = merge.value
            const next = mergeRequests(edits, request.id, into)
            selected = resolveRequest(next, into)
            deps.onSelectRequest?.(selected)
            setEdits(next)
          }
        })
        tools.append(merge)
      }
      const edited =
        request.renamed || request.custom || Object.keys(edits.merges).some((from) => edits.merges[from] === request.id) || request.id in edits.merges
      if (edited) {
        const reset = el('button', 'tbtn', t('resetRequest'))
        reset.type = 'button'
        reset.addEventListener('click', () => setEdits(resetRequest(edits, request.id)))
        tools.append(reset)
      }
      wrap.append(tools)
    }
    return wrap
  }

  let rowSeq = 0

  /** The chats' names and the bots, as the row's small note shows them. */
  function noteOf(request: Request): string[] {
    return [...request.chatNames, ...request.bots.map((bot) => bot.name).filter((name) => !request.chatNames.includes(name))]
  }

  /** An element holding `text` with the search's matches marked. */
  function marked<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string | undefined, text: string): HTMLElementTagNameMap[K] {
    const node = el(tag, cls)
    const shown = hideIds(text)
    const ranges = matchRanges(shown, terms)
    if (ranges.length === 0) {
      node.textContent = shown
      return node
    }
    let at = 0
    for (const [start, end] of ranges) {
      if (start > at) {
        node.append(shown.slice(at, start))
      }
      node.append(el('mark', undefined, shown.slice(start, end)))
      at = end
    }
    if (at < shown.length) {
      node.append(shown.slice(at))
    }
    return node
  }

  /** The search's view of the requests, rebuilt only when the list itself changed. */
  function searchEntries(): Map<string, SearchEntry> {
    // Rebuilt only when what it reads changed: the items (signature), the requests or the edits.
    const key = `${snapshot?.signature ?? ''}\u0000${listKey}\u0000${serializeEdits(edits)}`
    if (searchIndex && searchIndex.key === key) {
      return searchIndex.entries
    }
    const byUid = new Map((snapshot?.items ?? []).map((item) => [item.uid, item]))
    const entries = new Map<string, SearchEntry>()
    for (const request of requests) {
      const items = request.items.flatMap((uid) => {
        const item = byUid.get(uid)
        return item ? [{ number: item.number, title: hideIds(item.title) }] : []
      })
      const shown = [request.name, ...request.summary, ...(request.lastAsk ? [request.lastAsk] : []), noteOf(request).join(' · ')].map(hideIds)
      entries.set(request.id, searchEntry({ id: request.id, shown, items }))
    }
    searchIndex = { key, entries }
    return entries
  }

  /** The requests holding every word of the search, and what each row adds to show why. */
  function searchHits(): Map<string, SearchHit> {
    const hits = new Map<string, SearchHit>()
    for (const entry of searchEntries().values()) {
      const hit = matchEntry(entry, terms)
      if (hit) {
        hits.set(entry.id, hit)
      }
    }
    return hits
  }

  function setQuery(value: string): void {
    if (value === query) {
      return
    }
    query = value
    terms = queryTerms(value)
    activeReq = null
    renderRequests()
    requestList.scrollTop = 0
  }

  function clearSearch(): void {
    searchInput.value = ''
    setQuery('')
  }

  /** The rows ↑ ↓ move through, in the list's order. */
  function pickRows(): HTMLElement[] {
    return Array.from(requestList.querySelectorAll<HTMLElement>('.req[data-req]')).filter((row) => !!row.querySelector('.req-pick'))
  }

  /** Marks the row ↑ ↓ point at: kept while it is shown; while searching, the first match. */
  function markActive(scroll: boolean): void {
    const rows = pickRows()
    let row = activeReq ? rows.find((candidate) => candidate.dataset.req === activeReq) : undefined
    if (!row) {
      row = terms.length > 0 ? rows.find((candidate) => candidate.dataset.req !== ALL) : undefined
      activeReq = row?.dataset.req ?? null
    }
    for (const candidate of rows) {
      candidate.classList.toggle('act', candidate === row)
    }
    const pick = row?.querySelector<HTMLElement>('.req-pick')
    if (pick) {
      searchInput.setAttribute('aria-activedescendant', pick.id)
      if (scroll) {
        row!.scrollIntoView?.({ block: 'nearest' })
      }
    } else {
      searchInput.removeAttribute('aria-activedescendant')
    }
  }

  function moveActive(direction: -1 | 1): void {
    if (direction > 0 && pendingRows.length && pickRows().at(-1)?.dataset.req === activeReq) {
      drawMoreRows()
    }
    const rows = pickRows()
    if (rows.length === 0) {
      return
    }
    const at = rows.findIndex((row) => row.dataset.req === activeReq)
    const next = at < 0 ? (direction > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + direction))
    activeReq = rows[next]!.dataset.req ?? null
    markActive(true)
  }

  // The search's view is made ahead, when the field gets focus or the board is idle after a change,
  // so the first key doesn't wait for it.
  searchInput.addEventListener('focus', () => {
    searchEntries()
  })
  let indexTimer: ReturnType<typeof setTimeout> | undefined
  function prepareSearchSoon(): void {
    clearTimeout(indexTimer)
    indexTimer = setTimeout(() => {
      if (snapshot) {
        searchEntries()
      }
    }, 200)
  }
  searchInput.addEventListener('compositionstart', () => {
    composing = true
  })
  searchInput.addEventListener('compositionend', () => {
    composing = false
    setQuery(searchInput.value)
  })
  searchInput.addEventListener('input', (event) => {
    // Mid-conversion text is not what the owner means yet: wait for compositionend.
    if (composing || (event as InputEvent).isComposing) {
      return
    }
    setQuery(searchInput.value)
  })
  searchInput.addEventListener('keydown', (event) => {
    if (composing || event.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter') {
      if (activeReq) {
        event.preventDefault()
        // Chosen from the field: the focus stays there to go on searching.
        const id = activeReq
        selected = id
        renaming = null
        deps.onSelectRequest?.(id)
        redraw()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (searchInput.value) {
        clearSearch()
      } else {
        searchInput.blur()
        requestList.querySelector<HTMLElement>(`.req[data-req="${attr(selected)}"] .req-pick`)?.focus()
      }
    }
  })
  /** `/` anywhere on the board (not while typing, not with the box open) goes to the search. */
  const onSlash = (event: KeyboardEvent): void => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || !scrim.hidden) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return
    }
    event.preventDefault()
    searchInput.focus()
    searchInput.select()
  }
  doc.addEventListener('keydown', onSlash)

  function cardOf(number: number): HTMLElement | null {
    return board.querySelector<HTMLElement>(`.card[data-n="${number}"]`)
  }

  function renderCard(item: BoardItem): HTMLButtonElement {
    const card = el('button', item.status === 'needs_you' ? 'card needs' : 'card')
    card.type = 'button'
    card.dataset.n = String(item.number)
    card.setAttribute('aria-haspopup', 'dialog')
    const meta = el('span', 'm')
    meta.append(el('span', 'botchip', item.bot.name), el('span', undefined, `#${item.number} · ${relativeTime(item.lastActivityAt, now())}`))
    card.append(meta, el('span', 't', item.title))
    if (item.status === 'waiting' && item.wait?.text) {
      card.append(el('span', 'w', item.wait.text))
    }
    if (item.status === 'needs_you' && item.question) {
      const count = item.question.decisions.length
      const choices = item.question.decisions.some((decision) => decision.replies.length > 0)
      card.append(el('span', 'askhint', `${t('questions', { n: Math.max(count, 1) })}${choices ? t('withReplies') : ''}`))
    }
    card.addEventListener('click', () => {
      opener = card
      open(item.number)
    })
    return card
  }

  function renderBoard(): void {
    // Keep focus on the same card across a redraw.
    const focused = (doc.activeElement as HTMLElement | null)?.closest?.('.card') as HTMLElement | null
    const focusedNumber = focused?.dataset.n
    const scrolls = new Map<string, number>()
    board.querySelectorAll<HTMLElement>('.col').forEach((col) => {
      scrolls.set(col.dataset.status ?? '', col.querySelector<HTMLElement>('.col-list')?.scrollTop ?? 0)
    })
    board.replaceChildren(
      ...columns().map((column) => {
        const items = itemsIn(column.status)
        const col = el('section', column.status === 'needs_you' && Date.now() < flashUntil ? 'col flash' : 'col')
        col.dataset.status = column.status
        const heading = el('h2', 'col-h')
        const swatch = el('span', 'sw')
        swatch.style.background = column.color
        heading.append(swatch, el('span', undefined, column.label), el('span', 'n', String(items.length)))
        const list = el('div', 'col-list')
        const shown = column.recent && !showAll.has(column.status) ? items.slice(0, column.recent) : items
        if (items.length === 0) {
          list.append(el('div', 'empty', t('none')))
        }
        list.append(...shown.map(renderCard))
        if (shown.length < items.length) {
          const more = el('button', 'more', t('more', { n: items.length - shown.length }))
          more.type = 'button'
          more.addEventListener('click', () => {
            showAll.add(column.status)
            renderBoard()
          })
          list.append(more)
        }
        col.append(heading, list)
        return col
      })
    )
    board.querySelectorAll<HTMLElement>('.col').forEach((col) => {
      const list = col.querySelector<HTMLElement>('.col-list')
      if (list) {
        list.scrollTop = scrolls.get(col.dataset.status ?? '') ?? 0
      }
    })
    if (focusedNumber && scrim.hidden) {
      cardOf(Number(focusedNumber))?.focus()
    }
  }

  function renderToolbar(): void {
    if (!snapshot) {
      summary.textContent = t('reading')
      return
    }
    const archived = requests.filter((request) => request.archived)
    const archivedItems = archived.reduce((n, request) => n + request.items.length, 0)
    summary.replaceChildren(
      el('span', 'needs', t('needsYouCount', { n: snapshot.counts.needs_you })),
      t('summary', { items: snapshot.items.length - archivedItems, bots: snapshot.bots.length }),
      ...(archived.length ? [t('summaryArchived', { n: archived.length })] : [])
    )
    const failed = snapshot.bots.filter((bot) => bot.error).map((bot) => `${bot.name}: ${bot.error}`)
    if (!errorLine.dataset.fail) {
      errorLine.textContent = hideIds([...snapshot.errors, ...failed].join(' / '))
    }
    updated.textContent = t('updated', { when: relativeTime(snapshot.fetchedAt, now()) })
  }

  function block(title: string, node: Node): HTMLElement {
    const wrap = el('div', 'blk')
    wrap.append(el('div', 'blk-h', title), node)
    return wrap
  }

  function sideRow(term: string, value: string | Node): void {
    const dd = el('dd')
    dd.append(typeof value === 'string' ? hideIds(value) : value)
    side.append(el('dt', undefined, term), dd)
  }

  function eventRow(event: ItemEvent): HTMLElement {
    const owner = event.actor.kind === 'owner'
    const row = el('div', `ev${owner ? ' owner' : ''}${event.kind === 'status' ? ' status' : ''}`)
    const words = eventWords(event, t)
    const rail = el('span', 'rail')
    rail.append(el('i'))
    const what = el('span', 'what')
    what.append(el('span', 'who', words.who), hideIds(words.what))
    row.append(el('span', 'when', stamp(event.at)), rail, what)
    return row
  }

  function renderTimeline(item: BoardItem): HTMLElement {
    const timeline = el('div', 'tl')
    const cached = detailOf.get(item.number)
    if (!cached) {
      timeline.append(el('div', 'note', detailError ?? t('historyLoading')))
      return timeline
    }
    const events = cached.value.events
    const hidden = olderShown.has(item.number) ? 0 : Math.max(0, events.length - RECENT_EVENTS)
    if (hidden > 0) {
      const older = el('button', 'older', t('olderEvents', { n: hidden }))
      older.type = 'button'
      older.addEventListener('click', () => {
        olderShown.add(item.number)
        const replaced = renderTimeline(item)
        timeline.replaceWith(replaced)
        replaced.querySelector<HTMLElement>('.ev')?.setAttribute('tabindex', '-1')
        replaced.querySelector<HTMLElement>('.ev')?.focus()
      })
      timeline.append(older)
    }
    timeline.append(...events.slice(hidden).map(eventRow))
    return timeline
  }

  function renderFoot(item: BoardItem): void {
    foot.replaceChildren()
    if (item.status !== 'needs_you') {
      foot.hidden = true
      return
    }
    foot.hidden = false
    if (answerInPlace()) {
      renderAnswerInPlace(item)
    } else {
      renderAnswerInOrca(item)
    }
  }

  /** Until Orca lets a plugin answer as the owner: the questions and their replies to read, and one
   *  button that takes the owner to the bot's own screen. */
  function renderAnswerInOrca(item: BoardItem): void {
    for (const decision of item.question?.decisions ?? []) {
      foot.append(el('div', 'q', decision.question))
      const list = el('ul', 'choices')
      for (const reply of decision.replies) {
        const li = el('li', undefined, reply.label)
        if (reply.detail) {
          li.append(el('span', 'detail', reply.detail))
        }
        if (reply.recommended) {
          li.append(el('span', 'badge', t('recommended')))
        }
        list.append(li)
      }
      foot.append(list)
    }
    const bar = el('div', 'footbar')
    bar.append(el('div', 'footnote', t('answerHere')))
    if (deps.openBot) {
      const go = el('button', 'send go', t('goAnswer'))
      go.type = 'button'
      go.title = t('goAnswerTitle', { bot: item.bot.name })
      const result = el('div', 'footnote')
      result.setAttribute('role', 'status')
      go.addEventListener('click', () => {
        go.disabled = true
        result.textContent = t('opening', { bot: item.bot.name })
        deps.openBot!(item).then(
          ({ via }) => {
            // The bot's screen is where the answer happens now: close the box and say what to do there.
            close()
            noticeText.textContent =
              via === 'workspace'
                ? t('openedGuide', { bot: item.bot.name, n: item.number })
                : t('openedLink', { bot: item.bot.name, n: item.number })
            notice.hidden = false
          },
          (error: unknown) => {
            go.disabled = false
            result.textContent = t('openFailed', { error: error instanceof Error ? error.message : String(error) })
          }
        )
      })
      bar.append(go)
      foot.append(bar, result)
    } else {
      foot.append(bar)
    }
  }

  /** The answer-in-place UI, kept for when Orca lets plugins answer (stablyai/orca#48010; see
   *  docs/answer-in-place.md): reply buttons per decision, free text, Send, 1–9 and ⌘/Ctrl+Enter. */
  function renderAnswerInPlace(item: BoardItem): void {
    const draft = drafts.get(item.number) ?? { picks: new Map<number, Set<number>>(), text: '', sent: false }
    drafts.set(item.number, draft)
    if (draft.sent) {
      foot.append(el('div', 'sent', t('sent', { bot: item.bot.name })))
      return
    }
    const decisions = item.question?.decisions ?? []
    let ordinal = 0
    for (const decision of decisions) {
      foot.append(el('div', 'q', decision.question))
      const options = el('div', 'opts')
      for (const reply of decision.replies) {
        ordinal += 1
        const picked = draft.picks.get(decision.index)?.has(reply.index) ?? false
        const option = el('button', reply.recommended ? 'opt rec' : 'opt')
        option.type = 'button'
        option.dataset.ordinal = String(ordinal)
        option.setAttribute('aria-pressed', picked ? 'true' : 'false')
        option.append(el('span', undefined, `${ordinal}. ${reply.label}`))
        if (reply.detail) {
          option.append(el('span', 'detail', reply.detail))
        }
        if (reply.recommended) {
          option.append(el('span', 'tag', t('recommended')))
        }
        option.addEventListener('click', () => {
          const set = draft.picks.get(decision.index) ?? new Set<number>()
          if (set.has(reply.index)) {
            set.delete(reply.index)
          } else {
            if (!decision.multi) {
              set.clear()
            }
            set.add(reply.index)
          }
          draft.picks.set(decision.index, set)
          renderFoot(item)
          foot.querySelector<HTMLElement>(`.opt[data-ordinal="${option.dataset.ordinal}"]`)?.focus()
        })
        options.append(option)
      }
      foot.append(options)
    }
    const row = el('div', 'footrow')
    const free = el('input', 'free')
    free.setAttribute('aria-label', t('freeLabel'))
    free.placeholder = t('freePlaceholder')
    free.value = draft.text
    const send = el('button', 'send', t('send'))
    send.type = 'button'
    const ready = (): boolean => draft.text.trim() !== '' || [...draft.picks.values()].some((set) => set.size > 0)
    send.disabled = !ready()
    free.addEventListener('input', () => {
      draft.text = free.value
      send.disabled = !ready()
    })
    const result = el('div', 'footnote')
    result.setAttribute('role', 'status')
    send.addEventListener('click', () => {
      if (!ready() || !deps.answer) {
        return
      }
      send.disabled = true
      deps
        .answer(item, {
          number: item.number,
          questionId: item.question?.eventId ?? null,
          picks: decisions
            .map((decision) => ({ decision: decision.index, replies: [...(draft.picks.get(decision.index) ?? [])] }))
            .filter((pick) => pick.replies.length > 0),
          text: draft.text.trim()
        })
        .then(
          () => {
            draft.sent = true
            renderFoot(item)
          },
          (error: unknown) => {
            send.disabled = false
            result.textContent = t('sendFailed', { error: error instanceof Error ? error.message : String(error) })
          }
        )
    })
    row.append(free, send)
    foot.append(row, result)
  }

  function renderBox(item: BoardItem, resetScroll: boolean): void {
    current = item
    fBot.textContent = item.bot.name
    fNum.textContent = `#${item.number}`
    fStatus.textContent = STATUS_LABEL[item.status]
    fStatus.style.background = STATUS_COLOR[item.status]
    fUpdated.textContent = t('updated', { when: relativeTime(item.lastActivityAt, now()) })
    fTitle.textContent = hideIds(item.title)

    main.replaceChildren()
    if (item.status === 'needs_you' && item.question) {
      main.append(block(t('questionSummary'), el('div', 'gist', item.question.gist || item.question.text)))
    }
    if (item.status === 'waiting' && item.wait?.text) {
      main.append(block(t('waitingOn'), el('div', 'waitbox', item.wait.text)))
    }
    if (item.description) {
      main.append(block(t('description'), el('div', 'blk-b', item.description)))
    }
    if (item.doneMeans) {
      main.append(block(t('doneMeans'), el('div', 'blk-b', item.doneMeans)))
    }
    if (item.closeNote) {
      main.append(block(item.status === 'canceled' ? t('cancelReason') : t('closeNote'), el('div', 'blk-b', item.closeNote)))
    }
    main.append(block(t('history'), renderTimeline(item)))

    side.replaceChildren()
    sideRow(t('status'), STATUS_LABEL[item.status])
    sideRow(t('bot'), item.madeBy ? t('madeBy', { bot: item.bot.name, maker: item.madeBy.name }) : item.bot.name)
    sideRow(t('chat'), item.chat ? item.chat.title || item.chat.kind : '—')
    const links = el('div')
    if (item.links.length === 0) {
      links.textContent = t('none')
    }
    for (const link of item.links) {
      const url = link.url
      const button = el('button', url && deps.openExternal ? 'linkbtn' : 'linkbtn plain', linkWords(link))
      button.type = 'button'
      if (url && deps.openExternal) {
        button.title = url
        button.addEventListener('click', () => deps.openExternal!(url))
      } else {
        button.disabled = true
      }
      links.append(button)
    }
    sideRow(t('links'), links)
    // Split: move the item to another request, or to a new one.
    const move = el('select')
    move.setAttribute('aria-label', t('moveTo'))
    const mine = requestOf(edits, item)
    for (const request of requests) {
      const entry = option(request.name, request.id)
      entry.selected = request.id === mine
      move.append(entry)
    }
    move.append(option(t('newRequest'), '__new__'))
    move.addEventListener('change', () => {
      const to = move.value === '__new__' ? newRequestId(edits, now()) : move.value
      setEdits(moveItem(edits, item, to, now()))
    })
    sideRow(t('request'), move)
    if (item.createdAt) {
      sideRow(t('created'), stamp(item.createdAt))
    }
    if (item.closedAt) {
      sideRow(item.status === 'canceled' ? t('closedCanceled') : t('closedDone'), stamp(item.closedAt))
    }

    renderFoot(item)
    if (resetScroll) {
      body.scrollTop = 0
    }
    const list = itemsIn(item.status)
    const at = list.findIndex((entry) => entry.number === item.number)
    prev.disabled = at <= 0
    next.disabled = at < 0 || at >= list.length - 1
  }

  async function loadDetail(item: BoardItem): Promise<void> {
    const cached = detailOf.get(item.number)
    if (cached && cached.lastEventId === item.lastEventId) {
      return
    }
    const token = ++detailToken
    detailError = null
    try {
      const value = await deps.detail(item.number)
      detailOf.set(item.number, { lastEventId: value.item.lastEventId, value })
    } catch (error) {
      if (token === detailToken) {
        detailError = t('historyFailed', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (token === detailToken && current?.number === item.number) {
      main.querySelector('.tl')?.replaceWith(renderTimeline(current))
    }
  }

  function open(number: number): void {
    const item = snapshot?.items.find((entry) => entry.number === number)
    if (!item) {
      return
    }
    const wasOpen = !scrim.hidden
    opener = opener ?? cardOf(number)
    renderBox(item, true)
    scrim.hidden = false
    if (!wasOpen) {
      closeButton.focus()
    }
    void loadDetail(item)
  }

  function close(): void {
    if (scrim.hidden) {
      return
    }
    scrim.hidden = true
    const target = (current && cardOf(current.number)) ?? opener
    current = null
    opener = null
    target?.focus()
  }

  function step(direction: -1 | 1): void {
    if (!current) {
      return
    }
    const list = itemsIn(current.status)
    const at = list.findIndex((entry) => entry.number === current!.number)
    const target = list[at + direction]
    if (at >= 0 && target) {
      const focusInBox = float.contains(doc.activeElement)
      renderBox(target, true)
      void loadDetail(target)
      // Keep focus inside the box; a press on a now-disabled arrow moves it to the other.
      if (focusInBox && (doc.activeElement === null || (doc.activeElement as HTMLButtonElement).disabled || !float.contains(doc.activeElement))) {
        ;(direction < 0 ? (prev.disabled ? next : prev) : next.disabled ? prev : next).focus()
      }
    }
  }

  function focusables(): HTMLElement[] {
    return Array.from(float.querySelectorAll<HTMLElement>('button, input, textarea, a[href], [tabindex="0"]')).filter(
      (node) => !(node as HTMLButtonElement).disabled && !node.closest('[hidden]')
    )
  }

  const onKey = (event: KeyboardEvent): void => {
    if (scrim.hidden) {
      return
    }
    const target = event.target as HTMLElement | null
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      const nodes = focusables()
      if (nodes.length === 0) {
        event.preventDefault()
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      const active = doc.activeElement as HTMLElement | null
      if (!active || !float.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && answerInPlace()) {
      event.preventDefault()
      foot.querySelector<HTMLButtonElement>('.send:not(.go)')?.click()
      return
    }
    if (typing) {
      return
    }
    if (/^[1-9]$/.test(event.key) && answerInPlace() && !foot.hidden) {
      const option = foot.querySelector<HTMLButtonElement>(`.opt[data-ordinal="${event.key}"]`)
      if (option) {
        event.preventDefault()
        option.click()
      }
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(1)
    }
  }

  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))
  closeButton.addEventListener('click', () => close())
  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) {
      close()
    }
  })
  doc.addEventListener('keydown', onKey)
  renderToolbar()

  return {
    update(next) {
      snapshot = next
      delete errorLine.dataset.fail
      computeRequests()
      prepareSearchSoon()
      renderToolbar()
      refreshRequests()
      renderBoard()
      tidySavedEdits()
      if (current && !scrim.hidden) {
        const fresh = next.items.find((item) => item.number === current!.number)
        if (fresh) {
          if (sameItem(fresh, current)) {
            // Unchanged: keep the box as it is (focus, drafts, scroll); only its time moves on.
            current = fresh
            fUpdated.textContent = t('updated', { when: relativeTime(fresh.lastActivityAt, now()) })
          } else {
            const changed = fresh.lastEventId !== current.lastEventId
            renderBox(fresh, false)
            if (changed) {
              void loadDetail(fresh)
            }
          }
        }
      }
    },
    fail(message) {
      errorLine.dataset.fail = '1'
      errorLine.textContent = hideIds(message)
      renderToolbar()
    },
    tick() {
      renderToolbar()
    },
    open(number) {
      opener = cardOf(number)
      open(number)
    },
    showNeedsYou() {
      if (!scrim.hidden) {
        close()
      }
      // Needs you can hide behind another request or Archived: back to All.
      if (selected !== ALL) {
        selected = ALL
        renaming = null
        deps.onSelectRequest?.(ALL)
      }
      // The list goes back to its top, where All is; Archived folds away.
      showArchived = false
      scrolledTo = ALL
      requestList.scrollTop = 0
      flashUntil = Date.now() + FLASH_MS
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        board.querySelector('.col[data-status="needs_you"]')?.classList.remove('flash')
      }, FLASH_MS)
      redraw()
      const col = board.querySelector<HTMLElement>('.col[data-status="needs_you"]')
      board.scrollLeft = 0
      const list = col?.querySelector<HTMLElement>('.col-list')
      if (list) {
        list.scrollTop = 0
      }
      const first = col?.querySelector<HTMLElement>('.card')
      if (first) {
        // Marked as well as focused: a press on the status bar doesn't draw a focus ring.
        first.classList.add('target')
        first.addEventListener('blur', () => first.classList.remove('target'), { once: true })
        first.focus()
        first.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      } else {
        col?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      }
      return col?.querySelectorAll('.card').length ?? 0
    },
    setArchiveAfterDays(days) {
      archiveDays = Math.max(0, Math.floor(days))
      redraw()
    },
    replaceEdits(next) {
      if (JSON.stringify(next) === JSON.stringify(edits)) {
        return
      }
      edits = next
      renaming = null
      redraw()
    },
    close,
    step,
    get openNumber() {
      return scrim.hidden ? null : (current?.number ?? null)
    },
    dispose() {
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('keydown', onSlash)
      clearTimeout(indexTimer)
      stage.remove()
      style.remove()

    }
  }
}
