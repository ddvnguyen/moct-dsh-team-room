// Derived from multica-x packages/views/issues/components/execution-log-section.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's right-panel section — a header carrying the
// issue's token total, the active runs, the past runs collapsed — over the
// same rows the Thread page's log renders. One data source (M-70, A2): the
// section reads `useThreadLog` — the `loadThreadSessions` fold the rows
// themselves come from — so the total cannot disagree with the runs under it.
// The Host's `executionLog` snapshot stays the contract's mirror and is not
// read here. Unrecorded figures make the total partial (`≥ …`), and an
// all-unrecorded set shows no total at all (A1). With no runs at all the
// section still renders — heading and the Thread page's empty state — because
// the page journey names the region on a task that has never run: a region
// with nothing to say is present rather than absent.
//
// Placement is the host's business: the page's sidebar (and its narrow-width
// drawer) render this; the slice has no sidebar, so it does not render it.

import { useMemo, useState } from 'react'
import type { AgentTeamClientMemberStatus } from '@ddvnguyen/moct-dsh-team-room/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamConversationProps } from '../slots.ts'
import { formatTokens } from '../reply-stats.ts'
import { makeTimeAgo } from '../multica/time-ago.ts'
import { ExecutionLogRow, runTokenTotal, useThreadLog, useTickingNow, type LogRow, type ThreadLogSource } from '../thread/ExecutionLog.tsx'
import css from './issue-view.module.css'

export interface IssueExecutionLogProps extends ThreadLogSource {
  readonly openMemberSession: TeamConversationProps['openMemberSession']
  readonly members: readonly AgentTeamClientMemberStatus[]
  readonly t: TeamConversationProps['t']
}

/**
 * The issue's execution-log section: the seats' runs on this Task, the live
 * ones first, the past ones collapsed, and the Thread's token spend on the
 * header. Stop asks first, the way the Thread page's log does.
 */
export function IssueExecutionLog({ openMemberSession, members, t, ...source }: IssueExecutionLogProps) {
  const { activeRows, pastRows, activities, stopping, error, stop } = useThreadLog(source)
  const [pastOpen, setPastOpen] = useState(false)
  const [confirmingStop, setConfirmingStop] = useState<LogRow>()

  const activityByMember = useMemo(() => new Map(activities.map(activity => [activity.memberId, activity])), [activities])
  const handleByMember = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle])), [members])
  const timeAgo = useMemo(() => makeTimeAgo({ justNow: t('timeJustNow'), minutesAgo: t('timeMinutesAgo'), hoursAgo: t('timeHoursAgo'), daysAgo: t('timeDaysAgo') }), [t])
  const now = useTickingNow(activeRows.length > 0)
  // The same runs the rows render, summed once: a total the rows can't argue with.
  const total = useMemo(() => runTokenTotal([...activeRows, ...pastRows].map(row => row.run)), [activeRows, pastRows])

  // A region with nothing to say is present rather than absent — the page
  // journey names `issue-execution-log` on a task that has never run, and the
  // Thread page's log reads the same empty state. The total stays out: there
  // is nothing to sum.
  const hasNoRows = activeRows.length === 0 && pastRows.length === 0
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

  return (
    <section className={css.region} aria-label={t('issueExecutionLogLabel')} data-team-issue-execution-log data-testid="issue-execution-log">
      <div className={css.logHead}>
        <h2 className={css.regionHeading}>{t('issueExecutionLogLabel')}</h2>
        {total !== null && (
          <span className={css.logTotal} data-team-issue-log-total="" data-partial={total.partial ? '' : undefined}>
            {t('executionLogTotal', { tokens: `${total.partial ? '≥ ' : ''}${formatTokens(total.tokens)}` })}
          </span>
        )}
      </div>
      {hasNoRows
        ? <p className={css.empty}>{t('executionLogEmpty')}</p>
        : <>
            {activeRows.map(renderRow)}
            {pastRows.length > 0 && (
              <div className={css.logPast}>
                <button
                  type="button"
                  className={css.logToggle}
                  aria-expanded={pastOpen}
                  onClick={() => { setPastOpen(open => !open) }}
                >
                  {t('executionLogPast')} ({pastRows.length})
                </button>
                {pastOpen && pastRows.map(renderRow)}
              </div>
            )}
          </>}
      {error !== undefined && <p className={css.error} role="alert">{error}</p>}
      {confirmingStop !== undefined && (
        <Modal
          open
          onClose={() => { setConfirmingStop(undefined) }}
          title={t('stopRunTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <Button variant="outline" onClick={() => { setConfirmingStop(undefined) }}>{t('cancel')}</Button>
            <Button variant="primary" onClick={() => { setConfirmingStop(undefined); stop(confirmingStop.run.sessionId) }}>{t('stopRun')}</Button>
          </>}
        >
          <p className={css.error}>{t('stopRunBody', { handle: handleByMember.get(confirmingStop.run.memberId) ?? confirmingStop.run.memberId })}</p>
        </Modal>
      )}
    </section>
  )
}
