// Made-up bots and Items for screenshots and demos: a `.itemsboard` file holding
// {"source":"demo"} draws these instead of this computer's real Items. No real names.
import { ANSWER_UNAVAILABLE } from '../src/board'
import type { BoardItem, BoardSnapshot, ChatInfo, ItemDetail, ItemEvent, ItemOrigin, ItemStatus } from '../src/protocol'

const MIN = 60_000
const BOTS = {
  docs: { id: 'demo-docs-writer', name: 'docs-writer' },
  release: { id: 'demo-release-bot', name: 'release-bot' },
  qa: { id: 'demo-qa-runner', name: 'qa-runner' },
  infra: { id: 'demo-infra-keeper', name: 'infra-keeper' }
}

/** Demo chats: Home chats, a docs chat, and one group room whose two member chats (one per bot)
 *  make a single request. Two last asks are mail from bots, which the board doesn't show as asks. */
const CHATS = {
  infraHome: { id: 'demo-infra-home', bot: 'infra', title: 'Home', home: true, ago: 4, asked: 'Find environments nobody uses any more and tell me what they cost.' },
  docsHome: { id: 'demo-docs-home', bot: 'docs', title: 'Home', home: true, ago: 300, asked: 'Fix the broken links people reported in the FAQ.' },
  docsGuide: { id: 'demo-docs-guide', bot: 'docs', title: 'Getting-started guide', home: false, ago: 26, asked: 'Refresh the getting-started guide for v2.3, with new screenshots.' },
  releaseRoom: { id: 'bot-group-member-demo-release-1', bot: 'release', title: 'Release v2.3', home: false, ago: 2, asked: 'Get v2.3 out this week: notes, smoke test, tag.' },
  qaRoom: { id: 'bot-group-member-demo-release-2', bot: 'qa', title: 'Release v2.3', home: false, ago: 9, asked: '──── From: release-bot (status) ──── Subject: Re: v2.3 release candidate is ready' },
  releaseHome: { id: 'demo-release-home', bot: 'release', title: 'Home', home: true, ago: 2_900, asked: 'Subject: Re: v2.2 notes — published' },
  qaHome: { id: 'demo-qa-home', bot: 'qa', title: 'Home', home: true, ago: 140, asked: 'The checkout test fails now and then. Find out why.' },
  // Finished weeks ago: these requests sit under Archived.
  docsOnboarding: { id: 'demo-docs-onboarding', bot: 'docs', title: 'Onboarding docs', home: false, ago: 20_000, asked: 'Write an onboarding checklist for new contributors.' },
  qaSearch: { id: 'demo-qa-search', bot: 'qa', title: 'Search load test', home: false, ago: 28_000, asked: 'Load test the search API before the launch.' }
} as const

/** When each demo item was made (minutes ago): the oldest one names its request. */
const CREATED: Record<number, number> = {
  41: 310,
  36: 250,
  34: 240,
  38: 400,
  37: 300,
  44: 200,
  40: 150,
  43: 120,
  33: 3_300,
  30: 3_150,
  31: 3_000,
  35: 180,
  20: 24_000,
  21: 23_000,
  22: 30_000
}

/** Which demo chat each item belongs to. */
const CHAT_OF: Record<number, keyof typeof CHATS> = {
  41: 'infraHome',
  36: 'infraHome',
  34: 'infraHome',
  38: 'docsGuide',
  37: 'docsGuide',
  33: 'docsHome',
  30: 'docsHome',
  44: 'releaseRoom',
  40: 'releaseRoom',
  43: 'qaRoom',
  31: 'releaseHome',
  35: 'qaHome',
  20: 'docsOnboarding',
  21: 'docsOnboarding',
  22: 'qaSearch'
}

function demoChats(now: number): ChatInfo[] {
  return Object.values(CHATS).map((chat) => ({
    id: chat.id,
    bot: BOTS[chat.bot],
    title: chat.title,
    home: chat.home,
    lastAsked: chat.asked,
    lastActivityAt: now - chat.ago * MIN
  }))
}

type Seed = Partial<BoardItem> & { number: number; title: string; status: ItemStatus; bot: BoardItem['bot']; ago: number }

