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
    // A room message: Orca keys it per bot, and records the bot's room turn as the words.
    row({
      number: 106,
      title: 'Ship the fix',
      chat: ALPHA_ROOM,
      origin: { rootKey: 'bot-group-member-r1:m1', kind: 'group', at: '2026-11-21T10:00:00.000Z', request: 'You are responding in the shared group "Launch" as "alpha".' }
    })
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
    row({
      number: 107,
      owner: BETA,
      chat: BETA_ROOM,
      title: 'Run QA on the launch',
      origin: { rootKey: 'bot-group-member-r2:m1', kind: 'group', at: '2026-11-21T10:00:01.000Z', request: 'You are responding in the shared group "Launch" as "beta".' }
    }),
    // Handed off by alpha's room turn: the room's key, made in beta's Home.
    row({
      number: 108,
      owner: BETA,
      chat: BETA_HOME,
      title: 'Check the launch notes',
      origin: { rootKey: 'bot-group-member-r1:m1', kind: 'bot', at: '2026-11-21T10:02:00.000Z', request: null }
    })
  ],
  gamma: [
    // Three hops down a hand-off chain: Orca keeps the key, but no words.
    row({
      number: 109,
      owner: GAMMA,
      chat: GAMMA_HOME,
      title: 'Update the status page',
      origin: { rootKey: 'delta-home:u9', kind: 'bot', at: '2026-11-22T08:00:00.000Z', request: null }
    })
  ]
}

const chatsOf: Record<string, Record<string, unknown>[]> = {
  alpha: [
    { id: ALPHA_HOME.id, title: 'Home', home: true, lastActivityAt: 9_000, lastAsked: 'Fix the flaky login test and ask beta to QA it.' },
    { id: ALPHA_ROOM.id, title: 'Launch', home: false, lastActivityAt: 8_000, lastAsked: 'Get the launch out.' }
  ],
  beta: [
    { id: BETA_HOME.id, title: 'Home', home: true, lastActivityAt: 7_000, lastAsked: 'Tidy the old beta work.' },
    { id: BETA_ROOM.id, title: 'Launch', home: false, lastActivityAt: 8_100, lastAsked: 'Get the launch out.' }
  ],
  gamma: [{ id: GAMMA_HOME.id, title: 'Home', home: true, lastActivityAt: 6_000, lastAsked: null }]
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
