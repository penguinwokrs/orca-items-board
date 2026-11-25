// Synthetic `orca bot … --json` results from an Orca that records item origins (stablyai/orca#48086):
// each item row carries `origin: { rootKey, kind, at (ISO UTC), request }` and `fromItem`. Made-up
// bots, keys and words; no real data.
import type { OrcaRunner } from '../board'
import { CliError } from '../board'

const ALPHA = { id: 'bot-alpha', name: 'alpha' }
const BETA = { id: 'bot-beta', name: 'beta' }
const GAMMA = { id: 'bot-gamma', name: 'gamma' }

const ALPHA_HOME = { id: 'alpha-home', kind: 'home', title: 'Home' }
const BETA_HOME = { id: 'beta-home', kind: 'home', title: 'Home' }
const GAMMA_HOME = { id: 'gamma-home', kind: 'home', title: 'Home' }
const ALPHA_ROOM = { id: 'bot-group-member-r1', kind: 'chat', title: 'Launch' }
const BETA_ROOM = { id: 'bot-group-member-r2', kind: 'chat', title: 'Launch' }
const GAMMA_ROOM = { id: 'bot-group-member-r3', kind: 'chat', title: 'Launch' }

/** Two requests the owner typed into alpha's busy Home, a minute apart. */
export const CHECKLIST = {
  rootKey: 'alpha-home:u1',
  kind: 'owner',
  at: '2026-11-20T09:00:00.000Z',
  request: 'Build the release checklist,\n  then post it to the team.'
}
export const FLAKY = {
  rootKey: 'alpha-home:u2',
  kind: 'owner',
  at: '2026-11-20T09:01:00.000Z',
  request: 'Fix the flaky login test and ask beta to QA it.'
}

/** Two posts the owner made in the "Launch" room (alpha, beta and gamma are its members). Orca keys
 *  each post once for every member bot; the key is opaque (only compared, never parsed). */
export const LAUNCH = {
  rootKey: 'launch-post-1',
  kind: 'group',
  at: '2026-11-21T10:00:00.000Z',
  request: 'Get the launch out: ship the fix, QA it, and update the status notes.'
}
export const BLOG = {
  rootKey: 'launch-post-2',
  kind: 'group',
  at: '2026-11-21T11:00:00.000Z',
  request: 'Write the launch blog post.'
}

function row(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    uid: `uid-${fields.number}`,
    owner: ALPHA,
    description: '',
    doneMeans: '',
    status: 'in-progress',
    chat: ALPHA_HOME,
    madeBy: null,
    question: null,
    closeNote: null,
    wait: null,
    links: [],
    version: 1,
    snoozedUntil: null,
    createdAt: 1_000 + Number(fields.number),
    closedAt: null,
    lastActivityAt: 5_000 + Number(fields.number),
    ...fields,
    lastEventId: `e${fields.number}0`,
    othersLastEventId: `e${fields.number}0`,
    updatedAt: fields.lastActivityAt ?? 5_000 + Number(fields.number)
  }
}

