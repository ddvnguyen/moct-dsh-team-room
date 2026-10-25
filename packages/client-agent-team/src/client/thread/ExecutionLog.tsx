// Derived from multica-x packages/views/issues/components/execution-log-section.tsx and
// packages/views/issues/components/inline-comment-run.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted to the Team Room: Multica loads an issue's agent tasks
// through query hooks and cancels a run through its own API. Here the Host's
// `threadSessions` Remote folds each seat's Session runs for one Thread, the
// running rows' live step and tool arrive from the `memberActivity` snapshot,
// errored Turns come from `threadTurnFailures`, and stopping a run goes
// through the dsh Session controller (`session.cancel`). No cost bars, no
// retry, no transcript dialog: the seat's full context opens natively through
// `openMemberSession`, which is the row's own transcript affordance.
//
// The read, the fold and the Stop write live in `useThreadLog`, which this
// component and the issue sidebar's execution-log section (M-70) both
// consume: one data source, so a section's totals cannot disagree with the
// rows beside them.

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentTeamClientMemberStatus,
  AgentTeamThreadRef,
  AgentTeamThreadSessionRuns,
  AgentTeamThreadTurnFailure,
} from '@ddvnguyen/moct-dsh-team-room/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from '../slots.ts'
import type { ActivitySource } from '../multica/types.ts'
import { compareActiveRuns } from '../multica/active-task-order.ts'
import { RUN_STATE_LABEL_KEY, cacheHitPercent, formatDuration, runDurationMs, type RunState } from '../multica/task-run-labels.ts'
import { formatTokens, formatSeconds } from '../reply-stats.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { ActorAvatar } from '../multica-ui/ActorAvatar.tsx'
import look from '../multica-look.module.css'
import css from './execution-log.module.css'

/**
 * One wall-clock second while anything is running: the live rows' elapsed
 * timer ticks the way Multica's do, and nothing re-renders when the log is
 * quiet. Mounts only when the caller has active rows.
 */
export function useTickingNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/** The remotes one log's rows are read and stopped through. */
export interface ThreadLogSource {
  readonly workspaceId: WorkspaceId
  readonly threadRef: AgentTeamThreadRef
  readonly loadThreadSessions: TeamConversationProps['loadThreadSessions']
  readonly loadMemberActivity: TeamConversationProps['loadMemberActivity']
  readonly threadTurnFailures: TeamConversationProps['threadTurnFailures']
  readonly stopSession: TeamConversationProps['stopSession']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
}

/** One row the log renders: the folded Session run plus its derived state. */
export interface LogRow {
  readonly run: AgentTeamThreadSessionRuns['history'][number]
  readonly running: boolean
  readonly state: RunState
}

/** The token figures one run contributes to a total; either may be unrecorded. */
export interface RunTokenFigures {
  readonly tokensIn: number | null | undefined
  readonly tokensOut: number | null | undefined
}

/**
 * The issue's token spend over a set of runs: the sum of the figures the runs
 * recorded, and whether any run left a figure unrecorded. `null` means no run
 * recorded anything at all — the caller shows no total rather than a zero
 * that reads as "free". A partial sum is shown with its floor (`≥ …`), never
 * as an exact figure: a null is a Turn that reported no usage, not a zero.
 */
export function runTokenTotal(runs: readonly RunTokenFigures[]): { readonly tokens: number; readonly partial: boolean } | null {
  let tokens = 0
  let recorded = false
  let partial = false
  for (const run of runs) {
    if (typeof run.tokensIn === 'number') { tokens += run.tokensIn; recorded = true } else partial = true
    if (typeof run.tokensOut === 'number') { tokens += run.tokensOut; recorded = true } else partial = true
  }
  if (!recorded) return null
  return { tokens, partial }
}

/**
 * The log's data: every seat's Session runs on one Thread, the live one first,
 * with the live rows' step/tool activity and the non-optimistic Stop write.
 * A failed log read leaves the rows empty rather than surfacing an error: the
 * log is an enhancement over the timeline, and its own read errors ride the
 * returned `error`.
 */