function item(now: number, seed: Seed): BoardItem {
  const { ago, ...rest } = seed
  const at = now - ago * MIN
  return {
    uid: `demo-${seed.number}`,
    description: '',
    doneMeans: '',
    madeBy: null,
    origin: null,
    fromItem: null,
    links: [],
    wait: null,
    question: null,
    closeNote: null,
    snoozedUntil: null,
    createdAt: CREATED[seed.number] !== undefined ? now - CREATED[seed.number]! * MIN : at - 90 * MIN,
    updatedAt: at,
    lastActivityAt: at,
    closedAt: seed.status === 'done' || seed.status === 'canceled' ? at : null,
    version: 1,
    lastEventId: `e${seed.number}9`,
    othersLastEventId: `e${seed.number}9`,
    ...rest,
    chat: CHAT_OF[seed.number]
      ? {
          id: CHATS[CHAT_OF[seed.number]!].id,
          kind: CHATS[CHAT_OF[seed.number]!].home ? 'home' : 'chat',
          title: CHATS[CHAT_OF[seed.number]!].title
        }
      : (rest.chat ?? { id: 'demo-home', kind: 'home', title: 'Home' })
  }
}

/** `"origins": true`: the demo as Orca with item origins (stablyai/orca#48086) draws it. Made-up
 *  request keys and words, by item: infra-keeper's busy Home holds two requests and one item made
 *  before origins (#34); qa-runner's checkout request led to a docs-writer item (#45, a hand-off
 *  made from qa-runner's #35); the release room's post is one request for both member bots,
 *  qa-runner's item made on release-bot's peer request. Every item of a request carries its whole
 *  origin; `request` is only ever the owner's own words. */
function demoOrigins(now: number): Record<number, ItemOrigin> {
  const asked = (rootKey: string, kind: string, ago: number, request: string | null): ItemOrigin => ({ rootKey, kind, at: now - ago * MIN, request })
  const previews = asked('demo-infra-home:u1', 'owner', 320, 'Find environments nobody uses any more and tell me what they cost.')
  const password = asked('demo-infra-home:u2', 'owner', 100, 'Rotate the staging database password today and restart whatever uses it.')
  const checkout = asked('demo-qa-home:u1', 'owner', 190, 'The checkout test fails now and then. Find out why, and have the testing guide say how to avoid it.')
  const guide = asked('demo-docs-guide:u1', 'owner', 420, 'Refresh the getting-started guide for v2.3, with new screenshots.')
  const release = asked('demo-release-room:p1', 'group', 205, 'Get v2.3 out this week: notes, smoke test, tag.')
  return {
    41: previews,
    36: password,
    35: checkout,
    45: checkout,
    38: guide,
    37: guide,
    44: release,
    40: release,
    43: release
  }
}

function items(now: number, origins = false): BoardItem[] {
  const list = baseItems(now)
  if (!origins) {
    return list
  }
  const byNumber = demoOrigins(now)
  const handoff = item(now, {
    number: 45,
    bot: BOTS.docs,
    title: 'Say how to wait for mocks in the testing guide',
    status: 'planned',
    ago: 60,
    madeBy: BOTS.qa,
    fromItem: { uid: 'demo-35' },
    chat: { id: CHATS.docsHome.id, kind: 'home', title: 'Home' }
  })
  return [...list, handoff].map((entry) => ({ ...entry, origin: byNumber[entry.number] ?? null }))
}

