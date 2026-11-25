// The sidebar's small entry to the board: counts (Needs you first), the Needs you list, and
// buttons that open the board (the `.itemsboard` custom editor in the main area).
import {
  atom,
  Badge,
  Button,
  Callout,
  EmptyState,
  List,
  ListItem,
  plugin,
  read,
  RelativeTime,
  Row,
  set,
  settings,
  Spinner,
  Stack,
  Text,
  env,
  type PanelContext
} from 'orca'
import { langOf, translator } from './i18n'
import { hideIds } from './requests'
import type { BoardSnapshot } from './protocol'

/** Orca's display language: Japanese for `ja*`, else English. */
const t = translator(langOf(env.locale))

const board = atom<BoardSnapshot | null>(null)
const loadError = atom<string | null>(null)
const loading = atom(false)
const openError = atom<string | null>(null)

/** The same as the commands "Items: Open Board" / "Items: Show Needs You" (the status bar's). */
async function openBoard(needsYou: boolean): Promise<void> {
  try {
    await plugin.request('board.open', { needsYou }, { timeoutMs: 60_000 })
    set(openError, null)
  } catch (error) {
    set(openError, error instanceof Error ? error.message : String(error))
  }
}

async function refresh(force = false): Promise<void> {
  set(loading, true)
  try {
    set(board, await plugin.request('board.get', { force, locale: env.locale }, { timeoutMs: 120_000 }))
    set(loadError, null)
  } catch (error) {
    set(loadError, error instanceof Error ? error.message : String(error))
  } finally {
    set(loading, false)
  }
}

export function setup(ctx: PanelContext): void {
  void refresh()
  ctx.subscriptions.push(plugin.on('board.changed', () => void refresh()))
  // Orca sends plugins no Item events: poll while the panel is open.
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    const seconds = await settings.get('pollSeconds').catch(() => 30)
    if (ctx.signal.aborted) {
      return
    }
    timer = setTimeout(
      () => {
        if (read(ctx.visible)) {
          void refresh()
        }
        void tick()
      },
      Math.max(10, typeof seconds === 'number' ? seconds : 30) * 1000
    )
  }
  void tick()
  ctx.signal.addEventListener('abort', () => clearTimeout(timer))
}

export default function Panel() {
  const value = read(board)
  const error = read(loadError)
  const busy = read(loading)
  const needsYou = value?.items.filter((item) => item.status === 'needs_you') ?? []
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Row gap="xs" wrap>
          {/* In the board's column order: Planned (only when there are any) first. */}
          {value && value.counts.planned > 0 ? <Badge>{`Planned ${value.counts.planned}`}</Badge> : null}
          <Badge tone={needsYou.length > 0 ? 'warning' : 'neutral'}>{t('needsYouCount', { n: value?.counts.needs_you ?? '–' })}</Badge>
          {value ? <Badge tone="accent">{`In progress ${value.counts.in_progress}`}</Badge> : null}
          {value ? <Badge>{`Waiting ${value.counts.waiting}`}</Badge> : null}
        </Row>
        {busy ? (
          <Spinner label={t('loading')} labelHidden />
        ) : (
          <Button size="sm" variant="ghost" icon="refresh" onPress={() => refresh(true)}>
            {t('refresh')}
          </Button>
        )}
      </Row>
      {error ? (
        <Callout tone="danger" title={t('itemsFailed')}>
          {hideIds(error)}
        </Callout>
      ) : null}
      {value?.errors.map((text, index) => (
        <Callout key={`e${index}`} tone="danger">
          {hideIds(text)}
        </Callout>
      ))}
      {!value && !error ? <Spinner label={t('reading')} /> : null}
      {value && needsYou.length === 0 ? (
        <EmptyState title={t('nothingNeedsYou')} description={t('nobodyWaiting')} icon="check" />
      ) : null}
      {needsYou.length > 0 ? (
        <List label="Needs you">
          {needsYou.map((item) => (
            <ListItem
              key={item.uid || String(item.number)}
              title={hideIds(item.title)}
              description={t('panelQuestions', { bot: item.bot.name, n: item.number, q: Math.max(item.question?.decisions.length ?? 0, 1) })}
              icon="bell"
            />
          ))}
        </List>
      ) : null}
      <Row gap="xs" wrap>
        <Button size="sm" icon="blocks" onPress={() => openBoard(false)}>
          {t('openBoard')}
        </Button>
        {needsYou.length > 0 ? (
          <Button size="sm" variant="outline" icon="next" onPress={() => openBoard(true)}>
            {t('showNeedsYou')}
          </Button>
        ) : null}
      </Row>
      {read(openError) ? (
        <Callout tone="danger" title={t('openBoardFailed')}>
          {hideIds(read(openError) ?? '')}
        </Callout>
      ) : null}
      {value ? (
        <Text size="xs" muted>
          {t('botsUpdated', { bots: value.bots.length })}
          <RelativeTime at={value.fetchedAt} />
        </Text>
      ) : null}
    </Stack>
  )
}
