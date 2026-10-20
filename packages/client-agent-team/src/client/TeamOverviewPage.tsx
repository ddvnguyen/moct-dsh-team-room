import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamDecisionsRequest,
  AgentTeamDecisionView,
  AgentTeamMemberActivityRequest,
  AgentTeamMemberActivityResult,
  AgentTeamMembersRequest,
  AgentTeamThreadRef,
  AgentTeamWorkspaceActivity,
  AgentTeamWorkspaceActivityRequest,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Virtuoso } from 'react-virtuoso'
import type { TeamConversationProps } from './slots.ts'
import { buildPresenceMap } from './multica/derive-presence.ts'
import { makeTimeAgo } from './multica/time-ago.ts'
import { ActorAvatar, AgentPresenceDot } from './multica-ui/index.ts'
import look from './multica-look.module.css'
import { formatAbsoluteTime, formatInboxTime } from './team-formatters.ts'
import css from './conversation.module.css'
import page from './overview.module.css'

/** Event rows per page; the Host's own default, so a plain first read needs no override. */
const EVENT_PAGE_LIMIT = 50

/** Threads whose pending decision cards the needs-attention slice may probe. */
const DECISION_THREAD_PROBES = 8

/** Day buckets the 14-day chart may draw. */
const SPEND_DAYS = 14

interface TeamOverviewPageProps {
  readonly workspaceId: WorkspaceId
  readonly loadWorkspaceActivity: (request: AgentTeamWorkspaceActivityRequest) => Promise<RemoteResult<AgentTeamWorkspaceActivity>>
  readonly loadMembers: (request: AgentTeamMembersRequest) => Promise<RemoteResult<readonly AgentTeamClientMemberStatus[]>>
  readonly loadMemberActivity: (request: AgentTeamMemberActivityRequest) => Promise<RemoteResult<AgentTeamMemberActivityResult>>
  readonly loadDecisions: (request: AgentTeamDecisionsRequest) => Promise<RemoteResult<{ readonly decisions: readonly AgentTeamDecisionView[] }>>
  readonly loadInbox: TeamConversationProps['loadInbox']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  /** The Human's display name, from the Client's one identity projection. */
  readonly humanName: string
  readonly humanAvatarUrl?: string | undefined
  readonly t: TeamConversationProps['t']
}

/** One needs-attention row: an open decision card, an errored Turn, or a Task in review. */
type AttentionItem =
  | { readonly kind: 'decision'; readonly key: string; readonly at: string; readonly threadRef: AgentTeamThreadRef; readonly channelRef: AgentTeamChannelRef; readonly preview: string }
  | { readonly kind: 'failure'; readonly key: string; readonly at: string; readonly threadRef: AgentTeamThreadRef; readonly actor: string; readonly reason: string }
  | { readonly kind: 'review'; readonly key: string; readonly at: string; readonly threadRef: AgentTeamThreadRef; readonly channelRef?: AgentTeamChannelRef | undefined; readonly preview: string }

function attentionAt(item: AttentionItem): string {
  return item.at
}

/** Re-render every `ms` so turn elapsed times move without a change-stream wake. */
function useTicker(ms: number): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const handle = setInterval(() => { setTick(value => value + 1) }, ms)
    return () => { clearInterval(handle) }
  }, [ms])
  return tick
}