export const originItems: Record<string, Record<string, unknown>[]> = {
  alpha: [
    // Made before Orca recorded origins: no `origin` field at all.
    row({ number: 100, title: 'Old chore', status: 'done', closedAt: 4_000, lastActivityAt: 4_000 }),
    // One request, three items on one bot.
    row({ number: 101, title: 'Draft the checklist', origin: CHECKLIST, fromItem: null }),
    row({ number: 102, title: 'Review the checklist with QA', origin: CHECKLIST, fromItem: null }),
    row({ number: 103, title: 'Post the checklist', status: 'needs-you', origin: CHECKLIST, fromItem: null, lastActivityAt: 9_000 }),
    // A coordinator's item; beta's helper item (#105) shares its key.
    row({ number: 104, title: 'Fix the flaky login test', origin: FLAKY, fromItem: null }),
    // The room's first post, taken by alpha.
    row({ number: 106, title: 'Ship the fix', chat: ALPHA_ROOM, origin: LAUNCH }),
    // The room's second post: a request of its own, in the same room.
    row({ number: 111, title: 'Draft the launch blog post', chat: ALPHA_ROOM, origin: BLOG }),
    // Made in the room before Orca recorded origins: the room's chats make its request.
    row({ number: 112, title: 'Book the launch room', chat: ALPHA_ROOM, status: 'done', closedAt: 3_000, lastActivityAt: 3_000 })
  ],
  beta: [
    row({ number: 99, owner: BETA, chat: BETA_HOME, title: 'Old beta work', origin: null, fromItem: null }),
    row({
      number: 105,
      owner: BETA,
      chat: BETA_HOME,
      title: 'QA the login fix',
      madeBy: { botId: ALPHA.id, name: ALPHA.name },
      origin: { ...FLAKY, kind: 'bot', at: '2026-11-20T09:05:00.000Z' },
      fromItem: { uid: 'uid-104', number: 104 }
    }),
    // The first post, @mentioned to beta: the same key.
    row({ number: 107, owner: BETA, chat: BETA_ROOM, title: 'Run QA on the launch', origin: { ...LAUNCH, at: '2026-11-21T10:00:01.000Z' } }),
    // Handed off by alpha's room turn into beta's Home: the same key, no words.
    row({
      number: 108,
      owner: BETA,
      chat: BETA_HOME,
      title: 'Check the launch notes',
      origin: { rootKey: LAUNCH.rootKey, kind: 'bot', at: '2026-11-21T10:02:00.000Z', request: null }
    }),
    // Made in the room before origins, like #112.
    row({ number: 113, owner: BETA, chat: BETA_ROOM, title: 'Test the launch room booking', status: 'done', closedAt: 3_100, lastActivityAt: 3_100 })
  ],
  gamma: [
    // Three hops down a hand-off chain: Orca keeps the key, but no words.
    row({
      number: 109,
      owner: GAMMA,
      chat: GAMMA_HOME,
      title: 'Update the status page',
      origin: { rootKey: 'delta-home:u9', kind: 'bot', at: '2026-11-22T08:00:00.000Z', request: null }
    }),
    // A peer request from alpha in the room, on the first post: kind `bot`, the same key and words.
    row({
      number: 110,
      owner: GAMMA,
      chat: GAMMA_ROOM,
      title: 'Update the status notes',
      madeBy: { botId: ALPHA.id, name: ALPHA.name },
      origin: { ...LAUNCH, kind: 'bot', at: '2026-11-21T10:01:00.000Z' }
    })
  ]
}

const chatsOf: Record<string, Record<string, unknown>[]> = {
  alpha: [
    { id: ALPHA_HOME.id, title: 'Home', home: true, lastActivityAt: 9_000, lastAsked: 'Fix the flaky login test and ask beta to QA it.' },
    { id: ALPHA_ROOM.id, title: 'Launch', home: false, lastActivityAt: 8_000, lastAsked: BLOG.request }
  ],
  beta: [
    { id: BETA_HOME.id, title: 'Home', home: true, lastActivityAt: 7_000, lastAsked: 'Tidy the old beta work.' },
    { id: BETA_ROOM.id, title: 'Launch', home: false, lastActivityAt: 8_100, lastAsked: BLOG.request }
  ],
  gamma: [
    { id: GAMMA_HOME.id, title: 'Home', home: true, lastActivityAt: 6_000, lastAsked: null },
    { id: GAMMA_ROOM.id, title: 'Launch', home: false, lastActivityAt: 8_200, lastAsked: BLOG.request }
  ]
}

/** `orca` answering with origin rows for alpha, beta and gamma. */
export function originRunner(): OrcaRunner {
  return async (args) => {
    const line = args.join(' ')
    if (line === 'bot list --json') {
      return { bots: [ALPHA, BETA, GAMMA].map((bot) => ({ ...bot, agent: 'claude', paused: false, specialty: '' })) }
    }
    if (line.startsWith('bot item list --bot ')) {
      const bot = args[4]!
      return { botId: `bot-${bot}`, botName: bot, counts: {}, items: originItems[bot] ?? [] }
    }
    if (line.startsWith('bot chats --bot ')) {
      return { bot: args[3], chats: chatsOf[args[3]!] ?? [] }
    }
    throw new CliError(`No item for: ${line}`, 'not_found')
  }
}