export function useThreadLog({ workspaceId, threadRef, loadThreadSessions, loadMemberActivity, threadTurnFailures, stopSession, subscribeChanges }: ThreadLogSource): {
  readonly activeRows: readonly LogRow[]
  readonly pastRows: readonly LogRow[]
  readonly activities: readonly ActivitySource[]
  /** Sessions whose Stop was accepted but whose activity row has not cleared yet. */
  readonly stopping: ReadonlySet<string>
  readonly error: string | undefined
  /** Accepts a Stop for one session: the row reads "stopping…" until the Host refolds. */
  readonly stop: (sessionId: LogRow['run']['sessionId']) => void
} {
  const [seatRuns, setSeatRuns] = useState<readonly AgentTeamThreadSessionRuns[]>([])
  const [activities, setActivities] = useState<readonly ActivitySource[]>([])
  const [failures, setFailures] = useState<readonly AgentTeamThreadTurnFailure[]>([])
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    setSeatRuns([])
    setActivities([])
    setFailures([])
    setStopping(new Set())
    setError(undefined)
    const refresh = async (): Promise<void> => {
      if (!mountedRef.current) return
      // A failed log read leaves the section without its rows rather than
      // surfacing an error: the log is an enhancement over the timeline.
      const [sessions, activity, turnFailures] = await Promise.all([
        loadThreadSessions({ workspaceId, threadRef }).catch(() => undefined),
        loadMemberActivity({ workspaceId, threadRef }).catch(() => undefined),
        threadTurnFailures({ workspaceId, threadRef }).catch(() => undefined),
      ])
      if (!mountedRef.current) return
      if (sessions?.ok === true) {
        setSeatRuns(sessions.value)
        // A run the Host no longer folds as active has finished stopping.
        setStopping(current => {
          const live = new Set<string>(sessions.value.flatMap(seat => seat.active === null ? [] : [seat.active.sessionId]))
          const next = new Set([...current].filter(sessionId => live.has(sessionId)))
          return next.size === current.size ? current : next
        })
      }
      if (activity?.ok === true) setActivities(activity.value.activities)
      if (turnFailures?.ok === true) setFailures(turnFailures.value)
    }
    void refresh()
    const disposers = [
      // A finished or newly dispatched Turn wakes the Thread's projection; the
      // step/tool progress of a live one wakes the activity epoch.
      subscribeChanges({ kind: 'thread', threadRef }, update => {
        if (update.type === 'failed') { setError(update.message); return }
        void refresh()
      }),
      subscribeChanges({ kind: 'activity', workspaceId }, update => {
        if (update.type === 'failed') { setError(update.message); return }
        void refresh()
      })
    ]
    return () => {
      mountedRef.current = false
      for (const dispose of disposers) dispose()
    }
  }, [workspaceId, threadRef])

  const { activeRows, pastRows } = useMemo(() => {
    const failedSessions = new Set(failures.map(failure => failure.sessionId))
    const active: LogRow[] = []
    const past: LogRow[] = []
    for (const seat of seatRuns) {
      if (seat.active !== null) active.push({ run: seat.active, running: true, state: 'running' })
      for (const run of seat.history) {
        if (seat.active !== null && run.sessionId === seat.active.sessionId) continue
        past.push({ run, running: false, state: failedSessions.has(run.sessionId) ? 'failed' : 'completed' })
      }
    }
    active.sort((left, right) => compareActiveRuns(
      { sessionId: left.run.sessionId, running: true, startedAt: left.run.startedAt, memberId: left.run.memberId },
      { sessionId: right.run.sessionId, running: true, startedAt: right.run.startedAt, memberId: right.run.memberId },
    ))
    past.sort((left, right) => Date.parse(right.run.endedAt) - Date.parse(left.run.endedAt) || right.run.sessionId.localeCompare(left.run.sessionId))
    return { activeRows: active, pastRows: past }
  }, [seatRuns, failures])

  const stop = (sessionId: LogRow['run']['sessionId']): void => {
    // Non-optimistic: the row reads “stopping…” from the click, and only the
    // Host's next activity wake (or a failed cancel) moves it off that state.
    setStopping(current => new Set([...current, sessionId]))
    void stopSession(sessionId).then(result => {
      if (!result.ok) {
        setStopping(current => {
          const next = new Set(current)
          next.delete(sessionId)
          return next
        })
        setError(result.error.message)
      }
    }).catch(cause => {
      setStopping(current => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  return { activeRows, pastRows, activities, stopping, error, stop }
}

/**
 * One log row: the seat, its state, the live step/tool line or the recorded
 * tokens, and the two affordances — the seat's own transcript, and Stop on a
 * live row. Shared by the Thread page's log and the issue's history region;
 * the history renders finished runs only, so it passes no `onStop` and the
 * row offers none.
 */
export function ExecutionLogRow({ row, now, handle, tool, steps, stopping, onOpenSession, onStop, timeAgo, t }: {
  readonly row: LogRow
  readonly now: number
  readonly handle: string
  readonly tool: string | undefined
  readonly steps: number | undefined
  readonly stopping: boolean
  readonly onOpenSession: () => void
  readonly onStop?: (() => void) | undefined
  readonly timeAgo: (value: string) => string
  readonly t: TeamConversationProps['t']
}) {
  const { run } = row
  const duration = runDurationMs({ startedAt: run.startedAt, endedAt: run.endedAt, running: row.running })
  const cache = cacheHitPercent({ tokensIn: run.tokensIn, cacheReadTokens: run.cacheReadTokens, cacheWriteTokens: run.cacheWriteTokens })
  return <article className={css.row} data-run-state={stopping ? 'stopping' : row.state}>
    <ActorAvatar name={handle} kind="agent" size="sm" />
    <div className={css.main}>
      <span className={css.headLine}>
        <span className={css.handle}>{`@${handle}`}</span>
        <span className={`${css.state} ${stopping ? css.stopping : css[row.state]}`}>{stopping ? t('stopRunStopping') : t(RUN_STATE_LABEL_KEY[row.state] as Parameters<typeof t>[0])}</span>
        {row.running
        ? <span className={css.elapsed}>{formatDuration(Math.max(0, now - Date.parse(run.startedAt)))}</span>
        : duration !== null && <span className={css.elapsed}>{formatDuration(duration)}</span>}
      </span>
      {row.running && (tool !== undefined || steps !== undefined) && <span className={css.liveLine}>
        <span className={css.pulse} aria-hidden="true" />
        <span className={css.tool}>{tool ?? t('activityThinking')}</span>
        {steps !== undefined && <span className={css.step}>{t('activityStepCount', { count: String(steps) })}</span>}
      </span>}
      {!row.running && <span className={css.metaLine}>
        <span title={t('runTokensLabel')}>{formatTokens(run.tokensIn)} → {formatTokens(run.tokensOut)}</span>
        {run.unknownInputTurns > 0 && <span className={css.partial}>{t('agentDetailsPartial')}</span>}
        {cache !== null && <span>{t('runCacheLabel')} {cache}%</span>}
        <span>{formatSeconds(run.runMs)}</span>
        {run.model !== null && <span className={css.model}>{run.model.model}</span>}
        <span className={css.ended}>{timeAgo(run.endedAt)}</span>
      </span>}
    </div>
    <span className={css.actions}>
      <Button size="sm" variant="outline" onClick={onOpenSession}>{t('openSession')}</Button>
      {row.running && !stopping && onStop !== undefined && <Button size="sm" variant="outline" onClick={onStop}>{t('stopRun')}</Button>}
    </span>
  </article>
}

interface ExecutionLogProps extends ThreadLogSource {
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly t: TeamConversationProps['t']
}

/**
 * The execution log: every seat's Session runs that touched this Thread, the
 * live one first, with tokens, duration, cache-hit share and model per row.
 * Reads are non-optimistic everywhere — Stop marks the row “stopping…” and the
 * row leaves the live bucket only when the Host's own activity wake refolds
 * `threadSessions` without it.
 */
export function ExecutionLog(props: ExecutionLogProps) {
  const { workspaceId, threadRef, openMemberSession, members, t, ...source } = props
  const { activeRows, pastRows, activities, stopping, error, stop } = useThreadLog({ workspaceId, threadRef, ...source })
  const [confirmingStop, setConfirmingStop] = useState<LogRow>()

  // The live step and tool of each running row, keyed by seat.
  const activityByMember = useMemo(() => new Map(activities.map(activity => [activity.memberId, activity])), [activities])
  const handleByMember = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  const now = useTickingNow(activeRows.length > 0)

  if (activeRows.length === 0 && pastRows.length === 0) {
    return <p className={`${look.multicaLook} ${css.empty}`}>{t('executionLogEmpty')}</p>
  }

  const renderRow = (row: LogRow) => <ExecutionLogRow
    key={row.run.sessionId}
    row={row}
    now={now}
    handle={handleByMember.get(row.run.memberId) ?? row.run.memberId}
    tool={row.running ? activityByMember.get(row.run.memberId)?.current?.label : undefined}
    steps={row.running ? activityByMember.get(row.run.memberId)?.stepCount : undefined}
    stopping={stopping.has(row.run.sessionId)}
    onOpenSession={() => { openMemberSession(row.run.sessionId) }}
    onStop={() => { setConfirmingStop(row) }}
    timeAgo={timeAgo}
    t={t}
  />

  return <div className={`${look.multicaLook} ${css.root}`} data-team-execution-log>
    {activeRows.length > 0 && <p className={css.groupLabel}>{t('executionLogRunningCount', { count: String(activeRows.length) })}</p>}
    {activeRows.map(renderRow)}
    {pastRows.length > 0 && <p className={css.groupLabel}>{t('executionLogPast')}</p>}
    {pastRows.map(renderRow)}
    {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    {confirmingStop !== undefined && <Modal
      open
      onClose={() => { setConfirmingStop(undefined) }}
      title={t('stopRunTitle')}
      closeLabel={t('cancel')}
      footer={<>
        <Button variant="outline" onClick={() => { setConfirmingStop(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" onClick={() => { setConfirmingStop(undefined); stop(confirmingStop.run.sessionId) }}>{t('stopRun')}</Button>
      </>}
    >
      <p className={css.confirmBody}>{t('stopRunBody', { handle: handleByMember.get(confirmingStop.run.memberId) ?? confirmingStop.run.memberId })}</p>
    </Modal>}
  </div>
}