function formatElapsed(from: string, now: number, t: TeamOverviewPageProps['t']): string {
  const seconds = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return t('overviewTurnElapsed', { elapsed: minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s` })
}

function compactCount(count: number): string {
  return count >= 10_000 ? `${(count / 1000).toFixed(count >= 100_000 ? 0 : 1)}k` : String(count)
}

/**
 * The calendar day `offset` days before `day`, both `YYYY-MM-DD` keys. The
 * arithmetic runs on the date parts alone: the Host buckets by its own local
 * day, and the browser must not re-bucket those keys by its own timezone.
 */
function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1) - offset * 86_400_000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/**
 * The workspace Overview ("what is going on"): one page answering three questions
 * the Channel and Thread views never ask together. Live agents strip from the
 * roster plus the running-Turn snapshot, needs-attention from open decision
 * cards, Turn-failure events and Inbox rows whose Task waits in review, the
 * workspace event feed from the `workspaceActivity` aggregate with cursor paging,
 * and the spend chart from its per-day buckets. The page is a pure renderer of
 * its reads: every wake re-reads, every row opens through the same navigation
 * actions the other seats use.
 */
export function TeamOverviewPage({ workspaceId, loadWorkspaceActivity, loadMembers, loadMemberActivity, loadDecisions, loadInbox, subscribeChanges, selectThread, openMemberSession, humanName, humanAvatarUrl, t }: TeamOverviewPageProps) {
  const [activity, setActivity] = useState<AgentTeamWorkspaceActivity>()
  const [events, setEvents] = useState<AgentTeamWorkspaceActivity['events']>([])
  const [cursor, setCursor] = useState<string>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [activities, setActivities] = useState<AgentTeamMemberActivityResult['activities']>([])
  const [attention, setAttention] = useState<readonly AttentionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  // Only the first refresh owns the loading surface; wakes refresh rows in place.
  const loadedRef = useRef(false)
  const ticker = useTicker(1000)

  const timeAgo = useMemo(() => makeTimeAgo({
    justNow: t('timeAgoJustNow'),
    minutesAgo: t('timeAgoMinutes'),
    hoursAgo: t('timeAgoHours'),
    daysAgo: t('timeAgoDays'),
  }), [t])

  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    const results = await Promise.all([
      loadWorkspaceActivity({ workspaceId, limit: EVENT_PAGE_LIMIT }),
      loadMembers({ workspaceId }),
      loadMemberActivity({ workspaceId }),
    ])
    const workspaceResult = results[0]
    if (!workspaceResult.ok) {
      setError(workspaceResult.error.message)
      loadedRef.current = true
      setLoading(false)
      return
    }
    setError(undefined)
    setActivity(workspaceResult.value)
    setEvents(workspaceResult.value.events)
    setCursor(workspaceResult.value.nextCursor)
    if (results[1].ok) setMembers(results[1].value)
    if (results[2].ok) setActivities(results[2].value.activities)

    // Needs attention, folded from three sources the aggregate already names:
    // the feed's failure events, the decision cards of the Threads the feed
    // touches (bounded — the probes exist to fill a short list, not to sweep),
    // and the Inbox rows whose Task sits in review.
    const feedEvents = workspaceResult.value.events
    const failures: AttentionItem[] = feedEvents
      .filter(event => event.kind === 'team/turn-failure-notice')
      .map(event => ({
        kind: 'failure' as const,
        key: `failure:${event.sequence}`,
        at: event.at,
        threadRef: event.threadRef!,
        actor: event.actor,
        reason: event.summary.replace(/^turn \d+ failed: /, ''),
      }))
    const probeThreads = [...new Set(feedEvents.map(event => event.threadRef).filter((ref): ref is AgentTeamThreadRef => ref !== undefined))].slice(0, DECISION_THREAD_PROBES)
    const decisionPages = await Promise.all(probeThreads.map(async threadRef => {
      const result = await loadDecisions({ workspaceId, threadRef })
      return result.ok ? result.value.decisions.filter(decision => decision.status === 'open') : []
    }))
    const decisions: AttentionItem[] = decisionPages.flat().map(decision => ({
      kind: 'decision' as const,
      key: `decision:${decision.decisionRef}`,
      at: decision.askedAt,
      threadRef: decision.threadRef,
      channelRef: decision.channelRef,
      preview: decision.context ?? decision.questions[0]?.prompt ?? decision.questions[0]?.options.join(' / ') ?? '',
    }))
    // A Task in review is "waiting on me" exactly while its Inbox row still
    // names it: one direct-only Inbox read per refresh, rows only — no badge,
    // no read side effects.
    const inboxResult = await loadInbox({ workspaceId, limit: 100 })
    const reviews: AttentionItem[] = (inboxResult.ok
      ? [...inboxResult.value.items, ...inboxResult.value.recent]
        .filter(item => item.task?.status === 'in_review')
        .map(item => ({
          kind: 'review' as const,
          key: `review:${item.thread.threadRef}`,
          at: item.newestOccurredAt,
          threadRef: item.thread.threadRef,
          channelRef: item.channelRef,
          preview: item.previewText ?? item.task?.title ?? item.thread.threadRef,
        }))
      : []).filter((item, index, all) => all.findIndex(other => other.key === item.key) === index)
    setAttention([...decisions, ...failures, ...reviews].sort((left, right) => attentionAt(right).localeCompare(attentionAt(left))))
    loadedRef.current = true
    setLoading(false)
  }, [workspaceId, loadWorkspaceActivity, loadMembers, loadMemberActivity, loadDecisions, loadInbox])

  useEffect(() => { void refresh() }, [refresh])
  // The workspace scope carries every projection commit the aggregate folds; the
  // activity scope moves the live strip without a full projection wake.
  useEffect(() => subscribeChanges({ kind: 'workspace', workspaceId }, update => {
    if (update.type === 'failed') { setError(update.message); return }
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])
  useEffect(() => subscribeChanges({ kind: 'activity', workspaceId }, update => {
    if (update.type === 'failed') return
    void refresh()
  }), [subscribeChanges, refresh, workspaceId])

  const loadMore = useCallback(async () => {
    if (cursor === undefined || loadingMore) return
    setLoadingMore(true)
    const result = await loadWorkspaceActivity({ workspaceId, limit: EVENT_PAGE_LIMIT, cursor })
    if (result.ok) {
      setEvents(current => [...current, ...result.value.events])
      setCursor(result.value.nextCursor)
    }
    setLoadingMore(false)
  }, [cursor, loadingMore, loadWorkspaceActivity, workspaceId])

  // The live strip: every Agent seat of the Workspace, with presence and the
  // running-Turn facts the activity snapshot carries.
  const activitiesByMember = useMemo(() => {
    const map = new Map<string, AgentTeamMemberActivityResult['activities'][number]>()
    for (const row of activities) {
      const existing = map.get(row.memberId)
      if (existing === undefined || existing.updatedAt.localeCompare(row.updatedAt) < 0) map.set(row.memberId, row)
    }
    return map
  }, [activities])
  const presenceByMember = useMemo(() => buildPresenceMap({
    members,
    activities,
    memberIds: members.map(status => status.member.memberId),
  }), [members, activities])
  const agents = members.filter(status => status.presence !== undefined && status.member.memberId !== 'member:human' && !status.member.memberId.startsWith('human:'))
  // The spend rows name their seat by handle: the aggregate carries member ids,
  // and a reader knows a person by the name they answer to.
  const handleByMember = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])

  const todayBucket = activity?.perDay.at(-1)
  // The chart draws a fixed fortnight, not only the days that carry tokens: a
  // series with gaps is a series, and a single day stretched across the whole
  // width would read as a week of spending.
  const spendDays = useMemo(() => {
    const buckets = activity?.perDay ?? []
    const newest = buckets.at(-1)
    if (newest === undefined) return []
    const byDay = new Map(buckets.map(bucket => [bucket.day, bucket]))
    return Array.from({ length: SPEND_DAYS }, (_, index) => shiftDay(newest.day, SPEND_DAYS - 1 - index))
      .map(day => {
        const bucket = byDay.get(day)
        return { day, tokens: (bucket?.tokensOut ?? 0) + (bucket?.tokensIn ?? 0) }
      })
  }, [activity])
  const spendMax = Math.max(1, ...spendDays.map(day => day.tokens))

  return <main className={`${look.multicaLook} ${css.surface}`} data-team-overview>
    <div className={css.surfaceHeader}>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{t('overview')}</h1>
          <p className={page.subtitle}>{t('overviewSubtitle')}</p>
        </div>
      </header>
    </div>
    <div className={css.timeline}>
      <div className={`${css.timelineContent} ${page.body}`}>
        {loading && activity === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('overviewFeedLoading')}</p></div>}
        {!loading && error !== undefined && activity === undefined && <div className={css.errorState} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('retry')}</Button></div>}
        {activity !== undefined && <>
          <section className={page.section} aria-label={t('overviewLiveTitle')}>
            <h2 className={page.sectionTitle}>{t('overviewLiveTitle')}</h2>
            <div className={page.strip} data-team-overview-strip data-tick={ticker}>
              {agents.map(status => {
                const memberId = status.member.memberId
                const row = activitiesByMember.get(memberId)
                const presence = presenceByMember.get(memberId) ?? null
                const now = Date.now()
                return <button key={memberId} type="button" className={page.agentCard} data-team-overview-agent={memberId}
                  aria-label={t('overviewOpenAgent', { name: `@${status.member.handle}` })}
                  title={t('overviewOpenAgent', { name: `@${status.member.handle}` })}
                  onClick={() => { openMemberSession(status.member.sessionId) }}>
                  <span className={page.agentHead}>
                    <ActorAvatar name={status.member.handle} kind="agent" size="sm" />
                    <span className={page.agentHandle}>@{status.member.handle}</span>
                    <AgentPresenceDot detail={presence} compact t={t} />
                  </span>
                  {row !== undefined
                    ? <span className={page.agentLive} data-live="true">
                        <span className={page.agentTool}>{row.current?.label ?? t('activityThinking')}</span>
                        <span className={page.agentMeta}>{t('activityStepCount', { count: String(row.stepCount) })} · {formatElapsed(row.turnStartedAt, now, t)}</span>
                      </span>
                    : <span className={page.agentLive} data-live="false">{status.presence === 'error' ? t('statusError') : t('statusAvailable')}</span>}
                </button>
              })}
            </div>
          </section>

          {attention.length > 0 && <section className={page.section} aria-label={t('overviewNeedsAttention')} data-team-overview-attention>
            <h2 className={page.sectionTitle}>{t('overviewNeedsAttention')}<span className={page.sectionCount}>{attention.length}</span></h2>
            <div className={page.list}>
              {attention.map(item => <button key={item.key} type="button" className={page.attentionRow} data-attention-kind={item.kind}
                onClick={() => { selectThread(item.threadRef, item.kind === 'decision' ? item.channelRef : item.kind === 'review' ? item.channelRef : undefined) }}>
                <span className={`${page.attentionMark} ${item.kind === 'failure' ? page.attentionFailure : page.attentionDecision}`} aria-hidden="true" />
                <span className={page.attentionText}>
                  {item.kind === 'decision' && t('overviewDecisionOpen', { preview: item.preview })}
                  {item.kind === 'failure' && t('overviewTurnFailed', { actor: item.actor, reason: item.reason })}
                  {item.kind === 'review' && t('overviewTaskInReview', { preview: item.preview })}
                </span>
                <time dateTime={item.at} title={formatAbsoluteTime(item.at)}>{formatInboxTime(item.at, t)}</time>
              </button>)}
            </div>
          </section>}

          <section className={page.section} aria-label={t('overviewSpendTitle')} data-team-overview-spend>
            <h2 className={page.sectionTitle}>{t('overviewSpendTitle')}</h2>
            {todayBucket === undefined
              ? <p className={page.spendEmpty}>{t('overviewSpendEmpty')}</p>
              : <div className={page.spend}>
                  <div className={page.spendPerAgent}>
                    <h3 className={page.spendLabel}>{t('overviewSpendPerAgent', { day: todayBucket.day })}</h3>
                    <div className={page.bars} role="img" aria-label={t('overviewSpendPerAgent', { day: todayBucket.day })}>
                      {todayBucket.perAgent.map(row => <div key={row.memberId} className={page.barRow} data-team-overview-spend-agent={row.memberId}>
                        <span className={page.barName}>{handleByMember.get(row.memberId) ?? row.memberId.replace(/^member:/, '')}</span>
                        <span className={page.barTrack}><span className={page.barFill} style={{ width: `${Math.round(((row.tokensIn ?? 0) + row.tokensOut) / Math.max(1, Math.max(...todayBucket.perAgent.map(other => (other.tokensIn ?? 0) + other.tokensOut))) * 100)}%` }} /></span>
                        <span className={page.barValue}>{t('overviewTokens', { count: compactCount((row.tokensIn ?? 0) + row.tokensOut) })}</span>
                      </div>)}
                    </div>
                  </div>
                  <div className={page.spendPerDay}>
                    <h3 className={page.spendLabel}>{t('overviewSpendPerDay', { count: String(SPEND_DAYS) })}</h3>
                    <div className={page.dayBars} role="img" aria-label={t('overviewSpendPerDay', { count: String(SPEND_DAYS) })} data-team-overview-spend-days>
                      {spendDays.map(day => <div key={day.day} className={page.dayBar} title={`${day.day}: ${compactCount(day.tokens)} tokens`}>
                        <span className={page.dayBarFill} style={{ height: `${day.tokens === 0 ? 0 : Math.max(2, Math.round(day.tokens / spendMax * 100))}%` }} />
                      </div>)}
                    </div>
                  </div>
                </div>}
          </section>

          {activity !== undefined && <section className={page.section} aria-label={t('overviewFeedTitle')} data-team-overview-feed data-event-count={events.length}>
            <h2 className={page.sectionTitle}>{t('overviewFeedTitle')}<span className={page.sectionCount}>{events.length}</span></h2>
            {events.length === 0
              ? <p className={page.spendEmpty}>{t('overviewFeedEmpty')}</p>
              : <div className={page.feedBox}>
                <Virtuoso
                  className={page.feed}
                  data-testid="overview-feed"
                  totalCount={events.length}
                  initialItemCount={events.length}
                  itemContent={index => {
                    const event = events[index]!
                    const isHuman = event.actor === 'human'
                    return <div className={page.feedRow} data-team-overview-event={event.sequence} data-event-kind={event.kind}>
                      <ActorAvatar name={isHuman ? humanName : event.actor} kind={isHuman ? 'human' : 'agent'} size="xs" {...(isHuman && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {})} />
                      <span className={page.feedText}>
                        <span className={page.feedActor}>{isHuman ? humanName : `@${event.actor}`}</span>{' '}
                        <span className={page.feedSummary}>{event.summary}</span>
                        {event.taskRef !== undefined && <button type="button" className={page.feedLink}
                          onClick={() => { if (event.threadRef !== undefined) selectThread(event.threadRef) }}>{t('overviewOpenThread')}</button>}
                      </span>
                      <time dateTime={event.at} title={formatAbsoluteTime(event.at)}>{timeAgo(event.at)}</time>
                    </div>
                  }}
                  endReached={() => { void loadMore() }}
                  increaseViewportBy={{ top: 0, bottom: 400 }}
                />
              </div>}
            {cursor !== undefined && <Button size="sm" variant="outline" className={page.feedMore} disabled={loadingMore} onClick={() => { void loadMore() }}>{loadingMore ? t('overviewFeedLoading') : t('overviewFeedMore')}</Button>}
          </section>}
        </>}
      </div>
    </div>
  </main>
}