function baseItems(now: number): BoardItem[] {
  return [
    item(now, {
      number: 41,
      bot: BOTS.infra,
      title: 'Delete stale preview environments?',
      status: 'needs_you',
      ago: 4,
      description: 'Preview environments are created for every pull request and kept until someone removes them. 14 of them have had no deploys for over 30 days.',
      doneMeans: 'The stale environments are deleted, or you decided to keep them',
      question: {
        eventId: 'e4120',
        gist: '14 preview environments have had no deploys for 30+ days and cost about $120 a month. Two of them are linked to open pull requests. Deleting is reversible: an environment comes back on the next push to its branch.',
        text: '',
        decisions: [
          {
            index: 0,
            question: 'Delete the 14 stale preview environments?',
            multi: false,
            replies: [
              { index: 0, label: 'Delete the 12 without open pull requests', recommended: true },
              { index: 1, label: 'Delete all 14', recommended: false },
              { index: 2, label: 'Keep them for now', recommended: false }
            ]
          },
          {
            index: 1,
            question: 'Clean up automatically from now on?',
            multi: false,
            replies: [
              { index: 0, label: 'Yes, after 30 days without deploys', detail: 'A weekly job', recommended: true },
              { index: 1, label: 'No, ask me each time', recommended: false }
            ]
          }
        ]
      },
      links: [{ kind: 'url', ref: 'https://example.com/previews', url: 'https://example.com/previews', title: 'Preview environments' }]
    }),
    item(now, {
      number: 38,
      bot: BOTS.docs,
      title: 'Which screenshots go in the getting-started guide?',
      status: 'needs_you',
      ago: 26,
      description: 'The guide needs three screenshots; five candidates are ready.',
      doneMeans: 'Three screenshots chosen and added to the guide',
      question: {
        eventId: 'e3810',
        gist: 'Five candidate screenshots are in the draft. The guide has room for three.',
        text: '',
        decisions: [
          {
            index: 0,
            question: 'Use the dark or the light theme for the screenshots?',
            multi: false,
            replies: [
              { index: 0, label: 'Light', recommended: true },
              { index: 1, label: 'Dark', recommended: false }
            ]
          }
        ]
      }
    }),
    item(now, {
      number: 44,
      bot: BOTS.release,
      title: 'Release notes for v2.3',
      status: 'in_progress',
      ago: 2,
      description: 'Collect the merged changes since v2.2 and write the release notes.',
      doneMeans: 'Release notes published with the v2.3 tag',
      links: [
        {
          kind: 'pr',
          ref: 'example/app#128',
          title: 'Release notes for v2.3',
          url: 'https://example.com/app/pull/128',
          pr: { number: 128, state: 'open', checks: 'success', review: 'REVIEW_REQUIRED', title: 'Release notes for v2.3' }
        }
      ]
    }),
    item(now, { number: 43, bot: BOTS.qa, title: 'Smoke test the v2.3 release candidate', status: 'in_progress', ago: 9 }),
    item(now, {
      number: 40,
      bot: BOTS.release,
      title: 'Tag v2.3 once the release candidate passes',
      status: 'waiting',
      ago: 15,
      wait: { text: 'qa-runner’s smoke test of the release candidate; its report wakes me', at: now - 15 * MIN }
    }),
    item(now, {
      number: 37,
      bot: BOTS.docs,
      title: 'Update the API reference for the new export endpoint',
      status: 'waiting',
      ago: 70,
      wait: { text: 'The endpoint’s pull request to merge, so the examples match what ships. A daily check wakes me at 9:00.', at: now - 70 * MIN }
    }),
    item(now, { number: 36, bot: BOTS.infra, title: 'Rotate the staging database password', status: 'done', ago: 95, closeNote: 'Rotated; apps restarted with the new secret' }),
    item(now, { number: 35, bot: BOTS.qa, title: 'Flaky checkout test: find the cause', status: 'done', ago: 140, closeNote: 'A fixed sleep raced the payment mock; replaced with a wait' }),
    item(now, { number: 33, bot: BOTS.docs, title: 'Fix broken links in the FAQ', status: 'done', ago: 300 }),
    item(now, { number: 31, bot: BOTS.release, title: 'Release notes for v2.2', status: 'done', ago: 2_900 }),
    item(now, { number: 34, bot: BOTS.infra, title: 'Move nightly backups to the new bucket', status: 'canceled', ago: 200, closeNote: 'The storage plan changed; the old bucket stays' }),
    item(now, { number: 30, bot: BOTS.docs, title: 'Translate the changelog', status: 'canceled', ago: 3_100, closeNote: 'Not needed for this release' }),
    // About two and three weeks ago: archived with the default 7 days.
    item(now, { number: 20, bot: BOTS.docs, title: 'Write the onboarding checklist', status: 'done', ago: 20_000, closeNote: 'Published in the contributor guide' }),
    item(now, { number: 21, bot: BOTS.docs, title: 'Record the setup walkthrough', status: 'canceled', ago: 21_000, closeNote: 'The checklist covers it' }),
    item(now, { number: 22, bot: BOTS.qa, title: 'Load test the search API', status: 'done', ago: 28_000, closeNote: 'p95 under 200 ms at 3× traffic' })
  ]
}

