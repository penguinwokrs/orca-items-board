// The plugin's words in English (the default) and Japanese, picked by Orca's display language.
// Status names (Needs you, In progress, …) stay as Orca shows them in both.

export type Lang = 'en' | 'ja'

/** Japanese for a `ja*` locale; English for anything else. */
export function langOf(locale: string | null | undefined): Lang {
  return typeof locale === 'string' && /^ja(?:[-_.@]|$)/i.test(locale) ? 'ja' : 'en'
}

type Vars = Record<string, string | number>
type Message = string | ((vars: Vars) => string)

const en = {
  // Time
  secondsAgo: (v: Vars) => `${v.n}s ago`,
  minutesAgo: (v: Vars) => `${v.n}m ago`,
  hoursAgo: (v: Vars) => `${v.n}h ago`,
  daysAgo: (v: Vars) => `${v.n}d ago`,
  updated: (v: Vars) => `Updated ${v.when}`,
  // Board
  reading: 'Reading every bot’s items…',
  summary: (v: Vars) => ` · ${v.items} items · ${v.bots} bots`,
  needsYouCount: (v: Vars) => `Needs you ${v.n}`,
  boardFailed: (v: Vars) => `Could not load the board: ${v.error}`,
  none: 'None',
  more: (v: Vars) => `+${v.n} more`,
  questions: (v: Vars) => (Number(v.n) === 1 ? '1 question' : `${v.n} questions`),
  withReplies: ' · replies',
  // Box
  previous: 'Previous item',
  next: 'Next item',
  close: 'Close',
  questionSummary: 'Question summary',
  waitingOn: 'Waiting on',
  description: 'Description',
  doneMeans: 'Done means',
  cancelReason: 'Why it was canceled',
  closeNote: 'Close note',
  history: 'History (oldest first)',
  historyLoading: 'Loading the history…',
  historyFailed: (v: Vars) => `Could not read the history: ${v.error}`,
  olderEvents: (v: Vars) => `Show ${v.n} older ${Number(v.n) === 1 ? 'event' : 'events'}`,
  status: 'Status',
  bot: 'Bot',
  madeBy: (v: Vars) => `${v.bot} (made by ${v.maker})`,
  chat: 'Chat',
  links: 'Links',
  created: 'Created',
  closedDone: 'Done',
  closedCanceled: 'Canceled',
  // History lines
  you: 'You',
  evStatus: 'status',
  evMade: 'made',
  evLinked: 'link',
  evAnswer: 'answer',
  recommendedInline: ' (recommended)',
  images: (v: Vars) => `(${v.n} ${Number(v.n) === 1 ? 'image' : 'images'})`,
  // Answer area
  recommended: 'Recommended',
  freeLabel: 'Your own answer',
  freePlaceholder: 'Or answer in your own words',
  send: 'Send',
  goAnswer: 'Answer in Orca ↗',
  goAnswerTitle: (v: Vars) => `Opens ${v.bot} in Orca`,
  opening: (v: Vars) => `Opening ${v.bot}…`,
  openFailed: (v: Vars) => `Could not open it: ${v.error}`,
  answerHere: 'Orca does not let plugins send answers yet, so you answer on the bot’s screen.',
  answerUnavailable: 'You cannot answer from here yet.',
  openedGuide: (v: Vars) => `Opened ${v.bot} in Orca. In the panel on the right, under Needs you, open #${v.n} and answer there.`,
  openedLink: (v: Vars) =>
    `Asked Orca to open ${v.bot}. If nothing changed, choose ${v.bot} under Bots on the left, then open #${v.n} under Needs you on the right.`,
  dismiss: 'Dismiss',
  sent: (v: Vars) => `Sent. ${v.bot} picks it up and the item moves to In progress.`,
  sendFailed: (v: Vars) => `Could not send: ${v.error}`,
  // Requests (the left list)
  requests: 'Requests',
  allRequests: 'All',
  homeChat: 'Home',
  moreItems: (v: Vars) => ` +${v.n} more`,
  lastAsk: 'Last ask',
  allNote: (v: Vars) => (Number(v.n) === 1 ? 'Not counting 1 archived request' : `Not counting ${v.n} archived requests`),
  archivedHeading: (v: Vars) => `Archived (${v.n})`,
  archivedHint: (v: Vars) => `Every item closed ${v.days}+ days ago · ${v.items} items`,
  archivedRowNote: (v: Vars) => `All closed · last ${v.when}`,
  summaryArchived: (v: Vars) => ` · ${v.n} archived`,
  editsTooBig: (v: Vars) =>
    `That edit wasn't kept: your request edits would pass the ${v.max} characters Orca allows in a plugin setting. Undo edits on requests you no longer need (Undo edits), or clear “Request edits” in this plugin's Settings, then try again.`,
  editsSaveFailed: (v: Vars) =>
    `Your request edits couldn't be saved (${v.error}). They show here until the board closes, then they're lost. Undo some edits, or clear “Request edits” in this plugin's Settings, and try again.`,
  editsNearlyFull: (v: Vars) =>
    `Request edits are using ${v.used} of ${v.max} characters. Undo edits you no longer need to keep room for new ones.`,
  itemCount: (v: Vars) => (Number(v.n) === 1 ? '1 item' : `${v.n} items`),
  rename: 'Rename',
  renameLabel: 'Request name',
  mergeInto: 'Merge into…',
  resetRequest: 'Undo edits',
  request: 'Request',
  moveTo: 'Move to request',
  newRequest: 'New request',
  // Panel
  refresh: 'Refresh',
  loading: 'Loading',
  itemsFailed: 'Could not load items',
  nothingNeedsYou: 'Nothing needs you',
  nobodyWaiting: 'No bot is waiting on an answer.',
  openBoard: 'Open board',
  openBoardFailed: 'Could not open the board',
  botsUpdated: (v: Vars) => `${v.bots} bots · updated `,
  panelQuestions: (v: Vars) => `${v.bot} #${v.n} · ${Number(v.q) === 1 ? '1 question' : `${v.q} questions`}`,
  // Worker
  tipWaiting: (v: Vars) =>
    Number(v.n) === 1
      ? '1 item is waiting on you. Press to see it on the board.'
      : `${v.n} items are waiting on you. Press to see them on the board.`,
  needsYouShown: (v: Vars) => (Number(v.n) === 1 ? 'Showing the 1 item that needs you' : `Showing the ${v.n} items that need you`),
  showNeedsYou: 'Show Needs you',
  tipNone: 'No item is waiting on you',
  tipFailed: (v: Vars) => `Bot Items: ${v.error}`,
  boardOpened: 'Opened the Bot Items Board',
  itemOpened: (v: Vars) => `Opened #${v.n} (${v.bot})`,
  cliNotFound: 'The orca CLI was not found on PATH or in Orca’s CLI folder. Set “orca CLI path” in this plugin’s settings.',
  noWorkspace: 'No local Git main checkout in Orca to keep the board file in. Add a repository to Orca first.',
  badWorkspace: (v: Vars) => `“Board file workspace” (${v.path}) is not a local Git main checkout Orca knows.`
} satisfies Record<string, Message>

