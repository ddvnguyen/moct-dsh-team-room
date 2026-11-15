// Derived from multica-x packages/views/issues/components/execution-log-section.tsx @
// 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's right-panel section carries the issue's token
// total over the active runs and the past ones. Here the running seats have a
// card of their own above this region (M-77), so this is the Task's execution
// history: the runs that finished, with their tokens, duration, cache-hit share
// and model. The rows are the Thread page's own (`ExecutionLogRow`), and the
// rows themselves come from `useThreadLog` — the same `loadThreadSessions` fold
// the rows render — so the total cannot disagree with the runs under it. The
// Host's `executionLog` snapshot stays the contract's mirror and is not read
// here. Unrecorded figures make the total partial (`≥ …`), and an all-unrecorded
// set shows no total at all (A1).
//
// Placement is the host's business: the issue's main column renders this under
// the running cards, so both presentations of the issue — the page and the
// slice — carry their history the same way.

import { useMemo } from 'react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamConversationProps } from '../slots.ts'
import { formatTokens } from '../reply-stats.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { ExecutionLogRow, runTokenTotal, useTickingNow, type LogRow } from '../thread/ExecutionLog.tsx'
import css from './issue-view.module.css'

export interface IssueExecutionLogProps {
  /** The runs that finished, newest first: the running seats are the cards above. */
  readonly rows: readonly LogRow[]
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly members: readonly AgentTeamClientMemberStatus[]
  /** A failed read of either the rows or their live activity. */
  readonly error?: string | undefined
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's execution history: the seats' finished runs on this Task, with
 * the Thread's spend over them on the header. Nothing here writes: a finished
 * run has nothing to stop, and its transcript is one control away.
 */
export function IssueExecutionLog({ rows, openMemberSession, members, error, t }: IssueExecutionLogProps) {
  const handleByMember = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  // Finished rows never read the clock — their duration is recorded — but the
  // row's contract asks for one instant, so it gets one that never ticks.
  const now = useTickingNow(false)
  // The same runs the rows render, summed once: a total the rows can't argue with.
  const total = useMemo(() => runTokenTotal(rows.map(row => row.run)), [rows])

  return (
    <section className={css.region} aria-label={t('issueExecutionHistoryLabel')} data-team-issue-execution-log data-testid="issue-execution-log">
      <div className={css.logHead}>
        <h2 className={css.regionHeading}>{t('issueExecutionHistoryLabel')}</h2>
        {total !== null && (
          <span className={css.logTotal} data-team-issue-log-total="" data-partial={total.partial ? '' : undefined}>
            {t('executionLogTotal', { tokens: `${total.partial ? '≥ ' : ''}${formatTokens(total.tokens)}` })}
          </span>
        )}
      </div>
      {rows.length === 0
        ? <p className={css.empty}>{t('issueExecutionHistoryEmpty')}</p>
        : rows.map(row => <ExecutionLogRow
            key={row.run.sessionId}
            row={row}
            now={now}
            handle={handleByMember.get(row.run.memberId) ?? row.run.memberId}
            tool={undefined}
            steps={undefined}
            stopping={false}
            onOpenSession={() => { openMemberSession(row.run.sessionId) }}
            timeAgo={timeAgo}
            t={t}
          />)}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
