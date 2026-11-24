// Synthetic `orca bot … --json` results in the shapes Orca 1.4.272 prints, for tests and checks.
// No real bot data: names and texts are made up.
import type { OrcaRunner } from '../board'
import { CliError } from '../board'

const ALPHA = { id: 'bot-alpha', name: 'alpha' }
const BETA = { id: 'bot-beta', name: 'beta' }

export const botList = {
  bots: [
    { id: ALPHA.id, name: ALPHA.name, agent: 'claude', paused: false, specialty: 'Builds things.', chats: { count: 1, home: true } },
    { id: BETA.id, name: BETA.name, agent: 'codex', paused: false, specialty: 'Checks things.', chats: { count: 2, home: true } },
    { id: 'bot-empty', name: 'empty', agent: 'claude', paused: true, specialty: '', chats: { count: 0, home: false } }
  ]
}

function row(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    uid: `uid-${fields.number}`,
    owner: { botId: ALPHA.id, name: ALPHA.name },
    description: '',
    doneMeans: '',
    chat: { id: 'chat-home', kind: 'home', title: 'Home' },
    madeBy: null,
    question: null,
    closeNote: null,
    wait: null,
    links: [],
    version: 1,
    snoozedUntil: null,
    createdAt: 1_000,
    closedAt: null,
    ...fields,
    lastEventId: fields.lastEventId ?? `e${fields.number}0`,
    othersLastEventId: fields.lastEventId ?? `e${fields.number}0`,
    updatedAt: fields.lastActivityAt
  }
}

export const needsYou = row({
  number: 7,
  title: 'Merge without the review?',
  status: 'needs_you',
  lastActivityAt: 9_000,
  lastEventId: 'e73',
  question: {
    eventId: 'e72',
    text: 'The reviewer is out.\n\nMerge now?\n   - Merge now\n   - Wait (recommended)',
    gist: 'The reviewer is out until Monday.',
    decisions: [
      {
        question: 'Merge now?',
        replies: [
          { label: 'Merge now', recommended: false },
          { label: 'Wait for Monday', detail: 'Two days', recommended: true }
        ]
      },
      {
        question: 'Which labels?',
        multi: true,
        replies: [
          { label: 'bug', recommended: false },
          { label: 'ui', recommended: false }
        ]
      }
    ]
  }
})

export const alphaItems = {
  botId: ALPHA.id,
  botName: ALPHA.name,
  counts: {},
  items: [
    needsYou,
    row({
      number: 5,
      title: 'Ship the fix',
      status: 'waiting',
      lastActivityAt: 8_000,
      wait: { text: 'CI on #12; a wait wakes me', at: 8_000 },
      links: [
        {
          kind: 'pr',
          ref: 'acme/app#12',
          title: 'Fix the login redirect',
          state: null,
          pr: { number: 12, url: 'https://github.com/acme/app/pull/12', state: 'open', checks: 'pending', review: 'REVIEW_REQUIRED', title: 'Fix the login redirect' }
        }
      ]
    }),
    row({ number: 3, title: 'Old work', status: 'done', lastActivityAt: 2_000, closedAt: 2_000, closeNote: 'Merged' })
  ],
  nextCursor: '2000:3'
}

export const alphaItemsPage2 = {
  botId: ALPHA.id,
  botName: ALPHA.name,
  counts: {},
  items: [row({ number: 1, title: 'Dropped idea', status: 'canceled', lastActivityAt: 1_000, closedAt: 1_000 })]
}

export const betaItems = {
  botId: BETA.id,
  botName: BETA.name,
  counts: {},
  items: [
    row({
      number: 6,
      title: 'Run QA',
      status: 'in_progress',
      lastActivityAt: 8_500,
      owner: { botId: BETA.id, name: BETA.name },
      madeBy: { botId: ALPHA.id, name: ALPHA.name }
    })
  ]
}

const actorAlpha = { kind: 'bot', botId: ALPHA.id, chatId: 'chat-home' }

export const showNeedsYouPage1 = {
  item: needsYou,
  events: [
    { id: 'e70', kind: 'made', actor: actorAlpha, data: { title: 'Merge without the review?', status: 'planned', description: 'PR #12' }, at: 5_000 },
    { id: 'e71', kind: 'linked', actor: actorAlpha, data: { links: ['pr:acme/app#12', 'https://example.com/x'] }, at: 6_000 }
  ],
  nextCursor: 'e71'
}

export const showNeedsYouPage2 = {
  item: needsYou,
  events: [
    {
      id: 'e72',
      kind: 'commented',
      actor: actorAlpha,
      data: {
        text: 'The reviewer is out.',
        ask: {
          context: 'The reviewer is out until Monday.',
          questions: [
            { prompt: 'Merge now?', options: [{ label: 'Merge now' }, { label: 'Wait for Monday', detail: 'Two days' }], recommended: 1 },
            { prompt: 'Which labels?', options: [{ label: 'bug' }, { label: 'ui' }], multi: true }
          ]
        }
      },
      at: 9_000
    },
    { id: 'e73', kind: 'status', actor: actorAlpha, data: { from: 'in_progress', to: 'needs_you' }, at: 9_000 },
    { id: 'e74', kind: 'commented', actor: { kind: 'owner' }, data: { text: 'Earlier answer', answers: 'e60', requestId: 'r1' }, at: 9_100 }
  ]
}

/** A runner answering the commands above; anything else is refused as the CLI would. */
export function fixtureRunner(calls: string[][] = [], options: { failBot?: string } = {}): OrcaRunner {
  return async (args) => {
    calls.push([...args])
    const line = args.join(' ')
    if (line === 'bot list --json') {
      return botList
    }
    if (line.startsWith('bot item list --bot ')) {
      const bot = args[4]
      if (bot === options.failBot) {
        throw new CliError('boom', 'runtime_error')
      }
      if (bot === 'alpha') {
        return args.includes('--cursor') ? alphaItemsPage2 : alphaItems
      }
      if (bot === 'beta') {
        return betaItems
      }
      return { botId: 'bot-empty', botName: 'empty', counts: {}, items: [] }
    }
    if (line.startsWith('bot item show 7 ')) {
      return args.includes('--after') ? showNeedsYouPage2 : showNeedsYouPage1
    }
    throw new CliError(`No item for: ${line}`, 'not_found')
  }
}