export type MessageKey = keyof typeof en

const ja: Record<MessageKey, Message> = {
  secondsAgo: (v) => `${v.n} 秒前`,
  minutesAgo: (v) => `${v.n} 分前`,
  hoursAgo: (v) => `${v.n} 時間前`,
  daysAgo: (v) => `${v.n} 日前`,
  updated: (v) => `更新 ${v.when}`,
  reading: 'すべての bot の Item を読み込んでいます…',
  summary: (v) => ` · Item ${v.items} 件 · bot ${v.bots} 体`,
  needsYouCount: (v) => `Needs you ${v.n}`,
  boardFailed: (v) => `ボードを読み込めませんでした: ${v.error}`,
  none: 'なし',
  more: (v) => `＋${v.n} 件`,
  questions: (v) => `質問 ${v.n} 件`,
  withReplies: ' · 選択肢あり',
  previous: '前の Item',
  next: '次の Item',
  close: '閉じる',
  questionSummary: '質問の要約',
  waitingOn: '待っていること',
  description: '説明',
  doneMeans: '完了条件',
  cancelReason: '取りやめた理由',
  closeNote: '完了メモ',
  history: '経緯（古い順）',
  historyLoading: '経緯を読み込んでいます…',
  historyFailed: (v) => `経緯を読めませんでした: ${v.error}`,
  olderEvents: (v) => `さらに表示（古い経緯 ${v.n} 件）`,
  status: 'ステータス',
  bot: 'bot',
  madeBy: (v) => `${v.bot}（${v.maker} が作成）`,
  chat: 'チャット',
  links: 'リンク',
  created: '作成',
  closedDone: '完了',
  closedCanceled: '取りやめ',
  you: 'あなた',
  evStatus: 'ステータス',
  evMade: '作成',
  evLinked: 'リンク',
  evAnswer: '回答',
  recommendedInline: '（推奨）',
  images: (v) => `（画像 ${v.n} 枚）`,
  recommended: '推奨',
  freeLabel: '自由記述の回答',
  freePlaceholder: 'または自分の言葉で',
  send: '回答する',
  goAnswer: 'Orca で回答する ↗',
  goAnswerTitle: (v) => `Orca で ${v.bot} の画面を開きます`,
  opening: (v) => `${v.bot} の画面を開いています…`,
  openFailed: (v) => `開けませんでした: ${v.error}`,
  answerHere: 'いまの Orca ではプラグインから回答を送れないため、bot の画面で答えます。',
  answerUnavailable: 'いまはここから回答できません。',
  openedGuide: (v) => `${v.bot} の画面を開きました。右側の Needs you で #${v.n} を開いて回答してください。`,
  openedLink: (v) => `Orca に ${v.bot} の画面を開くよう頼みました。変わらないときは、左の Bots で ${v.bot} を選び、右側の Needs you で #${v.n} を開いてください。`,
  dismiss: '閉じる',
  sent: (v) => `送信しました。${v.bot} が受け取ると In progress に移ります。`,
  sendFailed: (v) => `送れませんでした: ${v.error}`,
  requests: '依頼',
  allRequests: 'すべて',
  homeChat: 'Home',
  moreItems: (v) => ` ＋${v.n} 件`,
  lastAsk: '最後の依頼',
  allNote: (v) => `アーカイブ済みの依頼 ${v.n} 件は数えていません`,
  archivedHeading: (v) => `アーカイブ済み（${v.n}）`,
  archivedHint: (v) => `Item がすべて閉じて ${v.days} 日以上 · Item ${v.items} 件`,
  archivedRowNote: (v) => `すべて閉じた · 最後 ${v.when}`,
  summaryArchived: (v) => ` · アーカイブ済み ${v.n} 件`,
  editsTooBig: (v) =>
    `この変更は保存できないため、取り消しました。依頼の編集が、Orca がプラグインの設定に保存できる上限（${v.max} 文字）を超えます。もう要らない依頼の「直した内容を戻す」を押すか、このプラグインの設定で「Request edits」を空にしてから、もう一度試してください。`,
  editsSaveFailed: (v) =>
    `依頼の編集を保存できませんでした（${v.error}）。ボードを閉じるまでは表示されますが、閉じると失われます。編集をいくつか戻すか、このプラグインの設定で「Request edits」を空にしてから、もう一度試してください。`,
  editsNearlyFull: (v) =>
    `依頼の編集が上限 ${v.max} 文字のうち ${v.used} 文字を使っています。新しい編集の余地を残すため、要らなくなった編集を戻してください。`,
  itemCount: (v) => `Item ${v.n} 件`,
  rename: '名前を変える',
  renameLabel: '依頼の名前',
  mergeInto: 'まとめる先…',
  resetRequest: '直した内容を戻す',
  request: '依頼',
  moveTo: '依頼を移す',
  newRequest: '新しい依頼',
  refresh: '再読み込み',
  loading: '読み込み中',
  itemsFailed: 'Item を読み込めませんでした',
  nothingNeedsYou: 'あなたを待っている Item はありません',
  nobodyWaiting: '回答を待っている bot はいません。',
  openBoard: 'ボードを開く',
  openBoardFailed: 'ボードを開けませんでした',
  botsUpdated: (v) => `bot ${v.bots} 体 · 更新 `,
  panelQuestions: (v) => `${v.bot} #${v.n} · 質問 ${v.q} 件`,
  tipWaiting: (v) => `${v.n} 件の Item があなたを待っています。押すとボードで表示します`,
  needsYouShown: (v) => `あなたを待っている ${v.n} 件の Item を表示しました`,
  showNeedsYou: 'Needs you を見る',
  tipNone: 'あなたを待っている Item はありません',
  tipFailed: (v) => `Bot Items: ${v.error}`,
  boardOpened: 'Bot Items Board を開きました',
  itemOpened: (v) => `#${v.n}（${v.bot}）を開きました`,
  cliNotFound: 'orca CLI が PATH にも Orca の CLI フォルダにも見つかりません。このプラグインの設定で「orca CLI path」を指定してください。',
  noWorkspace: 'ボードのファイルを置けるローカルの Git main checkout が Orca にありません。先にリポジトリを Orca に追加してください。',
  badWorkspace: (v) => `「Board file workspace」(${v.path}) は Orca が知っているローカルの Git main checkout ではありません。`
}

const DICTS: Record<Lang, Record<MessageKey, Message>> = { en, ja }

export type Translate = (key: MessageKey, vars?: Vars) => string

export function translator(lang: Lang): Translate {
  return (key, vars = {}) => {
    const message = DICTS[lang][key] ?? en[key]
    return typeof message === 'function' ? message(vars) : message
  }
}

/** "4m ago" / "4 分前". */
export function relativeTime(t: Translate, at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) {
    return t('secondsAgo', { n: seconds })
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return t('minutesAgo', { n: minutes })
  }
  const hours = Math.round(minutes / 60)
  return hours < 24 ? t('hoursAgo', { n: hours }) : t('daysAgo', { n: Math.round(hours / 24) })
}