export function demoSnapshot(now: number = Date.now(), options: { origins?: boolean } = {}): BoardSnapshot {
  const list = items(now, options.origins)
  const counts = { needs_you: 0, in_progress: 0, waiting: 0, planned: 0, done: 0, canceled: 0 } as Record<ItemStatus, number>
  for (const entry of list) {
    counts[entry.status] += 1
  }
  return {
    fetchedAt: now - 12_000,
    bots: Object.values(BOTS).map((bot) => ({ ...bot, agent: 'claude', paused: false, specialty: '', itemCount: list.filter((entry) => entry.bot.id === bot.id).length })),
    items: list,
    counts,
    chats: demoChats(now),
    signature: 'demo',
    errors: [],
    answer: { available: false, reason: ANSWER_UNAVAILABLE }
  }
}

function infraHistory(found: BoardItem, now: number): ItemEvent[] {
  const bot = { kind: 'bot' as const, botId: BOTS.infra.id, botName: BOTS.infra.name, chatId: CHATS.infraHome.id }
  const at = (ago: number): number => now - ago * MIN
  let n = 0
  const ev = (ago: number, rest: Partial<ItemEvent> & { kind: string }): ItemEvent => ({ id: `e41${String(n++).padStart(2, '0')}`, at: at(ago), actor: bot, ...rest })
  return [
    ev(300, { kind: 'made', made: { title: found.title, status: 'planned' }, text: found.description }),
    ev(298, { kind: 'status', status: { from: 'planned', to: 'in_progress' } }),
    ev(290, { kind: 'commented', text: 'Listed every preview environment with its last deploy and its pull request.' }),
    ev(260, { kind: 'commented', text: '31 environments in total; 14 have had no deploys for over 30 days.' }),
    ev(240, { kind: 'linked', links: [{ kind: 'url', ref: 'https://example.com/previews', url: 'https://example.com/previews' }] }),
    ev(220, { kind: 'commented', text: 'Checked the 14 against open pull requests: 2 still belong to open ones.' }),
    ev(200, { kind: 'commented', text: 'Estimated the cost of the 14: about $120 a month together.' }),
    ev(150, { kind: 'commented', text: 'Confirmed that a deleted environment is recreated on the next push to its branch, so deleting loses nothing that cannot come back.' }),
    ev(120, { kind: 'status', status: { from: 'in_progress', to: 'waiting', note: 'The weekly cost report, to confirm the estimate' } }),
    ev(60, { kind: 'commented', text: 'The cost report matches the estimate.' }),
    ev(58, { kind: 'status', status: { from: 'waiting', to: 'in_progress' } }),
    ev(30, { kind: 'commented', text: 'Drafted the cleanup: delete the 12 without open pull requests, and a weekly job for the future.' }),
    ev(5, {
      kind: 'commented',
      text: found.question?.gist ?? '',
      ask: { context: found.question?.gist ?? '', decisions: found.question?.decisions ?? [] }
    }),
    ev(4, { kind: 'status', status: { from: 'in_progress', to: 'needs_you' } })
  ]
}

export function demoDetail(number: number, now: number = Date.now(), options: { origins?: boolean } = {}): ItemDetail {
  const found = items(now, options.origins).find((entry) => entry.number === number)
  if (!found) {
    throw new Error(`No demo item ${number}`)
  }
  if (number === 41) {
    return { item: found, events: infraHistory(found, now) }
  }
  const bot = { kind: 'bot' as const, botId: found.bot.id, botName: found.bot.name, chatId: found.chat?.id ?? null }
  const events: ItemEvent[] = [
    { id: `e${number}0`, kind: 'made', at: found.createdAt ?? now, actor: bot, made: { title: found.title, status: 'planned' }, ...(found.description ? { text: found.description } : {}) },
    { id: `e${number}1`, kind: 'status', at: (found.createdAt ?? now) + MIN, actor: bot, status: { from: 'planned', to: 'in_progress' } }
  ]
  if (found.question) {
    events.push({ id: `e${number}2`, kind: 'commented', at: found.lastActivityAt, actor: bot, text: found.question.gist, ask: { context: found.question.gist, decisions: found.question.decisions } })
  }
  if (found.status !== 'in_progress') {
    events.push({ id: `e${number}9`, kind: 'status', at: found.lastActivityAt, actor: bot, status: { from: 'in_progress', to: found.status, ...(found.wait ? { note: found.wait.text } : {}) } })
  }
  return { item: found, events }
}
