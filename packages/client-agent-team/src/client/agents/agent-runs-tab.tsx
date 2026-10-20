// Derived from multica-x packages/views/agents/components/tabs/activity-tab.tsx @ 18fa9f728a9e25f2465df2789631edb2a75442ad. Copyright Index Labs. Multica License.
//
// Rendering adapted: Multica's activity tab reads AgentTask runs from its
// server and paints a 14-day activity chart beside a failure taxonomy. The
// Team Room's run ledger is `memberSessions` (one SessionRun row per dsh
// Session), so the table keeps the same columns — started, duration, turns,
// tokens in/out, cache hit, tool calls, model, Threads — and the chart plots
// tokens per day. A row opens its Session through the same native path the
// Sessions tab uses.

import type { AgentTeamSessionRun, AgentTeamThreadTurnFailure } from '@ddvnguyen/moct-dsh-team-room/types'
import type { TeamSidebarProps } from '../slots.ts'
import { formatAbsoluteTime } from '../team-formatters.ts'
import { formatTokens, UNKNOWN } from '../reply-stats.ts'
import {
  cacheHitLabel,
  failedSessions,
  failuresBySession,
  formatRunTime,
  tokenBuckets,
  tokensOfRun,
} from './agent-page-model.ts'
import { failureReasonLabel, failureTone } from './task-failure.ts'
import { Sparkline } from './Sparkline.tsx'
import css from './agent-page.module.css'

export interface RunPlace {
  readonly text: string
  readonly more: number
}

export function AgentRunsTab({ state, message, runs, current, failures, placeOf, onOpen, t }: {
  readonly state: 'loading' | 'failed' | 'ready'
  readonly message?: string | undefined
  readonly runs: readonly AgentTeamSessionRun[]
  /** The seat's current Session; its row is marked, not filtered out. */
  readonly current: string | null
  readonly failures: readonly AgentTeamThreadTurnFailure[]
  readonly placeOf: (run: AgentTeamSessionRun) => RunPlace | undefined
  readonly onOpen: (run: AgentTeamSessionRun) => void
  readonly t: TeamSidebarProps['t']
}) {
  const buckets = tokenBuckets(runs, failedSessions(failures))
  const bySession = failuresBySession(failures)
  const windowTokens = buckets.reduce((sum, bucket) => sum + bucket.total, 0)
  return (
    <div className={css.runs} data-agent-runs>
      <section className={css.chart} aria-label={t('agentRunsTokensTitle')} data-agent-runs-chart>
        <Sparkline buckets={buckets} width={196} height={40} label={t('agentRunsSparkline', { tokens: formatTokens(windowTokens) })} />
        <span className={css.chartLegend}>
          <strong>{formatTokens(windowTokens)}</strong>
          <span>{t('agentRunsTokensWindow')}</span>
        </span>
      </section>
      {state === 'loading' && <p className={css.muted}>{t('agentDetailsLoading')}</p>}
      {state === 'failed' && <p className={css.error} role="alert">{t('agentDetailsLoadFailed', { message: message ?? '' })}</p>}
      {state === 'ready' && runs.length === 0 && <p className={css.muted}>{t('agentRunsEmpty')}</p>}
      {state === 'ready' && runs.length > 0 && (
        <div className={css.tableWrap}>
          <table className={css.table} data-agent-runs-table>
            <thead>
              <tr>
                <th scope="col">{t('agentRunsStarted')}</th>
                <th scope="col" data-col="duration">{t('agentRunsDuration')}</th>
                <th scope="col" data-col="turns">{t('agentRunsTurns')}</th>
                <th scope="col">{t('agentRunsTokensIn')}</th>
                <th scope="col">{t('agentRunsTokensOut')}</th>
                <th scope="col" data-col="cache">{t('agentRunsCache')}</th>
                <th scope="col" data-col="tools">{t('agentRunsTools')}</th>
                <th scope="col" data-col="model">{t('agentRunsModel')}</th>
                <th scope="col" data-col="threads">{t('agentRunsThreads')}</th>
              </tr>
            </thead>
            {runs.map(run => {
              const partial = run.unknownInputTurns > 0
              const failuresHere = bySession.get(run.sessionId) ?? []
              const place = placeOf(run)
              return (
                <tbody key={run.sessionId} data-session-id={run.sessionId} data-current={run.sessionId === current || undefined}>
                  <tr className={css.runRow}>
                    <td>
                      <button type="button" className={css.runOpen} aria-label={t('agentDetailsOpen', { id: run.sessionId })} onClick={() => { onOpen(run) }}>
                        {formatAbsoluteTime(run.startedAt)}
                      </button>
                    </td>
                    <td data-col="duration">{formatRunTime(run.runMs)}</td>
                    <td data-col="turns">{String(run.turns)}</td>
                    <td className={css.numeric} title={partial ? t('agentDetailsPartialTitle', { count: String(run.unknownInputTurns) }) : undefined}>{partial ? `${formatTokens(run.tokensIn)}+` : formatTokens(run.tokensIn)}</td>
                    <td className={css.numeric}>{formatTokens(run.tokensOut)}</td>
                    <td data-col="cache">{cacheHitLabel(run)}</td>
                    <td data-col="tools">{String(run.toolCalls)}</td>
                    <td data-col="model">{run.model === null ? UNKNOWN : run.model.model}</td>
                    <td data-col="threads" className={css.threads}>{place === undefined ? t('agentDetailsNoThread') : place.text === '' ? t('agentDetailsThreads', { count: String(place.more + 1) }) : <>{place.text}{place.more > 0 ? ` +${String(place.more)}` : ''}</>}</td>
                  </tr>
                  {failuresHere.length > 0 && (
                    <tr className={css.failureRow} data-run-failures>
                      <td colSpan={9}>
                        <span className={css.failureList}>
                          {failuresHere.map(failure => {
                            const reason = failureReasonLabel(failure.reason)
                            const tone = failureTone(failure.reason)
                            return (
                              <span key={failure.sequence} className={css.failureChip} data-failure-tone={tone} title={reason ?? undefined}>
                                <span className={css.failureKind}>{t(tone === 'cancelled' ? 'agentRunsFailureCancelled' : tone === 'action' ? 'agentRunsFailureAction' : 'agentRunsFailure')}</span>
                                {reason !== null && <span className={css.failureReason}>{reason}</span>}
                                <span className={css.failureTurn}>{t('agentRunsFailureTurn', { turn: String(failure.turn) })}</span>
                              </span>
                            )
                          })}
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              )
            })}
          </table>
        </div>
      )}
      {state === 'ready' && runs.length > 0 && (
        <p className={css.muted}>{t('agentRunsTotals', {
          runs: String(runs.length),
          tokens: formatTokens(runs.reduce((sum, run) => sum + tokensOfRun(run), 0)),
          tools: String(runs.reduce((sum, run) => sum + run.toolCalls, 0)),
        })}</p>
      )}
    </div>
  )
}
